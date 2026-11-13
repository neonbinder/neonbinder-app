/**
 * NEO-535 — `backfillListingDescriptions`: every stored card gets the
 * description `generateListingDescription` writes today, read through
 * `listingInputsForStoredCard` (Regenerate's own reading of a stored card).
 *
 * Pinned: the dry run is the default and writes nothing; an armed invocation
 * on an unarmed deployment is refused (reported, not thrown); an armed run
 * writes exactly the generator's description and touches nothing else on the
 * row (`listingTitle`, `listingTitleTruncated`, `lastUpdated` byte-identical);
 * a second run writes nothing; pages sum and resume from the cursor; a missing
 * description is filled; a card with a dangling player or a missing row keeps
 * the description it has; and a card the commit path just wrote is already
 * what the backfill would write.
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { generateListingDescription } from "./features/generateListing";
import { listingInputsForStoredCard, newStoredCardLookupCache } from "./storedCardTitle";
import { CONFIRM_TOKEN, ENV_FLAG, planDescription } from "./backfillListingDescriptions";
import { seedCollectionCatalog } from "../lib/testing/collection-fixture";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

type T = ReturnType<typeof convexTest>;
type Card = Doc<"cardChecklist">;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function setup() {
  const t = convexTest(schema, modules);
  const fx = await seedCollectionCatalog(t);
  // One card with no description at all, and one flagged as truncated, so the
  // untouched-fields check covers `listingTitleTruncated` too.
  await t.run(async (ctx) => {
    await ctx.db.patch(fx.strawberry2, { listingDescription: undefined });
    await ctx.db.patch(fx.gold1, { listingTitleTruncated: true });
  });
  return { t, fx };
}

const allCards = (t: T) => t.run(async (ctx) => await ctx.db.query("cardChecklist").collect());

/** What the generator writes for each stored card today, by id. */
async function expectedDescriptions(t: T): Promise<Map<Id<"cardChecklist">, string>> {
  // `t.run` returns Convex values only, so pairs come back and the Map is built here.
  const pairs = await t.run(async (ctx) => {
    const out: Array<[Id<"cardChecklist">, string]> = [];
    for (const card of await ctx.db.query("cardChecklist").collect()) {
      out.push([card._id, generateListingDescription((await listingInputsForStoredCard(ctx, card)).inputs)]);
    }
    return out;
  });
  return new Map(pairs);
}

const untouched = (c: Card) => ({
  listingTitle: c.listingTitle,
  listingTitleTruncated: c.listingTitleTruncated,
  lastUpdated: c.lastUpdated,
});

describe("arming", () => {
  test("the dry run is the default and writes nothing", async () => {
    const { t } = await setup();
    const before = await allCards(t);
    const result = await t.action(internal.backfillListingDescriptions.run, {});
    expect(result.armed).toBe(false);
    expect(result.message).toMatch(/^Dry run/);
    expect(result.isDone).toBe(true);
    expect(result.counts.scanned).toBe(before.length);
    expect(result.counts.filled).toBe(1);
    expect(result.counts.rewritten).toBe(before.length - 1);
    expect(result.samples.length).toBeLessThanOrEqual(5);
    expect(await allCards(t)).toEqual(before);
  });

  test("confirm on an unarmed deployment is refused, reported, and writes nothing", async () => {
    const { t } = await setup();
    const before = await allCards(t);
    const result = await t.action(internal.backfillListingDescriptions.run, { confirm: CONFIRM_TOKEN });
    expect(result.armed).toBe(false);
    expect(result.message).toContain(`Refused`);
    expect(result.message).toContain(ENV_FLAG);
    expect(result.counts.filled + result.counts.rewritten).toBe(before.length);
    expect(await allCards(t)).toEqual(before);
  });

  test("the flag without confirm is still a dry run", async () => {
    const { t } = await setup();
    vi.stubEnv(ENV_FLAG, "1");
    const before = await allCards(t);
    const result = await t.action(internal.backfillListingDescriptions.run, { confirm: "yes" });
    expect(result.armed).toBe(false);
    expect(await allCards(t)).toEqual(before);
  });

  test("the page mutation re-checks both arms: called directly with confirm on an unarmed deployment, it writes nothing", async () => {
    const { t } = await setup();
    const before = await allCards(t);
    const page = await t.mutation(internal.backfillListingDescriptions.backfillListingDescriptionsPage, {
      cursor: null,
      confirm: CONFIRM_TOKEN,
    });
    expect(page.armed).toBe(false);
    expect(await allCards(t)).toEqual(before);
  });

  test("the log line carries counts only, never card text", async () => {
    const { t } = await setup();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await t.action(internal.backfillListingDescriptions.run, {});
    const lines = log.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("backfill_listing_descriptions"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/Gooden|Strawberry|Topps/);
  });
});

describe("an armed run", () => {
  test("writes the generator's description and touches nothing else; a second run writes nothing", async () => {
    const { t } = await setup();
    vi.stubEnv(ENV_FLAG, "1");
    const expected = await expectedDescriptions(t);
    const before = await allCards(t);

    const first = await t.action(internal.backfillListingDescriptions.run, { confirm: CONFIRM_TOKEN });
    expect(first.armed).toBe(true);
    expect(first.message).toMatch(/^Applied/);
    expect(first.counts.filled).toBe(1);
    expect(first.counts.rewritten).toBe(before.length - 1);

    const after = await allCards(t);
    for (const card of after) {
      expect(card.listingDescription, card.cardNumber).toBe(expected.get(card._id));
      const was = before.find((b) => b._id === card._id)!;
      expect(untouched(card), card.cardNumber).toEqual(untouched(was));
      // Short and long forms a collector types, where the card has them.
      expect(card.listingDescription).toContain(`#${card.cardNumber}`);
    }
    const gold = after.find((c) => c.printRun === 50)!;
    expect(gold.listingDescription).toContain("/50");
    expect(gold.listingTitleTruncated).toBe(true);

    const second = await t.action(internal.backfillListingDescriptions.run, { confirm: CONFIRM_TOKEN });
    expect(second.counts).toMatchObject({ filled: 0, rewritten: 0, unchanged: after.length });
    expect(second.samples).toEqual([]);
    expect(await allCards(t)).toEqual(after);
  });

  test("pages sum to the same totals and resume from the cursor", async () => {
    const { t } = await setup();
    vi.stubEnv(ENV_FLAG, "1");
    const total = (await allCards(t)).length;
    const expected = await expectedDescriptions(t);

    const first = await t.action(internal.backfillListingDescriptions.run, {
      confirm: CONFIRM_TOKEN,
      numItems: 2,
      maxPages: 1,
    });
    expect(first.isDone).toBe(false);
    expect(first.counts.scanned).toBe(2);
    expect(first.continueCursor).toBeDefined();
    expect(first.message).toContain("continueCursor");

    const rest = await t.action(internal.backfillListingDescriptions.run, {
      confirm: CONFIRM_TOKEN,
      numItems: 2,
      cursor: first.continueCursor,
    });
    expect(rest.isDone).toBe(true);
    expect(rest.pages).toBeGreaterThan(1);
    expect(rest.continueCursor).toBeUndefined();
    expect(first.counts.scanned + rest.counts.scanned).toBe(total);
    expect(
      first.counts.filled + rest.counts.filled + first.counts.rewritten + rest.counts.rewritten,
    ).toBe(total);
    for (const card of await allCards(t)) {
      expect(card.listingDescription, card.cardNumber).toBe(expected.get(card._id));
    }
  });

  test("numItems is clamped to the page size and to at least one", async () => {
    const { t } = await setup();
    const big = await t.mutation(internal.backfillListingDescriptions.backfillListingDescriptionsPage, {
      cursor: null,
      numItems: 10_000,
    });
    expect(big.isDone).toBe(true);
    const small = await t.mutation(internal.backfillListingDescriptions.backfillListingDescriptionsPage, {
      cursor: null,
      numItems: 0,
    });
    expect(small.counts.scanned).toBe(1);
  });

  test("onlyMissing fills the card with none and keeps every stored description", async () => {
    const { t, fx } = await setup();
    vi.stubEnv(ENV_FLAG, "1");
    const before = await allCards(t);
    const result = await t.action(internal.backfillListingDescriptions.run, {
      confirm: CONFIRM_TOKEN,
      onlyMissing: true,
    });
    expect(result.counts).toMatchObject({ filled: 1, rewritten: 0, keptExisting: before.length - 1 });
    for (const card of await allCards(t)) {
      const was = before.find((b) => b._id === card._id)!;
      if (card._id === fx.strawberry2) expect(card.listingDescription).toBeTruthy();
      else expect(card.listingDescription).toBe(was.listingDescription);
    }
  });
});

describe("unresolved cards", () => {
  test("a dangling player or a missing row keeps an existing description; with none, it is filled", async () => {
    const { t, fx } = await setup();
    vi.stubEnv(ENV_FLAG, "1");
    const ids = await t.run(async (ctx) => {
      const gone = await ctx.db.insert("players", {
        name: "Nobody At All",
        nameNormalized: "nobody at all",
        sportId: fx.sportId,
        lastUpdated: 0,
      });
      await ctx.db.delete(gone);
      // A dangling player beside a real one, with a description stored.
      await ctx.db.patch(fx.gooden1, {
        playerIds: [fx.goodenId, gone],
        listingDescription: "Kept as it is.",
      });
      // A dangling player and no description: filled from what resolves.
      await ctx.db.patch(fx.futureStar, { playerIds: [gone], listingDescription: undefined });
      // A card whose row is gone, with a description stored.
      const doomed = await ctx.db.insert("selectorOptions", {
        level: "insert",
        value: "Doomed",
        parentId: fx.insertsTypeId,
        platformData: {},
        lastUpdated: 0,
      });
      const orphan = await ctx.db.insert("cardChecklist", {
        selectorOptionId: doomed,
        cardNumber: "D-1",
        cardName: "Orphan",
        listingTitle: "#D-1",
        listingDescription: "Orphan description.",
        sportId: fx.sportId,
        platformData: {},
        sortOrder: 0,
        lastUpdated: 0,
      });
      await ctx.db.delete(doomed);
      return { orphan };
    });

    const result = await t.action(internal.backfillListingDescriptions.run, { confirm: CONFIRM_TOKEN });
    expect(result.counts.skippedUnresolved).toBe(2);
    const cards = await allCards(t);
    expect(cards.find((c) => c._id === fx.gooden1)!.listingDescription).toBe("Kept as it is.");
    expect(cards.find((c) => c._id === ids.orphan)!.listingDescription).toBe("Orphan description.");
    const filled = cards.find((c) => c._id === fx.futureStar)!.listingDescription;
    expect(filled).toContain("#FS-1");
    expect(filled).toContain("Future Stars");
  });
});

describe("parity with the commit path", () => {
  test("a card the commit chunk just wrote is already what the backfill writes", async () => {
    const { t, fx } = await setup();
    const result = await t.mutation(internal.selectorOptions.commitCardChecklistChunk, {
      selectorOptionId: fx.baseId,
      sportValue: "Baseball",
      setNameValue: "Topps Chrome",
      cards: [
        {
          cardNumber: "20",
          cardName: "Card 20",
          playerIds: [fx.goodenId],
          teamOnCardIds: [fx.metsId],
          isRookie: true,
          printRun: 99,
          platformData: {},
          sortOrder: 20,
          playerNames: ["Dwight Gooden"],
          teamNames: ["New York Mets"],
        },
      ],
    });
    const cardId = result.storedIds[0];
    const plan = await t.run(async (ctx) =>
      planDescription(ctx, (await ctx.db.get(cardId))!, newStoredCardLookupCache()),
    );
    const stored = await t.run(async (ctx) => (await ctx.db.get(cardId))!.listingDescription);
    expect(plan.action).toBe("unchanged");
    expect(plan.next).toBe(stored);
  });
});
