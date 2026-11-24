/**
 * NEO-645 / NEO-656 (ported from NEO-602 `playerStepContext.test.ts`) — the
 * gate's decision for a same-name player, now returned as facts (nothing is
 * stored).
 *
 * The 2026 Topps Chrome case: four Luis Castillos on file in baseball, two of
 * them with the Mariners on the printed card's roster in 2026, so the printed
 * team separates neither. The gate must ask (the name is unknown AND ambiguous,
 * no link), and a card that names no team asks too. The card's context is read
 * live (`tidyCards.cardContext`).
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
  subject: "admin_player_step_context_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_player_step_context_001",
  name: "Admin User",
  role: "admin",
};

const NAME = "Luis Castillo";
const MARINERS = "Seattle Mariners";

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
      await ctx.db.patch(fields.parentId, {
        children: [...(parent?.children ?? []), id],
      });
    }
    return id;
  });
}

async function setup(t: T) {
  const sportId = await node(t, { level: "sport", value: "Baseball" });
  const year = await node(t, { level: "year", value: "2026", parentId: sportId });
  const brand = await node(t, { level: "manufacturer", value: "Topps", parentId: year });
  const set = await node(t, { level: "setName", value: "Chrome", parentId: brand });
  await node(t, { level: "variantType", value: "Base", parentId: set });
  const insert = await node(t, { level: "variantType", value: "Insert", parentId: set });
  const team = (location: string, name: string, from: number, to?: number) =>
    t.run((ctx) =>
      ctx.db.insert("teams", {
        location,
        name,
        nameNormalized: normalizeTeamName(`${location} ${name}`),
        sportId,
        yearsActive: { from, ...(to !== undefined ? { to } : {}) },
        lastUpdated: Date.now(),
      }),
    );
  const mariners = await team("Seattle", "Mariners", 1977);
  const reds = await team("Cincinnati", "Reds", 1890);
  const tigers = await team("Detroit", "Tigers", 1901);
  const marlins = await team("Florida", "Marlins", 1993, 2011);
  const twins = await team("Minnesota", "Twins", 1961);
  return { sportId, insert, mariners, reds, tigers, marlins, twins };
}

function player(
  t: T,
  sportId: Sel,
  name: string,
  extra: {
    birthYear?: number;
    teamYears?: Array<{ teamId: Id<"teams">; fromYear?: number; toYear?: number }>;
  } = {},
) {
  return t.run((ctx) =>
    ctx.db.insert("players", {
      name,
      nameNormalized: normalizePlayerName(name),
      sportId,
      ...extra,
      lastUpdated: Date.now(),
    }),
  );
}

/** The four Luis Castillos of the 2026 Topps Chrome case. */
async function castillos(t: T, s: Awaited<ReturnType<typeof setup>>) {
  const retired = await player(t, s.sportId, NAME, {
    birthYear: 1975,
    teamYears: [
      { teamId: s.marlins, fromYear: 1996, toYear: 2005 },
      { teamId: s.twins, fromYear: 2006, toYear: 2007 },
    ],
  });
  const pitcher = await player(t, s.sportId, NAME, {
    birthYear: 1992,
    teamYears: [
      { teamId: s.reds, fromYear: 2017, toYear: 2022 },
      { teamId: s.mariners, fromYear: 2022 },
    ],
  });
  const second = await player(t, s.sportId, NAME, {
    birthYear: 1995,
    teamYears: [
      { teamId: s.tigers, fromYear: 2022, toYear: 2022 },
      { teamId: s.mariners, fromYear: 2025 },
    ],
  });
  const bare = await player(t, s.sportId, NAME);
  return { retired, pitcher, second, bare };
}

const card = (players: string[], n: number | string, teams: string[] = [MARINERS]) => ({
  cardNumber: `${n}`,
  cardName: "Card",
  players,
  teams,
  platformData: {},
});

async function gate(t: T, s: { sportId: Sel; insert: Sel }, cards: ReturnType<typeof card>[]) {
  return t.withIdentity(ADMIN).action(api.selectorOptions.resolveChecklistEntities, {
    selectorOptionId: s.insert,
    sportId: s.sportId,
    cards,
  });
}

describe("the gate: both Mariners rows were on the roster, so the printed team separates neither", () => {
  test("the name goes to the operator: unknown, ambiguous, and no automatic link", async () => {
    const t = newT();
    const s = await setup(t);
    await castillos(t, s);

    const result = await gate(t, s, [card([NAME], 62)]);

    expect(result.unknownPlayers).toEqual([NAME]);
    expect(result.ambiguousPlayers).toEqual([NAME]);
    expect(result.gateLinks ?? []).toEqual([]);
  });

  test("a card that names no team asks too", async () => {
    const t = newT();
    const s = await setup(t);
    await castillos(t, s);

    const result = await gate(t, s, [card([NAME], 62, [])]);

    expect(result.ambiguousPlayers).toEqual([NAME]);
    expect(result.gateLinks ?? []).toEqual([]);
  });

  test("a name nobody has on file is unknown and not ambiguous", async () => {
    const t = newT();
    const s = await setup(t);

    const result = await gate(t, s, [card(["Nobody Atall"], 1)]);

    expect(result.unknownPlayers).toEqual(["Nobody Atall"]);
    expect(result.ambiguousPlayers ?? []).toEqual([]);
    expect(result.gateLinks ?? []).toEqual([]);
  });

  test("the same name on two cards is listed once (the walk answers it once)", async () => {
    const t = newT();
    const s = await setup(t);
    await castillos(t, s);

    const result = await gate(t, s, [card([NAME], 62), card([NAME], 63)]);

    expect(result.unknownPlayers).toEqual([NAME]);
  });

  test("the gate stores nothing: no player or team row is added", async () => {
    const t = newT();
    const s = await setup(t);
    await castillos(t, s);
    const count = () => t.run(async (ctx) => (await ctx.db.query("players").collect()).length);
    const before = await count();
    await gate(t, s, [card([NAME], 62)]);
    expect(await count()).toBe(before);
  });
});
