/**
 * NEO-616 — the card writers that move a row's shown print run each schedule
 * ONE `variantPrintRun.refreshVariantPrintRun` for the card's row, and the
 * ones that cannot move it schedule nothing.
 *
 * Triggers: `updateCard` (a real print-run change, a clear included),
 * `deleteCard`, `addCustomCard`, and `commitCardChecklistChunk` (an accepted
 * `printRun` field, or a newly inserted card that carries a run — one call per
 * chunk however many cards say so).
 *
 * The queue is read before it is drained, then drained so no refresh runs into
 * teardown (`lib/testing/drain-scheduled.ts`). After the drain the row holds
 * what the rule says, which proves the scheduled call is the right one.
 */
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { insertTestCard } from "../lib/testing/card-row";
import { drainScheduled } from "../lib/testing/drain-scheduled";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

const ADMIN = { subject: "user_admin_neo616", role: "admin" };
const NOW = 1_700_000_000_000;

type T = ReturnType<typeof convexTest>;

/** Baseball › 2024 › Topps › Chrome › Base (the leaf the cards live on). */
async function seed(t: T): Promise<{ base: Id<"selectorOptions"> }> {
  return t.run(async (ctx) => {
    const row = (
      level: Doc<"selectorOptions">["level"],
      value: string,
      parentId?: Id<"selectorOptions">,
    ) =>
      ctx.db.insert("selectorOptions", {
        level,
        value,
        ...(parentId ? { parentId } : {}),
        platformData: {},
        children: [],
        lastUpdated: NOW,
      });
    const sport = await row("sport", "Baseball");
    const year = await row("year", "2024", sport);
    const brand = await row("manufacturer", "Topps", year);
    const set = await row("setName", "Chrome", brand);
    const base = await row("variantType", "Base", set);
    return { base };
  });
}

async function addCard(
  t: T,
  selectorOptionId: Id<"selectorOptions">,
  cardNumber: string,
  printRun?: number,
): Promise<Id<"cardChecklist">> {
  return t.run((ctx) =>
    insertTestCard(ctx, {
      selectorOptionId,
      cardNumber,
      cardName: `Card ${cardNumber}`,
      listingTitle: `Card ${cardNumber}`,
      platformData: {},
      sortOrder: Number.parseInt(cardNumber, 10) || 0,
      lastUpdated: NOW,
      ...(printRun !== undefined ? { printRun } : {}),
    }),
  );
}

/** The pending refreshes, as the row ids they were scheduled for. */
const pendingRefreshes = (t: T): Promise<string[]> =>
  t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect())
      .filter((j) => j.name.includes("refreshVariantPrintRun") && j.state.kind === "pending")
      .map((j) => (j.args as unknown as Array<{ selectorOptionId: string }>)[0].selectorOptionId),
  );

/** `null` for a row with no run: `t.run` serialises a bare `undefined` to null. */
const rowRun = (t: T, id: Id<"selectorOptions">): Promise<number | null> =>
  t.run(async (ctx) => (await ctx.db.get(id))!.printRun ?? null);

const setRowRun = (t: T, id: Id<"selectorOptions">, printRun: number | undefined) =>
  t.run((ctx) => ctx.db.patch(id, { printRun }));

const asAdmin = (t: T) => t.withIdentity(ADMIN);

describe("updateCard", () => {
  test("a print run that changes schedules one refresh for the card's row", async () => {
    const t = convexTest(schema, modules);
    const { base } = await seed(t);
    const id = await addCard(t, base, "1");
    await asAdmin(t).mutation(api.selectorOptions.updateCard, { id, printRun: 5 });
    expect(await pendingRefreshes(t)).toEqual([base]);
    await drainScheduled(t);
    // The one card holds the run, so the row now shows it.
    expect(await rowRun(t, base)).toBe(5);
  });

  test("clearing the run (null) schedules a refresh that clears the row", async () => {
    const t = convexTest(schema, modules);
    const { base } = await seed(t);
    const id = await addCard(t, base, "1", 5);
    await setRowRun(t, base, 5);
    await asAdmin(t).mutation(api.selectorOptions.updateCard, { id, printRun: null });
    expect(await pendingRefreshes(t)).toEqual([base]);
    await drainScheduled(t);
    expect(await rowRun(t, base)).toBeNull();
  });

  test("the run the card already has schedules nothing", async () => {
    const t = convexTest(schema, modules);
    const { base } = await seed(t);
    const id = await addCard(t, base, "1", 5);
    await asAdmin(t).mutation(api.selectorOptions.updateCard, { id, printRun: 5 });
    expect(await pendingRefreshes(t)).toEqual([]);
    await drainScheduled(t);
  });

  test("clearing a run the card never had schedules nothing", async () => {
    const t = convexTest(schema, modules);
    const { base } = await seed(t);
    const id = await addCard(t, base, "1");
    await asAdmin(t).mutation(api.selectorOptions.updateCard, { id, printRun: null });
    expect(await pendingRefreshes(t)).toEqual([]);
    await drainScheduled(t);
  });

  test("an edit that leaves the print run out schedules nothing", async () => {
    const t = convexTest(schema, modules);
    const { base } = await seed(t);
    const id = await addCard(t, base, "1", 5);
    await asAdmin(t).mutation(api.selectorOptions.updateCard, { id, cardName: "Renamed" });
    expect(await pendingRefreshes(t)).toEqual([]);
    await drainScheduled(t);
  });

  test("a refused print run schedules nothing", async () => {
    const t = convexTest(schema, modules);
    const { base } = await seed(t);
    const id = await addCard(t, base, "1");
    await expect(
      asAdmin(t).mutation(api.selectorOptions.updateCard, { id, printRun: 2.5 }),
    ).rejects.toThrow(/Print run/);
    expect(await pendingRefreshes(t)).toEqual([]);
    await drainScheduled(t);
  });
});

describe("deleteCard", () => {
  test("schedules one refresh, and the smaller denominator can set the row's run", async () => {
    const t = convexTest(schema, modules);
    const { base } = await seed(t);
    for (let n = 1; n <= 9; n++) await addCard(t, base, String(n), 5);
    const bare = await addCard(t, base, "10");
    // 9 of 10 is 90%: the row shows /5 already; drop that to see delete move it.
    await setRowRun(t, base, undefined);
    await asAdmin(t).mutation(api.selectorOptions.deleteCard, { id: bare });
    expect(await pendingRefreshes(t)).toEqual([base]);
    await drainScheduled(t);
    expect(await rowRun(t, base)).toBe(5);
  });
});

describe("addCustomCard", () => {
  test("schedules one refresh, and the card with no run counts against the share", async () => {
    const t = convexTest(schema, modules);
    const { base } = await seed(t);
    await addCard(t, base, "1", 5);
    await addCard(t, base, "2", 5);
    await setRowRun(t, base, 5);
    await asAdmin(t).mutation(api.selectorOptions.addCustomCard, {
      selectorOptionId: base,
      cardNumber: "9001",
      cardName: "Hand Added",
    });
    expect(await pendingRefreshes(t)).toEqual([base]);
    await drainScheduled(t);
    // 2 of 3 is under 90%.
    expect(await rowRun(t, base)).toBeNull();
  });
});

describe("commitCardChecklistChunk", () => {
  const wire = (cardNumber: string, extra: { printRun?: number } = {}) => ({
    cardNumber,
    cardName: `Card ${cardNumber}`,
    platformData: {},
    sortOrder: Number.parseInt(cardNumber, 10) || 0,
    playerNames: [],
    teamNames: [],
    ...extra,
  });
  const chunk = (t: T, base: Id<"selectorOptions">, cards: Array<Record<string, unknown>>) =>
    t.mutation(internal.selectorOptions.commitCardChecklistChunk, {
      selectorOptionId: base,
      sportValue: "Baseball",
      setNameValue: "Chrome",
      cards: cards as never,
    });

  test("new cards carrying a run schedule ONE refresh for the chunk", async () => {
    const t = convexTest(schema, modules);
    const { base } = await seed(t);
    await chunk(t, base, [wire("1", { printRun: 5 }), wire("2", { printRun: 5 }), wire("3")]);
    expect(await pendingRefreshes(t)).toEqual([base]);
    await drainScheduled(t);
    // 2 of 3 share /5: under the share, so the row shows nothing.
    expect(await rowRun(t, base)).toBeNull();
  });

  test("new cards with no run schedule nothing", async () => {
    const t = convexTest(schema, modules);
    const { base } = await seed(t);
    await chunk(t, base, [wire("1"), wire("2")]);
    expect(await pendingRefreshes(t)).toEqual([]);
    await drainScheduled(t);
  });

  test("an accepted printRun field on a matched card schedules one refresh", async () => {
    const t = convexTest(schema, modules);
    const { base } = await seed(t);
    const existingId = await addCard(t, base, "1");
    await chunk(t, base, [
      { ...wire("1", { printRun: 5 }), existingId, applyFields: ["printRun"], baseVersion: NOW },
    ]);
    expect(await pendingRefreshes(t)).toEqual([base]);
    await drainScheduled(t);
    expect(await rowRun(t, base)).toBe(5);
  });

  test("a matched card the operator did not accept the run for schedules nothing", async () => {
    const t = convexTest(schema, modules);
    const { base } = await seed(t);
    const existingId = await addCard(t, base, "1");
    await chunk(t, base, [{ ...wire("1", { printRun: 5 }), existingId }]);
    expect(await pendingRefreshes(t)).toEqual([]);
    await drainScheduled(t);
  });

  test("an accepted run plus inserted runs in one chunk is still one call", async () => {
    const t = convexTest(schema, modules);
    const { base } = await seed(t);
    const existingId = await addCard(t, base, "1");
    await chunk(t, base, [
      { ...wire("1", { printRun: 5 }), existingId, applyFields: ["printRun"], baseVersion: NOW },
      wire("2", { printRun: 5 }),
    ]);
    expect(await pendingRefreshes(t)).toEqual([base]);
    await drainScheduled(t);
    expect(await rowRun(t, base)).toBe(5);
  });
});
