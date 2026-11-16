/**
 * NEO-535 — `subtreeMayHoldCards` draws on ONE probe budget per transaction.
 *
 * The doors that ask it (a brand re-home, the reconciliation write pass) ask
 * once per row inside a transaction already sized to its row cap, so a
 * per-call cap alone multiplies by the row count. These tests seed sets the
 * NEO-358 counts never reached (no `subtreeCardCount`), each with a wide
 * empty subtree, and count the probe's reads.
 */

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { drainScheduled } from "../lib/testing/drain-scheduled";
import { insertTestCard } from "../lib/testing/card-row";
import {
  CARD_PROBE_READS_PER_TRANSACTION,
  cardProbeBudgetFor,
  subtreeMayHoldCards,
} from "./cardDescriptionFanOut";
import { rehomeSetRowsToBrand } from "./brandRehome";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

const SENTINEL = 1_000_000;
const SETS = 20;
/** Empty rows under each set: well under the 50-row per-call cap. */
const CHILDREN = 30;
/** Reads one fully probed set costs: a `.first()` and a `get` per row. */
const READS_PER_SET = (1 + CHILDREN) * 2;

type T = ReturnType<typeof convexTest>;

/** sport → year → Unknown + Topps brands; `SETS` uncounted empty sets under Unknown. */
async function seed(t: T) {
  return t.run(async (ctx) => {
    const sport = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      platformData: {},
      children: [],
      lastUpdated: SENTINEL,
    });
    const year = await ctx.db.insert("selectorOptions", {
      level: "year",
      value: "1995",
      parentId: sport,
      platformData: {},
      children: [],
      lastUpdated: SENTINEL,
    });
    const unknown = await ctx.db.insert("selectorOptions", {
      level: "manufacturer",
      value: "Unknown",
      parentId: year,
      metadata: { isBrandUnknown: true },
      platformData: {},
      children: [],
      lastUpdated: SENTINEL,
    });
    const topps = await ctx.db.insert("selectorOptions", {
      level: "manufacturer",
      value: "Topps",
      parentId: year,
      platformData: {},
      children: [],
      lastUpdated: SENTINEL,
    });
    await ctx.db.patch(sport, { children: [year] });
    await ctx.db.patch(year, { children: [unknown, topps] });
    const sets: Array<Id<"selectorOptions">> = [];
    for (let s = 0; s < SETS; s += 1) {
      const set = await ctx.db.insert("selectorOptions", {
        level: "setName",
        value: `Set ${s}`,
        parentId: unknown,
        platformData: {},
        children: [],
        lastUpdated: SENTINEL,
      });
      const kids: Array<Id<"selectorOptions">> = [];
      for (let c = 0; c < CHILDREN; c += 1) {
        kids.push(
          await ctx.db.insert("selectorOptions", {
            level: "variantType",
            value: `Type ${c}`,
            parentId: set,
            platformData: {},
            children: [],
            lastUpdated: SENTINEL,
          }),
        );
      }
      await ctx.db.patch(set, { children: kids });
      sets.push(set);
    }
    await ctx.db.patch(unknown, { children: sets });
    return { unknown, topps, sets };
  });
}

/** `ctx` with every `db.get` and `db.query` counted. */
function counting(ctx: MutationCtx): { ctx: MutationCtx; reads: () => number } {
  let reads = 0;
  const db = new Proxy(ctx.db, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (typeof value !== "function") return value;
      if (prop === "get" || prop === "query") {
        return (...args: unknown[]) => {
          reads += 1;
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return (value as (...a: unknown[]) => unknown).bind(target);
    },
  });
  return { ctx: { ...ctx, db } as MutationCtx, reads: () => reads };
}

describe("subtreeMayHoldCards probe budget", () => {
  test(`${SETS} uncounted empty sets spend at most ${CARD_PROBE_READS_PER_TRANSACTION} reads in one transaction`, async () => {
    const t = convexTest(schema, modules);
    const { sets } = await seed(t);
    // Unbounded, this would be every set probed in full.
    expect(SETS * READS_PER_SET).toBeGreaterThan(CARD_PROBE_READS_PER_TRANSACTION * 5);

    const answers = await t.run(async (raw) => {
      const { ctx, reads } = counting(raw as MutationCtx);
      const out: boolean[] = [];
      for (const id of sets) {
        const row = (await raw.db.get(id))!;
        out.push(await subtreeMayHoldCards(ctx, row));
      }
      return { out, reads: reads(), left: cardProbeBudgetFor(ctx).left };
    });

    expect(answers.reads).toBeLessThanOrEqual(CARD_PROBE_READS_PER_TRANSACTION);
    expect(answers.left).toBe(0);
    // The sets probed in full are truly empty; past the budget every answer
    // is "maybe", never a guessed "no".
    const fullyProbed = Math.floor(CARD_PROBE_READS_PER_TRANSACTION / READS_PER_SET);
    expect(answers.out.slice(0, fullyProbed)).toEqual(Array(fullyProbed).fill(false));
    expect(answers.out.slice(fullyProbed)).toEqual(Array(SETS - fullyProbed).fill(true));
  });

  test("a counted row spends nothing, and a new transaction starts a fresh budget", async () => {
    const t = convexTest(schema, modules);
    const { sets } = await seed(t);
    await t.run((ctx) => ctx.db.patch(sets[0], { subtreeCardCount: 0 }));

    const first = await t.run(async (raw) => {
      const { ctx, reads } = counting(raw as MutationCtx);
      cardProbeBudgetFor(ctx).left = 0;
      const counted = await subtreeMayHoldCards(ctx, (await raw.db.get(sets[0]))!);
      const uncounted = await subtreeMayHoldCards(ctx, (await raw.db.get(sets[1]))!);
      return { counted, uncounted, reads: reads() };
    });
    expect(first).toEqual({ counted: false, uncounted: true, reads: 0 });

    const second = await t.run(async (raw) => {
      const { ctx, reads } = counting(raw as MutationCtx);
      const uncounted = await subtreeMayHoldCards(ctx, (await raw.db.get(sets[1]))!);
      return { uncounted, reads: reads() };
    });
    expect(second).toEqual({ uncounted: false, reads: READS_PER_SET });
  });

  test("a card found inside the budget still answers yes", async () => {
    const t = convexTest(schema, modules);
    const { sets } = await seed(t);
    const deepRow = await t.run(async (ctx) => (await ctx.db.get(sets[0]))!.children![CHILDREN - 1]);
    await t.run((ctx) =>
      insertTestCard(ctx, {
        selectorOptionId: deepRow,
        cardNumber: "1",
        cardName: "Someone",
        platformData: {},
        sortOrder: 1,
        lastUpdated: SENTINEL,
      }),
    );
    const answer = await t.run(async (ctx) =>
      subtreeMayHoldCards(ctx as MutationCtx, (await ctx.db.get(sets[0]))!),
    );
    expect(answer).toBe(true);
  });

  test("a brand re-home of the sets shares one budget across its rows", async () => {
    const t = convexTest(schema, modules);
    const { topps, sets } = await seed(t);
    const reads = await t.run(async (raw) => {
      const { ctx, reads: count } = counting(raw as MutationCtx);
      const rows = await Promise.all(sets.map(async (id) => (await raw.db.get(id))!));
      const before = count();
      const result = await rehomeSetRowsToBrand(ctx, { rows, brandId: topps });
      expect(result.rehomed).toBe(SETS);
      return { total: count() - before, left: cardProbeBudgetFor(ctx).left };
    });
    expect(reads.left).toBe(0);
    // Everything else the move reads is small next to the unbounded probe.
    expect(reads.total).toBeLessThan(SETS * READS_PER_SET);

    // Moving off Unknown flips every card's maker line: the sets the budget
    // proved empty schedule nothing; every "maybe" goes to the fan-out.
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    const fanOut = scheduled.filter((r) => r.name.includes("refreshRenamedCardDescriptions"));
    expect(fanOut).toHaveLength(1);
    const target = (fanOut[0].args[0] as { target: { rows: Array<{ rowId: string }> } }).target;
    const fullyProbed = Math.floor(CARD_PROBE_READS_PER_TRANSACTION / READS_PER_SET);
    expect(target.rows.map((r) => r.rowId)).toEqual(sets.slice(fullyProbed));
    await drainScheduled(t);
  }, 60_000);
});
