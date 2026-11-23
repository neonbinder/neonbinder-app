/**
 * NEO-645 — the commit chunk and the scope's name list.
 *
 * The action reads "which printed names have a `tidyNames` row" ONCE, then hands
 * each chunk its slice. A name row born after that read (an operator answering
 * in the walk while the commit runs) is missing from the list. The chunk trusts
 * the list for what it says IS indexed and point-reads every name it lacks, so a
 * new row is picked up: the card gets its printed-name row and the answer's
 * fan-out has somewhere to land.
 *
 * Also measured here: what that point read costs a full chunk, against the
 * sizing in `COMMIT_CHUNK_TIDY_OPS_PER_CARD`.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import type { MutationCtx } from "./_generated/server";
import { COMMIT_CHUNK_OP_BUDGET, commitCardChecklistChunk, commitChunkSize } from "./selectorOptions";
import { cancelScheduled } from "../lib/testing/drain-scheduled";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import { nameRow, seedTidyWorld, type TidyWorld } from "../lib/testing/tidy-world";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

type T = ReturnType<typeof convexTest>;
const live: T[] = [];
const newT = () => {
  const t = convexTest(schema, modules);
  live.push(t);
  return t;
};
afterEach(async () => {
  for (const t of live.splice(0)) await cancelScheduled(t);
  vi.unstubAllGlobals();
});

const wireCard = (n: string, name: string) => ({
  cardNumber: n,
  cardName: `Card ${n}`,
  platformData: {},
  sortOrder: Number.parseInt(n, 10) || 0,
  playerNames: [] as string[],
  teamNames: [] as string[],
  pendingPlayerNames: [name],
  printedPlayers: [name],
});

const chunkArgs = (w: TidyWorld, cards: Array<ReturnType<typeof wireCard>>, namesWithRows?: string[]) => ({
  selectorOptionId: w.base,
  sportValue: "Baseball",
  setNameValue: "Chrome",
  cards,
  ...(namesWithRows ? { namesWithRows } : {}),
});

const printedFor = (t: T, number: string, w: TidyWorld) =>
  t.run(async (ctx) => {
    const card = (
      await ctx.db
        .query("cardChecklist")
        .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", w.base))
        .collect()
    ).find((c) => c.cardNumber === number);
    if (!card) return null;
    return ctx.db
      .query("cardPrintedNames")
      .withIndex("by_card", (q) => q.eq("cardChecklistId", card._id))
      .collect();
  });

/** `ctx.db` with every call counted, and the `tidyNames` ranges apart. */
function counting(db: MutationCtx["db"]) {
  const stats = { reads: 0, writes: 0, nameRowReads: 0 };
  const wrapped = new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop) as unknown;
      if (typeof value !== "function") return value;
      if (prop === "get" || prop === "query") {
        return (...a: unknown[]) => {
          stats.reads++;
          if (prop === "query" && a[0] === "tidyNames") stats.nameRowReads++;
          return (value as (...x: unknown[]) => unknown).apply(target, a);
        };
      }
      if (prop === "insert" || prop === "patch" || prop === "delete" || prop === "replace") {
        return (...a: unknown[]) => {
          stats.writes++;
          return (value as (...x: unknown[]) => unknown).apply(target, a);
        };
      }
      return value.bind(target);
    },
  });
  return { db: wrapped as MutationCtx["db"], stats };
}

const handler = (commitCardChecklistChunk as unknown as {
  _handler: (ctx: MutationCtx, args: ReturnType<typeof chunkArgs>) => Promise<{ storedIds: unknown[] }>;
})._handler;

const NEWCOMER = "Quinn Rookie";
const KNOWN = "Zed Nobody";

describe("commit chunk — a name row born after the list was read", () => {
  test("a name the list lacks but that has a row now is indexed", async () => {
    const t = newT();
    const w = await t.run((ctx) => seedTidyWorld(ctx));
    await t.run((ctx) => nameRow(ctx, { scopeId: w.base, sportId: w.sport, kind: "player", name: NEWCOMER }));
    // The list was read before the row existed: it names nothing.
    await t.mutation(internal.selectorOptions.commitCardChecklistChunk, chunkArgs(w, [wireCard("1", NEWCOMER)], []));
    const rows = await printedFor(t, "1", w);
    expect(rows?.map((r) => [r.kind, r.printed, r.scopeId])).toEqual([["player", NEWCOMER, w.base]]);
  });

  test("a name with no row at all is still not indexed", async () => {
    const t = newT();
    const w = await t.run((ctx) => seedTidyWorld(ctx));
    await t.mutation(internal.selectorOptions.commitCardChecklistChunk, chunkArgs(w, [wireCard("1", NEWCOMER)], []));
    expect(await printedFor(t, "1", w)).toEqual([]);
  });

  test("a name the list has is trusted: no name-row read for it", async () => {
    const t = newT();
    const w = await t.run((ctx) => seedTidyWorld(ctx));
    await t.run((ctx) => nameRow(ctx, { scopeId: w.base, sportId: w.sport, kind: "player", name: KNOWN }));
    const key = `player|${normalizeEntityName(KNOWN)}`;
    const cost = await t.run(async (ctx) => {
      const { db, stats } = counting(ctx.db);
      await handler({ ...ctx, db }, chunkArgs(w, [wireCard("1", KNOWN), wireCard("2", KNOWN)], [key]));
      return stats;
    });
    expect(cost.nameRowReads).toBe(0);
    expect((await printedFor(t, "1", w))?.length).toBe(1);
    expect((await printedFor(t, "2", w))?.length).toBe(1);
  });

  test("a name the list lacks is read once per chunk, however many cards print it", async () => {
    const t = newT();
    const w = await t.run((ctx) => seedTidyWorld(ctx));
    const cost = await t.run(async (ctx) => {
      const { db, stats } = counting(ctx.db);
      await handler(
        { ...ctx, db },
        chunkArgs(w, [wireCard("1", NEWCOMER), wireCard("2", NEWCOMER), wireCard("3", KNOWN)], []),
      );
      return stats;
    });
    // Two distinct names, three cards: the memo answers the repeat.
    expect(cost.nameRowReads).toBe(2);
  });

  test("a full chunk of distinct unindexed names stays inside the budget it is sized for", async () => {
    const t = newT();
    const w = await t.run((ctx) => seedTidyWorld(ctx));
    // The size the action uses with no defaults: the tidy allowance on top.
    const size = commitChunkSize(5);
    const cards = Array.from({ length: size }, (_, i) => wireCard(String(i + 1), `Player Number${i}`));
    const cost = await t.run(async (ctx) => {
      const { db, stats } = counting(ctx.db);
      const result = await handler({ ...ctx, db }, chunkArgs(w, cards, []));
      return { stored: result.storedIds.length, ...stats };
    });
    console.log(JSON.stringify({ size, ...cost, perCard: (cost.reads + cost.writes) / size }));
    expect(cost.stored).toBe(size);
    // One point read per distinct name, and nothing else per card on top of it.
    expect(cost.nameRowReads).toBe(size);
    // The commit's own calibration: ~900 comfortable, ~1,800 straining.
    expect(cost.reads + cost.writes).toBeLessThanOrEqual(1800);
    expect(size * 12).toBeLessThanOrEqual(COMMIT_CHUNK_OP_BUDGET);
  });
});
