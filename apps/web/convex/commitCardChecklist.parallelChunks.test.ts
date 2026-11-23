/**
 * NEO-645 — the commit's chunks run side by side.
 *
 * ## Why this file exists
 *
 * One Confirm on a real 554-card set (2014 Topps Football) took 7.17 s on the
 * server and missed the 7 s UX budget; 3.2 s of it was five chunk mutations
 * run one after another (0.5-0.7 s each, ~330 writes each). The chunks are
 * independent transactions, so `commitCardChecklist` now runs a wave of them at
 * once (`COMMIT_CHUNK_PARALLEL_CALLS`).
 *
 * That is only sound if no two chunks touch the same document, and
 * convex-test runs transactions one at a time, so it can never show a write
 * conflict. These tests pin the argument instead, three ways:
 *
 *  1. FOOTPRINT. A chunk run with `deferCardCounts` writes no document that
 *     existed before it ran (the leaf row's card counts were the one shared
 *     write; the flush moved to `commitCardChecklistLandCounts`), and an
 *     update chunk writes only the cards it was handed. The same chunk without
 *     the flag DOES patch the leaf row, which proves the recorder sees it.
 *  2. READ SET. A chunk reads no range of `cardChecklist` (it used to collect
 *     the whole set whenever one card was an update, so a sibling's insert
 *     invalidated it), and reads only the cards it was handed by id.
 *  3. COUNTS AND ORDER. The deferred counts land once, equal to the cards the
 *     chunks inserted, including when a sibling failed and when the commit is
 *     retried; a commit whose cards tie on `sortOrder` across chunks runs its
 *     chunks one after another, so their creation order is the payload's.
 *
 * Everything is counted, never timed.
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import schema from "./schema";
import {
  chunksMayRunTogether,
  commitCardChecklistChunk,
  commitCardChecklistLandCounts,
  COMMIT_CHUNK_PARALLEL_CALLS,
  commitChunkSize,
} from "./selectorOptions";
import { CardCountLedger } from "./cardCounts";
import { ENQUEUE_PAGE } from "./tidyNames";
import { cancelScheduled, drainScheduled } from "../lib/testing/drain-scheduled";
import { seedTidyWorld } from "../lib/testing/tidy-world";
import { insertTestCard } from "../lib/testing/card-row";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = { subject: "admin_parallel_chunks", role: "admin" };
type T = ReturnType<typeof convexTest>;

/** What a chunk of one-player-less cards costs `commitCardChecklist` to size (`TIDY` ops included). */
const CHUNK = commitChunkSize(5);

beforeEach(() => {
  vi.stubGlobal("fetch", (async (url: string | URL) => {
    throw new Error(`this test file must not reach the network: ${String(url)}`);
  }) as unknown as typeof fetch);
});
const live: T[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const t of live.splice(0)) {
    await drainScheduled(t);
    await cancelScheduled(t);
  }
  vi.unstubAllGlobals();
});

type Handler<A, R> = { _handler: (ctx: MutationCtx, args: A) => Promise<R> };
const handlerOf = <A, R>(fn: unknown) => (fn as Handler<A, R>)._handler;

/** A set whose leaf and parent carry known counts, so a DELTA (not a recount) is under test. */
async function seed(t: T) {
  return t.run(async (ctx) => {
    const world = await seedTidyWorld(ctx, { year: "2024" });
    await ctx.db.patch(world.base, {
      cardCount: 0,
      nonVariationCardCount: 0,
      subtreeCardCount: 0,
      subtreeNonVariationCardCount: 0,
    });
    await ctx.db.patch(world.set, { subtreeCardCount: 0, subtreeNonVariationCardCount: 0 });
    return world;
  });
}

function wireCard(cardNumber: string, extra: { variation?: boolean; sortOrder?: number } = {}) {
  return {
    cardNumber,
    cardName: `Card ${cardNumber}`,
    team: undefined,
    teams: [],
    players: [],
    attributes: [],
    cardVariation: extra.variation ? "Action" : undefined,
    isVariation: extra.variation ? true : undefined,
    platformData: { bsc: { ref: `bsc-${cardNumber}` } },
  };
}

function chunkCard(cardNumber: string, sortOrder: number, existingId?: Id<"cardChecklist">) {
  return {
    cardNumber,
    cardName: `Card ${cardNumber}`,
    platformData: {},
    sortOrder,
    playerNames: [],
    teamNames: [],
    ...(existingId ? { existingId } : {}),
  };
}

/** `ctx.db` with every document it reads, writes and queries recorded. */
function recording(db: MutationCtx["db"]) {
  const log = {
    inserted: new Set<string>(),
    written: new Set<string>(),
    got: new Set<string>(),
    queried: [] as string[],
    writes: 0,
  };
  const wrapped = new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop) as unknown;
      if (typeof value !== "function") return value;
      const fn = value as (...a: unknown[]) => unknown;
      if (prop === "insert") {
        return async (...a: unknown[]) => {
          const id = (await fn.apply(target, a)) as string;
          log.inserted.add(id);
          log.writes++;
          return id;
        };
      }
      if (prop === "patch" || prop === "delete" || prop === "replace") {
        return (...a: unknown[]) => {
          log.written.add(String(a[0]));
          log.writes++;
          return fn.apply(target, a);
        };
      }
      if (prop === "get") {
        return (...a: unknown[]) => {
          log.got.add(String(a[a.length - 1]));
          return fn.apply(target, a);
        };
      }
      if (prop === "query") {
        return (...a: unknown[]) => {
          log.queried.push(String(a[0]));
          return fn.apply(target, a);
        };
      }
      return fn.bind(target);
    },
  });
  return {
    db: wrapped as MutationCtx["db"],
    log,
    /** Documents that existed before the call and were patched or deleted by it. */
    preexistingWritten: () => [...log.written].filter((id) => !log.inserted.has(id)),
  };
}

type ChunkResult = {
  storedIds: Array<Id<"cardChecklist">>;
  insertedCardCount?: number;
  insertedBaseCardCount?: number;
};

async function runChunk(t: T, args: Record<string, unknown>) {
  const out = await t.run(async (ctx) => {
    const rec = recording(ctx.db);
    const result = await handlerOf<unknown, ChunkResult>(commitCardChecklistChunk)(
      { ...ctx, db: rec.db } as MutationCtx,
      args,
    );
    // Plain values only: a Set or the proxied db cannot cross `t.run`.
    return {
      result,
      preexistingWritten: rec.preexistingWritten(),
      got: [...rec.log.got],
      queried: rec.log.queried,
      writes: rec.log.writes,
    };
  });
  return {
    result: out.result,
    preexistingWritten: () => out.preexistingWritten,
    log: { got: new Set(out.got), queried: out.queried, writes: out.writes },
  };
}

describe("chunksMayRunTogether", () => {
  const chunk = (...sortOrders: number[]) => sortOrders.map((sortOrder) => ({ sortOrder }));

  test("distinct sort orders across chunks may run together", () => {
    expect(chunksMayRunTogether([chunk(0, 1), chunk(2, 3), chunk(4)])).toBe(true);
  });

  test("a single chunk has nothing to run beside", () => {
    expect(chunksMayRunTogether([chunk(0, 1, 2)])).toBe(false);
    expect(chunksMayRunTogether([])).toBe(false);
  });

  test("a sort order held by two chunks (a duplicated card number) keeps them in order", () => {
    expect(chunksMayRunTogether([chunk(0, 1), chunk(1, 2)])).toBe(false);
    expect(chunksMayRunTogether([chunk(0), chunk(1), chunk(2, 0)])).toBe(false);
  });

  test("a tie inside ONE chunk is that chunk's own order, so it does not matter", () => {
    expect(chunksMayRunTogether([chunk(0, 0, 1), chunk(2, 3)])).toBe(true);
  });
});

describe("a chunk run beside its siblings writes nothing they read or write", () => {
  test("an insert chunk with deferred counts writes no document that existed before it", async () => {
    const t = convexTest(schema, modules);
    live.push(t);
    const w = await seed(t);
    const cards = Array.from({ length: 30 }, (_, i) => chunkCard(String(i + 1), i));
    const { result, preexistingWritten, log } = await runChunk(t, {
      selectorOptionId: w.base,
      sportValue: "Baseball",
      setNameValue: "Chrome",
      cards,
      deferCardCounts: true,
    });
    expect(result.storedIds).toHaveLength(30);
    // The ledger's flush (the leaf row and the rows above it) is the one write
    // every chunk would make to the same documents. It is the caller's now.
    expect(preexistingWritten()).toEqual([]);
    expect(result.insertedCardCount).toBe(30);
    expect(result.insertedBaseCardCount).toBe(30);
    // And it reads no range of the checklist: nothing a sibling inserts is in it.
    expect(log.queried).not.toContain("cardChecklist");
    // The leaf's counts are untouched until the caller lands them.
    const leaf = await t.run((ctx) => ctx.db.get(w.base));
    expect(leaf?.cardCount).toBe(0);
  });

  test("the same chunk without the flag patches the leaf row: the recorder sees the shared write", async () => {
    const t = convexTest(schema, modules);
    live.push(t);
    const w = await seed(t);
    const { result, preexistingWritten } = await runChunk(t, {
      selectorOptionId: w.base,
      sportValue: "Baseball",
      setNameValue: "Chrome",
      cards: Array.from({ length: 5 }, (_, i) => chunkCard(String(i + 1), i)),
    });
    expect(result.insertedCardCount).toBeUndefined();
    expect(preexistingWritten()).toContain(w.base);
    const leaf = await t.run((ctx) => ctx.db.get(w.base));
    expect(leaf?.cardCount).toBe(5);
  });

  test("a deferred chunk whose ledger holds a change for a row other than the leaf throws instead of dropping it", async () => {
    const t = convexTest(schema, modules);
    live.push(t);
    const w = await seed(t);
    // Stand in for a future ledger write the deferral does not know about: each new card
    // also moves the leaf's parent set.
    vi.spyOn(CardCountLedger.prototype, "addCard").mockImplementation(function (this: CardCountLedger, card) {
      this.add(card.selectorOptionId, 1, 1);
      this.add(w.set, 1, 1);
    });
    const args = {
      selectorOptionId: w.base,
      sportValue: "Baseball",
      setNameValue: "Chrome",
      cards: [chunkCard("1", 0)],
    };
    await expect(runChunk(t, { ...args, deferCardCounts: true })).rejects.toThrow(
      /cannot defer a count change for a row other than the leaf/,
    );
    // Not deferred, the same ledger flushes itself: nothing is lost, so nothing throws.
    await expect(runChunk(t, args)).resolves.toBeDefined();
  });

  test("an update chunk patches only the cards it was handed and reads them by id, not the whole set", async () => {
    const t = convexTest(schema, modules);
    live.push(t);
    const w = await seed(t);
    const stored = await t.run(async (ctx) => {
      const ids: Array<Id<"cardChecklist">> = [];
      for (let i = 0; i < 40; i++) {
        ids.push(
          await insertTestCard(ctx, {
            selectorOptionId: w.base,
            cardNumber: String(i + 1),
            cardName: `Card ${i + 1}`,
            listingTitle: `Card ${i + 1}`,
            platformData: {},
            sortOrder: i,
            lastUpdated: 1,
          }),
        );
      }
      return ids;
    });
    const mine = stored.slice(0, 3);
    const { result, preexistingWritten, log } = await runChunk(t, {
      selectorOptionId: w.base,
      sportValue: "Baseball",
      setNameValue: "Chrome",
      cards: [
        ...mine.map((id, i) => chunkCard(String(i + 1), i, id)),
        chunkCard("500", 500),
      ],
      deferCardCounts: true,
    });
    expect(result.storedIds.slice(0, 3)).toEqual(mine);
    expect(result.insertedCardCount).toBe(1);
    expect([...preexistingWritten()].sort()).toEqual([...mine].sort());
    // The other 37 cards of the set are in nobody's read set but their own.
    const cardsRead = [...log.got].filter((id) => stored.includes(id as Id<"cardChecklist">));
    expect(cardsRead.sort()).toEqual([...mine].sort());
    expect(log.queried).not.toContain("cardChecklist");
  });

  test("a card of another set is a miss, as a row that is gone is: it falls to the insert branch", async () => {
    const t = convexTest(schema, modules);
    live.push(t);
    const w = await seed(t);
    const foreign = await t.run((ctx) =>
      insertTestCard(ctx, {
        selectorOptionId: w.insert,
        cardNumber: "7",
        cardName: "Other set",
        listingTitle: "Other set",
        platformData: {},
        sortOrder: 0,
        lastUpdated: 1,
      }),
    );
    const { result, preexistingWritten } = await runChunk(t, {
      selectorOptionId: w.base,
      sportValue: "Baseball",
      setNameValue: "Chrome",
      cards: [chunkCard("7", 0, foreign)],
      deferCardCounts: true,
    });
    expect(result.storedIds).toHaveLength(1);
    expect(result.storedIds[0]).not.toBe(foreign);
    expect(preexistingWritten()).toEqual([]);
  });

  test("a full chunk of new cards makes a pinned number of writes", async () => {
    const t = convexTest(schema, modules);
    live.push(t);
    const w = await seed(t);
    const { log } = await runChunk(t, {
      selectorOptionId: w.base,
      sportValue: "Baseball",
      setNameValue: "Chrome",
      cards: Array.from({ length: CHUNK }, (_, i) => chunkCard(String(i + 1), i)),
      deferCardCounts: true,
    });
    // Measured: an insert and its SKU patch per card, and nothing else (no
    // players, teams or printed names here). The flush's patches are not in it.
    expect(log.writes).toBe(CHUNK * 2);
  });
});

describe("the deferred counts land once, equal to the cards the chunks inserted", () => {
  /** Enough cards for several chunks, with one variation whose parent is in the first. */
  const CARDS = CHUNK * 3 + 7;
  const cards = () =>
    Array.from({ length: CARDS }, (_, i) =>
      i === CARDS - 1
        ? wireCard("1b", { variation: true })
        : wireCard(i === 0 ? "1" : String(1000 + i)),
    );
  const commit = (t: T, w: { base: Id<"selectorOptions">; sport: Id<"selectorOptions"> }) =>
    t.withIdentity(ADMIN).action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: w.base,
      sportId: w.sport,
      cards: cards(),
    });

  test("every chunk runs deferred, the counts land in one extra mutation, and the tree is counted right", async () => {
    const t = convexTest(schema, modules);
    live.push(t);
    const w = await seed(t);
    const chunkCalls = vi.spyOn(
      commitCardChecklistChunk as unknown as Handler<{ deferCardCounts?: boolean; cards: unknown[] }, unknown>,
      "_handler",
    );
    const landCalls = vi.spyOn(
      commitCardChecklistLandCounts as unknown as Handler<unknown, unknown>,
      "_handler",
    );
    const result = await commit(t, w);
    expect(result.count).toBe(CARDS);

    expect(chunkCalls).toHaveBeenCalledTimes(Math.ceil(CARDS / CHUNK));
    for (const [, args] of chunkCalls.mock.calls) expect(args.deferCardCounts).toBe(true);
    expect(landCalls).toHaveBeenCalledTimes(1);
    expect(landCalls.mock.calls[0][1]).toMatchObject({
      selectorOptionId: w.base,
      insertedCardCount: CARDS,
      insertedBaseCardCount: CARDS,
    });

    // The variation was linked by finalize, which moved one card off the base count.
    const [leaf, set, sport] = await t.run((ctx) =>
      Promise.all([ctx.db.get(w.base), ctx.db.get(w.set), ctx.db.get(w.sport)]),
    );
    expect(leaf).toMatchObject({ cardCount: CARDS, nonVariationCardCount: CARDS - 1 });
    expect(leaf?.lastCardAt).toBeDefined();
    expect(set).toMatchObject({ subtreeCardCount: CARDS, subtreeNonVariationCardCount: CARDS - 1 });
    expect(sport?.hasCards).toBe(true);
  });

  test("a commit of one chunk keeps its own flush: no flag, no extra mutation", async () => {
    const t = convexTest(schema, modules);
    live.push(t);
    const w = await seed(t);
    const chunkCalls = vi.spyOn(
      commitCardChecklistChunk as unknown as Handler<{ deferCardCounts?: boolean }, unknown>,
      "_handler",
    );
    const landCalls = vi.spyOn(
      commitCardChecklistLandCounts as unknown as Handler<unknown, unknown>,
      "_handler",
    );
    await t.withIdentity(ADMIN).action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: w.base,
      sportId: w.sport,
      cards: [wireCard("1"), wireCard("2"), wireCard("3")],
    });
    expect(chunkCalls).toHaveBeenCalledTimes(1);
    expect(chunkCalls.mock.calls[0][1].deferCardCounts).toBeUndefined();
    expect(landCalls).not.toHaveBeenCalled();
    const leaf = await t.run((ctx) => ctx.db.get(w.base));
    expect(leaf?.cardCount).toBe(3);
  });

  test("a chunk that fails does not cancel its siblings: they are counted, the failure is reported, a re-run converges", async () => {
    const t = convexTest(schema, modules);
    live.push(t);
    const w = await seed(t);
    const chunkCount = Math.ceil(CARDS / CHUNK);
    expect(chunkCount).toBeGreaterThanOrEqual(4);
    expect(chunkCount).toBeLessThanOrEqual(COMMIT_CHUNK_PARALLEL_CALLS);
    const real = handlerOf<{ cards: Array<{ cardNumber: string }> }, unknown>(commitCardChecklistChunk);
    // The second chunk's first card is the one the chunk is told apart by.
    const secondChunkFirst = [...cards()]
      .map((c, i) => ({ c, i }))
      .sort((a, b) => 0 || a.i - b.i)[CHUNK].c.cardNumber;
    const failing = vi
      .spyOn(commitCardChecklistChunk as unknown as Handler<{ cards: Array<{ cardNumber: string }> }, unknown>, "_handler")
      .mockImplementation(async (ctx, args) => {
        if (args.cards.some((c) => c.cardNumber === secondChunkFirst)) {
          throw new Error("chunk blew up");
        }
        return real(ctx, args);
      });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(commit(t, w)).rejects.toThrow(/chunk 2\/\d+ \(cards \d+-\d+ of \d+\) failed/);
    // Every chunk of the wave was attempted, the failed one included.
    expect(failing).toHaveBeenCalledTimes(chunkCount);
    const rows = await t.run((ctx) =>
      ctx.db
        .query("cardChecklist")
        .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", w.base))
        .collect(),
    );
    expect(rows.length).toBe(CARDS - CHUNK);
    // The chunks that landed are counted, the failed one's cards are not.
    const afterFailure = await t.run((ctx) => ctx.db.get(w.base));
    expect(afterFailure?.cardCount).toBe(CARDS - CHUNK);
    const setAfterFailure = await t.run((ctx) => ctx.db.get(w.set));
    expect(setAfterFailure?.subtreeCardCount).toBe(CARDS - CHUNK);

    // The re-run adopts what landed and adds the missing chunk once.
    failing.mockRestore();
    const rerun = await commit(t, w);
    expect(rerun.count).toBe(CARDS);
    const again = await t.run((ctx) =>
      ctx.db
        .query("cardChecklist")
        .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", w.base))
        .collect(),
    );
    expect(again.length).toBe(CARDS);
    const leaf = await t.run((ctx) => ctx.db.get(w.base));
    expect(leaf).toMatchObject({ cardCount: CARDS, nonVariationCardCount: CARDS - 1 });
  });

  test("a wave that failed is the last: no later wave is started", async () => {
    const t = convexTest(schema, modules);
    live.push(t);
    const w = await seed(t);
    // One wave and a bit: the last chunk only exists if a second wave runs.
    const total = CHUNK * (COMMIT_CHUNK_PARALLEL_CALLS + 1);
    const real = handlerOf<{ cards: Array<{ cardNumber: string }> }, unknown>(commitCardChecklistChunk);
    const all = Array.from({ length: total }, (_, i) => wireCard(String(1000 + i)));
    const failing = vi
      .spyOn(commitCardChecklistChunk as unknown as Handler<{ cards: Array<{ cardNumber: string }> }, unknown>, "_handler")
      .mockImplementation(async (ctx, args) => {
        if (args.cards.some((c) => c.cardNumber === all[0].cardNumber)) throw new Error("chunk blew up");
        return real(ctx, args);
      });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      t.withIdentity(ADMIN).action(api.selectorOptions.commitCardChecklist, {
        selectorOptionId: w.base,
        sportId: w.sport,
        cards: all,
      }),
    ).rejects.toThrow(/chunk 1\/\d+/);
    expect(failing).toHaveBeenCalledTimes(COMMIT_CHUNK_PARALLEL_CALLS);
  });
});

describe("a checklist that numbers two series the same keeps its creation order", () => {
  test("cards tying on sortOrder across chunks run their chunks one after another", async () => {
    const t = convexTest(schema, modules);
    live.push(t);
    const w = await seed(t);
    const half = CHUNK + 20;
    // Two series, each #1-half: every number appears once in each series, and
    // the second series' cards land in a later chunk than the first's.
    const series = (label: string) =>
      Array.from({ length: half }, (_, i) => ({
        ...wireCard(String(i + 1)),
        cardName: `${label} ${i + 1}`,
        platformData: { bsc: { ref: `bsc-${label}-${i + 1}` } },
      }));
    const chunkCalls = vi.spyOn(
      commitCardChecklistChunk as unknown as Handler<{ deferCardCounts?: boolean }, unknown>,
      "_handler",
    );
    const landCalls = vi.spyOn(
      commitCardChecklistLandCounts as unknown as Handler<unknown, unknown>,
      "_handler",
    );
    await t.withIdentity(ADMIN).action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: w.base,
      sportId: w.sport,
      cards: [...series("S1"), ...series("S2")],
    });
    expect(chunkCalls.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const [, args] of chunkCalls.mock.calls) expect(args.deferCardCounts).toBeUndefined();
    expect(landCalls).not.toHaveBeenCalled();

    // Each number's two cards read in the payload's order: series 1 first.
    const rows = await t.run((ctx) =>
      ctx.db
        .query("cardChecklist")
        .withIndex("by_selector_option_and_sort", (q) => q.eq("selectorOptionId", w.base))
        .collect(),
    );
    expect(rows).toHaveLength(half * 2);
    const names = rows.map((r) => r.cardName);
    for (let i = 0; i < half; i++) {
      expect(names.indexOf(`S1 ${i + 1}`)).toBeLessThan(names.indexOf(`S2 ${i + 1}`));
    }
    const leaf = await t.run((ctx) => ctx.db.get(w.base));
    expect(leaf?.cardCount).toBe(half * 2);
  });
});

describe("landing the counts", () => {
  test("a count of nothing writes nothing", async () => {
    const t = convexTest(schema, modules);
    live.push(t);
    const w = await seed(t);
    await t.mutation(internal.selectorOptions.commitCardChecklistLandCounts, {
      selectorOptionId: w.base,
      insertedCardCount: 0,
      insertedBaseCardCount: 0,
    });
    const leaf = await t.run((ctx) => ctx.db.get(w.base));
    expect(leaf?.cardCount).toBe(0);
    expect(leaf?.lastCardAt).toBeUndefined();
  });

  test("the landing recounts: whatever the caller reports, the leaf and its ancestors end at the real count", async () => {
    const t = convexTest(schema, modules);
    live.push(t);
    const w = await seed(t);
    // Rows in, counts never landed: leaf and set read 0, the checklist holds 12 (3 variations).
    await t.run(async (ctx) => {
      for (let i = 0; i < 12; i++) {
        await insertTestCard(ctx, plainCard(w.base, i));
      }
    });
    const rows = await t.run((ctx) =>
      ctx.db
        .query("cardChecklist")
        .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", w.base))
        .collect(),
    );
    await t.run(async (ctx) => {
      for (const row of rows.slice(0, 3)) await ctx.db.patch(row._id, { variationOfCardId: rows[3]._id });
    });
    const land = (insertedCardCount: number) =>
      t.mutation(internal.selectorOptions.commitCardChecklistLandCounts, {
        selectorOptionId: w.base,
        insertedCardCount,
        insertedBaseCardCount: insertedCardCount,
      });
    // A re-run that inserted nothing still repairs.
    await land(0);
    const expected = { cardCount: 12, nonVariationCardCount: 9 };
    expect(await t.run((ctx) => ctx.db.get(w.base))).toMatchObject(expected);
    expect(await t.run((ctx) => ctx.db.get(w.set))).toMatchObject({
      subtreeCardCount: 12,
      subtreeNonVariationCardCount: 9,
    });
    // Idempotent: landing again, with a lying report, moves nothing.
    await land(40);
    expect(await t.run((ctx) => ctx.db.get(w.base))).toMatchObject(expected);
    expect(await t.run((ctx) => ctx.db.get(w.set))).toMatchObject({
      subtreeCardCount: 12,
      subtreeNonVariationCardCount: 9,
    });
  });

  test("a leaf that reads higher than its cards is brought down, with the rows above it", async () => {
    const t = convexTest(schema, modules);
    live.push(t);
    const w = await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 4; i++) {
        await insertTestCard(ctx, plainCard(w.base, i));
      }
      await ctx.db.patch(w.base, { cardCount: 9, nonVariationCardCount: 9 });
      await ctx.db.patch(w.set, { subtreeCardCount: 9, subtreeNonVariationCardCount: 9 });
    });
    await t.mutation(internal.selectorOptions.commitCardChecklistLandCounts, {
      selectorOptionId: w.base,
      insertedCardCount: 0,
      insertedBaseCardCount: 0,
    });
    expect(await t.run((ctx) => ctx.db.get(w.base))).toMatchObject({ cardCount: 4, nonVariationCardCount: 4 });
    expect(await t.run((ctx) => ctx.db.get(w.set))).toMatchObject({
      subtreeCardCount: 4,
      subtreeNonVariationCardCount: 4,
    });
  });
});

// ─── adversarial pass (NEO-645) ──────────────────────────────────────────────

/** Every `cardChecklist` row of the leaf, counted the way the leaf row should read. */
async function truth(t: T, leaf: Id<"selectorOptions">) {
  return t.run(async (ctx) => {
    const rows = await ctx.db
      .query("cardChecklist")
      .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", leaf))
      .collect();
    return {
      all: rows.length,
      nonVariation: rows.filter((r) => r.variationOfCardId === undefined).length,
    };
  });
}

const plainCard = (leaf: Id<"selectorOptions">, i: number) => ({
  selectorOptionId: leaf,
  cardNumber: String(i + 1),
  cardName: `Card ${i + 1}`,
  listingTitle: `Card ${i + 1}`,
  platformData: {},
  sortOrder: i,
  lastUpdated: 1,
});

const MANY = CHUNK * 2 + 5;
const distinct = (n: number) => Array.from({ length: n }, (_, i) => wireCard(String(1000 + i)));
const commitAll = (t: T, w: { base: Id<"selectorOptions">; sport: Id<"selectorOptions"> }, cards: unknown[]) =>
  t.withIdentity(ADMIN).action(api.selectorOptions.commitCardChecklist, {
    selectorOptionId: w.base,
    sportId: w.sport,
    cards: cards as never,
  });

describe("a commit whose count landing fails", () => {
  // Rows landed but their counts did not; a re-run adopts the rows as updates (it inserts nothing), so only a RECOUNT landing repairs the leaf.
  test("every chunk landed but the landing threw: a re-run still leaves the leaf and its ancestors at the real count", async () => {
    const t = convexTest(schema, modules);
    live.push(t);
    const w = await seed(t);
    const real = handlerOf<unknown, unknown>(commitCardChecklistLandCounts);
    const landing = vi
      .spyOn(commitCardChecklistLandCounts as unknown as Handler<unknown, unknown>, "_handler")
      .mockImplementation(async () => {
        throw new Error("landing blew up");
      });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const cards = distinct(MANY);
    await expect(commitAll(t, w, cards)).rejects.toThrow(/card counts failed/);
    landing.mockImplementation(real as never);

    await commitAll(t, w, cards);
    const real_ = await truth(t, w.base);
    expect(real_.all).toBe(MANY);
    const [leaf, set] = await t.run((ctx) => Promise.all([ctx.db.get(w.base), ctx.db.get(w.set)]));
    expect(leaf).toMatchObject({ cardCount: MANY, nonVariationCardCount: MANY });
    expect(set).toMatchObject({ subtreeCardCount: MANY, subtreeNonVariationCardCount: MANY });
  });

  // The logged-and-dropped landing must not lose the counts of the chunks that did land: the retry's landing recounts them.
  test("a partial failure whose landing also fails: the retry counts the cards that landed exactly once", async () => {
    const t = convexTest(schema, modules);
    live.push(t);
    const w = await seed(t);
    const cards = distinct(MANY);
    const realChunk = handlerOf<{ cards: Array<{ cardNumber: string }> }, unknown>(commitCardChecklistChunk);
    const failFirst = vi
      .spyOn(commitCardChecklistChunk as unknown as Handler<{ cards: Array<{ cardNumber: string }> }, unknown>, "_handler")
      .mockImplementation(async (ctx, args) => {
        if (args.cards.some((c) => c.cardNumber === cards[0].cardNumber)) throw new Error("chunk blew up");
        return realChunk(ctx, args);
      });
    const realLand = handlerOf<unknown, unknown>(commitCardChecklistLandCounts);
    const landing = vi
      .spyOn(commitCardChecklistLandCounts as unknown as Handler<unknown, unknown>, "_handler")
      .mockImplementation(async () => {
        throw new Error("landing blew up");
      });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(commitAll(t, w, cards)).rejects.toThrow(/chunk 1\/\d+/);
    expect(logged.mock.calls.some(([line]) => String(line).includes("commit_card_counts_not_landed"))).toBe(true);
    failFirst.mockRestore();
    landing.mockImplementation(realLand as never);

    await commitAll(t, w, cards);
    const leaf = await t.run((ctx) => ctx.db.get(w.base));
    expect(leaf?.cardCount).toBe(MANY);
  });
});

describe("a mixed insert and update commit counts the tree once", () => {
  test("existing cards (one a variation) are adopted, new ones inserted across chunks: leaf and ancestors equal the rows", async () => {
    const t = convexTest(schema, modules);
    live.push(t);
    const w = await seed(t);
    // First commit: a base card and its variation, one chunk.
    await commitAll(t, w, [wireCard("1"), wireCard("1b", { variation: true })]);
    // Second commit: the same two (updates) beside enough new cards for several chunks.
    await commitAll(t, w, [wireCard("1"), wireCard("1b", { variation: true }), ...distinct(MANY)]);
    const real = await truth(t, w.base);
    expect(real).toEqual({ all: MANY + 2, nonVariation: MANY + 1 });
    const [leaf, set, sport] = await t.run((ctx) =>
      Promise.all([ctx.db.get(w.base), ctx.db.get(w.set), ctx.db.get(w.sport)]),
    );
    expect(leaf).toMatchObject({ cardCount: real.all, nonVariationCardCount: real.nonVariation });
    expect(set).toMatchObject({
      subtreeCardCount: real.all,
      subtreeNonVariationCardCount: real.nonVariation,
    });
    expect(sport?.hasCards).toBe(true);
  });

  test("a commit that only updates still lands (a recount), writes nothing new, and leaves the totals alone", async () => {
    const t = convexTest(schema, modules);
    live.push(t);
    const w = await seed(t);
    const cards = distinct(MANY);
    await commitAll(t, w, cards);
    const before = await t.run((ctx) => ctx.db.get(w.base));
    const landCalls = vi.spyOn(
      commitCardChecklistLandCounts as unknown as Handler<unknown, unknown>,
      "_handler",
    );
    await commitAll(t, w, cards);
    // The landing runs whenever the chunks ran together, so a lost landing is repaired
    // by a re-run that inserts nothing; here the counts are right and it changes nothing.
    expect(landCalls).toHaveBeenCalledTimes(1);
    expect(landCalls.mock.calls[0][1]).toMatchObject({ insertedCardCount: 0, insertedBaseCardCount: 0 });
    const leaf = await t.run((ctx) => ctx.db.get(w.base));
    expect(leaf?.cardCount).toBe(MANY);
    expect(leaf?.lastCardAt).toBe(before?.lastCardAt);
  });
});

describe("chunksMayRunTogether on the numbers a real checklist has", () => {
  const sortOrders = (numbers: string[], chunkSize: number) => {
    const sorted = [...numbers].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const order = new Map<string, number>();
    sorted.forEach((n, i) => order.set(n, i));
    const out: Array<Array<{ sortOrder: number }>> = [];
    for (let i = 0; i < numbers.length; i += chunkSize) {
      out.push(numbers.slice(i, i + chunkSize).map((n) => ({ sortOrder: order.get(n)! })));
    }
    return out;
  };

  test("two NNO cards in different chunks share a sort order: sequential", () => {
    const numbers = ["1", "2", "NNO", "3", "4", "NNO"];
    expect(chunksMayRunTogether(sortOrders(numbers, 3))).toBe(false);
  });

  test("letter-suffixed numbers are distinct sort orders: parallel", () => {
    const numbers = ["1a", "1b", "1c", "2a", "2b", "2c"];
    expect(chunksMayRunTogether(sortOrders(numbers, 3))).toBe(true);
  });

  test("a tie only between the first and last chunk is still caught", () => {
    expect(chunksMayRunTogether([[{ sortOrder: 7 }], [{ sortOrder: 1 }], [{ sortOrder: 2 }], [{ sortOrder: 7 }]])).toBe(false);
  });
});

describe("a commit with NNO cards across chunks", () => {
  test("keeps the payload's creation order for the NNO cards and counts every card", async () => {
    const t = convexTest(schema, modules);
    live.push(t);
    const w = await seed(t);
    const cards = [
      ...distinct(CHUNK - 1),
      { ...wireCard("NNO"), cardName: "First NNO", platformData: { bsc: { ref: "bsc-nno-1" } } },
      ...distinct(CHUNK).map((c, i) => ({ ...c, cardNumber: String(5000 + i), platformData: { bsc: { ref: `bsc-late-${i}` } } })),
      { ...wireCard("NNO"), cardName: "Second NNO", platformData: { bsc: { ref: "bsc-nno-2" } } },
    ];
    const chunkCalls = vi.spyOn(
      commitCardChecklistChunk as unknown as Handler<{ deferCardCounts?: boolean }, unknown>,
      "_handler",
    );
    await commitAll(t, w, cards);
    expect(chunkCalls.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const [, args] of chunkCalls.mock.calls) expect(args.deferCardCounts).toBeUndefined();
    const rows = await t.run((ctx) =>
      ctx.db
        .query("cardChecklist")
        .withIndex("by_selector_option_and_sort", (q) => q.eq("selectorOptionId", w.base))
        .collect(),
    );
    const nno = rows.filter((r) => r.cardNumber === "NNO").map((r) => r.cardName);
    expect(nno).toEqual(["First NNO", "Second NNO"]);
    const leaf = await t.run((ctx) => ctx.db.get(w.base));
    expect(leaf?.cardCount).toBe(cards.length);
  });
});

describe("the lookup enqueue is scheduled, not awaited", () => {
  const scheduledEnqueues = (t: T) =>
    t.run(async (ctx) => {
      const rows = await (ctx as unknown as {
        db: { system: { query: (n: string) => { collect: () => Promise<Array<{ name: string; args: unknown[] }>> } } };
      }).db.system.query("_scheduled_functions").collect();
      return rows.filter((r) => r.name === "tidyNames:enqueuePendingLookups");
    });

  test("a commit schedules the enqueue for its leaf and does not run it inline", async () => {
    const t = convexTest(schema, modules);
    live.push(t);
    const w = await seed(t);
    const rowId = await t.run((ctx) =>
      ctx.db.insert("tidyNames", {
        scopeId: w.base,
        kind: "player",
        nameNormalized: "pending person",
        name: "Pending Person",
        sportId: w.sport,
        status: "pending",
        lookupGen: 0,
      } as never),
    );
    await commitAll(t, w, distinct(MANY));
    const queued = await scheduledEnqueues(t);
    expect(queued).toHaveLength(1);
    expect(queued[0].args[0]).toEqual({ scopeId: w.base });
    // Not run inline: the row still waits for the scheduled function.
    expect((await t.run((ctx) => ctx.db.get(rowId)))?.lookupGen).toBe(0);
  });

  test("a failed commit schedules nothing, and the re-run schedules it once more", async () => {
    const t = convexTest(schema, modules);
    live.push(t);
    const w = await seed(t);
    const cards = distinct(MANY);
    const realChunk = handlerOf<{ cards: Array<{ cardNumber: string }> }, unknown>(commitCardChecklistChunk);
    const failing = vi
      .spyOn(commitCardChecklistChunk as unknown as Handler<{ cards: Array<{ cardNumber: string }> }, unknown>, "_handler")
      .mockImplementation(async (ctx, args) => {
        if (args.cards.some((c) => c.cardNumber === cards[0].cardNumber)) throw new Error("chunk blew up");
        return realChunk(ctx, args);
      });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(commitAll(t, w, cards)).rejects.toThrow();
    expect(await scheduledEnqueues(t)).toHaveLength(0);
    failing.mockRestore();
    await commitAll(t, w, cards);
    expect(await scheduledEnqueues(t)).toHaveLength(1);
  });

  // A queued row stays `pending`, so the walk needs a real cursor: a `.take()` re-read page one and never reached the rest.
  test("the scheduled enqueue queues every pending name across pages, and a second run queues none twice", async () => {
    const t = convexTest(schema, modules);
    live.push(t);
    const w = await seed(t);
    const total = ENQUEUE_PAGE * 2 + 17;
    await t.run(async (ctx) => {
      for (let i = 0; i < total; i++) {
        await ctx.db.insert("tidyNames", {
          scopeId: w.base,
          kind: "player",
          nameNormalized: `pending person ${i}`,
          name: `Pending Person ${i}`,
          sportId: w.sport,
          status: "pending",
          lookupGen: 0,
        } as never);
      }
    });
    // One page per call; each call schedules the next with the cursor it ended on.
    // Walk that chain by hand (draining it would reach the unregistered wikidata pool).
    const walk = async () => {
      let sum = 0;
      let calls = 0;
      let args: { scopeId: Id<"selectorOptions">; cursor?: string } | undefined = { scopeId: w.base };
      while (args && calls < 10) {
        const known = (await scheduledEnqueues(t)).length;
        sum += await t.mutation(internal.tidyNames.enqueuePendingLookups, args);
        calls++;
        const after = await scheduledEnqueues(t);
        args = after.length > known ? (after[after.length - 1].args[0] as typeof args) : undefined;
      }
      return { sum, calls };
    };
    const first = await walk();
    const queued = first.sum;
    // 2 full pages and a part page: three calls, and the walk ends by itself.
    expect(first.calls).toBe(3);
    expect(queued).toBe(total);
    const rows = await t.run((ctx) => ctx.db.query("tidyNames").collect());
    expect(rows.every((r) => r.lookupGen === 1)).toBe(true);
    // Idempotent: a second walk finds nothing left to queue, on every page.
    expect((await walk()).sum).toBe(0);
  });
});
