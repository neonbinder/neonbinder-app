/**
 * NEO-602 x NEO-574 — a printed team name that fits two eras, with the
 * career check beside it. Two review-gate answers the Playwright specs
 * `checklist-two-era-team-name-silent-card-abstains` and
 * `checklist-two-era-team-name-asks-the-operator` depend on, pinned at the
 * action (`selectorOptions.resolveChecklistEntities`):
 *
 *  1. The silent card. Two cards print the current era's name; #1's player has
 *     a stint on it (a voter), #2's player has no stints at all. The NAME is
 *     linked silently (NEO-602: the silent card abstains, the voter's era is
 *     the year's own pick), so nothing is asked about the team. The career
 *     check (NEO-574) is a separate question: #2's player has nothing on file
 *     for the team the gate resolved, so the gate reports that gap and the
 *     wizard opens on "Career check". Both hold at once.
 *
 *  2. The asked name. The name fits two eras and the player has stints on both,
 *     so the name is asked (unknown, with both rows offered) and the gate does
 *     NOT resolve a team id for it: no gap is judged here. The wizard reads
 *     the pair's coverage itself once the operator has picked a team, and
 *     holds "Next" while it does.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { normalizePlayerName } from "./players";
import { normalizeTeamName } from "./teams";
import { cancelScheduled } from "../lib/testing/drain-scheduled";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = {
  subject: "admin_era_name_career_check_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_era_name_career_check_001",
  name: "Admin User",
  role: "admin",
};

type T = ReturnType<typeof convexTest>;
type Sel = Id<"selectorOptions">;

const live: T[] = [];
function newT(): T {
  const t = convexTest(schema, modules);
  live.push(t);
  return t;
}
afterEach(async () => {
  for (const t of live.splice(0)) await cancelScheduled(t);
});

async function node(
  t: T,
  fields: { level: string; value: string; parentId?: Sel },
): Promise<Sel> {
  return t.run(async (ctx) => {
    const id = await ctx.db.insert("selectorOptions", {
      ...fields,
      platformData: {},
      children: [],
      lastUpdated: Date.now(),
    });
    if (fields.parentId) {
      const parent = await ctx.db.get(fields.parentId);
      await ctx.db.patch(fields.parentId, { children: [...(parent?.children ?? []), id] });
    }
    return id;
  });
}

/** sport › year 2025 › Topps › set › Insert, then the two-era club (the Orioles shape). */
async function world(t: T) {
  const sportId = await node(t, { level: "sport", value: "Baseball" });
  const year = await node(t, { level: "year", value: "2025", parentId: sportId });
  const brand = await node(t, { level: "manufacturer", value: "Topps", parentId: year });
  const set = await node(t, { level: "setName", value: "Series 1", parentId: brand });
  const insert = await node(t, { level: "variantType", value: "Insert", parentId: set });
  const CURRENT = "Baltimore Orioles";
  const current = await t.run((ctx) =>
    ctx.db.insert("teams", {
      location: "Baltimore",
      name: "Orioles",
      nameNormalized: normalizeTeamName(CURRENT),
      sportId,
      yearsActive: { from: 1954 },
      lastUpdated: Date.now(),
    }),
  );
  // The past era answers to the current era's full name as an ALIAS.
  const past = await t.run(async (ctx) => {
    const id = await ctx.db.insert("teams", {
      location: "Milwaukee",
      name: "Brewers",
      nameNormalized: normalizeTeamName("Milwaukee Brewers"),
      sportId,
      aliases: [CURRENT],
      yearsActive: { from: 1901, to: 1902 },
      lastUpdated: Date.now(),
    });
    await ctx.db.insert("teamAliases", {
      teamId: id,
      sportId,
      aliasNormalized: normalizeTeamName(CURRENT),
    });
    return id;
  });
  return { sportId, insert, current, past, CURRENT };
}

function player(
  t: T,
  sportId: Sel,
  name: string,
  stints: Array<{ teamId: Id<"teams">; fromYear: number; toYear: number }>,
): Promise<Id<"players">> {
  return t.run((ctx) =>
    ctx.db.insert("players", {
      name,
      nameNormalized: normalizePlayerName(name),
      sportId,
      ...(stints.length > 0 ? { teamYears: stints } : {}),
      lastUpdated: Date.now(),
    }),
  );
}

function card(n: number, playerName: string, team: string) {
  return {
    cardNumber: `${n}`,
    cardName: "Card",
    players: [playerName],
    teams: [team],
    platformData: {},
  };
}

async function gate(t: T, w: { sportId: Sel; insert: Sel }, cards: ReturnType<typeof card>[]) {
  return t.withIdentity(ADMIN).action(api.selectorOptions.resolveChecklistEntities, {
    selectorOptionId: w.insert,
    sportId: w.sportId,
    cards,
  });
}

describe("NEO-602 x NEO-574: a two-era name and the career check", () => {
  test("the silent card abstains: the name links silently AND the silent player is a career gap", async () => {
    const t = newT();
    const w = await world(t);
    const voter = await player(t, w.sportId, "Cur Aho", [
      { teamId: w.current, fromYear: 2023, toYear: 2025 },
    ]);
    const silent = await player(t, w.sportId, "Sil Aho", []);

    const result = await gate(t, w, [
      card(1, "Cur Aho", w.CURRENT),
      card(2, "Sil Aho", w.CURRENT),
    ]);

    // NEO-602: nothing asked about the name, nothing linked for the operator.
    expect(result.unknownTeams).toEqual([]);
    expect(result.unknownPlayers).toEqual([]);
    expect(result.autoLinkedCount).toBe(0);
    // NEO-574: the name resolved to the year's era, so the career is judged
    // there: the voter is covered, the silent player has nothing on file.
    expect(result.careerContext?.teams).toEqual([{ printed: w.CURRENT, teamId: w.current }]);
    expect(result.careerContext?.gaps).toEqual([{ teamId: w.current, playerIds: [silent] }]);
    expect(result.careerContext?.gaps.flatMap((g) => g.playerIds)).not.toContain(voter);
  });

  test("a name whose player has stints on both eras is asked, and no team is resolved for the career check", async () => {
    const t = newT();
    const w = await world(t);
    await player(t, w.sportId, "Bot Aho", [
      { teamId: w.current, fromYear: 2025, toYear: 2025 },
      { teamId: w.past, fromYear: 1901, toYear: 1902 },
    ]);

    const result = await gate(t, w, [card(1, "Bot Aho", w.CURRENT)]);

    expect(result.unknownTeams).toEqual([w.CURRENT]);
    // Unresolved at the gate: no team id for the career check to judge, so no
    // gap (the wizard reads the coverage of the operator's pick itself).
    expect(result.careerContext?.teams).toEqual([]);
    expect(result.careerContext?.gaps).toEqual([]);
  });
});
