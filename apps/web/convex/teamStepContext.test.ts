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

describe("the gate carries the team step's context onto the queue row", () => {
  test("an ambiguous name stores its candidate rows and its cards, with player ids where the gate resolved them", async () => {
    const t = newT();
    const s = await setup(t);
    const recent = await player(t, s.sportId, "Recent Oriole", [
      { teamId: s.now, fromYear: 2020, toYear: 2023 },
    ]);
    await player(t, s.sportId, "Dead Ball", [{ teamId: s.old, fromYear: 1901, toYear: 1902 }]);

    const result = await gate(t, s, [
      card(["Recent Oriole"], 7),
      card(["Dead Ball"], 8),
    ]);

    expect(result.unknownTeams).toEqual([NAME]);
    const [row] = await teamRows(t, result.batchId);
    expect(row.teamContext?.candidateTeamIds.slice().sort()).toEqual(
      [s.now, s.old, s.aa].sort(),
    );
    expect(row.teamContext?.moreCards).toBe(0);
    // Rows that answer to the printed name: not a place.
    expect(row.teamContext?.place).toBeUndefined();
    const step = await t
      .withIdentity(ADMIN)
      .query(api.entityReviewQueue.teamStepContext, { reviewRowId: row._id });
    expect(step?.fromPlace).toBeUndefined();
    expect(row.teamContext?.cards).toEqual([
      { number: "7", players: [{ name: "Recent Oriole", playerId: recent }] },
      {
        number: "8",
        players: [{ name: "Dead Ball", playerId: expect.any(String) }],
      },
    ]);
  });

  test("a team the batch linked for the operator carries its context too, so a Change shows the cards", async () => {
    const t = newT();
    const s = await setup(t);
    // His only stint is on the old club; the 2026 year would pick the current
    // one. The players' answer contradicts the year: a visible decided row.
    await player(t, s.sportId, "Dead Ball", [{ teamId: s.old, fromYear: 1901, toYear: 1902 }]);

    const result = await gate(t, s, [card(["Dead Ball"], 8)]);

    expect(result.unknownTeams).toEqual([]);
    const [row] = await teamRows(t, result.batchId);
    expect(row.decision).toMatchObject({ action: "link", linkedTeamId: s.old, autoLinked: "careerTeam" });
    expect(row.teamContext?.candidateTeamIds).toHaveLength(3);
    expect(row.teamContext?.cards).toEqual([
      { number: "8", players: [{ name: "Dead Ball", playerId: expect.any(String) }] },
    ]);
    // A Change keeps it: the row is a team step again, with its cards.
    await t.withIdentity(ADMIN).mutation(api.entityReviewQueue.clearDecision, {
      reviewRowId: row._id,
    });
    const cleared = await t.run((ctx) => ctx.db.get(row._id));
    expect(cleared?.decision).toBeUndefined();
    expect(cleared?.teamContext?.cards).toHaveLength(1);
  });

  test("a name no row holds still carries its cards, with no candidates", async () => {
    const t = newT();
    const s = await setup(t);
    const result = await gate(t, s, [card(["Somebody New"], 3, ["Nowhere Nobodies"])]);

    expect(result.unknownTeams).toEqual(["Nowhere Nobodies"]);
    const [row] = await teamRows(t, result.batchId);
    expect(row.teamContext).toEqual({
      candidateTeamIds: [],
      cards: [{ number: "3", players: [{ name: "Somebody New" }] }],
      moreCards: 0,
    });
  });

  test("the cards listed are bounded at 16, and the rest are counted", async () => {
    const t = newT();
    const s = await setup(t);
    const cards = Array.from({ length: 20 }, (_, i) =>
      card([`Player ${i}`], i + 1, ["Nowhere Nobodies"]),
    );
    const result = await gate(t, s, cards);

    const [row] = await teamRows(t, result.batchId);
    expect(row.teamContext?.cards).toHaveLength(16);
    expect(row.teamContext?.moreCards).toBe(4);
  });

  test("a card filed twice (the same number and players) is listed and counted once", async () => {
    const t = newT();
    const s = await setup(t);
    const result = await gate(t, s, [
      card(["Same Player"], 5, ["Nowhere Nobodies"]),
      card(["Same Player"], 5, ["Nowhere Nobodies"]),
    ]);
    const [row] = await teamRows(t, result.batchId);
    expect(row.teamContext?.cards).toHaveLength(1);
    expect(row.teamContext?.moreCards).toBe(0);
  });

  test("a name added by a second fetch (the resume path) carries its context too", async () => {
    const t = newT();
    const s = await setup(t);
    const first = await gate(t, s, [card(["First Player"], 1, ["Nowhere Nobodies"])]);
    const second = await gate(t, s, [
      card(["First Player"], 1, ["Nowhere Nobodies"]),
      card(["Second Player"], 2, ["Elsewhere United"]),
    ]);

    expect(second.batchId).toBe(first.batchId);
    const rows = await teamRows(t, second.batchId);
    const added = rows.find((r) => r.name === "Elsewhere United");
    expect(added?.teamContext?.cards).toEqual([
      { number: "2", players: [{ name: "Second Player" }] },
    ]);
  });

  test("getBatch shows the wizard the candidate rows and nothing else of the context", async () => {
    const t = newT();
    const s = await setup(t);
    await player(t, s.sportId, "Recent Oriole", [{ teamId: s.now, fromYear: 2020, toYear: 2023 }]);
    await player(t, s.sportId, "Dead Ball", [{ teamId: s.old, fromYear: 1901, toYear: 1902 }]);
    const result = await gate(t, s, [card(["Recent Oriole"], 7), card(["Dead Ball"], 8)]);

    const rows = await t.withIdentity(ADMIN).query(api.entityReviewQueue.getBatch, {
      selectorOptionId: s.insert,
      batchId: result.batchId!,
    });
    const teamRow = rows.find((r) => r.kind === "team");
    expect(Object.keys(teamRow?.teamContext ?? {})).toEqual(["candidateTeamIds"]);
    expect(teamRow?.teamContext?.candidateTeamIds).toHaveLength(3);
  });
});

describe("entityReviewQueue.teamStepContext", () => {
  async function ambiguous() {
    const t = newT();
    const s = await setup(t);
    await player(t, s.sportId, "Recent Oriole", [
      { teamId: s.now, fromYear: 2020, toYear: 2023 },
      { teamId: s.old, fromYear: 1901 },
    ]);
    await player(t, s.sportId, "Undated Oriole", [{ teamId: s.now }]);
    await player(t, s.sportId, "Dead Ball", [{ teamId: s.old, fromYear: 1901, toYear: 1902 }]);
    const result = await gate(t, s, [
      card(["Recent Oriole", "Undated Oriole"], 7),
      card(["Dead Ball"], 8),
    ]);
    const [row] = await teamRows(t, result.batchId);
    return { t, s, row };
  }

  test("candidates come newest era first, each with its era and league", async () => {
    const { t, s, row } = await ambiguous();
    const ctx = await t
      .withIdentity(ADMIN)
      .query(api.entityReviewQueue.teamStepContext, { reviewRowId: row._id });

    expect(ctx?.candidates).toEqual([
      {
        teamId: s.now,
        fullName: "Baltimore Orioles",
        era: "1954–present",
        league: "Major League Baseball",
      },
      { teamId: s.old, fullName: "Baltimore Orioles", era: "1901–1902" },
      { teamId: s.aa, fullName: "Baltimore Orioles", era: "1882–1899" },
    ]);
  });

  test("each player lists the stints we know, a candidate row named with its era, an undated stint with no years", async () => {
    const { t, s, row } = await ambiguous();
    const ctx = await t
      .withIdentity(ADMIN)
      .query(api.entityReviewQueue.teamStepContext, { reviewRowId: row._id });

    expect(ctx?.cards.map((c) => c.number)).toEqual(["7", "8"]);
    const [recent, undated] = ctx!.cards[0].players;
    expect(recent.name).toBe("Recent Oriole");
    expect(recent.stints).toEqual([
      { teamId: s.old, label: "Baltimore Orioles · 1901–1902", years: "1901–present" },
      { teamId: s.now, label: "Baltimore Orioles · 1954–present", years: "2020–23" },
    ]);
    expect(undated.stints).toEqual([
      { teamId: s.now, label: "Baltimore Orioles · 1954–present", years: "" },
    ]);
    expect(ctx?.moreCards).toBe(0);
  });

  test("players on different rows do not settle it: the reason is true", async () => {
    const { t, row } = await ambiguous();
    const ctx = await t
      .withIdentity(ADMIN)
      .query(api.entityReviewQueue.teamStepContext, { reviewRowId: row._id });
    expect(ctx?.playersDontSettle).toBe(true);
  });

  test("no player has played for any row: no reason is claimed", async () => {
    const t = newT();
    const s = await setup(t);
    // Two undated rows the year cannot separate, and a player with no stints
    // at all: a tie nothing but the operator can settle.
    await t.run(async (ctx) => {
      await ctx.db.patch(s.now, { yearsActive: undefined });
      await ctx.db.patch(s.old, { yearsActive: undefined });
    });
    await player(t, s.sportId, "Nobody Yet", []);
    const result = await gate(t, s, [card(["Nobody Yet"], 1)]);
    const [row] = await teamRows(t, result.batchId);
    expect(row.teamContext?.candidateTeamIds).toHaveLength(3);
    const ctx = await t
      .withIdentity(ADMIN)
      .query(api.entityReviewQueue.teamStepContext, { reviewRowId: row._id });
    expect(ctx?.playersDontSettle).toBe(false);
    expect(ctx?.cards[0].players[0].stints).toEqual([]);
  });

  test("a candidate row deleted since the gate is left out", async () => {
    const { t, s, row } = await ambiguous();
    await t.run((ctx) => ctx.db.delete(s.aa));
    const ctx = await t
      .withIdentity(ADMIN)
      .query(api.entityReviewQueue.teamStepContext, { reviewRowId: row._id });
    expect(ctx?.candidates.map((c) => c.teamId)).toEqual([s.now, s.old]);
  });

  test("a row with no context answers null", async () => {
    const t = newT();
    const s = await setup(t);
    const rowId = await t.run((ctx) =>
      ctx.db.insert("entityReviewQueue", {
        selectorOptionId: s.insert,
        batchId: "b",
        createdByUserId: ADMIN.subject,
        kind: "team",
        name: "Plain FC",
        sportId: s.sportId,
        status: "ready",
      }),
    );
    expect(
      await t
        .withIdentity(ADMIN)
        .query(api.entityReviewQueue.teamStepContext, { reviewRowId: rowId }),
    ).toBeNull();
  });

  test("another admin's batch is refused", async () => {
    const { t, row } = await ambiguous();
    await expect(
      t
        .withIdentity(OTHER_ADMIN)
        .query(api.entityReviewQueue.teamStepContext, { reviewRowId: row._id }),
    ).rejects.toThrow(/different review session/);
  });
});
