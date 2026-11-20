/**
 * NEO-616 — a built parallel takes its cards' print runs from the parallel's
 * own linked checklist rows when SportLots states none, and its row shows the
 * run its cards share.
 *
 * Two shapes: an insert's parallel linked on both marketplaces (SportLots
 * wins where it has a run), and a base parallel with no marketplace ids (the
 * "1989 Pro Set Base Mini" case: the Mini's numbers differ from the Base's,
 * so cards and rows pair by player name).
 */

import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { insertTestCard } from "../lib/testing/card-row";
import { setRowChecklistSections } from "./lib/publishedChecklistSections";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

const ADMIN = {
  subject: "admin_neo616",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_neo616",
  role: "admin",
};
const SENTINEL = 1_700_000_000_000;

type StubCard = {
  cardNumber: string;
  cardName: string;
  players?: string[];
  printRun?: number;
  platformRef: string;
};

const bscState = vi.hoisted(() => ({ cards: [] as StubCard[] }));
vi.mock("./adapters/buysportscards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./adapters/buysportscards")>();
  const { action } = await import("./_generated/server");
  const { v } = await import("convex/values");
  return {
    ...actual,
    fetchBscChecklist: action({
      args: {
        parentFilters: v.record(v.string(), v.string()),
        platformFilters: v.optional(v.record(v.string(), v.array(v.string()))),
        facetFilters: v.optional(v.record(v.string(), v.array(v.string()))),
        sourceFacet: v.optional(v.string()),
      },
      returns: v.any(),
      handler: async () => ({ success: true, cards: bscState.cards }),
    }),
  };
});

const slState = vi.hoisted(() => ({ bySlId: {} as Record<string, StubCard[]> }));
vi.mock("./adapters/sportlots", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./adapters/sportlots")>();
  const { action } = await import("./_generated/server");
  const { v } = await import("convex/values");
  return {
    ...actual,
    fetchSportLotsChecklist: action({
      args: {
        parentFilters: v.record(v.string(), v.string()),
        platformFilters: v.optional(v.record(v.string(), v.string())),
      },
      returns: v.any(),
      handler: async (_ctx, args) => ({
        success: true,
        cards: slState.bySlId[args.platformFilters?.parallel ?? ""] ?? [],
      }),
    }),
  };
});

beforeEach(() => {
  bscState.cards = [];
  slState.bySlId = {};
});

type T = ReturnType<typeof convexTest>;
type SO = Id<"selectorOptions">;
type ChecklistRow = { number: string; players: string[]; teams: string[]; printRun?: number };

async function node(
  t: T,
  level: string,
  value: string,
  parentId?: SO,
  extra: Record<string, unknown> = {},
): Promise<SO> {
  return t.run(async (ctx) => {
    const id = await ctx.db.insert("selectorOptions", {
      level: level as never,
      value,
      ...(parentId ? { parentId } : {}),
      platformData: {},
      children: [],
      lastUpdated: SENTINEL,
      ...extra,
    });
    if (parentId) {
      const parent = (await ctx.db.get(parentId))!;
      await ctx.db.patch(parentId, { children: [...(parent.children ?? []), id] });
    }
    return id;
  });
}

/** sport → year → set → source (a Base variantType, or an Insert) → parallel. */
async function seed(t: T, shape: "baseParallel" | "linkedInsert") {
  const ids = shape === "linkedInsert";
  const sport = await node(t, "sport", "Baseball", undefined, {
    platformData: ids ? { bsc: { b0: "baseball" }, sportlots: { s0: "BB" } } : {},
  });
  const year = await node(t, "year", "2024", sport, {
    platformData: ids ? { bsc: { b0: "2024" }, sportlots: { s0: "2024" } } : {},
  });
  const set = await node(t, "setName", "Bowman", year, {
    platformData: ids ? { bsc: { b0: "bowman" } } : {},
  });
  if (ids) {
    const vt = await node(t, "variantType", "Insert", set, {
      platformData: { bsc: { b0: "insert" } },
      platformFacets: { bsc: { b0: "variant" } },
    });
    const source = await node(t, "insert", "Anime", vt, {
      platformData: { bsc: { b0: "anime" }, sportlots: { s0: "SL-INSERT-1" } },
    });
    const parallel = await node(t, "parallel", "Anime Kanji", source, {
      platformData: { bsc: { b0: "anime-kanji" }, sportlots: { s0: "SL-PARALLEL-1" } },
      platformFacets: { bsc: { b0: "variantName" } },
    });
    return { set, source, parallel };
  }
  const base = await node(t, "variantType", "Base", set);
  const parallelType = await node(t, "variantType", "Parallel", set);
  const mini = await node(t, "insert", "1989 Pro Set Base Mini", parallelType);
  return { set, source: base, parallel: mini };
}

let sortOrder = 0;
async function card(t: T, selectorOptionId: SO, cardNumber: string, name: string) {
  return t.run(async (ctx) =>
    insertTestCard(ctx, {
      selectorOptionId,
      cardNumber,
      cardName: name,
      pendingPlayerNames: [name],
      platformData: {},
      sortOrder: sortOrder++,
      lastUpdated: SENTINEL,
    }),
  );
}

/** Upload one section to the set's checklist and link the row to it. */
async function linkChecklist(
  t: T,
  set: SO,
  row: SO,
  sectionName: string,
  rows: ChecklistRow[],
) {
  const who = t.withIdentity(ADMIN);
  const { checklistId } = await who.mutation(api.publishedChecklists.start, {
    setId: set,
    fileName: "checklist.csv",
    format: "csv",
  });
  await who.mutation(api.publishedChecklists.addSections, {
    checklistId,
    firstOrdinal: 0,
    sections: [{ name: sectionName, rows }],
  });
  await who.mutation(api.publishedChecklists.finish, {
    checklistId,
    sectionCount: 1,
    rowCount: rows.length,
  });
  await t.run((ctx) =>
    setRowChecklistSections(ctx, {
      rowId: row,
      setId: set,
      keys: [sectionName],
      userId: ADMIN.subject,
    }),
  );
}

const cardsOn = (t: T, id: SO) =>
  t.run(async (ctx) =>
    ctx.db
      .query("cardChecklist")
      .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", id))
      .collect(),
  );
const rowOf = (t: T, id: SO) => t.run((ctx) => ctx.db.get(id));
const build = (t: T, parallelId: SO) =>
  t.withIdentity(ADMIN).action(api.parallelChecklistBuild.buildParallelChecklist, { parallelId });
const row = (number: string, player: string, printRun?: number): ChecklistRow => ({
  number,
  players: [player],
  teams: [],
  ...(printRun !== undefined ? { printRun } : {}),
});
const runsByName = (cards: Array<{ cardName: string; printRun?: number }>) =>
  Object.fromEntries(cards.map((c) => [c.cardName, c.printRun]));

describe("buildParallelChecklist — print runs from the parallel's linked checklist rows (NEO-616)", () => {
  test("Mini-style: numbers differ from the Base's, names pair, every copy and the row take the run", async () => {
    const t = convexTest(schema, modules);
    const { set, source, parallel } = await seed(t, "baseParallel");
    await card(t, source, "89B-1", "Joe Montana");
    await card(t, source, "89B-2", "Jerry Rice");
    await card(t, source, "89B-3", "Dan Marino");
    await linkChecklist(t, set, parallel, "1989 Pro Set Base Mini", [
      row("89M-1", "Joe Montana", 5),
      row("89M-2", "Jerry Rice", 5),
      row("89M-3", "Dan Marino", 5),
    ]);

    const result = await build(t, parallel);

    expect(result.status).toBe("built");
    const copies = await cardsOn(t, parallel);
    expect(runsByName(copies)).toEqual({ "Joe Montana": 5, "Jerry Rice": 5, "Dan Marino": 5 });
    // The Mini's numbers never reach the built cards: they keep the Base's.
    expect(copies.map((c) => c.cardNumber).sort()).toEqual(["89B-1", "89B-2", "89B-3"]);
    expect((await rowOf(t, parallel))!.printRun).toBe(5);
  });

  test("a player with two cards is a tie: neither takes a run, and the row falls under the share", async () => {
    const t = convexTest(schema, modules);
    const { set, source, parallel } = await seed(t, "baseParallel");
    await card(t, source, "89B-1", "Joe Montana");
    await card(t, source, "89B-2", "Jerry Rice");
    await card(t, source, "89B-3", "Dan Marino");
    await card(t, source, "89B-4", "Dan Marino");
    await linkChecklist(t, set, parallel, "1989 Pro Set Base Mini", [
      row("89M-1", "Joe Montana", 5),
      row("89M-2", "Jerry Rice", 5),
      row("89M-3", "Dan Marino", 5),
      row("89M-4", "Dan Marino", 5),
    ]);

    await build(t, parallel);

    const copies = await cardsOn(t, parallel);
    expect(copies.filter((c) => c.cardName === "Dan Marino").map((c) => c.printRun)).toEqual([
      undefined,
      undefined,
    ]);
    expect(copies.find((c) => c.cardName === "Joe Montana")!.printRun).toBe(5);
    // 2 of 4 cards carry /5: under 90%, so the row shows none.
    expect((await rowOf(t, parallel))!.printRun).toBeUndefined();
  });

  test("a pair whose players disagree gives no run", async () => {
    const t = convexTest(schema, modules);
    const { set, source, parallel } = await seed(t, "baseParallel");
    await card(t, source, "1", "Joe Montana");
    await linkChecklist(t, set, parallel, "1989 Pro Set Base Mini", [row("1", "Someone Else", 5)]);

    await build(t, parallel);

    const [copy] = await cardsOn(t, parallel);
    expect(copy.printRun).toBeUndefined();
  });

  test("a run outside 1..MAX never reaches a card (stored rows can predate the check)", async () => {
    const t = convexTest(schema, modules);
    const { set, source, parallel } = await seed(t, "baseParallel");
    await card(t, source, "1", "Joe Montana");
    await linkChecklist(t, set, parallel, "1989 Pro Set Base Mini", [row("M-1", "Joe Montana")]);
    // Plant an out-of-range run straight into the stored chunk.
    await t.run(async (ctx) => {
      const chunk = (await ctx.db.query("publishedChecklistChunks").collect())[0];
      await ctx.db.patch(chunk._id, { rows: chunk.rows.map((r) => ({ ...r, printRun: 0 })) });
    });

    await build(t, parallel);

    const [copy] = await cardsOn(t, parallel);
    expect(copy.printRun).toBeUndefined();
  });

  test("no linked rows: today's output, no run on any copy or on the row", async () => {
    const t = convexTest(schema, modules);
    const { source, parallel } = await seed(t, "baseParallel");
    await card(t, source, "89B-1", "Joe Montana");
    await card(t, source, "89B-2", "Jerry Rice");

    const result = await build(t, parallel);

    expect(result.status).toBe("built");
    expect(result.copied).toBe(2);
    const copies = await cardsOn(t, parallel);
    expect(copies.every((c) => !("printRun" in c))).toBe(true);
    expect(await rowOf(t, parallel)).not.toHaveProperty("printRun");
  });

  test("SportLots wins where it states a run; the checklist fills the card it left bare", async () => {
    const t = convexTest(schema, modules);
    const { set, source, parallel } = await seed(t, "linkedInsert");
    await card(t, source, "1", "Ken Griffey Jr.");
    await card(t, source, "2", "Mike Trout");
    bscState.cards = [
      { cardNumber: "1", cardName: "Ken Griffey Jr.", players: ["Ken Griffey Jr."], platformRef: "bsc-1" },
      { cardNumber: "2", cardName: "Mike Trout", players: ["Mike Trout"], platformRef: "bsc-2" },
    ];
    slState.bySlId["SL-PARALLEL-1"] = [
      {
        cardNumber: "1",
        cardName: "Ken Griffey Jr.",
        players: ["Ken Griffey Jr."],
        platformRef: "sl-1",
        printRun: 99,
      },
      { cardNumber: "2", cardName: "Mike Trout", players: ["Mike Trout"], platformRef: "sl-2" },
    ];
    await linkChecklist(t, set, parallel, "Anime Kanji", [
      row("1", "Ken Griffey Jr.", 25),
      row("2", "Mike Trout", 25),
    ]);

    const result = await build(t, parallel);

    expect(result.status).toBe("built");
    expect(runsByName(await cardsOn(t, parallel))).toEqual({
      "Ken Griffey Jr.": 99,
      "Mike Trout": 25,
    });
    // Two runs, neither at 90%: the row shows none.
    expect((await rowOf(t, parallel))!.printRun).toBeUndefined();
  });

  test("a SportLots run on every card never reads the checklist", async () => {
    const t = convexTest(schema, modules);
    const { set, source, parallel } = await seed(t, "linkedInsert");
    await card(t, source, "1", "Ken Griffey Jr.");
    bscState.cards = [
      { cardNumber: "1", cardName: "Ken Griffey Jr.", players: ["Ken Griffey Jr."], platformRef: "bsc-1" },
    ];
    slState.bySlId["SL-PARALLEL-1"] = [
      { cardNumber: "1", cardName: "Ken Griffey Jr.", players: ["Ken Griffey Jr."], platformRef: "sl-1", printRun: 99 },
    ];
    await linkChecklist(t, set, parallel, "Anime Kanji", [row("1", "Ken Griffey Jr.", 25)]);

    await build(t, parallel);

    const [copy] = await cardsOn(t, parallel);
    expect(copy.printRun).toBe(99);
    expect((await rowOf(t, parallel))!.printRun).toBe(99);
  });
});
