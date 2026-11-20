/**
 * NEO-616 — the armed variant print-run backfill: a dry run writes nothing, an
 * unarmed deployment refuses to write, and an armed one fills what was never
 * computed and (with `repair`) rewrites what disagrees with the cards.
 */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { insertTestCard } from "../lib/testing/card-row";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

const NOW = 1_700_000_000_000;
const FLAG = "ALLOW_VARIANT_PRINT_RUN_BACKFILL";

afterEach(() => {
  vi.unstubAllEnvs();
});

type T = ReturnType<typeof convexTest>;
type SO = Id<"selectorOptions">;

/** Four rows: one to fill, one that disagrees, one stale, one steady. */
async function seed(t: T) {
  return t.run(async (ctx) => {
    const sport = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      platformData: {},
      children: [],
      lastUpdated: NOW,
    });
    const row = async (
      level: "variantType" | "insert" | "parallel",
      value: string,
      runs: Array<number | undefined>,
      printRun?: number,
    ): Promise<SO> => {
      const id = await ctx.db.insert("selectorOptions", {
        level,
        value,
        parentId: sport,
        platformData: {},
        children: [],
        lastUpdated: NOW,
        ...(printRun !== undefined ? { printRun } : {}),
      });
      for (const [i, run] of runs.entries()) {
        await insertTestCard(ctx, {
          selectorOptionId: id,
          cardNumber: String(i + 1),
          cardName: `${value} ${i + 1}`,
          platformData: {},
          sortOrder: i,
          lastUpdated: NOW,
          ...(run !== undefined ? { printRun: run } : {}),
        });
      }
      return id;
    };
    return {
      // never computed; the cards share /5
      fill: await row("parallel", "Fill", [5, 5, 5]),
      // stored /10, the cards now say /5
      disagree: await row("insert", "Disagree", [5, 5, 5], 10),
      // stored /5, the cards share nothing
      stale: await row("variantType", "Stale", [5, 10], 5),
      // stored and right
      steady: await row("parallel", "Steady", [7, 7], 7),
      // nothing stored, nothing shared
      bare: await row("parallel", "Bare", [undefined, undefined]),
    };
  });
}

const printRuns = async (t: T, ids: Record<string, SO>) =>
  t.run(async (ctx) => {
    const out: Record<string, number | undefined> = {};
    for (const [name, id] of Object.entries(ids)) out[name] = (await ctx.db.get(id))!.printRun;
    return out;
  });

const run = (t: T, args: Record<string, unknown> = {}) =>
  t.action(internal.backfillVariantPrintRun.backfillVariantPrintRun, args);

const BEFORE = { fill: undefined, disagree: 10, stale: 5, steady: 7, bare: undefined };

describe("backfillVariantPrintRun", () => {
  test("a dry run reports and writes nothing, even on an armed deployment", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    vi.stubEnv(FLAG, "1");

    const result = await run(t, { repair: true });

    expect(result).toMatchObject({
      armed: false,
      complete: true,
      scanned: 5,
      filled: 1,
      disagreed: 2,
      repaired: 2,
    });
    expect(result.message).toMatch(/^Dry run/);
    expect(await printRuns(t, ids)).toEqual(BEFORE);
  });

  test("confirm without the env flag refuses to write", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);

    const result = await run(t, { confirm: "BACKFILL", repair: true });

    expect(result.armed).toBe(false);
    expect(result.message).toMatch(/^Refused: this deployment is not armed/);
    expect(result.filled).toBe(1);
    expect(await printRuns(t, ids)).toEqual(BEFORE);
  });

  test("an apply page on an unarmed deployment throws and writes nothing", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    await expect(
      t.mutation(internal.backfillVariantPrintRun.backfillVariantPrintRunPage, {
        level: "parallel",
        cursor: null,
        apply: true,
        repair: true,
      }),
    ).rejects.toThrow(/not armed/);
    expect(await printRuns(t, ids)).toEqual(BEFORE);
  });

  test("a wrong confirm word is a dry run", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    vi.stubEnv(FLAG, "1");
    const result = await run(t, { confirm: "yes" });
    expect(result.armed).toBe(false);
    expect(await printRuns(t, ids)).toEqual(BEFORE);
  });

  test("armed: fills what was never computed; a disagreement is reported, not rewritten", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    vi.stubEnv(FLAG, "1");

    const result = await run(t, { confirm: "BACKFILL" });

    expect(result).toMatchObject({ armed: true, complete: true, filled: 1, disagreed: 2, repaired: 0 });
    expect(result.message).toMatch(/^Applied/);
    expect(await printRuns(t, ids)).toEqual({ ...BEFORE, fill: 5 });
  });

  test("armed with repair: rewrites a run that moved and clears one the cards no longer share", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    vi.stubEnv(FLAG, "1");

    const result = await run(t, { confirm: "BACKFILL", repair: true });

    expect(result).toMatchObject({ armed: true, filled: 1, disagreed: 2, repaired: 2 });
    expect(await printRuns(t, ids)).toEqual({
      fill: 5,
      disagree: 5,
      stale: undefined,
      steady: 7,
      bare: undefined,
    });
  });

  test("the second armed run over a steady deployment changes nothing", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    vi.stubEnv(FLAG, "1");
    await run(t, { confirm: "BACKFILL", repair: true });
    const after = await printRuns(t, ids);

    const again = await run(t, { confirm: "BACKFILL", repair: true });

    expect(again).toMatchObject({ filled: 0, disagreed: 0, repaired: 0, tooBig: 0, complete: true });
    expect(await printRuns(t, ids)).toEqual(after);
  });

  test("a lastUpdated stamp is never touched", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    vi.stubEnv(FLAG, "true");
    await run(t, { confirm: "BACKFILL", repair: true });
    const stamps = await t.run(async (ctx) =>
      Promise.all(Object.values(ids).map(async (id) => (await ctx.db.get(id))!.lastUpdated)),
    );
    expect(new Set(stamps)).toEqual(new Set([NOW]));
  });

  test("pages of one row resume through the returned cursor and reach the same end", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    vi.stubEnv(FLAG, "1");

    // The action loops pages itself; walking the page mutation by hand with a
    // page size of one proves a cursor resumes where the last page stopped.
    let cursor: string | null = null;
    let scanned = 0;
    let filled = 0;
    for (;;) {
      const page: { scanned: number; filled: number; isDone: boolean; continueCursor: string } =
        await t.mutation(internal.backfillVariantPrintRun.backfillVariantPrintRunPage, {
          level: "parallel",
          cursor,
          apply: true,
          repair: false,
          numItems: 1,
        });
      scanned += page.scanned;
      filled += page.filled;
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    expect(scanned).toBe(3);
    expect(filled).toBe(1);
    expect((await printRuns(t, ids)).fill).toBe(5);

    // And the action's own cursor is refused when it is not one it returned.
    await expect(run(t, { cursor: "nonsense:0:" })).rejects.toThrow(/not one this backfill returned/);
  });
});
