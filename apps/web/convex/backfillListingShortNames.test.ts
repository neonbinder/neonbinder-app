/**
 * NEO-535 — `backfillListingShortNames`: a stored "Set name in titles" value
 * written under the OLD meaning (a short name the builder put the year and
 * maker in front of) is rewritten to the NEW one (the whole description, used
 * verbatim), so the box each row's cards read equals what the old builder put
 * in front of the players.
 *
 * Pinned: dry run by default; an armed call on an unarmed deployment is
 * refused; rewriting needs `rewriteExisting: true`; the two worked examples;
 * a second run writes nothing; a name the text already says in another
 * spelling is not appended again at read time (insert and parallel); a value
 * over 80 is reported and not written; only `metadata.listingShortName`
 * changes (other keys, `lastUpdated` and every card kept).
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { titleChainFacts } from "./listingShortName";
import { CONFIRM_TOKEN, ENV_FLAG, rewriteShortName, roughlySays } from "./backfillListingShortNames";
import { insertTestCard } from "../lib/testing/card-row";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

type T = ReturnType<typeof convexTest>;
type RowId = Id<"selectorOptions">;
const NOW = 1_700_000_000_000;
const APPROVED = { confirm: CONFIRM_TOKEN, rewriteExisting: true };

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/**
 * 2026 › Leaf › Leaf Metal
 *   ├ Base (type)
 *   ├ Insert (type) › 1991 Gold Prospects Autographs (insert) › Prismatic (sub-variant)
 *   └ Parallel (type) › Silver (parallel of base)
 */
async function seed(t: T, brandUnknown = false) {
  return t.run(async (ctx) => {
    const row = (
      level: Doc<"selectorOptions">["level"],
      value: string,
      parentId?: RowId,
      metadata?: Doc<"selectorOptions">["metadata"],
    ) =>
      ctx.db.insert("selectorOptions", {
        level,
        value,
        ...(parentId ? { parentId } : {}),
        ...(metadata ? { metadata } : {}),
        platformData: {},
        children: [],
        lastUpdated: NOW,
      });
    const sport = await row("sport", "Baseball");
    const year = await row("year", "2026", sport);
    const maker = await row("manufacturer", brandUnknown ? "All Brands" : "Leaf", year,
      brandUnknown ? { isBrandUnknown: true } : undefined);
    const set = await row("setName", "Leaf Metal", maker);
    const baseType = await row("variantType", "Base", set);
    const insertType = await row("variantType", "Insert", set);
    const insert = await row("insert", "1991 Gold Prospects Autographs", insertType);
    const prismatic = await row("parallel", "Prismatic", insert);
    const parallelType = await row("variantType", "Parallel", set);
    const silver = await row("insert", "Silver", parallelType);
    const card = await insertTestCard(ctx, {
      selectorOptionId: prismatic,
      cardNumber: "1",
      cardName: "Card 1",
      listingTitle: "A stored title",
      listingDescription: "A stored description",
      platformData: {},
      sortOrder: 0,
      lastUpdated: NOW,
    });
    return { sport, set, baseType, insertType, insert, prismatic, parallelType, silver, card };
  });
}
type Ids = Awaited<ReturnType<typeof seed>>;

const setValue = (t: T, id: RowId, value: string, extra: Record<string, unknown> = {}) =>
  t.run(async (ctx) => {
    await ctx.db.patch(id, { metadata: { ...extra, listingShortName: value } as never });
  });

const valueOf = (t: T, id: RowId) =>
  t.run(async (ctx) => (await ctx.db.get(id))!.metadata?.listingShortName ?? null);

/** The box a row's cards read at title time (`titleChainFacts`, leaf first to the set). */
const boxFor = (t: T, id: RowId) =>
  t.run(async (ctx) => {
    const chain: Doc<"selectorOptions">[] = [];
    let cursor: RowId | undefined = id;
    while (cursor) {
      const node: Doc<"selectorOptions"> | null = await ctx.db.get(cursor);
      if (!node) break;
      chain.push(node);
      if (node.level === "setName") break;
      cursor = node.parentId;
    }
    return titleChainFacts(chain).listingShortName ?? null;
  });

const allRows = (t: T) =>
  t.run(async (ctx) => ({
    rows: await ctx.db.query("selectorOptions").collect(),
    cards: await ctx.db.query("cardChecklist").collect(),
  }));

describe("pure rules", () => {
  test("year and maker go in front, unless the text already starts with them", () => {
    const head = { year: "2026", maker: "Leaf" };
    expect(rewriteShortName("Metal 1991 Gold Prospect Autograph Prismatic", head)).toBe(
      "2026 Leaf Metal 1991 Gold Prospect Autograph Prismatic",
    );
    expect(rewriteShortName("2026 Leaf Metal 1991 Gold Prospect Auto Prismatic", head)).toBe(
      "2026 Leaf Metal 1991 Gold Prospect Auto Prismatic",
    );
    expect(rewriteShortName("Leaf Metal", head)).toBe("2026 Leaf Metal");
    expect(rewriteShortName("Metal", { year: "2026" })).toBe("2026 Metal");
  });

  test("a parallel leaf's own name follows, unless the text roughly says it", () => {
    const head = { year: "2026", maker: "Leaf" };
    expect(rewriteShortName("Metal Gold Prospects", head, "Prismatic")).toBe(
      "2026 Leaf Metal Gold Prospects Prismatic",
    );
    expect(rewriteShortName("Metal Prismatics", head, "Prismatic")).toBe("2026 Leaf Metal Prismatics");
    expect(rewriteShortName("Metal", head, "Base")).toBe("2026 Leaf Metal");
  });

  test("roughlySays folds case, a plural s and the autograph spellings", () => {
    expect(roughlySays("Metal 1991 Gold Prospect Auto", "1991 Gold Prospects Autographs")).toBe(true);
    expect(roughlySays("Metal 1991 Gold Prospect", "1991 Gold Prospects Autographs")).toBe(false);
  });
});

describe("arming", () => {
  test("the dry run is the default and writes nothing", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    await setValue(t, ids.prismatic, "Metal 1991 Gold Prospect Autograph Prismatic");
    const before = await allRows(t);
    const result = await t.action(internal.backfillListingShortNames.run, { rewriteExisting: true });
    expect(result.armed).toBe(false);
    expect(result.message).toMatch(/^Dry run/);
    expect(result.counts).toMatchObject({ withShortName: 1, rewritten: 1 });
    expect(result.samples[0]).toMatchObject({
      rowId: ids.prismatic,
      name: "Prismatic",
      before: "Metal 1991 Gold Prospect Autograph Prismatic",
      after: "2026 Leaf Metal 1991 Gold Prospect Autograph Prismatic",
    });
    expect(await allRows(t)).toEqual(before);
  });

  test("confirm on an unarmed deployment is refused and writes nothing", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    await setValue(t, ids.prismatic, "Metal");
    const before = await allRows(t);
    const result = await t.action(internal.backfillListingShortNames.run, APPROVED);
    expect(result.armed).toBe(false);
    expect(result.message).toContain("Refused");
    expect(result.message).toContain(ENV_FLAG);
    expect(await allRows(t)).toEqual(before);
  });

  test("armed without rewriteExisting rewrites nothing and reports it kept", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    vi.stubEnv(ENV_FLAG, "1");
    await setValue(t, ids.prismatic, "Metal");
    const before = await allRows(t);
    const result = await t.action(internal.backfillListingShortNames.run, { confirm: CONFIRM_TOKEN });
    expect(result.armed).toBe(true);
    expect(result.counts).toMatchObject({ rewritten: 0, keptExisting: 1 });
    expect(await allRows(t)).toEqual(before);
  });

  test("the log line carries counts only", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    await setValue(t, ids.prismatic, "Metal Secret Words");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await t.action(internal.backfillListingShortNames.run, { rewriteExisting: true });
    const lines = log.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("backfill_listing_short_names"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/Secret|Metal|Leaf/);
  });
});

describe("the approved rewrite", () => {
  test("the two worked examples, and only listingShortName changes", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    vi.stubEnv(ENV_FLAG, "1");
    // Already full: unchanged. Old short form: year and maker in front.
    await setValue(t, ids.prismatic, "2026 Leaf Metal 1991 Gold Prospect Auto Prismatic", { cardNumberPrefix: "LM-" });
    await setValue(t, ids.silver, "Metal 1991 Gold Prospect Autograph Prismatic", { cardNumberPrefix: "S-" });
    const before = await allRows(t);

    const result = await t.action(internal.backfillListingShortNames.run, APPROVED);
    expect(result.armed).toBe(true);
    expect(result.counts).toMatchObject({ withShortName: 2, rewritten: 1, unchanged: 1, copiedDown: 0 });
    expect(await valueOf(t, ids.prismatic)).toBe("2026 Leaf Metal 1991 Gold Prospect Auto Prismatic");
    // Silver is a parallel leaf whose text does not say "Silver": its own name follows.
    expect(await valueOf(t, ids.silver)).toBe("2026 Leaf Metal 1991 Gold Prospect Autograph Prismatic Silver");

    const after = await allRows(t);
    expect(after.cards).toEqual(before.cards);
    for (const row of after.rows) {
      const was = before.rows.find((r) => r._id === row._id)!;
      expect(row.lastUpdated).toBe(was.lastUpdated);
      expect({ ...row.metadata, listingShortName: undefined }).toEqual({
        ...was.metadata,
        listingShortName: undefined,
      });
    }
  });

  test("a second run writes nothing", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    vi.stubEnv(ENV_FLAG, "1");
    await setValue(t, ids.insertType, "Metal 1991 Gold Prospect Auto");
    await setValue(t, ids.set, "Metal");
    await t.action(internal.backfillListingShortNames.run, APPROVED);
    const after = await allRows(t);
    const second = await t.action(internal.backfillListingShortNames.run, APPROVED);
    expect(second.counts).toMatchObject({ rewritten: 0, copiedDown: 0, keptExisting: 0 });
    expect(await allRows(t)).toEqual(after);
  });

  test("a brand NB has not identified gets no maker", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t, true);
    vi.stubEnv(ENV_FLAG, "1");
    await setValue(t, ids.set, "Metal");
    await t.action(internal.backfillListingShortNames.run, APPROVED);
    expect(await valueOf(t, ids.set)).toBe("2026 Metal");
  });

  test("a value over 80 is reported and nothing is written for it", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    vi.stubEnv(ENV_FLAG, "1");
    const long = "Metal " + "Word ".repeat(14).trim(); // 75 characters; +"2026 Leaf " > 80
    expect(long.length).toBeLessThanOrEqual(80);
    await setValue(t, ids.set, long);
    const result = await t.action(internal.backfillListingShortNames.run, APPROVED);
    expect(result.counts).toMatchObject({ overLimit: 1, rewritten: 0 });
    expect(result.samples[0]).toMatchObject({ action: "overLimit", before: long });
    expect(result.samples[0].after.length).toBeGreaterThan(80);
    expect(await valueOf(t, ids.set)).toBe(long);
  });
});

describe("no name said twice at read time", () => {
  test("an insert the text already says in another spelling is not appended again", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    vi.stubEnv(ENV_FLAG, "1");
    // Stored on the Insert TYPE, above the insert row: at read time
    // `titleChainFacts` would append "1991 Gold Prospects Autographs", since
    // "Prospect" and "Auto" are not those words.
    await setValue(t, ids.insertType, "Metal 1991 Gold Prospect Auto");
    const result = await t.action(internal.backfillListingShortNames.run, APPROVED);
    expect(result.counts).toMatchObject({ rewritten: 1, copiedDown: 1 });

    expect(await valueOf(t, ids.insertType)).toBe("2026 Leaf Metal 1991 Gold Prospect Auto");
    // The insert row carries the box as its own value, so nothing is appended.
    expect(await valueOf(t, ids.insert)).toBe("2026 Leaf Metal 1991 Gold Prospect Auto");
    expect(await boxFor(t, ids.insert)).toBe("2026 Leaf Metal 1991 Gold Prospect Auto");
    // Its sub-variant still gets its parallel's name: the text never said it.
    expect(await valueOf(t, ids.prismatic)).toBeNull();
    expect(await boxFor(t, ids.prismatic)).toBe("2026 Leaf Metal 1991 Gold Prospect Auto Prismatic");
  });

  test("a parallel the text already says in another spelling is not appended again", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    vi.stubEnv(ENV_FLAG, "1");
    // On the insert row, above the Prismatic sub-variant.
    await setValue(t, ids.insert, "Metal Gold Prospects Autographs Prismatics");
    const result = await t.action(internal.backfillListingShortNames.run, APPROVED);
    expect(result.counts).toMatchObject({ rewritten: 1, copiedDown: 1 });
    const value = "2026 Leaf Metal Gold Prospects Autographs Prismatics";
    expect(await valueOf(t, ids.insert)).toBe(value);
    expect(await valueOf(t, ids.prismatic)).toBe(value);
    expect(await boxFor(t, ids.prismatic)).toBe(value);
  });

  test("a name the text does not say at all is left to be appended (the NEO-535 rule)", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    vi.stubEnv(ENV_FLAG, "1");
    await setValue(t, ids.set, "Metal");
    const result = await t.action(internal.backfillListingShortNames.run, APPROVED);
    expect(result.counts).toMatchObject({ rewritten: 1, copiedDown: 0 });
    expect(await boxFor(t, ids.baseType)).toBe("2026 Leaf Metal");
    expect(await boxFor(t, ids.insert)).toBe("2026 Leaf Metal 1991 Gold Prospects Autographs");
    expect(await boxFor(t, ids.prismatic)).toBe("2026 Leaf Metal 1991 Gold Prospects Autographs Prismatic");
    expect(await boxFor(t, ids.silver)).toBe("2026 Leaf Metal Silver");
  });

  test("a row with its own value is never written by the walk above it", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    vi.stubEnv(ENV_FLAG, "1");
    await setValue(t, ids.insertType, "Metal 1991 Gold Prospect Auto");
    await setValue(t, ids.insert, "2026 Leaf Metal GPA");
    await t.action(internal.backfillListingShortNames.run, APPROVED);
    expect(await valueOf(t, ids.insert)).toBe("2026 Leaf Metal GPA");
  });
});
