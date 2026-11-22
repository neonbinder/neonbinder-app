/**
 * NEO-602 — what a TEAM review step shows: the cards that printed the name,
 * their players with the stints we know, and the team rows the name reached.
 *
 * Driven through the real gate (`selectorOptions.resolveChecklistEntities`),
 * which writes `entityReviewQueue.teamContext` at insert, and the real
 * `entityReviewQueue.teamStepContext` query the wizard reads it back with.
 *
 * Fixture: three rows answer to "Baltimore Orioles" (the 1954- club, the
 * 1901-1902 club and the 1882-1899 American Association club) under a 2026
 * set. Several players have dated stints on the 1954- row; others (recent
 * trades whose NB stints predate the move) have none on any row.
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
  subject: "admin_team_step_context_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_team_step_context_001",
  name: "Admin User",
  role: "admin",
};
const OTHER_ADMIN = {
  subject: "admin_team_step_context_002",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_team_step_context_002",
  name: "Other Admin",
  role: "admin",
};

const NAME = "Baltimore Orioles";

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
  const leagueId = await t.run((ctx) =>
    ctx.db.insert("leagues", {
      name: "Major League Baseball",
      nameNormalized: "major league baseball",
      sportId,
      level: "major",
      lastUpdated: Date.now(),
    } as never),
  );
  const row = (years: { from: number; to?: number }, withLeague = false) =>
    t.run((ctx) =>
      ctx.db.insert("teams", {
        location: "Baltimore",
        name: "Orioles",
        nameNormalized: normalizeTeamName(NAME),
        sportId,
        yearsActive: years,
        ...(withLeague ? { leagueId } : {}),
        lastUpdated: Date.now(),
      }),
    );
  const now = await row({ from: 1954 }, true);
  const old = await row({ from: 1901, to: 1902 });
  const aa = await row({ from: 1882, to: 1899 });
  return { sportId, insert, now, old, aa };
}

function player(
  t: T,
  sportId: Sel,
  name: string,
  teamYears: Array<{ teamId: Id<"teams">; fromYear?: number; toYear?: number }>,
) {
  return t.run((ctx) =>
    ctx.db.insert("players", {
      name,
      nameNormalized: normalizePlayerName(name),
      sportId,
      teamYears,
      lastUpdated: Date.now(),
    }),
  );
}

const card = (players: string[], n: number, teams = [NAME]) => ({
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

async function teamRows(t: T, batchId: string | undefined) {
  if (!batchId) return [];
  return (await t.run((ctx) => ctx.db.query("entityReviewQueue").collect())).filter(
    (r) => r.batchId === batchId && r.kind === "team",
  );
}

describe("the gate: silent cards abstain (the 2026 Topps Chrome Baltimore Orioles regression)", () => {
  test("six players on the 1954- row and four with no stint on any row: settled by the year-agreeing players, no team step", async () => {
    const t = newT();
    const s = await setup(t);
    const names = ["A One", "B Two", "C Three", "D Four", "E Five", "F Six"];
    for (const [i, n] of names.entries()) {
      await player(t, s.sportId, n, [{ teamId: s.now, fromYear: 2015 + i, toYear: 2016 + i }]);
    }
    const silent = ["Baz Silent", "Alonso Silent", "Bassitt Silent", "Ward Silent"];
    for (const n of silent) await player(t, s.sportId, n, []);

    const result = await gate(
      t,
      s,
      [...names, ...silent].map((n, i) => card([n], i + 1)),
    );

    expect(result.unknownTeams).toEqual([]);
    // The players' answer is the year's own: linked silently, no decided row.
    expect(await teamRows(t, result.batchId)).toEqual([]);
  });
});
