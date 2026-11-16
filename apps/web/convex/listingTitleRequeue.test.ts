/**
 * NEO-535 — a retitled card is queued for eBay (`listingTitleRequeue`), so a
 * card eBay held back for an over-80 title goes up once an operator shortens
 * it, without anyone pressing Sync.
 *
 * Queued: for every owner who lists and holds the card in a box, eBay only,
 * when the stored title actually changed. Not queued: an unchanged title, a
 * description-only edit, a copy in a binder, an owner who lists nowhere. A
 * card held by more copies than one page hands off to the scheduled chain.
 */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { RETITLE_COPY_PAGE } from "./listingTitleRequeue";
import { seedCollectionCatalog } from "../lib/testing/collection-fixture";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = { subject: "user_admin", role: "admin" };
const SELLER = "collector_retitle_seller";
const NOW = 1_700_000_000_000;

afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const t = convexTest(schema, modules);
  const fx = await seedCollectionCatalog(t);
  return { t, fx, admin: t.withIdentity(ADMIN) };
}
type S = Awaited<ReturnType<typeof setup>>;

/** An owner listing on `platforms`, with one copy of `cardId` in a box or a binder. */
async function holder(
  s: S,
  ownerId: string,
  cardId: Id<"cardChecklist">,
  opts: { home: "box" | "binder"; platforms: Array<"bsc" | "ebay"> },
) {
  await s.t.run(async (ctx) => {
    for (const platform of opts.platforms) {
      await ctx.db.insert("marketplaceListingStates", { ownerId, platform, listingStartedAt: NOW, lastUpdated: NOW });
    }
    const homeId = await ctx.db.insert("collectionContainers", {
      ownerId,
      kind: opts.home,
      name: opts.home === "box" ? "Box 1" : "Binder 1",
      lastUpdated: NOW,
    });
    const card = (await ctx.db.get(cardId))!;
    await ctx.db.insert("collectionCopies", {
      ownerId,
      cardId,
      variantId: card.selectorOptionId,
      setId: s.fx.setId,
      homeId,
      quantity: 1,
      lastUpdated: NOW,
    });
  });
}

const outbox = (s: S) => s.t.run(async (ctx) => await ctx.db.query("listingOutbox").collect());

describe("a retitled card is queued for eBay (NEO-535)", () => {
  test("an owner who lists and holds it in a box gets an eBay row, never a BSC one", async () => {
    const s = await setup();
    await holder(s, SELLER, s.fx.gooden1, { home: "box", platforms: ["bsc", "ebay"] });
    await s.admin.mutation(api.selectorOptions.updateCard, {
      id: s.fx.gooden1,
      listingTitle: "2024 Topps Chrome Doc Gooden #1 RC",
    });
    const rows = await outbox(s);
    expect(rows.map((r) => ({ ownerId: r.ownerId, platform: r.platform, cardId: r.cardId }))).toEqual([
      { ownerId: SELLER, platform: "ebay", cardId: s.fx.gooden1 },
    ]);
    expect(rows[0].variantId).toBe(s.fx.baseId);
  });

  test("an unchanged title, sent again as the panel does on every save, queues nothing", async () => {
    const s = await setup();
    await holder(s, SELLER, s.fx.gooden1, { home: "box", platforms: ["ebay"] });
    const stored = await s.t.run(async (ctx) => (await ctx.db.get(s.fx.gooden1))!.listingTitle);
    await s.admin.mutation(api.selectorOptions.updateCard, {
      id: s.fx.gooden1,
      listingTitle: `  ${stored}  `,
      cardVariation: "Sliding",
    });
    expect(await outbox(s)).toEqual([]);
  });

  test("a description-only edit queues nothing", async () => {
    const s = await setup();
    await holder(s, SELLER, s.fx.gooden1, { home: "box", platforms: ["ebay"] });
    await s.admin.mutation(api.selectorOptions.updateCard, {
      id: s.fx.gooden1,
      listingDescription: "A new description.",
    });
    expect(await outbox(s)).toEqual([]);
  });

  test("a copy in a binder, or an owner who lists nowhere, queues nothing", async () => {
    const s = await setup();
    await holder(s, "collector_binder_only", s.fx.gooden1, { home: "binder", platforms: ["ebay"] });
    await holder(s, "collector_not_listing", s.fx.gooden1, { home: "box", platforms: [] });
    await s.admin.mutation(api.selectorOptions.updateCard, {
      id: s.fx.gooden1,
      listingTitle: "2024 Topps Chrome Doc Gooden #1 RC",
    });
    expect(await outbox(s)).toEqual([]);
  });

  test("only the retitled card is queued, not its neighbours", async () => {
    const s = await setup();
    await holder(s, SELLER, s.fx.gooden1, { home: "box", platforms: ["ebay"] });
    await holder(s, "collector_other", s.fx.strawberry2, { home: "box", platforms: ["ebay"] });
    await s.admin.mutation(api.selectorOptions.updateCard, {
      id: s.fx.gooden1,
      listingTitle: "2024 Topps Chrome Doc Gooden #1 RC",
    });
    expect((await outbox(s)).map((r) => r.cardId)).toEqual([s.fx.gooden1]);
  });

  test("a card held by more than a page of copies is queued by the scheduled chain", async () => {
    vi.useFakeTimers();
    const s = await setup();
    // A page's worth of binder copies from owners who list nowhere, then the
    // one seller with a box copy past the first page.
    await s.t.run(async (ctx) => {
      const card = (await ctx.db.get(s.fx.gooden1))!;
      for (let i = 0; i < RETITLE_COPY_PAGE; i++) {
        const ownerId = `collector_bulk_${i}`;
        const homeId = await ctx.db.insert("collectionContainers", {
          ownerId,
          kind: "binder",
          name: "Binder",
          lastUpdated: NOW,
        });
        await ctx.db.insert("collectionCopies", {
          ownerId,
          cardId: s.fx.gooden1,
          variantId: card.selectorOptionId,
          setId: s.fx.setId,
          homeId,
          quantity: 1,
          lastUpdated: NOW,
        });
      }
    });
    await holder(s, SELLER, s.fx.gooden1, { home: "box", platforms: ["ebay"] });

    await s.admin.mutation(api.selectorOptions.updateCard, {
      id: s.fx.gooden1,
      listingTitle: "2024 Topps Chrome Doc Gooden #1 RC",
    });
    // Nothing inline: the save handed the whole job to the chain.
    expect(await outbox(s)).toEqual([]);
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    const rows = await outbox(s);
    expect(rows.map((r) => [r.ownerId, r.platform, r.cardId])).toEqual([[SELLER, "ebay", s.fx.gooden1]]);
  });
});
