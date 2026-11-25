/**
 * NEO-656 — a team name the gate left for the operator controls itself at
 * commit, exactly as main's team review row did (NEO-602 D5, undecided rows
 * included).
 *
 * "Oakland Athletics" is the 1968-2024 Oakland row's own name and, since 2025,
 * an alias of the Athletics. A co-printed player whose ONLY same-name row has a
 * stint on the Athletics is resolved by the prelude's silent same-name
 * narrowing, and that stint agrees with the 2025 set's year, so the year-only
 * shortcut links the card to the Athletics. When the gate had raised the team
 * name (`resolveChecklistEntities` -> `unknownTeams`), main skipped that
 * shortcut: the name stayed pending for the operator. The gate stores no row
 * now, so the client hands the names back as `gateTeamNames`.
 */

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { normalizePlayerName } from "./players";
import { normalizeTeamName } from "./teams";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN_IDENTITY = {
  subject: "admin_gate_team_names_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_gate_team_names_001",
  name: "Admin User",
  role: "admin",
};

const NAME = "Oakland Athletics";

async function seedAthletics(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const sportId = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      sportConfig: {
        skuCode: "BB",
        league: "MLB",
        espn: { path: "baseball/mlb", leagueName: "Major League Baseball" },
        wikidata: { sportQid: "Q5369", hallOfFameQid: "Q1194380" },
      },
      platformData: {},
      children: [],
      lastUpdated: Date.now(),
    });
    const features = { manufacturer: "Topps", season: "2025" };
    const setNameId = await ctx.db.insert("selectorOptions", {
      level: "setName",
      value: "Chrome",
      platformData: {},
      features,
      parentId: sportId,
      children: [],
      lastUpdated: Date.now(),
    });
    await ctx.db.patch(sportId, { children: [setNameId] });
    const variantTypeId = await ctx.db.insert("selectorOptions", {
      level: "variantType",
      value: "Base",
      platformData: {},
      features,
      parentId: setNameId,
      children: [],
      lastUpdated: Date.now(),
    });
    await ctx.db.patch(setNameId, { children: [variantTypeId] });
    const oakland = await ctx.db.insert("teams", {
      location: "Oakland",
      name: "Athletics",
      nameNormalized: normalizeTeamName("Oakland Athletics"),
      sportId,
      yearsActive: { from: 1968, to: 2024 },
      lastUpdated: Date.now(),
    });
    const athletics = await ctx.db.insert("teams", {
      name: "Athletics",
      nameNormalized: normalizeTeamName("Athletics"),
      sportId,
      yearsActive: { from: 2025 },
      aliases: [NAME],
      lastUpdated: Date.now(),
    });
    await ctx.db.insert("teamAliases", {
      teamId: athletics,
      sportId,
      aliasNormalized: normalizeTeamName(NAME),
    });
    // The card's one co-printed player: exactly one row by that name, with a
    // stint on the Athletics, which agrees with the set's year.
    await ctx.db.insert("players", {
      name: "Jacob Wilson",
      nameNormalized: normalizePlayerName("Jacob Wilson"),
      sportId,
      lastUpdated: Date.now(),
      teamYears: [{ teamId: athletics, fromYear: 2025 }],
    });
    return { sportId, variantTypeId, oakland, athletics };
  });
}

function card() {
  return {
    cardNumber: "1",
    cardName: "Card",
    team: undefined,
    teams: [NAME],
    players: ["Jacob Wilson"],
    attributes: [],
    isRookie: false,
    isRelic: false,
    printRun: undefined,
    autographType: undefined,
    cardVariation: undefined,
    platformData: {},
    unmatched: undefined,
  };
}

const commit = (
  t: ReturnType<typeof convexTest>,
  w: { variantTypeId: Id<"selectorOptions">; sportId: Id<"selectorOptions"> },
  gateTeamNames?: string[],
) =>
  t.withIdentity(ADMIN_IDENTITY).action(api.selectorOptions.commitCardChecklist, {
    selectorOptionId: w.variantTypeId,
    sportId: w.sportId,
    cards: [card()],
    ...(gateTeamNames ? { gateTeamNames } : {}),
  });

const readCards = (t: ReturnType<typeof convexTest>, id: Id<"selectorOptions">) =>
  t.run(async (ctx) =>
    ctx.db
      .query("cardChecklist")
      .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", id))
      .collect(),
  );

describe("NEO-656: a team name the gate raised controls the commit prelude", () => {
  test("control: with no gate name, the player's stint agrees with the year and the card links to the Athletics", async () => {
    const t = convexTest(schema, modules);
    const w = await seedAthletics(t);

    const result = await commit(t, w);

    expect(result.unreviewedNameCount).toBe(0);
    const [row] = await readCards(t, w.variantTypeId);
    expect(row.teamOnCardIds).toEqual([w.athletics]);
  });

  test("a name in gateTeamNames is never linked by the year-only shortcut: it stays pending, as on main", async () => {
    const t = convexTest(schema, modules);
    const w = await seedAthletics(t);

    const result = await commit(t, w, [NAME]);

    expect(result.unreviewedNameCount).toBe(1);
    const [row] = await readCards(t, w.variantTypeId);
    expect(row.teamOnCardIds ?? []).toEqual([]);
    expect(row.pendingTeamNames).toEqual([NAME]);
  });

  test("the match is on the normalized name, so a differently spaced or cased spelling still controls", async () => {
    const t = convexTest(schema, modules);
    const w = await seedAthletics(t);

    await commit(t, w, ["  oakland   ATHLETICS "]);

    const [row] = await readCards(t, w.variantTypeId);
    expect(row.teamOnCardIds ?? []).toEqual([]);
    expect(row.pendingTeamNames).toEqual([NAME]);
  });
});
