/**
 * NEO-616 — the shared-run rule (`sharedPrintRun`) and the refresh mutation
 * that writes it onto a variant row.
 */
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { insertTestCard } from "../lib/testing/card-row";
import { refreshVariantPrintRun } from "./variantPrintRun";
import {
  PRINT_RUN_SHARE,
  printRunsFromChecklistRows,
  sharedPrintRun,
} from "./lib/variantPrintRun";
import { MAX_BSC_PRINT_RUN } from "./lib/bscAttributeTokens";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

const NOW = 1_700_000_000_000;
const cards = (runs: Array<number | undefined>) => runs.map((printRun) => ({ printRun }));
const repeat = <T>(n: number, value: T): T[] => Array.from({ length: n }, () => value);

describe("sharedPrintRun — the 90% rule", () => {
  test("the share is 90%", () => {
    expect(PRINT_RUN_SHARE).toBe(0.9);
  });

  test("9 of 10 share a run: set", () => {
    expect(sharedPrintRun(cards([...repeat(9, 5), undefined]))).toBe(5);
  });

  test("8 of 10 share a run: clear", () => {
    expect(sharedPrintRun(cards([...repeat(8, 5), undefined, undefined]))).toBeUndefined();
  });

  test("all cards share a run: set", () => {
    expect(sharedPrintRun(cards(repeat(3, 25)))).toBe(25);
  });

  test("a tie between two runs clears", () => {
    expect(sharedPrintRun(cards([...repeat(5, 5), ...repeat(5, 10)]))).toBeUndefined();
  });

  test("a different run on the tenth card keeps the plurality at 90%", () => {
    expect(sharedPrintRun(cards([...repeat(9, 5), 10]))).toBe(5);
  });

  test("0 cards clears", () => {
    expect(sharedPrintRun([])).toBeUndefined();
  });

  test("unnumbered cards count against the share", () => {
    expect(sharedPrintRun(cards([5, undefined]))).toBeUndefined();
    expect(sharedPrintRun(cards([...repeat(18, 5), undefined, undefined]))).toBe(5);
  });

  test("a run that is not a whole number in range is no run", () => {
    expect(sharedPrintRun(cards([0]))).toBeUndefined();
    expect(sharedPrintRun(cards([-5]))).toBeUndefined();
    expect(sharedPrintRun(cards([2.5]))).toBeUndefined();
    expect(sharedPrintRun(cards([Number.NaN]))).toBeUndefined();
    expect(sharedPrintRun(cards([MAX_BSC_PRINT_RUN + 1]))).toBeUndefined();
    expect(sharedPrintRun(cards([MAX_BSC_PRINT_RUN]))).toBe(MAX_BSC_PRINT_RUN);
    expect(sharedPrintRun(cards([1]))).toBe(1);
  });
});

describe("printRunsFromChecklistRows", () => {
  const mk = (id: string, cardNumber: string, player: string) => ({
    id,
    cardNumber,
    players: [player],
  });
  const r = (number: string, player: string, printRun?: number) => ({
    number,
    players: [player],
    teams: [] as string[],
    ...(printRun !== undefined ? { printRun } : {}),
  });

  test("names pair across differing numbers", () => {
    const runs = printRunsFromChecklistRows(
      [mk("a", "89B-1", "Joe Montana"), mk("b", "89B-2", "Jerry Rice")],
      [r("89M-1", "Joe Montana", 5), r("89M-2", "Jerry Rice", 10)],
    );
    expect([...runs]).toEqual([
      ["a", 5],
      ["b", 10],
    ]);
  });

  test("a tie on either side pairs nothing", () => {
    expect(
      printRunsFromChecklistRows(
        [mk("a", "89B-1", "Dan Marino"), mk("b", "89B-2", "Dan Marino")],
        [r("89M-1", "Dan Marino", 5)],
      ).size,
    ).toBe(0);
    expect(
      printRunsFromChecklistRows(
        [mk("a", "89B-1", "Dan Marino")],
        [r("89M-1", "Dan Marino", 5), r("89M-2", "Dan Marino", 5)],
      ).size,
    ).toBe(0);
  });

  test("a number pair whose players disagree is dropped", () => {
    expect(
      printRunsFromChecklistRows([mk("a", "1", "Joe Montana")], [r("1", "Someone Else", 5)]).size,
    ).toBe(0);
  });

  test("a row without a run gives none", () => {
    expect(
      printRunsFromChecklistRows([mk("a", "1", "Joe Montana")], [r("1", "Joe Montana")]).size,
    ).toBe(0);
  });
});

type T = ReturnType<typeof convexTest>;
type SO = Id<"selectorOptions">;

async function seedRows(t: T) {
  return t.run(async (ctx) => {
    const node = async (level: string, value: string, parentId?: SO): Promise<SO> =>
      ctx.db.insert("selectorOptions", {
        level: level as never,
        value,
        ...(parentId ? { parentId } : {}),
        platformData: {},
        children: [],
        lastUpdated: NOW,
      });
    const sport = await node("sport", "Baseball");
    const year = await node("year", "2024", sport);
    const brand = await node("manufacturer", "Topps", year);
    const set = await node("setName", "Chrome", brand);
    const base = await node("variantType", "Base", set);
    const parallelType = await node("variantType", "Parallel", set);
    // A base parallel is an insert-level row under the Parallel type.
    const baseParallel = await node("insert", "Gold Wave", parallelType);
    const insertType = await node("variantType", "Insert", set);
    const insert = await node("insert", "Anime", insertType);
    const parallel = await node("parallel", "Kanji", insert);
    return { sport, set, base, parallelType, baseParallel, insert, parallel };
  });
}

async function addCards(t: T, rowId: SO, runs: Array<number | undefined>) {
  await t.run(async (ctx) => {
    for (const [i, printRun] of runs.entries()) {
      await insertTestCard(ctx, {
        selectorOptionId: rowId,
        cardNumber: String(i + 1),
        cardName: `Player ${i + 1}`,
        platformData: {},
        sortOrder: i,
        lastUpdated: NOW,
        ...(printRun !== undefined ? { printRun } : {}),
      });
    }
  });
}

const refresh = (t: T, id: SO) =>
  t.mutation(internal.variantPrintRun.refreshVariantPrintRun, { selectorOptionId: id });
const stored = (t: T, id: SO) => t.run(async (ctx) => (await ctx.db.get(id))!);

describe("refreshVariantPrintRun", () => {
  test("9 of 10 set, 8 of 10 clear: the row follows its cards", async () => {
    const t = convexTest(schema, modules);
    const { parallel } = await seedRows(t);
    await addCards(t, parallel, [...repeat(9, 5), undefined]);

    expect(await refresh(t, parallel)).toEqual({ outcome: "set", printRun: 5 });
    expect((await stored(t, parallel)).printRun).toBe(5);

    // One of the nine loses its run: 8 of 10.
    await t.run(async (ctx) => {
      const first = (await ctx.db.query("cardChecklist").first())!;
      await ctx.db.patch(first._id, { printRun: undefined });
    });
    expect(await refresh(t, parallel)).toEqual({ outcome: "cleared" });
    expect((await stored(t, parallel)).printRun).toBeUndefined();
  });

  test("a tie clears a stored run", async () => {
    const t = convexTest(schema, modules);
    const { parallel } = await seedRows(t);
    await t.run((ctx) => ctx.db.patch(parallel, { printRun: 5 }));
    await addCards(t, parallel, [...repeat(2, 5), ...repeat(2, 10)]);

    expect((await refresh(t, parallel)).outcome).toBe("cleared");
    expect((await stored(t, parallel)).printRun).toBeUndefined();
  });

  test("0 cards clears", async () => {
    const t = convexTest(schema, modules);
    const { parallel } = await seedRows(t);
    await t.run((ctx) => ctx.db.patch(parallel, { printRun: 5 }));

    expect((await refresh(t, parallel)).outcome).toBe("cleared");
    expect((await stored(t, parallel)).printRun).toBeUndefined();
  });

  test("every card-bearing level is covered, an insert-level base parallel included", async () => {
    const t = convexTest(schema, modules);
    const { base, baseParallel, insert, parallel } = await seedRows(t);
    for (const id of [base, baseParallel, insert, parallel]) {
      await addCards(t, id, repeat(3, 99));
    }
    for (const id of [base, baseParallel, insert, parallel]) {
      expect(await refresh(t, id)).toEqual({ outcome: "set", printRun: 99 });
      expect((await stored(t, id)).printRun).toBe(99);
    }
  });

  test("variations count in the denominator", async () => {
    const t = convexTest(schema, modules);
    const { parallel } = await seedRows(t);
    await addCards(t, parallel, repeat(9, 5));
    // A tenth card, a variation with no run: 9 of 10, still set.
    await t.run(async (ctx) => {
      const parent = (await ctx.db.query("cardChecklist").first())!;
      await insertTestCard(ctx, {
        selectorOptionId: parallel,
        cardNumber: "1b",
        cardName: "Player 1",
        platformData: {},
        sortOrder: 99,
        lastUpdated: NOW,
        variationOfCardId: parent._id,
      });
    });
    expect((await refresh(t, parallel)).outcome).toBe("set");
    // An eleventh unnumbered card drops it to 9 of 11.
    await addCards(t, parallel, [undefined]);
    expect((await refresh(t, parallel)).outcome).toBe("cleared");
  });

  test("a row that cannot hold cards (or is gone) is skipped, never written", async () => {
    const t = convexTest(schema, modules);
    const { set } = await seedRows(t);
    expect(await refresh(t, set)).toEqual({ outcome: "skipped" });
    const gone = await t.run(async (ctx) => {
      const id = await ctx.db.insert("selectorOptions", {
        level: "parallel",
        value: "x",
        platformData: {},
        children: [],
        lastUpdated: NOW,
      });
      await ctx.db.delete(id);
      return id;
    });
    expect(await refresh(t, gone)).toEqual({ outcome: "skipped" });
  });

  test("writes only on change: a steady row is not patched, a changed row once, and lastUpdated never moves", async () => {
    const handler = (
      refreshVariantPrintRun as unknown as {
        _handler: (ctx: unknown, args: { selectorOptionId: string }) => Promise<{ outcome: string }>;
      }
    )._handler;
    const run = async (rowPrintRun: number | undefined, runs: Array<number | undefined>) => {
      const patch = vi.fn();
      const ctx = {
        db: {
          get: async () => ({ _id: "row", level: "parallel", printRun: rowPrintRun, lastUpdated: NOW }),
          query: () => ({
            withIndex: () => ({
              take: async () => runs.map((printRun) => ({ printRun })),
            }),
          }),
          patch,
        },
      };
      const result = await handler(ctx, { selectorOptionId: "row" });
      return { result, patch };
    };

    const steady = await run(5, repeat(10, 5));
    expect(steady.result.outcome).toBe("unchanged");
    expect(steady.patch).not.toHaveBeenCalled();
    const steadyEmpty = await run(undefined, repeat(10, undefined));
    expect(steadyEmpty.result.outcome).toBe("unchanged");
    expect(steadyEmpty.patch).not.toHaveBeenCalled();

    const changed = await run(undefined, repeat(10, 5));
    expect(changed.result.outcome).toBe("set");
    expect(changed.patch).toHaveBeenCalledTimes(1);
    expect(changed.patch).toHaveBeenCalledWith("row", { printRun: 5 });
  });

  test("a second call over the same cards is a no-op", async () => {
    const t = convexTest(schema, modules);
    const { parallel } = await seedRows(t);
    await addCards(t, parallel, repeat(4, 7));
    expect((await refresh(t, parallel)).outcome).toBe("set");
    const before = await stored(t, parallel);
    expect((await refresh(t, parallel)).outcome).toBe("unchanged");
    expect(await stored(t, parallel)).toEqual(before);
    expect(before.lastUpdated).toBe(NOW);
  });
});
