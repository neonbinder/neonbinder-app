/**
 * NEO-616 — a stored checklist row's print run: kept as an integer
 * 1..MAX_BSC_PRINT_RUN, refused otherwise, absent when absent, and read back
 * from the stored chunk unchanged.
 */
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { checkPublishedChecklist } from "./lib/publishedChecklistCheck";
import { MAX_BSC_PRINT_RUN } from "./lib/bscAttributeTokens";
import { setRowChecklistSections } from "./lib/publishedChecklistSections";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

const ADMIN = { subject: "user_admin_a", role: "admin" };
const NOW = 1_700_000_000_000;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const row = (number: string, printRun?: number) => ({
  number,
  players: ["Joe Montana"],
  teams: [] as string[],
  ...(printRun !== undefined ? { printRun } : {}),
});

describe("checkPublishedChecklist — print run", () => {
  test.each([1, 5, 99, MAX_BSC_PRINT_RUN])("keeps %d", (printRun) => {
    expect(checkPublishedChecklist({ rows: [row("1", printRun)] })!.rows[0].printRun).toBe(printRun);
  });

  test("absent stays absent: the key is not even present", () => {
    const [checked] = checkPublishedChecklist({ rows: [row("1")] })!.rows;
    expect("printRun" in checked).toBe(false);
  });

  test.each([0, -1, 2.5, MAX_BSC_PRINT_RUN + 1, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses %s, naming the row",
    (printRun) => {
      const call = () => checkPublishedChecklist({ rows: [row("1"), row("2", printRun)] });
      expect(call).toThrow(ConvexError);
      expect(call).toThrow(/Row 2 of the official checklist has a print run/);
    },
  );
});

describe("a stored row's print run round-trips", () => {
  test("upload → stored chunk → rowsForLeaf returns it; a row without one has none", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const node = async (level: string, value: string, parentId?: Id<"selectorOptions">) =>
        ctx.db.insert("selectorOptions", {
          level: level as never,
          value,
          ...(parentId ? { parentId } : {}),
          platformData: {},
          children: [],
          lastUpdated: NOW,
        });
      const sport = await node("sport", "Baseball");
      const year = await node("year", "2026", sport);
      const brand = await node("manufacturer", "Pro Set", year);
      const set = await node("setName", "Metal", brand);
      const vt = await node("variantType", "Insert", set);
      const insert = await node("insert", "Mini", vt);
      return { set, insert };
    });
    const who = t.withIdentity(ADMIN);
    const { checklistId } = await who.mutation(api.publishedChecklists.start, {
      setId: ids.set,
      fileName: "c.csv",
      format: "csv",
    });
    await who.mutation(api.publishedChecklists.addSections, {
      checklistId,
      firstOrdinal: 0,
      sections: [{ name: "Mini", rows: [row("M-1", 5), row("M-2")] }],
    });
    await who.mutation(api.publishedChecklists.finish, {
      checklistId,
      sectionCount: 1,
      rowCount: 2,
    });
    await t.run((ctx) =>
      setRowChecklistSections(ctx, {
        rowId: ids.insert,
        setId: ids.set,
        keys: ["Mini"],
        userId: ADMIN.subject,
      }),
    );

    const read = await t.query(internal.publishedChecklists.rowsForLeaf, {
      selectorOptionId: ids.insert,
    });

    expect(read.kind).toBe("rows");
    if (read.kind !== "rows") return;
    expect(read.rows[0]).toEqual({ number: "M-1", players: ["Joe Montana"], teams: [], printRun: 5 });
    expect("printRun" in read.rows[1]).toBe(false);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("a bad run is refused at upload and nothing is stored", async () => {
    const t = convexTest(schema, modules);
    const set = await t.run(async (ctx) =>
      ctx.db.insert("selectorOptions", {
        level: "setName",
        value: "Metal",
        platformData: {},
        children: [],
        lastUpdated: NOW,
      }),
    );
    const who = t.withIdentity(ADMIN);
    const { checklistId } = await who.mutation(api.publishedChecklists.start, {
      setId: set,
      fileName: "c.csv",
      format: "csv",
    });
    await expect(
      who.mutation(api.publishedChecklists.addSections, {
        checklistId,
        firstOrdinal: 0,
        sections: [{ name: "Mini", rows: [row("M-1", 0)] }],
      }),
    ).rejects.toThrow(/print run/);
    expect(await t.run((ctx) => ctx.db.query("publishedChecklistChunks").collect())).toEqual([]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });
});
