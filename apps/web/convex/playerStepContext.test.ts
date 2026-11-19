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

describe("the gate: both Mariners rows were on the roster, so the printed team separates neither", () => {
  test("the name goes to the operator and the row carries card #62 and its printed team", async () => {
    const t = newT();
    const s = await setup(t);
    await castillos(t, s);

    const result = await gate(t, s, [card([NAME], 62)]);

    expect(result.unknownPlayers).toEqual([NAME]);
    expect(result.ambiguousPlayers).toEqual([NAME]);
    const [row] = await playerRows(t, result.batchId);
    // Not linked: nothing decided it.
    expect(row.decision).toBeUndefined();
    expect(row.enrichment?.existingCandidates).toHaveLength(4);
    expect(row.playerContext).toEqual({
      cards: [{ number: "62", teams: [MARINERS] }],
      moreCards: 0,
    });
  });

  test("a card that names no team is listed with no team, and the name still goes to the operator", async () => {
    const t = newT();
    const s = await setup(t);
    await castillos(t, s);

    const result = await gate(t, s, [card([NAME], 62, [])]);

    expect(result.ambiguousPlayers).toEqual([NAME]);
    const [row] = await playerRows(t, result.batchId);
    expect(row.decision).toBeUndefined();
    expect(row.playerContext?.cards).toEqual([{ number: "62", teams: [] }]);
  });

  test("a name that is not a same-name choice carries no player context", async () => {
    const t = newT();
    const s = await setup(t);
    await castillos(t, s);

    const result = await gate(t, s, [card(["Somebody New"], 9)]);

    const [row] = await playerRows(t, result.batchId);
    expect(row.name).toBe("Somebody New");
    expect(row.playerContext).toBeUndefined();
  });

  test("the cards listed are bounded at 16, and the rest are counted", async () => {
    const t = newT();
    const s = await setup(t);
    await castillos(t, s);

    const result = await gate(
      t,
      s,
      Array.from({ length: 20 }, (_, i) => card([NAME], i + 1)),
    );

    const [row] = await playerRows(t, result.batchId);
    expect(row.playerContext?.cards).toHaveLength(16);
    expect(row.playerContext?.moreCards).toBe(4);
  });

  test("a card filed twice (the same number and team) is listed and counted once", async () => {
    const t = newT();
    const s = await setup(t);
    await castillos(t, s);

    const result = await gate(t, s, [card([NAME], 62), card([NAME], 62)]);

    const [row] = await playerRows(t, result.batchId);
    expect(row.playerContext?.cards).toHaveLength(1);
    expect(row.playerContext?.moreCards).toBe(0);
  });

  test("a second fetch (the resume path) writes the context on the name it adds", async () => {
    const t = newT();
    const s = await setup(t);
    await castillos(t, s);
    await player(t, s.sportId, "Jose Ramirez", { birthYear: 1992 });
    await player(t, s.sportId, "Jose Ramirez", { birthYear: 1999 });
    const first = await gate(t, s, [card([NAME], 62)]);
    const second = await gate(t, s, [card([NAME], 62), card(["Jose Ramirez"], 7, ["Cleveland Guardians"])]);

    expect(second.batchId).toBe(first.batchId);
    const rows = await playerRows(t, second.batchId);
    const added = rows.find((r) => r.name === "Jose Ramirez");
    expect(added?.playerContext).toEqual({
      cards: [{ number: "7", teams: ["Cleveland Guardians"] }],
      moreCards: 0,
    });
  });

  test("getBatch does not send the context to the wizard", async () => {
    const t = newT();
    const s = await setup(t);
    await castillos(t, s);
    const result = await gate(t, s, [card([NAME], 62)]);

    const rows = await t.withIdentity(ADMIN).query(api.entityReviewQueue.getBatch, {
      selectorOptionId: s.insert,
      batchId: result.batchId!,
    });
    expect(rows.find((r) => r.kind === "player")).toBeDefined();
    expect(rows.some((r) => "playerContext" in r)).toBe(false);
  });
});

describe("entityReviewQueue.playerStepContext", () => {
  async function pickStep(cards = [card([NAME], 62)]) {
    const t = newT();
    const s = await setup(t);
    const ids = await castillos(t, s);
    const result = await gate(t, s, cards);
    const [row] = await playerRows(t, result.batchId);
    return { t, s, ids, row };
  }

  test("lists the cards and each candidate's stints, marking the ones on the printed team", async () => {
    const { t, ids, row } = await pickStep();
    const ctx = await t
      .withIdentity(ADMIN)
      .query(api.entityReviewQueue.playerStepContext, { reviewRowId: row._id });

    expect(ctx?.cards).toEqual([{ number: "62", teams: [MARINERS] }]);
    expect(ctx?.moreCards).toBe(0);
    const byId = new Map(ctx?.players.map((p) => [p.playerId as string, p]));
    expect(byId.size).toBe(4);

    expect(byId.get(ids.pitcher as string)).toMatchObject({
      name: NAME,
      birthYear: 1992,
      moreStints: 0,
      hasPrintedTeam: true,
      stints: [
        { label: "Cincinnati Reds", years: "2017–22", onPrintedTeam: false },
        { label: MARINERS, years: "2022–present", onPrintedTeam: true },
      ],
    });
    // Oldest first, whatever order the row stores them in.
    expect(byId.get(ids.second as string)?.stints.map((s) => s.label)).toEqual([
      "Detroit Tigers",
      MARINERS,
    ]);
    expect(byId.get(ids.second as string)?.hasPrintedTeam).toBe(true);
    // Neither the retired infielder nor the bare row has a stint on the card's team.
    expect(byId.get(ids.retired as string)?.hasPrintedTeam).toBe(false);
    expect(byId.get(ids.retired as string)?.stints.every((s) => !s.onPrintedTeam)).toBe(true);
    expect(byId.get(ids.bare as string)).toMatchObject({
      stints: [],
      moreStints: 0,
      hasPrintedTeam: false,
    });
    expect(byId.get(ids.bare as string)?.birthYear).toBeUndefined();
  });

  test("answers in the order the pick step lists its candidates", async () => {
    const { t, row } = await pickStep();
    const ctx = await t
      .withIdentity(ADMIN)
      .query(api.entityReviewQueue.playerStepContext, { reviewRowId: row._id });
    expect(ctx?.players.map((p) => p.playerId)).toEqual(
      row.enrichment?.existingCandidates?.map((c) => c.playerId),
    );
  });

  test("a printed nickname alone marks the stint too (the same reading the gate uses)", async () => {
    const { t, row } = await pickStep([card([NAME], 62, ["Mariners"])]);
    const ctx = await t
      .withIdentity(ADMIN)
      .query(api.entityReviewQueue.playerStepContext, { reviewRowId: row._id });
    expect(ctx?.players.filter((p) => p.hasPrintedTeam)).toHaveLength(2);
  });

  test("a card with no printed team marks nothing", async () => {
    const { t, row } = await pickStep([card([NAME], 62, [])]);
    const ctx = await t
      .withIdentity(ADMIN)
      .query(api.entityReviewQueue.playerStepContext, { reviewRowId: row._id });
    expect(ctx?.cards).toEqual([{ number: "62", teams: [] }]);
    expect(ctx?.players.some((p) => p.hasPrintedTeam)).toBe(false);
    expect(ctx?.players.flatMap((p) => p.stints).some((s) => s.onPrintedTeam)).toBe(false);
  });

  test("stints past the bound are counted, not listed, and a printed team past it still counts", async () => {
    const t = newT();
    const s = await setup(t);
    const ids = await castillos(t, s);
    // Twelve earlier stints, then the Mariners: the printed team sits past the bound.
    await t.run((ctx) =>
      ctx.db.patch(ids.pitcher, {
        teamYears: [
          ...Array.from({ length: 12 }, (_, i) => ({
            teamId: s.reds,
            fromYear: 1990 + i,
            toYear: 1990 + i,
          })),
          { teamId: s.mariners, fromYear: 2022 },
        ],
      }),
    );
    const result = await gate(t, s, [card([NAME], 62)]);
    const [row] = await playerRows(t, result.batchId);
    const ctx = await t
      .withIdentity(ADMIN)
      .query(api.entityReviewQueue.playerStepContext, { reviewRowId: row._id });
    const pitcher = ctx?.players.find((p) => p.playerId === ids.pitcher);
    expect(pitcher?.stints).toHaveLength(12);
    expect(pitcher?.moreStints).toBe(1);
    expect(pitcher?.hasPrintedTeam).toBe(true);
  });

  test("a team row, and a player row with no context, answer null", async () => {
    const t = newT();
    const s = await setup(t);
    const row = (kind: "team" | "player", name: string) =>
      t.run((ctx) =>
        ctx.db.insert("entityReviewQueue", {
          selectorOptionId: s.insert,
          batchId: "b",
          createdByUserId: ADMIN.subject,
          kind,
          name,
          sportId: s.sportId,
          status: "ready",
        }),
      );
    for (const id of [await row("team", "Plain FC"), await row("player", "Plain Player")]) {
      expect(
        await t.withIdentity(ADMIN).query(api.entityReviewQueue.playerStepContext, {
          reviewRowId: id,
        }),
      ).toBeNull();
    }
  });

  test("another admin's batch is refused", async () => {
    const { t, row } = await pickStep();
    await expect(
      t
        .withIdentity(OTHER_ADMIN)
        .query(api.entityReviewQueue.playerStepContext, { reviewRowId: row._id }),
    ).rejects.toThrow(/different review session/);
  });
});
