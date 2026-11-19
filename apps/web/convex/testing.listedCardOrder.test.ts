/**
 * NEO-555 (G1) — a spec names the card that sold by its printed number
 * (`listedCardNumber`); `addMyEbayOrder` / `addMyBscOrder` resolve it against
 * the CALLER'S OWN live listings on that platform, exactly one, and send the
 * fake the real SKU / listing id / BSC card id. Zero or several matches, and
 * another user's listing, are refused with a fixed message before the fake
 * sees anything. Lines without `listedCardNumber` pass through unchanged.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import schema from "./schema";
import { __resetContractCache } from "./credentials";
import { bscConditionFor } from "./lib/bscConditions";
import { fakeBscNamespaceFor } from "./testing";

/** convex-test ids carry no Convex checksum (see listingSales.test.ts). */
vi.mock("./lib/listingSku", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/listingSku")>();
  return {
    ...actual,
    buildListingSku: (p: { cardId: string; bscCondition: keyof typeof actual.BSC_CONDITION_SKU_CODE; boxId: string }) =>
      `NB1-${p.cardId}-${actual.BSC_CONDITION_SKU_CODE[p.bscCondition]}-${p.boxId}`,
  };
});

const ME = "user_listedme_aaaa";
const OTHER = "user_listedother_bbbb";
const CLOUD_URL = "https://happy-otter-123.convex.cloud";
const NOW = 1_700_000_000_000;
const FAKE_ENV = {
  TESTING_RESET_SECRET: "test-enabled",
  NEONBINDER_BSC_API_BASE: "https://neonbinder-fake-bsc-abc123-uc.a.run.app",
  NEONBINDER_FAKE_BSC_KEY: "caller-key",
  CONVEX_CLOUD_URL: CLOUD_URL,
  EBAY_ENVIRONMENT: "fake",
  NEONBINDER_BROWSER_URL: "http://localhost:9999",
};

type Call = { fn: string; args: Record<string, unknown> };
const calls: Call[] = [];
function recorder(fn: string) {
  return internalAction({
    args: { ns: v.optional(v.string()), seller: v.optional(v.string()), order: v.optional(v.any()) },
    returns: v.any(),
    handler: async (_ctx, args) => {
      calls.push({ fn, args });
      return { ok: true, skipped: false };
    },
  });
}
const modules = {
  ...(import.meta as unknown as { glob: (pattern: string) => Record<string, () => Promise<unknown>> }).glob("./**/*.*s"),
  "./fakeBsc.ts": async () => ({ addOrder: recorder("addOrder"), ebayOrders: recorder("ebayOrders") }),
};

type T = ReturnType<typeof convexTest>;

beforeEach(() => {
  calls.length = 0;
  __resetContractCache();
  for (const [k, val] of Object.entries(FAKE_ENV)) vi.stubEnv(k, val);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** A year (modern era), set and variant with cards FS-1 (twice, two cards share a number), FS-2. */
async function seedCatalog(t: T) {
  return await t.run(async (ctx) => {
    const row = (level: string, value: string, parentId?: Id<"selectorOptions">) =>
      ctx.db.insert("selectorOptions", {
        level,
        value,
        platformData: { bsc: { b0: `slug-${value}` } },
        isCustom: false,
        children: [],
        ...(parentId ? { parentId } : {}),
        lastUpdated: NOW,
      } as never);
    const sport = await row("sport", "Baseball");
    const year = await row("year", "2024", sport);
    const set = await row("setName", "Chrome", year);
    const variant = await row("variantType", "Base", set);
    const card = (cardNumber: string, ref: string | null) =>
      ctx.db.insert("cardChecklist", {
        selectorOptionId: variant,
        cardNumber,
        cardName: `Player ${cardNumber}`,
        listingTitle: `Card ${cardNumber}`,
        sportId: sport,
        platformData: ref ? { bsc: { ref, src: "b0" } } : {},
        sortOrder: 0,
        lastUpdated: NOW,
      } as never);
    return {
      variant,
      set,
      fs1: await card("FS-1", "bsc-fs1"),
      fs1Twin: await card("fs-1", "bsc-fs1-twin"),
      fs2: await card("FS-2", "bsc-fs2"),
      fs3NoBsc: await card("FS-3", null),
    };
  });
}
type Catalog = Awaited<ReturnType<typeof seedCatalog>>;

async function seedBox(t: T, ownerId: string, listed = true) {
  return await t.run(async (ctx) =>
    ctx.db.insert("collectionContainers", {
      ownerId,
      kind: "box",
      name: "Box",
      ...(listed ? {} : { listedOnMarketplaces: false }),
      lastUpdated: NOW,
    } as never),
  );
}

async function seedCopy(
  t: T,
  c: Catalog,
  ownerId: string,
  cardId: Id<"cardChecklist">,
  homeId: Id<"collectionContainers">,
  extra: Record<string, unknown> = {},
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("collectionCopies", {
      ownerId,
      cardId,
      variantId: c.variant,
      setId: c.set,
      homeId,
      quantity: 2,
      condition: "Near Mint",
      lastUpdated: NOW,
      ...extra,
    } as never);
  });
}

async function seedLink(
  t: T,
  ownerId: string,
  cardId: Id<"cardChecklist">,
  over: { conditionCode?: "NM" | "EX"; listingId?: string | null; status?: "live" | "draft" | "ended" } = {},
) {
  const code = over.conditionCode ?? "NM";
  await t.run(async (ctx) => {
    await ctx.db.insert("marketplaceListingLinks", {
      ownerId,
      platform: "ebay",
      cardId,
      conditionCode: code,
      sku: `NB2-${cardId}-${code}`,
      offerId: "O1",
      ...(over.listingId === null ? {} : { listingId: over.listingId ?? (code === "NM" ? "110000000001" : "110000000002") }),
      status: over.status ?? "live",
      lastUpdated: NOW,
    });
  });
}

const as = (t: T, user = ME) => t.withIdentity({ subject: user });

describe("addMyEbayOrder with listedCardNumber", () => {
  test("resolves exactly one live link of the caller's and sends the real SKU and listing id", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCatalog(t);
    await seedLink(t, ME, c.fs2);
    const result = await as(t).action(api.testing.addMyEbayOrder, {
      order: { orderId: "O-1", lines: [{ listedCardNumber: "FS-2", quantity: 1, priceCents: 150 }] },
    });
    expect(result).toEqual({ lines: 1 });
    expect(calls).toEqual([
      {
        fn: "ebayOrders",
        args: {
          ns: fakeBscNamespaceFor(ME, CLOUD_URL),
          order: {
            orderId: "O-1",
            lines: [{ sku: `NB2-${c.fs2}-NM`, listingId: "110000000001", quantity: 1, priceCents: 150 }],
          },
        },
      },
    ]);
  });

  test("matches the printed number case-insensitively and ignoring surrounding spaces", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCatalog(t);
    await seedLink(t, ME, c.fs2);
    await as(t).action(api.testing.addMyEbayOrder, { order: { lines: [{ listedCardNumber: " fs-2 ", quantity: 1 }] } });
    expect(calls).toHaveLength(1);
  });

  test("a card with no live listing is refused with a fixed message, and nothing is sent", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCatalog(t);
    await seedLink(t, ME, c.fs2);
    await expect(
      as(t).action(api.testing.addMyEbayOrder, { order: { lines: [{ listedCardNumber: "FS-9", quantity: 1 }] } }),
    ).rejects.toThrow("lines[0]: none of your cards with that number is listed on eBay");
    expect(calls).toEqual([]);
  });

  test.each([
    ["a draft link", { status: "draft" as const }],
    ["an ended link", { status: "ended" as const }],
    ["a link with no listing id", { listingId: null }],
  ])("%s is not a live listing", async (_name, over) => {
    const t = convexTest(schema, modules);
    const c = await seedCatalog(t);
    await seedLink(t, ME, c.fs2, over);
    await expect(
      as(t).action(api.testing.addMyEbayOrder, { order: { lines: [{ listedCardNumber: "FS-2", quantity: 1 }] } }),
    ).rejects.toThrow(/none of your cards/);
    expect(calls).toEqual([]);
  });

  test("two listings carrying the number (two cards) are refused, never given to the first", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCatalog(t);
    await seedLink(t, ME, c.fs1);
    await seedLink(t, ME, c.fs1Twin);
    await expect(
      as(t).action(api.testing.addMyEbayOrder, { order: { lines: [{ listedCardNumber: "FS-1", quantity: 1 }] } }),
    ).rejects.toThrow("lines[0]: more than one of your listings on eBay has that number, so it names no one card");
    expect(calls).toEqual([]);
  });

  test("two listings of ONE card (two condition buckets) are refused too", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCatalog(t);
    await seedLink(t, ME, c.fs2, { conditionCode: "NM" });
    await seedLink(t, ME, c.fs2, { conditionCode: "EX" });
    await expect(
      as(t).action(api.testing.addMyEbayOrder, { order: { lines: [{ listedCardNumber: "FS-2", quantity: 1 }] } }),
    ).rejects.toThrow(/more than one of your listings/);
  });

  test("another user's listing is never read: with only theirs, the caller's number matches nothing", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCatalog(t);
    await seedLink(t, OTHER, c.fs2);
    await expect(
      as(t).action(api.testing.addMyEbayOrder, { order: { lines: [{ listedCardNumber: "FS-2", quantity: 1 }] } }),
    ).rejects.toThrow(/none of your cards/);
    // And with one each, the caller gets their own.
    await seedLink(t, ME, c.fs2, { listingId: "999" });
    await as(t).action(api.testing.addMyEbayOrder, { order: { lines: [{ listedCardNumber: "FS-2", quantity: 1 }] } });
    expect(calls[0].args.order).toMatchObject({ lines: [{ listingId: "999" }] });
  });

  test("a line with no listedCardNumber (an unknown title) passes through unchanged, beside a resolved one", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCatalog(t);
    await seedLink(t, ME, c.fs2);
    const stranger = { title: "Stranger card", quantity: 1, priceCents: 99 };
    const known = { sku: "NB2-x-NM", listingId: "123", quantity: 2 };
    expect(
      await as(t).action(api.testing.addMyEbayOrder, {
        seller: "alt",
        order: { orderId: "O-2", lines: [{ listedCardNumber: "FS-2", quantity: 1 }, stranger, known] },
      }),
    ).toEqual({ lines: 3 });
    expect(calls[0].args).toMatchObject({ seller: "alt" });
    expect((calls[0].args.order as { lines: unknown[] }).lines.slice(1)).toEqual([stranger, known]);
  });

  test.each([
    ["blank", "  "],
    ["too long", "x".repeat(33)],
    ["a control character", "FS-\n1"],
  ])("a listedCardNumber that is %s is refused before anything is read", async (_name, listedCardNumber) => {
    const t = convexTest(schema, modules);
    await seedCatalog(t);
    await expect(
      as(t).action(api.testing.addMyEbayOrder, { order: { lines: [{ listedCardNumber, quantity: 1 }] } }),
    ).rejects.toThrow(/listedCardNumber is blank, too long/);
    expect(calls).toEqual([]);
  });

  test("a line may not carry both a number and ids", async () => {
    const t = convexTest(schema, modules);
    await seedCatalog(t);
    await expect(
      as(t).action(api.testing.addMyEbayOrder, {
        order: { lines: [{ listedCardNumber: "FS-2", sku: "NB2-x-NM", quantity: 1 } as never] },
      }),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  test("the locks still come first (anonymous caller)", async () => {
    const t = convexTest(schema, modules);
    await expect(t.action(api.testing.addMyEbayOrder, { order: { lines: [{ listedCardNumber: "FS-2", quantity: 1 }] } })).rejects.toThrow(
      /Not authenticated/,
    );
  });
});

describe("addMyBscOrder with listedCardNumber", () => {
  const near = bscConditionFor("Near Mint", "modern");

  test("resolves exactly one listed card and sends its BSC card id, condition and SKU", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCatalog(t);
    const box = await seedBox(t, ME);
    await seedCopy(t, c, ME, c.fs2, box);
    const result = await as(t).action(api.testing.addMyBscOrder, {
      order: { orderNo: "B-1", items: [{ listedCardNumber: "FS-2", quantity: 1, priceCents: 200 }] },
    });
    expect(result).toEqual({ items: 1 });
    expect(calls).toEqual([
      {
        fn: "addOrder",
        args: {
          ns: fakeBscNamespaceFor(ME, CLOUD_URL),
          order: {
            orderNo: "B-1",
            items: [
              {
                cardId: "bsc-fs2",
                condition: near,
                sellerSku: `NB1-${c.fs2}-NM-${box}`,
                quantity: 1,
                priceCents: 200,
              },
            ],
          },
        },
      },
    ]);
  });

  test("two copies of one card in one condition are one listing", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCatalog(t);
    const box = await seedBox(t, ME);
    await seedCopy(t, c, ME, c.fs2, box, { acquiredOn: "2024-01-01" });
    await seedCopy(t, c, ME, c.fs2, box, { acquiredOn: "2024-02-01", upForTrade: undefined });
    await as(t).action(api.testing.addMyBscOrder, { order: { items: [{ listedCardNumber: "FS-2", quantity: 1 }] } });
    expect(calls).toHaveLength(1);
  });

  test("no listed copy of that number: refused with a fixed message, nothing sent", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCatalog(t);
    const box = await seedBox(t, ME);
    await seedCopy(t, c, ME, c.fs2, box);
    await expect(
      as(t).action(api.testing.addMyBscOrder, { order: { items: [{ listedCardNumber: "FS-9", quantity: 1 }] } }),
    ).rejects.toThrow("items[0]: none of your cards with that number is listed on BuySportsCards");
    expect(calls).toEqual([]);
  });

  test.each([
    ["a box that does not list", async (t: T, c: Catalog) => seedCopy(t, c, ME, c.fs2, await seedBox(t, ME, false))],
    ["a binder", async (t: T, c: Catalog) => seedCopy(t, c, ME, c.fs2, await t.run((ctx) => ctx.db.insert("collectionContainers", { ownerId: ME, kind: "binder", name: "B", lastUpdated: NOW } as never)))],
    ["a graded copy", async (t: T, c: Catalog) => seedCopy(t, c, ME, c.fs2, await seedBox(t, ME), { grading: { grader: "PSA", grade: "10" } })],
    ["a copy with no condition", async (t: T, c: Catalog) => seedCopy(t, c, ME, c.fs2, await seedBox(t, ME), { condition: undefined })],
    ["a card with no BSC id", async (t: T, c: Catalog) => seedCopy(t, c, ME, c.fs3NoBsc, await seedBox(t, ME))],
  ])("%s is not a listing", async (_name, seed) => {
    const t = convexTest(schema, modules);
    const c = await seedCatalog(t);
    await seed(t, c);
    const number = _name === "a card with no BSC id" ? "FS-3" : "FS-2";
    await expect(
      as(t).action(api.testing.addMyBscOrder, { order: { items: [{ listedCardNumber: number, quantity: 1 }] } }),
    ).rejects.toThrow(/none of your cards/);
    expect(calls).toEqual([]);
  });

  test("two cards sharing the number, both listed, are refused", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCatalog(t);
    const box = await seedBox(t, ME);
    await seedCopy(t, c, ME, c.fs1, box);
    await seedCopy(t, c, ME, c.fs1Twin, box);
    await expect(
      as(t).action(api.testing.addMyBscOrder, { order: { items: [{ listedCardNumber: "FS-1", quantity: 1 }] } }),
    ).rejects.toThrow("items[0]: more than one of your listings on BuySportsCards has that number, so it names no one card");
    expect(calls).toEqual([]);
  });

  test("one card listed in two conditions is two listings: refused", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCatalog(t);
    const box = await seedBox(t, ME);
    await seedCopy(t, c, ME, c.fs2, box, { condition: "Near Mint" });
    await seedCopy(t, c, ME, c.fs2, box, { condition: "Excellent" });
    await expect(
      as(t).action(api.testing.addMyBscOrder, { order: { items: [{ listedCardNumber: "FS-2", quantity: 1 }] } }),
    ).rejects.toThrow(/more than one of your listings/);
  });

  test("another user's listed copy is never read", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCatalog(t);
    await seedCopy(t, c, OTHER, c.fs2, await seedBox(t, OTHER));
    await expect(
      as(t).action(api.testing.addMyBscOrder, { order: { items: [{ listedCardNumber: "FS-2", quantity: 1 }] } }),
    ).rejects.toThrow(/none of your cards/);
    // The other user's own sell resolves to their box, not the caller's.
    const mine = await seedBox(t, ME);
    await seedCopy(t, c, ME, c.fs2, mine);
    await as(t).action(api.testing.addMyBscOrder, { order: { items: [{ listedCardNumber: "FS-2", quantity: 1 }] } });
    expect((calls[0].args.order as { items: Array<{ sellerSku: string }> }).items[0].sellerSku).toContain(mine);
  });

  test("an item with the BSC ids passes through unchanged beside a resolved one", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCatalog(t);
    await seedCopy(t, c, ME, c.fs2, await seedBox(t, ME));
    const unknown = { cardId: "96f9a87adeb7d02c", condition: "nm", quantity: 1, priceCents: 150 };
    expect(
      await as(t).action(api.testing.addMyBscOrder, {
        order: { items: [{ listedCardNumber: "FS-2", quantity: 1 }, unknown] },
      }),
    ).toEqual({ items: 2 });
    expect((calls[0].args.order as { items: unknown[] }).items[1]).toEqual(unknown);
  });

  test("an order with only id items is exactly what it was before", async () => {
    const t = convexTest(schema, modules);
    const order = { orderNo: "T-1", status: "READY_TO_SHIP", items: [{ cardId: "96f9a87adeb7d02c", condition: "nm", quantity: 1 }] };
    await as(t).action(api.testing.addMyBscOrder, { order });
    expect(calls).toEqual([{ fn: "addOrder", args: { ns: fakeBscNamespaceFor(ME, CLOUD_URL), order } }]);
  });

  test("a bad listedCardNumber is refused before anything is read", async () => {
    const t = convexTest(schema, modules);
    await expect(
      as(t).action(api.testing.addMyBscOrder, { order: { items: [{ listedCardNumber: "", quantity: 1 }] } }),
    ).rejects.toThrow(/listedCardNumber is blank/);
    expect(calls).toEqual([]);
  });
});

describe("listedCardForOrder is internal", () => {
  test("reads only the owner it is given", async () => {
    const t = convexTest(schema, modules);
    const c = await seedCatalog(t);
    await seedLink(t, OTHER, c.fs2);
    expect(await t.query(internal.testing.listedCardForOrder, { ownerId: ME, platform: "ebay", cardNumber: "FS-2" })).toEqual({ matches: 0 });
    expect(await t.query(internal.testing.listedCardForOrder, { ownerId: OTHER, platform: "ebay", cardNumber: "FS-2" })).toMatchObject({ matches: 1 });
  });
});
