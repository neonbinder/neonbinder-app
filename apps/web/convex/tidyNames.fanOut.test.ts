/**
 * NEO-645 — the fan-out of one name answer to every other card that prints it.
 *
 * Two jobs: pin what the fan-out does (compare-and-set against the previous
 * answer, skips a card the operator edited by hand, stops when a newer answer
 * lands), and MEASURE what one card costs, which is where `FAN_OUT_PAGE_SIZE`
 * and the "about 800-1000 operations per page" budget come from.
 */

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { insertTestCard } from "../lib/testing/card-row";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import { syncCardPrintedNames } from "./cardPrintedNames";
import { FAN_OUT_PAGE_SIZE, fanOutPageImpl } from "./tidyNames";
import { cancelScheduled } from "../lib/testing/drain-scheduled";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

type T = ReturnType<typeof convexTest>;
const NAME = "Bo Jackson";
const KEY = normalizeEntityName(NAME);

async function world(t: T, cards: number, opts: { overrideEvery?: number } = {}) {
  return t.run(async (ctx) => {
    const sport = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      platformData: {},
      children: [],
      lastUpdated: 1,
    });
    const leaf = await ctx.db.insert("selectorOptions", {
      level: "variantType",
      value: "Insert",
      parentId: sport,
      platformData: {},
      children: [],
      lastUpdated: 1,
    });
    const player = await ctx.db.insert("players", {
      name: NAME,
      nameNormalized: KEY,
      sportId: sport,
      lastUpdated: 1,
    });
    const rowId = await ctx.db.insert("tidyNames", {
      scopeId: leaf,
      kind: "player",
      nameNormalized: KEY,
      name: NAME,
      sportId: sport,
      status: "ready",
      answer: { kind: "linkPlayer", playerId: player, by: "operator" },
      answerGen: 1,
    });
    const ids: Array<Id<"cardChecklist">> = [];
    for (let i = 0; i < cards; i++) {
      const id = await insertTestCard(ctx, {
        selectorOptionId: leaf,
        cardNumber: String(i + 1),
        cardName: `Card ${i + 1}`,
        platformData: {},
        sportId: sport,
        sortOrder: i,
        lastUpdated: 1_700_000_000_000,
        pendingPlayerNames: [NAME],
      });
      await syncCardPrintedNames(ctx, { _id: id }, [
        {
          kind: "player",
          scopeId: leaf,
          nameNormalized: KEY,
          printed: NAME,
          order: 0,
          ...(opts.overrideEvery && i % opts.overrideEvery === 0 ? { cardOverride: true as const } : {}),
        },
      ]);
      ids.push(id);
    }
    return { sport, leaf, player, rowId, ids };
  });
}

const baseArgs = (w: Awaited<ReturnType<typeof world>>, openCardId: Id<"cardChecklist">) => ({
  scopeId: w.leaf,
  kind: "player" as const,
  nameNormalized: KEY,
  gen: 1,
  change: { kind: "linkPlayer" as const, playerId: w.player },
  openCardId,
  userId: "op",
  cursor: null,
});

/**
 * `ctx.db` with every database call counted: `calls` is one per get / insert /
 * patch / delete / query terminal (`first`, `unique`, `take`, `collect`,
 * `paginate`), `reads` adds the documents a terminal returned and each get.
 */
function counting(ctx: { db: unknown }) {
  const tally = { calls: 0, reads: 0, writes: 0 };
  const TERMINAL = new Set(["first", "unique", "take", "collect", "paginate"]);
  const wrap = (target: object): object =>
    new Proxy(target, {
      get(obj, prop) {
        const value = Reflect.get(obj, prop);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const name = String(prop);
          const out = value.apply(obj, args);
          if (name === "get") {
            tally.calls += 1;
            tally.reads += 1;
            return out;
          }
          if (name === "insert" || name === "patch" || name === "replace" || name === "delete") {
            tally.calls += 1;
            tally.writes += 1;
            return out;
          }
          if (TERMINAL.has(name)) {
            tally.calls += 1;
            return Promise.resolve(out).then((rows) => {
              if (Array.isArray(rows)) tally.reads += rows.length;
              else if (rows && typeof rows === "object" && "page" in rows) {
                tally.reads += (rows as { page: unknown[] }).page.length;
              } else if (rows) tally.reads += 1;
              return rows;
            });
          }
          // A query builder: keep wrapping down the chain.
          if (out && typeof out === "object" && !("then" in (out as object))) return wrap(out as object);
          return out;
        };
      },
    });
  return { db: wrap(ctx.db as object), tally };
}

describe("tidyNames.fanOut — the page", () => {
  test("links every other card that prints the name, never the open one, and clears its pending name", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t, 6);
    const result = await t.run(async (ctx) => fanOutPageImpl(ctx, baseArgs(w, w.ids[0])));
    expect(result).toMatchObject({ done: true, stale: false, applied: 5 });
    const cards = await t.run((ctx) => Promise.all(w.ids.map((id) => ctx.db.get(id))));
    expect(cards[0]!.playerIds).toBeUndefined();
    for (const card of cards.slice(1)) {
      expect(card!.playerIds).toEqual([w.player]);
      expect(card!.playerLinks).toEqual([{ playerId: w.player, nameOnCard: NAME }]);
      expect(card!.pendingPlayerNames ?? []).toEqual([]);
    }
    await cancelScheduled(t);
  });

  test("a card the operator edited by hand (cardOverride) is skipped and counted", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t, 6, { overrideEvery: 2 }); // cards 0, 2, 4
    const result = await t.run(async (ctx) => fanOutPageImpl(ctx, baseArgs(w, w.ids[1])));
    expect(result.skipped).toBe(3);
    expect(result.applied).toBe(2); // cards 3 and 5; card 1 is the open one
    const cards = await t.run((ctx) => Promise.all(w.ids.map((id) => ctx.db.get(id))));
    expect(cards[0]!.playerIds).toBeUndefined();
    expect(cards[3]!.playerIds).toEqual([w.player]);
    await cancelScheduled(t);
  });

  test("stops (stale) when a newer answer has moved the generation on", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t, 4);
    await t.run((ctx) => ctx.db.patch(w.rowId, { answerGen: 2 }));
    const result = await t.run(async (ctx) => fanOutPageImpl(ctx, baseArgs(w, w.ids[0])));
    expect(result).toMatchObject({ stale: true, applied: 0 });
    const cards = await t.run((ctx) => Promise.all(w.ids.map((id) => ctx.db.get(id))));
    expect(cards.every((c) => c!.playerIds === undefined)).toBe(true);
  });

  test("does not bump lastUpdated on a card that is not linked (printed rows only)", async () => {
    // A name link IS a data write and bumps the baseVersion; this pins the
    // opposite: the open card, which the fan-out skips, keeps its stamp.
    const t = convexTest(schema, modules);
    const w = await world(t, 3);
    await t.run(async (ctx) => fanOutPageImpl(ctx, baseArgs(w, w.ids[0])));
    const open = (await t.run((ctx) => ctx.db.get(w.ids[0])))! as Doc<"cardChecklist">;
    expect(open.lastUpdated).toBe(1_700_000_000_000);
    await cancelScheduled(t);
  });
});

describe("tidyNames.fanOut — what one card costs (the FAN_OUT_OPS_PER_CARD measurement)", () => {
  test("a full page stays inside the transaction budget; the per-card numbers are in the doc comment", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t, FAN_OUT_PAGE_SIZE);
    const measured = await t.run(async (ctx) => {
      const probe = counting(ctx);
      const result = await fanOutPageImpl({ ...ctx, db: probe.db } as never, baseArgs(w, w.ids[0]));
      return { result, tally: probe.tally };
    });
    // The page holds FAN_OUT_PAGE_SIZE printers; the open card is one of them.
    expect(measured.result.applied).toBe(FAN_OUT_PAGE_SIZE - 1);
    // The numbers in the doc comment on FAN_OUT_PAGE_SIZE (tidyNames.ts): a
    // change that moves them past the band must update both.
    const per = measured.tally.calls / (FAN_OUT_PAGE_SIZE - 1);
    expect(per).toBeGreaterThan(3);
    expect(per).toBeLessThan(7);
    expect(measured.tally.writes).toBeLessThanOrEqual(2 * FAN_OUT_PAGE_SIZE);
    // calls + documents read + documents written, each once: far under ~900.
    expect(measured.tally.calls + measured.tally.reads + measured.tally.writes).toBeLessThan(900);
    await cancelScheduled(t);
  });
});
