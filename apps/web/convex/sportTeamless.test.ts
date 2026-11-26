/**
 * NEO-426 — the "No teams in this sport" switch (`setTeamlessSport`), the
 * admin list the wizard reads, and the server's two reads of the flag
 * (`createSportNoTeamReader`, `playersWithTeamlessHomeSport`). The switch is a
 * default, never a block: it touches no card. Admin gating is pinned in
 * publicFunctionAuth.test.ts.
 */
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { insertTestCard } from "../lib/testing/card-row";
import {
  createSportNoTeamReader,
  TEAMLESS_PLAYER_LOOKUP_PAGE,
  TEAMLESS_SPORT_SCAN,
  teamlessSportIdSet,
  teamlessSportMap,
} from "./sportTeamless";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = { subject: "admin_teamless_001", role: "admin" };
const ADMIN_2 = { subject: "admin_teamless_002", role: "admin" };
const SEEDED_AT = 1_700_000_000_000;

type T = ReturnType<typeof convexTest>;
type Sel = Id<"selectorOptions">;

async function seedRow(
  t: T,
  level: "sport" | "year" | "setName",
  value: string,
  extra: { parentId?: Sel; teamlessSport?: { setAt: number; setByUserId: string } } = {},
): Promise<Sel> {
  return t.run(async (ctx) =>
    ctx.db.insert("selectorOptions", {
      level,
      value,
      platformData: {},
      children: [],
      lastUpdated: SEEDED_AT,
      ...extra,
    }),
  );
}

const seedPlayer = (t: T, sportId: Sel, name: string) =>
  t.run(async (ctx) =>
    ctx.db.insert("players", { name, nameNormalized: name.toLowerCase(), sportId, lastUpdated: SEEDED_AT }),
  );

const getRow = (t: T, id: Sel) => t.run(async (ctx) => ctx.db.get(id));
const set = (t: T, sportId: Sel, teamless: boolean, as = ADMIN) =>
  t.withIdentity(as).mutation(api.sportTeamless.setTeamlessSport, { sportId, teamless });

describe("setTeamlessSport", () => {
  test("true stamps the sport with the admin's subject and a server time", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedRow(t, "sport", "Golf");
    const before = Date.now();
    await set(t, sportId, true);
    const row = await getRow(t, sportId);
    expect(row!.teamlessSport!.setByUserId).toBe(ADMIN.subject);
    expect(row!.teamlessSport!.setAt).toBeGreaterThanOrEqual(before);
    expect(row!.lastUpdated).toBeGreaterThanOrEqual(before);
  });

  test("false removes the field rather than storing a false", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedRow(t, "sport", "Golf");
    await set(t, sportId, true);
    await set(t, sportId, false);
    expect("teamlessSport" in (await getRow(t, sportId))!).toBe(false);
  });

  test("a second true keeps the first stamp and writes nothing", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedRow(t, "sport", "Golf", {
      teamlessSport: { setAt: SEEDED_AT, setByUserId: "admin_first" },
    });
    await set(t, sportId, true, ADMIN_2);
    const row = await getRow(t, sportId);
    expect(row!.teamlessSport).toEqual({ setAt: SEEDED_AT, setByUserId: "admin_first" });
    expect(row!.lastUpdated).toBe(SEEDED_AT);
  });

  test("clearing a sport that was never flagged writes nothing", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedRow(t, "sport", "Baseball");
    await set(t, sportId, false);
    const row = await getRow(t, sportId);
    expect("teamlessSport" in row!).toBe(false);
    expect(row!.lastUpdated).toBe(SEEDED_AT);
  });

  test("a row that is not a sport is refused both ways, and stays unflagged", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedRow(t, "sport", "Baseball");
    const yearId = await seedRow(t, "year", "2024", { parentId: sportId });
    for (const teamless of [true, false]) {
      await expect(set(t, yearId, teamless)).rejects.toThrow(/Only a sport/);
    }
    expect("teamlessSport" in (await getRow(t, yearId))!).toBe(false);
  });

  test("a deleted row is refused with a message", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedRow(t, "sport", "Gone");
    await t.run(async (ctx) => ctx.db.delete(sportId));
    await expect(set(t, sportId, true)).rejects.toThrow(/gone/);
  });

  test("touches no card and schedules nothing: it only moves what a later save defaults to", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedRow(t, "sport", "Golf");
    const cardId = await t.run(async (ctx) =>
      insertTestCard(ctx, {
        selectorOptionId: sportId,
        cardNumber: "1",
        cardName: "Card 1",
        platformData: {},
        sortOrder: 1,
        lastUpdated: SEEDED_AT,
      }),
    );
    const before = await t.run(async (ctx) => ctx.db.get(cardId));
    await set(t, sportId, true);
    expect(await t.run(async (ctx) => ctx.db.get(cardId))).toEqual(before);
    expect(await t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect())).toEqual([]);
  });
});

describe("listTeamlessSportIds and the flagged-sport readers", () => {
  const STAMP = { setAt: SEEDED_AT, setByUserId: "admin_x" };

  test("lists only flagged sport rows, not unflagged sports and not a non-sport carrying the field", async () => {
    const t = convexTest(schema, modules);
    const golf = await seedRow(t, "sport", "Golf", { teamlessSport: STAMP });
    const tennis = await seedRow(t, "sport", "Tennis", { teamlessSport: STAMP });
    await seedRow(t, "sport", "Baseball");
    await seedRow(t, "year", "2024", { parentId: golf, teamlessSport: STAMP });
    const ids = await t.withIdentity(ADMIN).query(api.sportTeamless.listTeamlessSportIds, {});
    expect([...ids].sort()).toEqual([golf, tennis].sort());
  });

  test("follows a clear, and is empty when nothing is flagged", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedRow(t, "sport", "Golf");
    const as = t.withIdentity(ADMIN);
    expect(await as.query(api.sportTeamless.listTeamlessSportIds, {})).toEqual([]);
    await set(t, sportId, true);
    expect(await as.query(api.sportTeamless.listTeamlessSportIds, {})).toEqual([sportId]);
    await set(t, sportId, false);
    expect(await as.query(api.sportTeamless.listTeamlessSportIds, {})).toEqual([]);
  });

  test("teamlessSportMap and teamlessSportIdSet agree and carry each sport's stamp", async () => {
    const t = convexTest(schema, modules);
    const golf = await seedRow(t, "sport", "Golf", { teamlessSport: STAMP });
    await seedRow(t, "sport", "Baseball");
    const { map, ids } = await t.run(async (ctx) => ({
      map: [...(await teamlessSportMap(ctx))],
      ids: [...(await teamlessSportIdSet(ctx))],
    }));
    expect(map).toEqual([[golf, STAMP]]);
    expect(ids).toEqual([golf]);
  });

  test("a sport scan that fills the cap fails closed: an empty map, so the default is never applied", async () => {
    const t = convexTest(schema, modules);
    const golf = await seedRow(t, "sport", "Golf", { teamlessSport: STAMP });
    const a = await seedPlayer(t, golf, "A");
    // One row under the cap is still read in full.
    await t.run(async (ctx) => {
      for (let i = 0; i < TEAMLESS_SPORT_SCAN - 2; i++) {
        await ctx.db.insert("selectorOptions", {
          level: "sport",
          value: `Filler ${i}`,
          platformData: {},
          children: [],
          lastUpdated: SEEDED_AT,
        });
      }
    });
    const under = await t.run(async (ctx) => ({
      map: [...(await teamlessSportMap(ctx)).keys()],
      answer: await createSportNoTeamReader(ctx).defaultFor({ playerIds: [a], pendingPlayerNameCount: 0 }),
    }));
    expect(under.map).toEqual([golf]);
    expect(under.answer).toEqual(STAMP);

    // One more sport fills the cap: nothing can be trusted, so nothing applies.
    await seedRow(t, "sport", "Overflow");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const over = await t.run(async (ctx) => ({
        map: [...(await teamlessSportMap(ctx))],
        ids: [...(await teamlessSportIdSet(ctx))],
        answer: await createSportNoTeamReader(ctx).defaultFor({ playerIds: [a], pendingPlayerNameCount: 0 }),
      }));
      expect(over.map).toEqual([]);
      expect(over.ids).toEqual([]);
      expect(over.answer).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("teamlessSportMap"));
    } finally {
      warn.mockRestore();
    }
  });
});

describe("createSportNoTeamReader", () => {
  const STAMP = { setAt: SEEDED_AT, setByUserId: "admin_x" };

  /** Counts `db.get` calls so a probe can prove which reads happened. */
  async function probe(
    t: T,
    cards: Array<{ playerIds: Array<Id<"players">>; pendingPlayerNameCount: number }>,
  ) {
    return t.run(async (ctx) => {
      const gets: string[] = [];
      const queries: string[] = [];
      const counting = {
        db: {
          get: (id: never) => {
            gets.push(String(id));
            return ctx.db.get(id);
          },
          query: (table: never) => {
            queries.push(String(table));
            return ctx.db.query(table);
          },
        },
      } as unknown as typeof ctx;
      const reader = createSportNoTeamReader(counting);
      const answers = [];
      for (const c of cards) answers.push((await reader.defaultFor(c)) ?? null);
      return { answers, gets, queries };
    });
  }

  test("every player home sport flagged: answers the stamp", async () => {
    const t = convexTest(schema, modules);
    const golf = await seedRow(t, "sport", "Golf", { teamlessSport: STAMP });
    const a = await seedPlayer(t, golf, "A");
    const { answers } = await probe(t, [{ playerIds: [a], pendingPlayerNameCount: 0 }]);
    expect(answers).toEqual([STAMP]);
  });

  test("no sport flagged: zero player reads, however many cards", async () => {
    const t = convexTest(schema, modules);
    const bb = await seedRow(t, "sport", "Baseball");
    const a = await seedPlayer(t, bb, "A");
    const { answers, gets, queries } = await probe(t, [
      { playerIds: [a], pendingPlayerNameCount: 0 },
      { playerIds: [a], pendingPlayerNameCount: 0 },
    ]);
    expect(answers).toEqual([null, null]);
    expect(gets).toEqual([]);
    // The flagged sports are read once for the whole chunk.
    expect(queries).toEqual(["selectorOptions"]);
  });

  test("no player, or a pending player name: refused before any database read", async () => {
    const t = convexTest(schema, modules);
    const golf = await seedRow(t, "sport", "Golf", { teamlessSport: STAMP });
    const a = await seedPlayer(t, golf, "A");
    const { answers, gets, queries } = await probe(t, [
      { playerIds: [], pendingPlayerNameCount: 0 },
      { playerIds: [a], pendingPlayerNameCount: 2 },
    ]);
    expect(answers).toEqual([null, null]);
    expect(gets).toEqual([]);
    expect(queries).toEqual([]);
  });

  test("each distinct player is read once across cards, and a repeat on one card is read once", async () => {
    const t = convexTest(schema, modules);
    const golf = await seedRow(t, "sport", "Golf", { teamlessSport: STAMP });
    const a = await seedPlayer(t, golf, "A");
    const b = await seedPlayer(t, golf, "B");
    const { answers, gets } = await probe(t, [
      { playerIds: [a, a, b], pendingPlayerNameCount: 0 },
      { playerIds: [b, a], pendingPlayerNameCount: 0 },
    ]);
    expect(answers).toEqual([STAMP, STAMP]);
    expect([...gets].sort()).toEqual([a, b].sort());
  });

  test("one player from a sport with teams ends it; only the HOME sport counts, never playerSports", async () => {
    const t = convexTest(schema, modules);
    const golf = await seedRow(t, "sport", "Golf", { teamlessSport: STAMP });
    const bb = await seedRow(t, "sport", "Baseball");
    const g = await seedPlayer(t, golf, "G");
    const b = await seedPlayer(t, bb, "B");
    // The ballplayer also plays golf as an extra sport: still not teamless.
    await t.run(async (ctx) =>
      ctx.db.insert("playerSports", { playerId: b, sportId: golf, nameNormalized: "b" }),
    );
    const { answers } = await probe(t, [
      { playerIds: [g, b], pendingPlayerNameCount: 0 },
      { playerIds: [b], pendingPlayerNameCount: 0 },
    ]);
    expect(answers).toEqual([null, null]);
  });

  test("a deleted player is not teamless", async () => {
    const t = convexTest(schema, modules);
    const golf = await seedRow(t, "sport", "Golf", { teamlessSport: STAMP });
    const a = await seedPlayer(t, golf, "A");
    await t.run(async (ctx) => ctx.db.delete(a));
    const { answers } = await probe(t, [{ playerIds: [a], pendingPlayerNameCount: 0 }]);
    expect(answers).toEqual([null]);
  });
});

describe("playersWithTeamlessHomeSport", () => {
  test("returns the players whose HOME sport is flagged, deduped; extra sports and missing players do not count", async () => {
    const t = convexTest(schema, modules);
    const golf = await seedRow(t, "sport", "Golf");
    const bb = await seedRow(t, "sport", "Baseball");
    const g = await seedPlayer(t, golf, "G");
    const b = await seedPlayer(t, bb, "B");
    const gone = await seedPlayer(t, golf, "Gone");
    await t.run(async (ctx) => {
      await ctx.db.insert("playerSports", { playerId: b, sportId: golf, nameNormalized: "b" });
      await ctx.db.delete(gone);
    });
    const out = await t.query(internal.sportTeamless.playersWithTeamlessHomeSport, {
      playerIds: [g, b, gone, g],
      teamlessSportIds: [golf],
    });
    expect(out).toEqual([g]);
  });

  test("no flagged sport reads nothing and answers empty", async () => {
    const t = convexTest(schema, modules);
    const golf = await seedRow(t, "sport", "Golf");
    const g = await seedPlayer(t, golf, "G");
    expect(
      await t.query(internal.sportTeamless.playersWithTeamlessHomeSport, { playerIds: [g], teamlessSportIds: [] }),
    ).toEqual([]);
  });

  test("a page over the cap is refused, at the cap is accepted", async () => {
    const t = convexTest(schema, modules);
    const golf = await seedRow(t, "sport", "Golf");
    const g = await seedPlayer(t, golf, "G");
    const ids = (n: number) => Array.from({ length: n }, () => g);
    await expect(
      t.query(internal.sportTeamless.playersWithTeamlessHomeSport, {
        playerIds: ids(TEAMLESS_PLAYER_LOOKUP_PAGE + 1),
        teamlessSportIds: [golf],
      }),
    ).rejects.toThrow(/slice them/);
    expect(
      await t.query(internal.sportTeamless.playersWithTeamlessHomeSport, {
        playerIds: ids(TEAMLESS_PLAYER_LOOKUP_PAGE),
        teamlessSportIds: [golf],
      }),
    ).toEqual([g]);
  });
});
