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

/**
 * Collector review — Onyx prints teams as places. The operator's own link
 * settles "Seattle" exactly as the matcher's pair does: the one team in the
 * set's league(s) with that location, never against a team the card's data
 * already names, and never when two teams share it or the set has no league.
 */
describe("applyPublishedChecklistPairs — a team printed as a place", () => {
  const runPlace = async (
    cardTeams: string[],
    rowTeams: string[],
    options: { setLeague?: boolean } = { setLeague: true },
  ) => {
    const t = convexTest(schema, modules);
    const setId = await seed(t);
    await t.run(async (ctx) => {
      const mlb = (await ctx.db.query("leagues").collect()).find((l) => l.level === "major")!;
      const team = (name: string, location: string) =>
        ctx.db.insert("teams", {
          ...teamRowFields({ name, location }),
          sportId: mlb.sportId,
          leagueId: mlb._id,
          lastUpdated: 1,
        });
      await team("Mariners", "Seattle");
      await team("Yankees", "New York");
      await team("Mets", "New York");
      if (options.setLeague) await ctx.db.patch(setId, { leagueIds: [mlb._id] });
    });
    const before = await counts(t);
    const answers = await t.withIdentity(ADMIN).action(api.publishedChecklistPairs.applyPublishedChecklistPairs, {
      selectorOptionId: setId,
      pairs: [
        {
          card: { players: ["Cord Rager"], teams: cardTeams },
          row: { number: "1", players: ["Cord Rager"], teams: rowTeams },
        },
      ],
    });
    expect(await counts(t)).toEqual(before);
    return answers[0];
  };

  test("Seattle in an MLB set answers the card with the Mariners, as a checklist team", async () => {
    expect(await runPlace([], ["Seattle"])).toEqual({ teams: ["Seattle Mariners"], teamLookup: "checklist" });
  });

  test("a card whose data already names that team agrees with the row", async () => {
    expect(await runPlace(["Seattle Mariners"], ["Seattle"])).toEqual({
      teams: ["Seattle Mariners"],
      teamLookup: "checklist",
    });
  });

  test("a card whose data names a DIFFERENT team is a conflict; nothing is written over it (rule 8)", async () => {
    const answer = await runPlace(["Boston Red Sox"], ["Seattle"]);
    expect(answer).toEqual({
      checklistConflict: { teams: { marketplace: ["Boston Red Sox"], checklist: ["Seattle Mariners"] } },
    });
    expect(answer).not.toHaveProperty("teams");
  });

  test("New York is two MLB teams: the text stays as printed for the operator", async () => {
    expect(await runPlace([], ["New York"])).toEqual({ teams: ["New York"], teamLookup: "checklist" });
  });

  test("a set with no league leaves Seattle as printed", async () => {
    expect(await runPlace([], ["Seattle"], { setLeague: false })).toEqual({
      teams: ["Seattle"],
      teamLookup: "checklist",
    });
  });
});
