/**
 * NEO-535 — the title a parallel copy is born with, through the real build
 * (`buildParallelChecklist` → `insertParallelCardsPage`):
 *
 *   1. the builder's title when it fits with full names (the common path,
 *      written exactly as before);
 *   2. else the source card's hand edit, re-headed, stored as the operator's
 *      own title (never flagged);
 *   3. else the builder's flagged result, counted in `titlesToFix` for the
 *      Card titles dialog, summed across insert pages.
 *
 * Same mocking style as `parallelChecklistBuild.base.test.ts`: the BSC
 * adapter is replaced with a test-controlled action; SportLots is never asked
 * (no row here carries a SportLots id).
 *
 * Tree: sport → year → setName(Topps Chrome) → variantType "Inserts"
 *         → insert "Anime" → parallel "Kanji Orange Wave Refractor Sapphire Gold XYZW"
 *
 * The parallel's description is 70 characters, so "Mike Trout" (10) cannot
 * keep its first name; "Al Bo" fits with room to spare.
 */

import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { INSERT_COPIES_PER_PAGE } from "./parallelChecklistBuild";
import { normalizePlayerName } from "./players";
import { storedTitleFails } from "./features/carriedTitle";
import { LISTING_TITLE_MAX } from "./features/listingLimits";
import { insertTestCard } from "../lib/testing/card-row";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

const ADMIN = {
  subject: "admin_neo535_titles",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_neo535_titles",
  role: "admin",
};

const SENTINEL = 1_700_000_000_000;
const PARALLEL = "Kanji Orange Wave Refractor Sapphire Gold XYZW";
const DESCRIPTION = `2024 Topps Chrome Anime ${PARALLEL}`;
/** The year and maker reach a title through features (`listingInputsForCard`). */
const SET_FACTS = { season: "2024", manufacturer: "Topps" };

type StubCard = { cardNumber: string; cardName: string; platformRef: string };

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
      handler: async () => ({ success: true, cards: [] }),
    }),
  };
});

beforeEach(() => {
  bscState.cards = [];
});

type T = ReturnType<typeof convexTest>;

async function seed(t: T, parallelExtra: Partial<Doc<"selectorOptions">> = {}) {
  return t.run(async (ctx) => {
    const sport = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      platformData: { bsc: { b0: "baseball" } },
      children: [],
      lastUpdated: SENTINEL,
    });
    const year = await ctx.db.insert("selectorOptions", {
      level: "year",
      value: "2024",
      parentId: sport,
      platformData: { bsc: { b0: "2024" } },
      children: [],
      lastUpdated: SENTINEL,
    });
    const setName = await ctx.db.insert("selectorOptions", {
      level: "setName",
      value: "Topps Chrome",
      parentId: year,
      platformData: { bsc: { b0: "topps-chrome" } },
      children: [],
      lastUpdated: SENTINEL,
    });
    const inserts = await ctx.db.insert("selectorOptions", {
      level: "variantType",
      value: "Inserts",
      parentId: setName,
      platformData: { bsc: { b0: "insert" } },
      platformFacets: { bsc: { b0: "variant" } },
      children: [],
      lastUpdated: SENTINEL,
    });
    const anime = await ctx.db.insert("selectorOptions", {
      level: "insert",
      value: "Anime",
      parentId: inserts,
      platformData: { bsc: { b0: "anime" } },
      platformFacets: { bsc: { b0: "variantName" } },
      features: { ...SET_FACTS, cardType: "Insert" },
      children: [],
      lastUpdated: SENTINEL,
    });
    const parallel = await ctx.db.insert("selectorOptions", {
      level: "parallel",
      value: PARALLEL,
      parentId: anime,
      platformData: { bsc: { b0: "kanji-xyzw" } },
      platformFacets: { bsc: { b0: "variantName" } },
      features: { ...SET_FACTS, cardType: "Parallel" },
      children: [],
      lastUpdated: SENTINEL,
      ...parallelExtra,
    });
    await ctx.db.patch(inserts, { children: [anime] });
    await ctx.db.patch(anime, { children: [parallel] });
    const trout = await ctx.db.insert("players", {
      name: "Mike Trout",
      nameNormalized: normalizePlayerName("Mike Trout"),
      sportId: sport,
      lastUpdated: SENTINEL,
    });
    const albo = await ctx.db.insert("players", {
      name: "Al Bo",
      nameNormalized: normalizePlayerName("Al Bo"),
      sportId: sport,
      lastUpdated: SENTINEL,
    });
    return { anime, parallel, trout, albo };
  });
}

async function addCard(
  t: T,
  selectorOptionId: Id<"selectorOptions">,
  card: Partial<Doc<"cardChecklist">> & { cardNumber: string; cardName: string },
) {
  bscState.cards.push({
    cardNumber: card.cardNumber,
    cardName: card.cardName,
    platformRef: `bsc-${card.cardNumber}`,
  });
  return t.run(async (ctx) =>
    insertTestCard(ctx, {
      selectorOptionId,
      platformData: {},
      sortOrder: Number.parseInt(card.cardNumber, 10) || 0,
      lastUpdated: SENTINEL,
      features: { ...SET_FACTS, cardType: "Insert" },
      ...card,
    }),
  );
}

const cardsOn = (t: T, selectorOptionId: Id<"selectorOptions">) =>
  t.run(async (ctx) =>
    ctx.db
      .query("cardChecklist")
      .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", selectorOptionId))
      .collect(),
  );

const build = (t: T, parallelId: Id<"selectorOptions">) =>
  t
    .withIdentity(ADMIN)
    .action(api.parallelChecklistBuild.buildParallelChecklist, { parallelId });

describe("buildParallelChecklist — a parallel copy's title (NEO-535)", () => {
  test("the three outcomes: builder, carried hand edit, flagged and counted", async () => {
    const t = convexTest(schema, modules);
    const { anime, parallel, trout, albo } = await seed(t);
    await addCard(t, anime, { cardNumber: "1", cardName: "Al Bo", playerIds: [albo] });
    await addCard(t, anime, {
      cardNumber: "2",
      cardName: "Mike Trout",
      playerIds: [trout],
      // The operator's hand edit on the insert card.
      listingTitle: "2024 Topps Chrome Anime Trout",
    });
    await addCard(t, anime, { cardNumber: "3", cardName: "Mike Trout", playerIds: [trout] });

    const result = await build(t, parallel);
    expect(result.copied).toBe(3);
    expect(result.titlesToFix).toBe(1);

    const byNumber = new Map((await cardsOn(t, parallel)).map((c) => [c.cardNumber, c]));

    // 1. The builder's title fits with full names: written as before.
    const builder = byNumber.get("1")!;
    expect(builder.listingTitle.startsWith(`${DESCRIPTION} Al Bo`)).toBe(true);
    expect(builder.listingTitle.length).toBeLessThanOrEqual(LISTING_TITLE_MAX);
    expect(builder.listingTitleTruncated).not.toBe(true);
    expect(builder.listingTitleKept).toBeUndefined();

    // 2. The hand edit, re-headed with the parallel's description.
    const carried = byNumber.get("2")!;
    expect(carried.listingTitle).toBe(`${DESCRIPTION} Trout`);
    expect(carried.listingTitleTruncated).not.toBe(true);
    expect(storedTitleFails(carried)).toBe(false);

    // 3. No hand edit to carry: the builder's flagged result, for the dialog.
    const failing = byNumber.get("3")!;
    expect(storedTitleFails(failing)).toBe(true);
    expect(failing.listingTitle).not.toContain("Mike");
  });

  test("the parallel's box, when it fits with full names, is no title to fix", async () => {
    const t = convexTest(schema, modules);
    const { anime, parallel, trout } = await seed(t, {
      metadata: { listingShortName: "Anime Kanji XYZW" },
    });
    await addCard(t, anime, { cardNumber: "3", cardName: "Mike Trout", playerIds: [trout] });

    const result = await build(t, parallel);
    expect(result.copied).toBe(1);
    expect(result.titlesToFix ?? 0).toBe(0);
    const [copy] = await cardsOn(t, parallel);
    expect(copy.listingTitle).toContain("Anime Kanji XYZW Mike Trout");
    expect(storedTitleFails(copy)).toBe(false);
  });

  test("a flagged hand edit on the source is not carried", async () => {
    const t = convexTest(schema, modules);
    const { anime, parallel, trout } = await seed(t);
    await addCard(t, anime, {
      cardNumber: "2",
      cardName: "Mike Trout",
      playerIds: [trout],
      listingTitle: "2024 Topps Chrome Anime Trout",
      listingTitleTruncated: true,
    });

    const result = await build(t, parallel);
    expect(result.titlesToFix).toBe(1);
    const [copy] = await cardsOn(t, parallel);
    expect(copy.listingTitle).not.toBe(`${DESCRIPTION} Trout`);
    expect(storedTitleFails(copy)).toBe(true);
  });

  test("titlesToFix is summed across insert pages", async () => {
    const t = convexTest(schema, modules);
    const { anime, parallel, trout } = await seed(t);
    const total = INSERT_COPIES_PER_PAGE + 2;
    for (let n = 1; n <= total; n += 1) {
      await addCard(t, anime, { cardNumber: String(n), cardName: "Mike Trout", playerIds: [trout] });
    }

    const result = await build(t, parallel);
    expect(result.copied).toBe(total);
    expect(result.titlesToFix).toBe(total);
  }, 60_000);
});
