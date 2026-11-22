/**
 * NEO-602 — what a same-name PLAYER pick step shows: the cards that printed the
 * name (number and printed team) and every candidate's stints, with the ones on
 * a printed team marked.
 *
 * Jason, 2026-11-19: "I don't know how I would choose between the two active
 * luis castillo. We should show the card number & team from the player on the
 * screen." Driven through the real gate (`selectorOptions.resolveChecklistEntities`),
 * which writes `entityReviewQueue.playerContext` at insert, and the real
 * `entityReviewQueue.playerStepContext` query the wizard reads it back with.
 *
 * Fixture: the 2026 Topps Chrome case. Four Luis Castillos are on file in
 * baseball: a retired infielder (Marlins, Twins, Mets), a pitcher (Reds, then
 * the Mariners since 2022), a second player with the Mariners since 2025 (a
 * Tigers stint in 2022 before it), and a bare row with no stints. One card,
 * #62, prints "Seattle Mariners". Both Mariners rows were on that roster in
 * 2026, so the printed team separates neither: the gate must ask, and the
 * step must say so.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { normalizePlayerName } from "./players";
import { normalizeTeamName } from "./teams";
import { cancelScheduled } from "../lib/testing/drain-scheduled";
import { PLAYER_STEP_MAX_STINTS_SCANNED } from "./entityReviewQueue";

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
const OTHER_ADMIN = {
  subject: "admin_player_step_context_002",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_player_step_context_002",
  name: "Other Admin",
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

async function playerRows(t: T, batchId: string | undefined) {
  if (!batchId) return [];
  return (await t.run((ctx) => ctx.db.query("entityReviewQueue").collect())).filter(
    (r) => r.batchId === batchId && r.kind === "player",
  );
}

describe("startBatch: an auto-linked name that a Change turns back into a pick step (NEO-602)", () => {
  test("carries the player context on the decided row, and the step query answers for it", async () => {
    const t = newT();
    const s = await setup(t);
    const ids = await castillos(t, s);

    const batchId = await t.mutation(internal.entityReviewQueue.startBatch, {
      selectorOptionId: s.insert,
      createdByUserId: ADMIN.subject,
      sportId: s.sportId,
      playerNames: [],
      teamNames: [],
      // The set's history linked the pitcher; the second Mariners row is the
      // rival, so the batch holds two candidates and a Change opens the pick.
      autoLinks: [
        {
          kind: "player",
          name: NAME,
          playerId: ids.pitcher,
          rowSportId: s.sportId,
          origin: "setHistory",
          candidatePlayerIds: [ids.pitcher, ids.second],
        },
      ],
      playerContexts: [
        { name: NAME, cards: [{ number: "62", teams: [MARINERS] }], moreCards: 0 },
      ],
    } as never);

    const [row] = await playerRows(t, batchId);
    // Decided by the fact, not asked.
    expect(row.decision).toMatchObject({ action: "link", linkedPlayerId: ids.pitcher });
    expect(row.enrichment?.existingCandidates).toHaveLength(2);
    // The context landed on the inserted row...
    expect(row.playerContext).toEqual({
      cards: [{ number: "62", teams: [MARINERS] }],
      moreCards: 0,
    });
    // ...so the step that a Change turns this row back into has its evidence.
    const ctx = await t
      .withIdentity(ADMIN)
      .query(api.entityReviewQueue.playerStepContext, { reviewRowId: row._id });
    expect(ctx?.cards).toEqual([{ number: "62", teams: [MARINERS] }]);
    expect(ctx?.players.map((p) => p.playerId).sort()).toEqual([ids.pitcher, ids.second].sort());
    expect(ctx?.players.every((p) => p.hasPrintedTeam)).toBe(true);
  });

  test("a context for another name lands on no row", async () => {
    const t = newT();
    const s = await setup(t);
    const ids = await castillos(t, s);

    const batchId = await t.mutation(internal.entityReviewQueue.startBatch, {
      selectorOptionId: s.insert,
      createdByUserId: ADMIN.subject,
      sportId: s.sportId,
      playerNames: [],
      teamNames: [],
      autoLinks: [
        {
          kind: "player",
          name: NAME,
          playerId: ids.pitcher,
          rowSportId: s.sportId,
          origin: "setHistory",
          candidatePlayerIds: [ids.pitcher, ids.second],
        },
      ],
      playerContexts: [{ name: "Somebody Else", cards: [{ number: "1", teams: [] }], moreCards: 0 }],
    } as never);

    const [row] = await playerRows(t, batchId);
    expect(row.playerContext).toBeUndefined();
  });
});
