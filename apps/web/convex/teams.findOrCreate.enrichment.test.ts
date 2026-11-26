/**
 * NEO-645 — what the entity lookup said about a team rides onto the row
 * `teams.findOrCreate` creates.
 *
 * The review wizard's commit wrote the lookup's league suggestion, era, colours
 * and ESPN / Wikidata ids onto every team it created from a staged row. The
 * Tidy Up tiles create teams through this mutation, so it takes the same
 * enrichment and keeps the same rules:
 *
 *   - creation only: an existing team is returned untouched;
 *   - the operator's own answers win (league, years) and `null` ("No league")
 *     is never overridden by the suggestion;
 *   - the league is LINKED, never created (NEO-331);
 *   - a malformed value is dropped, never thrown on: it is a lookup's output.
 */

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = {
  subject: "admin_team_enrichment_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_team_enrichment_001",
  role: "admin",
};
type T = ReturnType<typeof convexTest>;

async function seedSport(t: T): Promise<Id<"selectorOptions">> {
  return t.run((ctx) =>
    ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      sportConfig: { skuCode: "BB", league: "MLB" },
      platformData: {},
      children: [],
      lastUpdated: Date.now(),
    }),
  );
}

async function seedLeague(t: T, sportId: Id<"selectorOptions">, name: string) {
  return t.run((ctx) =>
    ctx.db.insert("leagues", {
      level: "other" as const,
      name,
      nameNormalized: name.toLowerCase(),
      sportId,
      lastUpdated: Date.now(),
    }),
  );
}

const create = (t: T, args: Record<string, unknown>) =>
  t.withIdentity(ADMIN).mutation(api.teams.findOrCreate, args as never);
const team = (t: T, id: Id<"teams">) => t.run((ctx) => ctx.db.get(id));
const leagues = (t: T) => t.run((ctx) => ctx.db.query("leagues").collect());

describe("teams.findOrCreate: the lookup's enrichment (NEO-645)", () => {
  test("a new team keeps the lookup's colours, ESPN id, Wikidata id and era", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const id = await create(t, {
      location: "Sydney",
      name: "Blue Sox",
      sportId,
      enrichment: {
        yearsActive: { from: 2010, to: 2014 },
        colors: { primary: "#003DA5", secondary: "#fff" },
        espnId: "1234",
        wikidataId: "Q42",
      },
    });
    const row = (await team(t, id))!;
    expect(row.yearsActive).toEqual({ from: 2010, to: 2014 });
    expect(row.colors).toEqual({ primary: "#003DA5", secondary: "#fff" });
    expect(row.externalIds).toEqual({ wikidataId: "Q42", espnId: "1234" });
  });

  test("the operator's years win over the lookup's", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const id = await create(t, {
      name: "Jets",
      location: "Winnipeg",
      sportId,
      yearsActive: { from: 1972, to: 1996 },
      enrichment: { yearsActive: { from: 2011 } },
    });
    expect((await team(t, id))!.yearsActive).toEqual({ from: 1972, to: 1996 });
  });

  test("the suggested league is linked when the operator answered none, and never created", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const abl = await seedLeague(t, sportId, "Australian Baseball League");
    const linked = await create(t, {
      name: "Blue Sox",
      location: "Sydney",
      sportId,
      enrichment: { league: "Australian Baseball League" },
    });
    expect((await team(t, linked))!.leagueId).toBe(abl);

    const held = await create(t, {
      name: "Crawdads",
      location: "Hickory",
      sportId,
      enrichment: { league: "South Atlantic League" },
    });
    expect((await team(t, held))!.leagueId).toBeUndefined();
    expect((await leagues(t)).map((l) => l.name)).toEqual(["Australian Baseball League"]);
  });

  test("the operator's league, and a deliberate No league, beat the suggestion", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const abl = await seedLeague(t, sportId, "Australian Baseball League");
    const other = await seedLeague(t, sportId, "Mexican League");
    const picked = await create(t, {
      name: "Blue Sox",
      location: "Sydney",
      sportId,
      leagueId: other,
      enrichment: { league: "Australian Baseball League" },
    });
    expect((await team(t, picked))!.leagueId).toBe(other);
    const none = await create(t, {
      name: "Heat",
      location: "Perth",
      sportId,
      leagueId: null,
      enrichment: { league: "Australian Baseball League" },
    });
    expect((await team(t, none))!.leagueId).toBeUndefined();
    expect(abl).toBeTruthy();
  });

  test("a malformed value is dropped, the team is still created", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const id = await create(t, {
      name: "Blue Sox",
      location: "Sydney",
      sportId,
      enrichment: {
        yearsActive: { from: 2014, to: 2010 },
        colors: { primary: "javascript:alert(1)", secondary: "#abc" },
        espnId: "not-digits",
        wikidataId: "Q42; DROP",
      },
    });
    const row = (await team(t, id))!;
    expect(row.yearsActive).toBeUndefined();
    expect(row.colors).toEqual({ secondary: "#abc" });
    expect(row.externalIds).toBeUndefined();
  });

  test("an existing team is returned untouched: enrichment is creation-only", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const first = await create(t, { name: "Padres", location: "San Diego", sportId });
    const again = await create(t, {
      name: "Padres",
      location: "San Diego",
      sportId,
      enrichment: { colors: { primary: "#112233" }, espnId: "25", wikidataId: "Q1" },
    });
    expect(again).toBe(first);
    const row = (await team(t, first))!;
    expect(row.colors).toBeUndefined();
    expect(row.externalIds).toBeUndefined();
  });
});
