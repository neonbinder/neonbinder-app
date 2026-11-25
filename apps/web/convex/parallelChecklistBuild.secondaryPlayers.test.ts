/**
 * NEO-528 — the parallel build copies each insert card's "Also pictured"
 * players (`secondaryPlayerIds`) onto its copy, through the one writer, so the
 * copy's `cardSecondaryPlayerLinks` rows exist too; a rebuild leaves no orphan
 * row behind. Harness: `parallelChecklistBuild.cardPlayerLinks.test.ts`.
 */

import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { insertTestCard } from "../lib/testing/card-row";
import { setCardSecondaryPlayers } from "./cardSecondaryPlayers";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

const ADMIN = {
  subject: "admin_neo528_links",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_neo528_links",
  role: "admin",
};

const SENTINEL = 1_700_000_000_000;

type StubCard = {
  cardNumber: string;
  cardName: string;
  players?: string[];
  platformRef: string;
  sourceBscSetSlug?: string;
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

beforeEach(() => {
  bscState.cards = [];
});

type T = ReturnType<typeof convexTest>;

/**
 * sport → year → setName → variantType(Insert) → insert(Anime) →
 * parallel(Anime Kanji, BSC only), plus two players and two insert cards
 * carrying them. BSC only, so no SportLots stub is needed.
 */
async function seed(t: T) {
  return t.run(async (ctx) => {
    const mk = (
      level: "sport" | "year" | "setName" | "variantType" | "insert" | "parallel",
      value: string,
      parentId: Id<"selectorOptions"> | undefined,
      platformData: { bsc?: Record<string, string> },
      extra: { platformFacets?: { bsc: Record<string, "variant" | "variantName"> } } = {},
    ) =>
      ctx.db.insert("selectorOptions", {
        level,
        value,
        ...(parentId ? { parentId } : {}),
        platformData,
        children: [],
        lastUpdated: SENTINEL,
        ...extra,
      });
    const sport = await mk("sport", "Baseball", undefined, { bsc: { b0: "baseball" } });
    const year = await mk("year", "2024", sport, { bsc: { b0: "2024" } });
    const setName = await mk("setName", "Bowman", year, { bsc: { b0: "bowman" } });
    const variantType = await mk("variantType", "Insert", setName, { bsc: { b0: "insert" } }, {
      platformFacets: { bsc: { b0: "variant" } },
    });
    const insert = await mk("insert", "Anime", variantType, { bsc: { b0: "anime" } });
    const parallel = await mk("parallel", "Anime Kanji", insert, { bsc: { b0: "anime-kanji" } }, {
      platformFacets: { bsc: { b0: "variantName" } },
    });

    const player = async (name: string) =>
      ctx.db.insert("players", {
        name,
        nameNormalized: name.toLowerCase(),
        sportId: sport,
        lastUpdated: SENTINEL,
      });
    const ohtani = await player("Shohei Ohtani");
    const judge = await player("Aaron Judge");
    const card = (n: string, p: Id<"players">, name: string, sortOrder: number) =>
      insertTestCard(ctx, {
        selectorOptionId: insert,
        cardNumber: n,
        cardName: name,
        playerIds: [p],
        playerLinks: [{ playerId: p, nameOnCard: name }],
        platformData: { bsc: { ref: `ins-${n}`, src: "b0" } },
        // NEO-661: a card still waiting on its team lookup holds the build, so
        // the source is one an operator ruled teamless (tidy, owes no lookup).
        teamNoneConfirmedAt: SENTINEL,
        teamNoneConfirmedByUserId: "user_operator",
        sortOrder,
        lastUpdated: SENTINEL,
      });
    await card("1", ohtani, "Shohei Ohtani", 1);
    await card("2", judge, "Aaron Judge", 2);
    return { sport, insert, parallel, ohtani, judge };
  });
}

function kanjiCards(): StubCard[] {
  return [
    { cardNumber: "1", cardName: "Shohei Ohtani", players: ["Shohei Ohtani"], platformRef: "k-1", sourceBscSetSlug: "anime-kanji" },
    { cardNumber: "2", cardName: "Aaron Judge", players: ["Aaron Judge"], platformRef: "k-2", sourceBscSetSlug: "anime-kanji" },
  ];
}

async function cameoState(t: T, parallel: Id<"selectorOptions">) {
  return t.run(async (ctx) => {
    const cards = await ctx.db
      .query("cardChecklist")
      .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", parallel))
      .collect();
    const links = await ctx.db.query("cardSecondaryPlayerLinks").collect();
    const cardIds = new Set<string>(cards.map((c) => c._id));
    return {
      cards,
      linksOnParallel: links.filter((l) => cardIds.has(l.cardChecklistId)),
      orphans: (
        await Promise.all(links.map(async (l) => ((await ctx.db.get(l.cardChecklistId)) ? null : l)))
      ).filter((l) => l !== null),
    };
  });
}

describe("parallel build — also-pictured players (NEO-528)", () => {
  test("each copy carries its insert card's cameos, indexed by the parallel's sport; a card without any gets none", async () => {
    const t = convexTest(schema, modules);
    const { sport, insert, parallel, ohtani, judge } = await seed(t);
    // Ohtani's card pictures Judge; Judge's card pictures no one.
    await t.run(async (ctx) => {
      const [ohtaniCard] = (
        await ctx.db
          .query("cardChecklist")
          .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", insert))
          .collect()
      ).filter((c) => c.cardNumber === "1");
      await setCardSecondaryPlayers(ctx, ohtaniCard, [judge]);
    });
    bscState.cards = kanjiCards();

    const result = await t
      .withIdentity(ADMIN)
      .action(api.parallelChecklistBuild.buildParallelChecklist, { parallelId: parallel });
    expect(result.status).toBe("built");

    const { cards, linksOnParallel } = await cameoState(t, parallel);
    const one = cards.find((c) => c.cardNumber === "1")!;
    const two = cards.find((c) => c.cardNumber === "2")!;
    expect(one.playerIds).toEqual([ohtani]);
    expect(one.secondaryPlayerIds).toEqual([judge]);
    expect(two.secondaryPlayerIds).toBeUndefined();
    expect(linksOnParallel).toHaveLength(1);
    expect(linksOnParallel[0]).toMatchObject({ cardChecklistId: one._id, playerId: judge, sportId: sport });
  });

  test("a copy's freshly generated description names its cameos; a copy without any has no cameo line", async () => {
    const t = convexTest(schema, modules);
    const { insert, parallel, judge } = await seed(t);
    await t.run(async (ctx) => {
      const [ohtaniCard] = (
        await ctx.db
          .query("cardChecklist")
          .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", insert))
          .collect()
      ).filter((c) => c.cardNumber === "1");
      await setCardSecondaryPlayers(ctx, ohtaniCard, [judge]);
    });
    bscState.cards = kanjiCards();
    await t.withIdentity(ADMIN).action(api.parallelChecklistBuild.buildParallelChecklist, { parallelId: parallel });

    const { cards } = await cameoState(t, parallel);
    const one = cards.find((c) => c.cardNumber === "1")!;
    const two = cards.find((c) => c.cardNumber === "2")!;
    const lines = (one.listingDescription ?? "").split("\n");
    expect(lines[0]).toMatch(/card of Shohei Ohtani, #1\.$/);
    expect(lines).toContain("Cameo: Aaron Judge.");
    expect(two.listingDescription ?? "").not.toMatch(/Cameo/);
  });

  test("a rebuild leaves no orphan cameo row and indexes the new copy once", async () => {
    const t = convexTest(schema, modules);
    const { insert, parallel, judge } = await seed(t);
    await t.run(async (ctx) => {
      const [ohtaniCard] = (
        await ctx.db
          .query("cardChecklist")
          .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", insert))
          .collect()
      ).filter((c) => c.cardNumber === "1");
      await setCardSecondaryPlayers(ctx, ohtaniCard, [judge]);
    });
    bscState.cards = kanjiCards();
    await t.withIdentity(ADMIN).action(api.parallelChecklistBuild.buildParallelChecklist, { parallelId: parallel });
    const rebuilt = await t
      .withIdentity(ADMIN)
      .action(api.parallelChecklistBuild.buildParallelChecklist, { parallelId: parallel });
    expect(rebuilt.rebuilt).toBe(true);
    const after = await cameoState(t, parallel);
    expect(after.orphans).toEqual([]);
    expect(after.linksOnParallel).toHaveLength(1);
  });
  test("a copy's listingTitle names its insert card's cameo after the card's own player", async () => {
    const t = convexTest(schema, modules);
    const { insert, parallel, judge } = await seed(t);
    await t.run(async (ctx) => {
      const [ohtaniCard] = (
        await ctx.db
          .query("cardChecklist")
          .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", insert))
          .collect()
      ).filter((c) => c.cardNumber === "1");
      await setCardSecondaryPlayers(ctx, ohtaniCard, [judge]);
    });
    bscState.cards = kanjiCards();
    await t.withIdentity(ADMIN).action(api.parallelChecklistBuild.buildParallelChecklist, { parallelId: parallel });

    const { cards } = await cameoState(t, parallel);
    const one = cards.find((c) => c.cardNumber === "1")!;
    const two = cards.find((c) => c.cardNumber === "2")!;
    expect(one.listingTitle).toContain("Shohei Ohtani & Aaron Judge");
    expect(two.listingTitle).not.toContain("&");
  });

  test("a cameo too long for the title is cut from the copy's listingTitle, and the copy's description keeps it", async () => {
    const t = convexTest(schema, modules);
    const { sport, insert, parallel } = await seed(t);
    const longCameo = `Bartholomew ${"Fitzgerald".repeat(7)}`;
    await t.run(async (ctx) => {
      const long = await ctx.db.insert("players", {
        name: longCameo,
        nameNormalized: longCameo.toLowerCase(),
        sportId: sport,
        lastUpdated: SENTINEL,
      });
      const [ohtaniCard] = (
        await ctx.db
          .query("cardChecklist")
          .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", insert))
          .collect()
      ).filter((c) => c.cardNumber === "1");
      await setCardSecondaryPlayers(ctx, ohtaniCard, [long]);
    });
    bscState.cards = kanjiCards();
    await t.withIdentity(ADMIN).action(api.parallelChecklistBuild.buildParallelChecklist, { parallelId: parallel });

    const { cards } = await cameoState(t, parallel);
    const one = cards.find((c) => c.cardNumber === "1")!;
    expect(one.listingTitle).toContain("Shohei Ohtani");
    expect(one.listingTitle).not.toContain("Bartholomew");
    expect((one.listingTitle ?? "").length).toBeLessThanOrEqual(80);
    expect((one.listingDescription ?? "").split("\n")).toContain(`Cameo: ${longCameo}.`);
    expect(one.secondaryPlayerIds).toHaveLength(1);
  });
});
