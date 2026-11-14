/**
 * NEO-535 — the Card titles dialog's backend for a parallel's cards:
 * `failingTitles` (one-shot page read), `saveTitleFixes` (answers + the box)
 * and `rewriteFailingTitlesPage` (the box applied to the rest).
 *
 * The copies are made by the real build (`buildParallelChecklist`), so what
 * the dialog lists is exactly what a build leaves behind. The BSC adapter is
 * stubbed as in `parallelChecklistBuild.titles.test.ts`; eBay requeueing is
 * observed through a spy on `queueRetitledCardNow`.
 *
 * Tree: sport → year → setName(Topps Chrome) → variantType "Inserts"
 *         → insert "Anime" → parallel "Kanji Orange Wave Refractor Sapphire Gold XYZW"
 */

import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { normalizePlayerName } from "./players";
import { assessParallelCopyTitle, storedTitleFails } from "./features/carriedTitle";
import { LISTING_TITLE_MAX } from "./features/listingLimits";
import { FAILING_TITLES_SCAN, MAX_TITLE_FIXES } from "./parallelCopyTitles";
import { insertTestCard } from "../lib/testing/card-row";
import { drainScheduled } from "../lib/testing/drain-scheduled";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

const ADMIN = {
  subject: "admin_neo535_dialog",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_neo535_dialog",
  role: "admin",
};
const MEMBER = {
  subject: "member_neo535_dialog",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|member_neo535_dialog",
};

const SENTINEL = 1_700_000_000_000;
const PARALLEL = "Kanji Orange Wave Refractor Sapphire Gold XYZW";
const SET_FACTS = { season: "2024", manufacturer: "Topps" };
const BOX = "Anime Kanji XYZW";

type StubCard = { cardNumber: string; cardName: string; platformRef: string };

const bscState = vi.hoisted(() => ({ cards: [] as StubCard[] }));
const requeued = vi.hoisted(() => [] as string[]);

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
vi.mock("./listingTitleRequeue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./listingTitleRequeue")>();
  return {
    ...actual,
    queueRetitledCardNow: async (_ctx: unknown, cardId: string) => {
      requeued.push(cardId);
      return 0;
    },
  };
});

beforeEach(() => {
  bscState.cards = [];
  requeued.length = 0;
});

type T = ReturnType<typeof convexTest>;

async function seed(t: T) {
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

async function addSourceCard(
  t: T,
  anime: Id<"selectorOptions">,
  card: Partial<Doc<"cardChecklist">> & { cardNumber: string; cardName: string },
) {
  bscState.cards.push({
    cardNumber: card.cardNumber,
    cardName: card.cardName,
    platformRef: `bsc-${card.cardNumber}`,
  });
  return t.run(async (ctx) =>
    insertTestCard(ctx, {
      selectorOptionId: anime,
      platformData: {},
      sortOrder: Number.parseInt(card.cardNumber, 10) || 0,
      lastUpdated: SENTINEL,
      features: { ...SET_FACTS, cardType: "Insert" },
      ...card,
    }),
  );
}

const build = (t: T, parallelId: Id<"selectorOptions">) =>
  t
    .withIdentity(ADMIN)
    .action(api.parallelChecklistBuild.buildParallelChecklist, { parallelId });

const cardsOn = (t: T, selectorOptionId: Id<"selectorOptions">) =>
  t.run(async (ctx) =>
    ctx.db
      .query("cardChecklist")
      .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", selectorOptionId))
      .collect(),
  );

const byNumber = async (t: T, parallel: Id<"selectorOptions">) =>
  new Map((await cardsOn(t, parallel)).map((c) => [c.cardNumber, c]));

/**
 * The standard parallel: #1 fits (Al Bo), #2 carried a hand edit, #3 fails
 * with nothing to carry, #4 fails although its source has a hand edit (too
 * long re-headed), so the dialog gets its carried rest.
 */
async function standardParallel(t: T) {
  const ids = await seed(t);
  await addSourceCard(t, ids.anime, { cardNumber: "1", cardName: "Al Bo", playerIds: [ids.albo] });
  await addSourceCard(t, ids.anime, {
    cardNumber: "2",
    cardName: "Mike Trout",
    playerIds: [ids.trout],
    listingTitle: "2024 Topps Chrome Anime Trout",
  });
  await addSourceCard(t, ids.anime, { cardNumber: "3", cardName: "Mike Trout", playerIds: [ids.trout] });
  await addSourceCard(t, ids.anime, {
    cardNumber: "4",
    cardName: "Mike Trout",
    playerIds: [ids.trout],
    listingTitle: "2024 Topps Chrome Anime Trout Halos Angels Rookie Card",
  });
  const result = await build(t, ids.parallel);
  expect(result.copied).toBe(4);
  expect(result.titlesToFix).toBe(2);
  return { ...ids, cards: await byNumber(t, ids.parallel) };
}

const failingTitles = (t: T, parallelId: Id<"selectorOptions">, cursor?: string) =>
  t.withIdentity(ADMIN).query(api.parallelCopyTitles.failingTitles, {
    parallelId,
    ...(cursor ? { cursor } : {}),
  });

const save = (
  t: T,
  args: {
    parallelId: Id<"selectorOptions">;
    listingShortName?: string;
    cards: Array<{ cardId: Id<"cardChecklist">; listingTitle?: string; kept?: string }>;
  },
) => t.withIdentity(ADMIN).mutation(api.parallelCopyTitles.saveTitleFixes, args);

describe("access", () => {
  test("anonymous and non-admin callers are refused by both functions", async () => {
    const t = convexTest(schema, modules);
    const { parallel } = await seed(t);
    await expect(t.query(api.parallelCopyTitles.failingTitles, { parallelId: parallel })).rejects.toThrow();
    await expect(
      t.withIdentity(MEMBER).query(api.parallelCopyTitles.failingTitles, { parallelId: parallel }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.parallelCopyTitles.saveTitleFixes, { parallelId: parallel, listingShortName: BOX, cards: [] }),
    ).rejects.toThrow();
    await expect(
      t
        .withIdentity(MEMBER)
        .mutation(api.parallelCopyTitles.saveTitleFixes, { parallelId: parallel, listingShortName: BOX, cards: [] }),
    ).rejects.toThrow();
    const row = await t.run((ctx) => ctx.db.get(parallel));
    expect(row?.metadata?.listingShortName).toBeUndefined();
  });

  test("a row that is not a buildable parallel is refused, and nothing is written", async () => {
    const t = convexTest(schema, modules);
    const { anime } = await seed(t);
    await expect(failingTitles(t, anime)).rejects.toThrow();
    await expect(save(t, { parallelId: anime, listingShortName: BOX, cards: [] })).rejects.toThrow();
    const row = await t.run((ctx) => ctx.db.get(anime));
    expect(row?.metadata?.listingShortName).toBeUndefined();
  });
});

describe("failingTitles", () => {
  test("lists only the failing cards, with their inputs and any carried rest", async () => {
    const t = convexTest(schema, modules);
    const { parallel, cards } = await standardParallel(t);
    const page = await failingTitles(t, parallel);

    expect(page.parallel).toEqual({ _id: parallel, value: PARALLEL });
    expect(page.boxPrefill).toContain("Topps Chrome");
    expect(page.cursor).toBeNull();
    expect(page.failingInPage).toBe(2);
    expect(page.cards.map((c) => c.cardNumber)).toEqual(["3", "4"]);

    const [three, four] = page.cards;
    expect(three.cardId).toBe(cards.get("3")!._id);
    expect(three.title).toBe(cards.get("3")!.listingTitle);
    expect(three.inputs.playerNames).toEqual(["Mike Trout"]);
    expect(three.inputs.parallelName).toBe(PARALLEL);
    expect(three.carriedRest).toBeUndefined();
    expect(four.carriedRest).toBe("Trout Halos Angels Rookie Card");
  });

  test(`returns at most ${MAX_TITLE_FIXES} cards and counts the rest`, async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    const total = MAX_TITLE_FIXES + 5;
    for (let n = 1; n <= total; n += 1) {
      await addSourceCard(t, ids.anime, { cardNumber: String(n), cardName: "Mike Trout", playerIds: [ids.trout] });
    }
    expect((await build(t, ids.parallel)).titlesToFix).toBe(total);

    const page = await failingTitles(t, ids.parallel);
    expect(page.cards).toHaveLength(MAX_TITLE_FIXES);
    expect(page.failingInPage).toBe(total);
  }, 60_000);

  test("pages the parallel with a cursor", async () => {
    const t = convexTest(schema, modules);
    const { parallel } = await seed(t);
    await t.run(async (ctx) => {
      for (let n = 0; n < FAILING_TITLES_SCAN; n += 1) {
        await insertTestCard(ctx, {
          selectorOptionId: parallel,
          cardNumber: String(n),
          cardName: "Fits",
          platformData: {},
          sortOrder: n,
          lastUpdated: SENTINEL,
          listingTitle: `Fits #${n}`,
        });
      }
      await insertTestCard(ctx, {
        selectorOptionId: parallel,
        cardNumber: "last",
        cardName: "Flagged",
        platformData: {},
        sortOrder: FAILING_TITLES_SCAN + 1,
        lastUpdated: SENTINEL,
        listingTitle: "Flagged #last",
        listingTitleTruncated: true,
      });
    });

    const first = await failingTitles(t, parallel);
    expect(first.cards).toEqual([]);
    expect(first.cursor).not.toBeNull();
    const second = await failingTitles(t, parallel, first.cursor!);
    expect(second.cards.map((c) => c.cardNumber)).toEqual(["last"]);
    expect(second.cursor).toBeNull();
  }, 60_000);
});

describe("saveTitleFixes", () => {
  test("an own title is written trimmed, unflagged, and queued for eBay", async () => {
    const t = convexTest(schema, modules);
    const { parallel, cards } = await standardParallel(t);
    const three = cards.get("3")!;

    const out = await save(t, {
      parallelId: parallel,
      cards: [{ cardId: three._id, listingTitle: "  2024 Topps Chrome Anime Kanji XYZW Mike Trout #3  " }],
    });
    expect(out).toEqual({ saved: 1, rewritten: 0, kept: 0, skipped: 0, stillFailing: 0 });

    const after = (await byNumber(t, parallel)).get("3")!;
    expect(after.listingTitle).toBe("2024 Topps Chrome Anime Kanji XYZW Mike Trout #3");
    expect(after.listingTitleTruncated).toBeUndefined();
    expect(requeued).toEqual([three._id]);
  });

  test("an over-80, blank or multi-line title is refused before anything is written", async () => {
    const t = convexTest(schema, modules);
    const { parallel, cards } = await standardParallel(t);
    const three = cards.get("3")!;
    const four = cards.get("4")!;

    for (const bad of ["x".repeat(LISTING_TITLE_MAX + 1), "   ", "two\nlines"]) {
      await expect(
        save(t, {
          parallelId: parallel,
          cards: [
            { cardId: three._id, listingTitle: "A fine title #3" },
            { cardId: four._id, listingTitle: bad },
          ],
        }),
      ).rejects.toThrow(/Card titles/);
    }
    const after = await byNumber(t, parallel);
    expect(after.get("3")!.listingTitle).toBe(three.listingTitle);
    expect(requeued).toEqual([]);
  });

  test(`more than ${MAX_TITLE_FIXES} answers are refused`, async () => {
    const t = convexTest(schema, modules);
    const { parallel, cards } = await standardParallel(t);
    const answers = Array.from({ length: MAX_TITLE_FIXES + 1 }, () => ({
      cardId: cards.get("3")!._id,
      kept: cards.get("3")!.listingTitle,
    }));
    await expect(save(t, { parallelId: parallel, cards: answers })).rejects.toThrow(/limit/);
  });

  test("kept on the exact stored text clears the flag; any other text is skipped", async () => {
    const t = convexTest(schema, modules);
    const { parallel, cards } = await standardParallel(t);
    const three = cards.get("3")!;
    const four = cards.get("4")!;
    expect(three.listingTitleTruncated).toBe(true);

    const out = await save(t, {
      parallelId: parallel,
      cards: [
        { cardId: three._id, kept: three.listingTitle },
        { cardId: four._id, kept: `${four.listingTitle} extra` },
      ],
    });
    expect(out).toEqual({ saved: 0, rewritten: 0, kept: 1, skipped: 1, stillFailing: 0 });

    const after = await byNumber(t, parallel);
    expect(after.get("3")!.listingTitle).toBe(three.listingTitle);
    expect(after.get("3")!.listingTitleTruncated).toBeUndefined();
    expect(storedTitleFails(after.get("4")!)).toBe(true);
    // Nothing's title changed, so nothing is queued.
    expect(requeued).toEqual([]);
  });

  test("a card that fits, or is on another row, is skipped and untouched", async () => {
    const t = convexTest(schema, modules);
    const { parallel, anime, cards } = await standardParallel(t);
    const one = cards.get("1")!;
    const source = (await cardsOn(t, anime))[0];

    const out = await save(t, {
      parallelId: parallel,
      cards: [
        { cardId: one._id, listingTitle: "Something else #1" },
        { cardId: source._id, listingTitle: "Something else" },
      ],
    });
    expect(out.skipped).toBe(2);
    expect((await byNumber(t, parallel)).get("1")!.listingTitle).toBe(one.listingTitle);
    expect((await t.run((ctx) => ctx.db.get(source._id)))!.listingTitle).toBe(source.listingTitle);
  });

  test("the box goes on the parallel row, a shown box title is written, and the rest are rewritten", async () => {
    const t = convexTest(schema, modules);
    const { parallel, anime, cards } = await standardParallel(t);
    const one = cards.get("1")!;
    const page = await failingTitles(t, parallel);
    const three = page.cards.find((c) => c.cardNumber === "3")!;
    // What the dialog shows for #3 with the box draft: the same rule.
    const shown = assessParallelCopyTitle({ ...three.inputs, setShortName: BOX }, three.carriedRest).title;
    expect(shown).toContain(`${BOX} Mike Trout`);

    const out = await save(t, {
      parallelId: parallel,
      listingShortName: `  ${BOX}  `,
      cards: [{ cardId: three.cardId, kept: shown }],
    });
    expect(out).toEqual({ saved: 0, rewritten: 1, kept: 0, skipped: 0, stillFailing: 0 });

    expect((await t.run((ctx) => ctx.db.get(parallel)))?.metadata?.listingShortName).toBe(BOX);
    expect((await t.run((ctx) => ctx.db.get(anime)))?.metadata?.listingShortName).toBeUndefined();

    await drainScheduled(t);
    const after = await byNumber(t, parallel);
    expect(after.get("3")!.listingTitle).toBe(shown);
    expect(storedTitleFails(after.get("3")!)).toBe(false);
    // #4 was not answered; the continuation retitled it with the box.
    expect(storedTitleFails(after.get("4")!)).toBe(false);
    expect(after.get("4")!.listingTitle).toContain(BOX);
    // A card that fit is never touched.
    expect(after.get("1")!.listingTitle).toBe(one.listingTitle);
    expect(after.get("1")!.lastUpdated).toBe(one.lastUpdated);
    expect(new Set(requeued)).toEqual(new Set([three.cardId, cards.get("4")!._id]));
  });

  test("a kept title the server would not build with the box is skipped", async () => {
    const t = convexTest(schema, modules);
    const { parallel, cards } = await standardParallel(t);
    const three = cards.get("3")!;
    const out = await save(t, {
      parallelId: parallel,
      listingShortName: BOX,
      cards: [{ cardId: three._id, kept: "A title nobody was shown" }],
    });
    expect(out.skipped).toBe(1);
    expect(out.rewritten).toBe(0);
    await drainScheduled(t);
  });
});

describe("rewriteFailingTitlesPage", () => {
  test("a rerun writes nothing", async () => {
    const t = convexTest(schema, modules);
    const { parallel } = await standardParallel(t);
    await t.run((ctx) => ctx.db.patch(parallel, { metadata: { listingShortName: BOX } }));

    const first = await t.mutation(internal.parallelCopyTitles.rewriteFailingTitlesPage, { parallelId: parallel, box: BOX });
    expect(first).toEqual({ rewritten: 2, stopped: false, isDone: true });
    const snapshot = await cardsOn(t, parallel);
    requeued.length = 0;

    const second = await t.mutation(internal.parallelCopyTitles.rewriteFailingTitlesPage, { parallelId: parallel, box: BOX });
    expect(second).toEqual({ rewritten: 0, stopped: false, isDone: true });
    expect(await cardsOn(t, parallel)).toEqual(snapshot);
    expect(requeued).toEqual([]);
  });

  test("a chain whose box is no longer the parallel's stops without writing", async () => {
    const t = convexTest(schema, modules);
    const { parallel } = await standardParallel(t);
    await t.run((ctx) => ctx.db.patch(parallel, { metadata: { listingShortName: "A newer box" } }));
    const before = await cardsOn(t, parallel);

    const out = await t.mutation(internal.parallelCopyTitles.rewriteFailingTitlesPage, { parallelId: parallel, box: BOX });
    expect(out).toEqual({ rewritten: 0, stopped: true, isDone: true });
    expect(await cardsOn(t, parallel)).toEqual(before);
  });
});
