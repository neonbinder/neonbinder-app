/**
 * NEO-616 — a row past the read cap is left exactly as it stands, by the
 * refresh and by the backfill. The cap is lowered to 5 here so the test needs
 * six cards, not ten thousand.
 */
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { insertTestCard } from "../lib/testing/card-row";

vi.mock("./cardCounts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./cardCounts")>()),
  RECOUNT_MAX: 5,
}));

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

const NOW = 1_700_000_000_000;

async function seed(t: ReturnType<typeof convexTest>, cardRuns: number[], stored?: number) {
  return t.run(async (ctx) => {
    const sport = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      platformData: {},
      children: [],
      lastUpdated: NOW,
    });
    const row = await ctx.db.insert("selectorOptions", {
      level: "parallel",
      value: "Big",
      parentId: sport,
      platformData: {},
      children: [],
      lastUpdated: NOW,
      ...(stored !== undefined ? { printRun: stored } : {}),
    });
    for (const [i, printRun] of cardRuns.entries()) {
      await insertTestCard(ctx, {
        selectorOptionId: row,
        cardNumber: String(i + 1),
        cardName: `P${i + 1}`,
        platformData: {},
        sortOrder: i,
        lastUpdated: NOW,
        printRun,
      });
    }
    return row;
  });
}

describe("past the read cap", () => {
  test("the refresh leaves a stored run alone (and an empty row empty)", async () => {
    const t = convexTest(schema, modules);
    const withRun = await seed(t, [1, 1, 1, 1, 1, 1], 99);
    expect(
      await t.mutation(internal.variantPrintRun.refreshVariantPrintRun, { selectorOptionId: withRun }),
    ).toEqual({ outcome: "tooBig", printRun: 99 });
    expect((await t.run((ctx) => ctx.db.get(withRun)))!.printRun).toBe(99);

    const without = await seed(t, [1, 1, 1, 1, 1, 1]);
    expect(
      (await t.mutation(internal.variantPrintRun.refreshVariantPrintRun, { selectorOptionId: without }))
        .outcome,
    ).toBe("tooBig");
    expect((await t.run((ctx) => ctx.db.get(without)))!.printRun).toBeUndefined();
  });

  test("at the cap exactly it is read", async () => {
    const t = convexTest(schema, modules);
    const row = await seed(t, [1, 1, 1, 1, 1]);
    expect(
      await t.mutation(internal.variantPrintRun.refreshVariantPrintRun, { selectorOptionId: row }),
    ).toEqual({ outcome: "set", printRun: 1 });
  });

  test("the backfill counts it and writes nothing", async () => {
    const t = convexTest(schema, modules);
    const row = await seed(t, [1, 1, 1, 1, 1, 1], 99);
    const page = await t.mutation(internal.backfillVariantPrintRun.backfillVariantPrintRunPage, {
      level: "parallel",
      cursor: null,
      apply: false,
      repair: true,
    });
    expect(page).toMatchObject({ scanned: 1, tooBig: 1, filled: 0, disagreed: 0, repaired: 0 });
    expect((await t.run((ctx) => ctx.db.get(row)))!.printRun).toBe(99);
  });
});
