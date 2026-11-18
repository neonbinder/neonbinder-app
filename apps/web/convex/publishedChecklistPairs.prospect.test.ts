/**
 * NEO-591 — `applyPublishedChecklistPairs` with a "Prospect (X)" row, through
 * the real team reads (`resolveProspectTeams`): the operator's own link settles
 * X exactly as the fetch's matcher does. A settled X becomes the one minor or
 * college team's full name; anything else is held and is never a team string
 * (rule 8); an MLB club is never offered. Nothing is written.
 */
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { teamRowFields } from "./lib/teamRow";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = {
  subject: "admin_pairs_prospect_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_pairs_prospect_001",
  role: "admin",
};

type T = ReturnType<typeof convexTest>;

/** Baseball -> 2024 -> a set, with an MLB, a minor and a college league and a few teams. */
async function seed(t: T) {
  return t.run(async (ctx) => {
    const sportId = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      platformData: {},
      children: [],
      lastUpdated: 1,
    });
    const yearId = await ctx.db.insert("selectorOptions", {
      level: "year",
      value: "2024",
      platformData: {},
      parentId: sportId,
      children: [],
      lastUpdated: 1,
    });
    const setId = await ctx.db.insert("selectorOptions", {
      level: "setName",
      value: "2024 Onyx",
      platformData: {},
      parentId: yearId,
      children: [],
      lastUpdated: 1,
    });
    const league = (name: string, level: "major" | "minor" | "college") =>
      ctx.db.insert("leagues", { name, nameNormalized: name.toLowerCase(), sportId, level, lastUpdated: 1 });
    const mlb = await league("Major League Baseball", "major");
    const college = await league("NCAA Division I", "college");
    const team = (name: string, location: string, leagueId: Id<"leagues">) =>
      ctx.db.insert("teams", { ...teamRowFields({ name, location }), sportId, leagueId, lastUpdated: 1 });
    await team("Sooners", "Oklahoma", college);
    await team("Diamondbacks", "Arizona", mlb);
    return setId;
  });
}

async function counts(t: T) {
  return t.run(async (ctx) => ({
    teams: (await ctx.db.query("teams").collect()).length,
    players: (await ctx.db.query("players").collect()).length,
    selectorOptions: (await ctx.db.query("selectorOptions").collect()).length,
    candidates: (await ctx.db.query("checklistCandidates").collect()).length,
  }));
}

type Row = { number: string; players: string[]; teams: string[]; noTeam?: boolean; prospect?: boolean; prospectTeams?: string[] };
const run = async (cardTeams: string[], row: Partial<Row>) => {
  const t = convexTest(schema, modules);
  const setId = await seed(t);
  const before = await counts(t);
  const answers = await t.withIdentity(ADMIN).action(api.publishedChecklistPairs.applyPublishedChecklistPairs, {
    selectorOptionId: setId,
    pairs: [
      {
        card: { players: ["Cord Rager"], teams: cardTeams },
        row: { number: "NNO", players: ["Cord Rager"], teams: [], ...row },
      },
    ],
  });
  expect(await counts(t)).toEqual(before);
  return answers[0];
};

describe("applyPublishedChecklistPairs — Prospect (X)", () => {
  test("a college team found by its place answers the card with its full name", async () => {
    expect(await run([], { prospect: true, prospectTeams: ["Oklahoma"] })).toEqual({
      teams: ["Oklahoma Sooners"],
      teamLookup: "checklist",
      isProspect: true,
    });
  });

  test("a prospect cell sent as the raw team string reads the same", async () => {
    expect(await run([], { teams: ["Prospect (Oklahoma)"] })).toEqual(
      await run([], { prospect: true, prospectTeams: ["Oklahoma"] }),
    );
  });

  test("an X only an MLB club answers to is held: no team, the X as the listing's name", async () => {
    const answer = await run([], { prospect: true, prospectTeams: ["Arizona"] });
    expect(answer).toEqual({
      teams: [],
      teamLookup: "checklist",
      isProspect: true,
      prospectTeam: "Arizona",
      prospectTeams: ["Arizona"],
      rawTeamName: "Arizona",
    });
  });

  test("an X no team answers to is held", async () => {
    const answer = await run([], { prospect: true, prospectTeams: ["Texas"] });
    expect(answer).toMatchObject({ teams: [], prospectTeam: "Texas", prospectTeams: ["Texas"], isProspect: true });
  });

  test("a held X against a card with a team is a conflict flagged as a prospect claim, and writes no team", async () => {
    const answer = await run(["Boston Red Sox"], { prospect: true, prospectTeams: ["Arizona"] });
    expect(answer).toEqual({
      checklistConflict: { teams: { marketplace: ["Boston Red Sox"], checklist: [], prospectClaim: true } },
      isProspect: true,
      prospectTeam: "Arizona",
      prospectTeams: ["Arizona"],
    });
    expect(answer).not.toHaveProperty("teams");
  });

  test("a settled X against a different team is the ordinary conflict, flagged as a prospect claim", async () => {
    const answer = await run(["Boston Red Sox"], { prospect: true, prospectTeams: ["Oklahoma"] });
    expect(answer).toEqual({
      checklistConflict: {
        teams: { marketplace: ["Boston Red Sox"], checklist: ["Oklahoma Sooners"], prospectClaim: true },
      },
      isProspect: true,
    });
  });

  test("a settled X that is the card's own team changes nothing but the prospect mark", async () => {
    expect(await run(["Oklahoma Sooners"], { prospect: true, prospectTeams: ["Oklahoma"] })).toEqual({
      teams: ["Oklahoma Sooners"],
      teamLookup: "checklist",
      isProspect: true,
    });
  });

  test("a bare Prospect answers a teamless card with no team and marks it a prospect", async () => {
    expect(await run([], { prospect: true, noTeam: true })).toEqual({
      teams: [],
      teamLookup: "checklist",
      isProspect: true,
    });
  });

  test("a bare Prospect sent as the raw team string reads the same", async () => {
    expect(await run([], { teams: ["Prospect"] })).toEqual(await run([], { prospect: true, noTeam: true }));
  });

  test("refuses a row that says No Team and names an X, writing nothing", async () => {
    const t = convexTest(schema, modules);
    const setId = await seed(t);
    const before = await counts(t);
    await expect(
      t.withIdentity(ADMIN).action(api.publishedChecklistPairs.applyPublishedChecklistPairs, {
        selectorOptionId: setId,
        pairs: [
          {
            card: { players: [], teams: [] },
            row: { number: "NNO", players: ["Cord Rager"], teams: [], noTeam: true, prospectTeams: ["Oklahoma"] },
          },
        ],
      }),
    ).rejects.toThrow(/says No Team and names a team/);
    expect(await counts(t)).toEqual(before);
  });
});
