/**
 * NEO-358 — `previewListingTitle` (Regenerate) and `titleForStoredCard` (what
 * the NEO-358 title backfill wrote, retired in NEO-363) give the same answer.
 *
 * The preview's body was moved, unchanged, into `storedCardTitle.ts`; this
 * pins that the two stay one implementation across the shapes a stored card
 * comes in: resolved players and teams, a hand-added card's pending names, a
 * card under an insert and under a parallel of one, a card with a dangling
 * player id, a variation, and a core the generator has to cut. Each title is
 * also pinned as a literal, so a change to either side (or to the generator)
 * is seen here first. And a card born through the commit chunk stores the
 * title Regenerate would offer, so a backfilled title and an inserted one
 * agree.
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { listingInputsForStoredCard, newStoredCardReadCache, titleForStoredCard } from "./storedCardTitle";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import { insertTestCard } from "../lib/testing/card-row";
import { cancelScheduled, drainScheduled } from "../lib/testing/drain-scheduled";
import { PAUSED_PLATFORMS_ENV } from "./lib/marketplacePause";
import { pickTitleChainFacts } from "./listingShortName";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = { subject: "user_admin", role: "admin" };
const NOW = 1_700_000_000_000;
type T = ReturnType<typeof convexTest>;
type Card = Doc<"cardChecklist">;

async function seed(t: T) {
  return t.run(async (ctx) => {
    const row = (
      level: Doc<"selectorOptions">["level"],
      value: string,
      parentId?: Id<"selectorOptions">,
      features?: Record<string, string>,
    ) =>
      ctx.db.insert("selectorOptions", {
        level,
        value,
        ...(parentId ? { parentId } : {}),
        ...(features ? { features } : {}),
        platformData: {},
        children: [],
        lastUpdated: NOW,
      });
    const sport = await row("sport", "Baseball");
    const year = await row("year", "2024", sport);
    const brand = await row("manufacturer", "Topps", year);
    const set = await row("setName", "Topps Chrome", brand);
    const base = await row("variantType", "Base", set, { season: "2024", cardType: "Base" });
    const insertType = await row("variantType", "Insert", set);
    const insert = await row("insert", "Future Stars", insertType, {
      season: "2024",
      cardType: "Insert",
    });
    const parallel = await row("parallel", "Gold Refractor", insert, {
      season: "2024",
      cardType: "Parallel",
      parallelName: "Gold Refractor",
    });
    const leagueId = await ctx.db.insert("leagues", {
      level: "major",
      name: "Major League Baseball",
      nameNormalized: "baseball league major",
      sportId: sport,
      lastUpdated: NOW,
    });
    const mets = await ctx.db.insert("teams", {
      name: "Mets",
      location: "New York",
      nameNormalized: normalizeEntityName("New York Mets"),
      sportId: sport,
      leagueId,
      lastUpdated: NOW,
    });
    const player = (name: string) =>
      ctx.db.insert("players", {
        name,
        nameNormalized: normalizeEntityName(name),
        sportId: sport,
        lastUpdated: NOW,
      });
    const gooden = await player("Dwight Gooden");
    const strawberry = await player("Darryl Strawberry");
    const gone = await player("Nobody At All");
    await ctx.db.delete(gone);

    const card = (selectorOptionId: Id<"selectorOptions">, cardNumber: string, extra: Partial<Card>) =>
      insertTestCard(ctx, {
        selectorOptionId,
        cardNumber,
        cardName: `Card ${cardNumber}`,
        platformData: {},
        sortOrder: 0,
        lastUpdated: NOW,
        ...extra,
      });
    const cards = {
      resolved: await card(base, "16", {
        playerIds: [gooden, strawberry, gooden],
        teamOnCardIds: [mets],
        isRookie: true,
        printRun: 99,
        features: { season: "2024" },
      }),
      pending: await card(base, "17", {
        pendingPlayerNames: ["Doc Gooden"],
        pendingTeamNames: ["New York Mets"],
      }),
      underInsert: await card(insert, "FS-1", {
        playerIds: [gooden],
        features: { season: "2024", cardType: "Insert", autographed: "On Card" },
      }),
      underParallel: await card(parallel, "FS-2", {
        playerIds: [strawberry],
        features: { season: "2024", cardType: "Parallel", parallelName: "Gold Refractor" },
      }),
      dangling: await card(base, "18", { playerIds: [gone] }),
      variation: await card(base, "16", {
        playerIds: [gooden],
        cardVariation: "Image Variation",
      }),
      longCore: await card(base, "19", {
        pendingPlayerNames: [
          "Bartholomew Maximilian Fitzgerald-Worthington",
          "Bartholomew Maximilian Fitzgerald-Worthington",
        ],
      }),
    };
    return { sport, base, mets, gooden, cards };
  });
}

/**
 * What the commit action hands its chunks (NEO-609: the level facts travel by
 * key from the prelude), so a test that calls the chunk directly stores the
 * title the real commit would.
 */
async function chunkFacts(t: T, selectorOptionId: Id<"selectorOptions">, sportId: Id<"selectorOptions">) {
  const prelude = await t
    .withIdentity(ADMIN)
    .mutation(internal.selectorOptions.commitCardChecklistPrelude, {
      selectorOptionId,
      sportId,
      playerNames: [],
      teamNames: [],
    });
  return pickTitleChainFacts(prelude);
}

describe("previewListingTitle and titleForStoredCard", () => {
  test("give the same title, flags and inputs for every shape of stored card", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const titles: Record<string, string> = {};
    for (const [key, cardId] of Object.entries(s.cards)) {
      const preview = await t
        .withIdentity(ADMIN)
        .query(api.selectorOptions.previewListingTitle, { cardId });
      const stored = await t.run(async (ctx) => titleForStoredCard(ctx, (await ctx.db.get(cardId))!));
      // NEO-535: the assessment grew `fits`, `firstNameLost` and (only when
      // the box text built the title) `shortNameUsed`; the preview returns
      // them all.
      expect(preview, key).toEqual({
        title: stored.title,
        fits: stored.fits,
        firstNameLost: stored.firstNameLost,
        ...(stored.shortNameUsed ? { shortNameUsed: true } : {}),
        coreFits: stored.coreFits,
        tidyUp: stored.tidyUp,
        dropped: stored.dropped,
        inputs: stored.inputs,
      });
      titles[key] = preview.title;
    }
    // The literal titles, so drift on either side shows up here.
    expect(titles).toMatchInlineSnapshot(`
      {
        "dangling": "Topps Chrome Base #18 Baseball",
        "longCore": "Topps Chrome Base Bartholomew Maximilian Fitzgerald-Worthington #19 Baseball",
        "pending": "Topps Chrome Base Doc Gooden #17 New York Mets Baseball",
        "resolved": "2024 Topps Chrome Dwight Gooden & Darryl Strawberry #16 /99 RC New York Mets",
        "underInsert": "2024 Topps Chrome Future Stars Insert Dwight Gooden #FS-1 AUTO Baseball",
        "underParallel": "2024 Topps Chrome Future Stars Gold Refractor Darryl Strawberry #FS-2 Baseball",
        "variation": "Topps Chrome Base Dwight Gooden #16 Image Variation Baseball",
      }
    `);
  });

  test("a card born through the commit chunk stores the title Regenerate offers", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const result = await t.mutation(internal.selectorOptions.commitCardChecklistChunk, {
      selectorOptionId: s.base,
      sportValue: "Baseball",
      setNameValue: "Topps Chrome",
      ...(await chunkFacts(t, s.base, s.sport)),
      cards: [
        {
          cardNumber: "20",
          cardName: "Card 20",
          playerIds: [s.gooden],
          teamOnCardIds: [s.mets],
          platformData: {},
          sortOrder: 20,
          playerNames: ["Dwight Gooden"],
          teamNames: ["New York Mets"],
        },
      ],
    });
    const cardId = result.storedIds[0];
    const stored = await t.run(async (ctx) => (await ctx.db.get(cardId))!);
    const preview = await t
      .withIdentity(ADMIN)
      .query(api.selectorOptions.previewListingTitle, { cardId });
    expect(stored.listingTitle).toBe(preview.title);
  });
});

/**
 * NEO-527 — a set committed while it sat in the year's Unknown row, then
 * re-homed under its brand by `backfillKnownBrands`. The title the card
 * stored at commit is the title Regenerate offers after the move: the brand
 * is dropped while unidentified (NEO-272) and collapsed into a set name that
 * already leads with it once identified, so the move never yields "Unknown
 * Topps Chrome" or "Topps Topps Chrome".
 */
describe("a stored title survives the set's move out of Unknown (NEO-527)", () => {
  beforeEach(() => {
    vi.stubEnv(PAUSED_PLATFORMS_ENV, "sportlots");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test("titleForStoredCard after the re-home equals the listingTitle stored under Unknown", async () => {
    const t = convexTest(schema, modules);
    const { sportId, yearId } = await t.run(async (ctx) => {
      const sportId = await ctx.db.insert("selectorOptions", {
        level: "sport",
        value: "Football",
        sportConfig: { skuCode: "FB", league: "NFL" },
        platformData: {},
        children: [],
        lastUpdated: NOW,
      });
      const yearId = await ctx.db.insert("selectorOptions", {
        level: "year",
        value: "2026",
        features: { season: "2026" },
        platformData: {},
        parentId: sportId,
        children: [],
        lastUpdated: NOW,
      });
      return { sportId, yearId };
    });
    // The real flagged row, minted the way the paused set sync mints it.
    const { id: unknownId } = await t.mutation(
      internal.selectorOptions.ensureBrandUnknownRow,
      { yearId },
    );
    // "Topps Chrome" and its Base, each copying its parent's features down
    // as creation does, so whatever the Unknown row carries reaches the card.
    const { setId, baseId } = await t.run(async (ctx) => {
      const child = async (
        level: "setName" | "variantType",
        value: string,
        parentId: Id<"selectorOptions">,
      ) => {
        const parent = (await ctx.db.get(parentId))!;
        const id = await ctx.db.insert("selectorOptions", {
          level,
          value,
          ...(parent.features ? { features: { ...parent.features } } : {}),
          platformData: {},
          parentId,
          children: [],
          lastUpdated: NOW,
        });
        await ctx.db.patch(parentId, { children: [...parent.children, id] });
        return id;
      };
      const setId = await child("setName", "Topps Chrome", unknownId);
      const baseId = await child("variantType", "Base", setId);
      return { setId, baseId };
    });

    // Committed while the set still sat under Unknown. SportLots-only, so no
    // BSC team lookup is queued.
    await t.withIdentity(ADMIN).action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: baseId,
      sportId,
      cards: [
        {
          cardNumber: "1",
          cardName: "Card 1",
          teams: [],
          players: [],
          platformData: { sportlots: { ref: "SL-1" } },
        },
      ],
    });
    await drainScheduled(t);
    await cancelScheduled(t);
    const stored = await t.run(async (ctx) =>
      ctx.db
        .query("cardChecklist")
        .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", baseId))
        .first(),
    );
    const storedTitle = stored!.listingTitle!;
    expect(storedTitle).toContain("Topps Chrome");

    // The NEO-527 prod fix: mint Topps from the known list and re-home.
    vi.stubEnv("ALLOW_SELECTOR_BACKFILL", "1");
    const report = await t.mutation(internal.backfillKnownBrands.run, {
      confirm: "BACKFILL",
    });
    expect(report.counts.moved).toBe(1);
    const set = await t.run(async (ctx) => ctx.db.get(setId));
    const brand = await t.run(async (ctx) => ctx.db.get(set!.parentId!));
    expect(brand?.value).toBe("Topps");
    expect(brand?.metadata?.isBrandUnknown).toBeUndefined();

    const regenerated = await t.run(async (ctx) =>
      titleForStoredCard(ctx, (await ctx.db.get(stored!._id))!),
    );
    expect(regenerated.title).toBe(storedTitle);
    expect(regenerated.title).not.toMatch(/Unknown/i);
    expect(regenerated.title).not.toMatch(/Topps Topps/i);
  });
});

/**
 * NEO-528 + NEO-535 — cameos (`secondaryPlayerIds`) in the stored-card title.
 * A card born with a cameo stores the title its insert path generated; the
 * stored-card path must read the cameo back and give the same title.
 */
describe("cameos in titleForStoredCard and previewListingTitle", () => {
  beforeEach(() => {
    vi.stubEnv(PAUSED_PLATFORMS_ENV, "sportlots");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test("a card born with a default cameo: the stored-card path gives the title the insert path stored", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const strawberry = await t.run(async (ctx) => {
      const found = await ctx.db
        .query("players")
        .filter((q) => q.eq(q.field("name"), "Darryl Strawberry"))
        .first();
      await ctx.db.patch(s.base, { defaultCameoIds: [found!._id] });
      return found!._id;
    });
    const cardId = await t
      .withIdentity(ADMIN)
      .mutation(api.selectorOptions.addCustomCard, {
        selectorOptionId: s.base,
        cardNumber: "40",
        cardName: "Card 40",
        playerIds: [s.gooden],
      });
    await cancelScheduled(t);
    const card = await t.run(async (ctx) => (await ctx.db.get(cardId))!);
    expect(card.secondaryPlayerIds).toEqual([strawberry]);
    expect(card.listingTitle).toContain("Dwight Gooden & Darryl Strawberry");

    const stored = await t.run(async (ctx) => titleForStoredCard(ctx, card));
    const preview = await t
      .withIdentity(ADMIN)
      .query(api.selectorOptions.previewListingTitle, { cardId });
    expect(stored.title).toBe(card.listingTitle);
    expect(preview.title).toBe(card.listingTitle);
    expect(preview.inputs.cameoNames).toEqual(["Darryl Strawberry"]);
  });

  test("a dangling cameo id is counted unresolved and the title is not rewritten", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const { goner, withGoner } = await t.run(async (ctx) => {
      const sport = (await ctx.db.get(s.base))!;
      void sport;
      const goner = await ctx.db.insert("players", {
        name: "Gone Cameo",
        nameNormalized: normalizeEntityName("Gone Cameo"),
        sportId: s.sport,
        lastUpdated: NOW,
      });
      await ctx.db.delete(goner);
      const withGoner = await insertTestCard(ctx, {
        selectorOptionId: s.base,
        cardNumber: "41",
        cardName: "Card 41",
        platformData: {},
        sortOrder: 0,
        lastUpdated: NOW,
        playerIds: [s.gooden],
        secondaryPlayerIds: [goner],
        listingTitle: "Kept As Typed",
      });
      return { goner, withGoner };
    });
    expect(goner).toBeTruthy();
    const read = await t.run(async (ctx) => {
      const card = (await ctx.db.get(withGoner))!;
      return listingInputsForStoredCard(ctx, card, newStoredCardReadCache());
    });
    expect(read.unresolved).toMatchObject({ cameos: 1, players: 0, teams: 0, parent: false });
    // The dangling id names nobody: the card's own player is all the title says.
    expect(read.inputs.cameoNames).toBeUndefined();
  });

  test("a cameo equal to the card's own player is said once", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const id = await t.run(async (ctx) =>
      insertTestCard(ctx, {
        selectorOptionId: s.base,
        cardNumber: "42",
        cardName: "Card 42",
        platformData: {},
        sortOrder: 0,
        lastUpdated: NOW,
        playerIds: [s.gooden],
        secondaryPlayerIds: [s.gooden],
        features: { season: "2024" },
      }),
    );
    const read = await t.run(async (ctx) =>
      listingInputsForStoredCard(ctx, (await ctx.db.get(id))!, newStoredCardReadCache()),
    );
    const stored = await t.run(async (ctx) => titleForStoredCard(ctx, (await ctx.db.get(id))!));
    expect((stored.title.match(/Dwight Gooden/g) ?? []).length).toBe(1);
    expect(stored.title).not.toContain("&");
    expect(read.unresolved.cameos).toBe(0);
  });
});

/**
 * NEO-606 — a team whose row is split (Location "New York", Name "Mets") gives
 * its location up before the team goes. Every path that titles a card reads the
 * split off the team row: Regenerate and the stored title (here), the card the
 * commit chunk inserts (its own team, or the set's team it is born with), and
 * the hand-added card. They all give the title they would give the Regenerate
 * button.
 */
describe("a split team gives up its location before it goes (NEO-606)", () => {
  // "Topps Chrome <name> #21" is 17 + the name; the whole team is 14 more
  // characters ("Topps Chrome" has no year here), the nickname 5.
  const LONG_NAME = "Q".repeat(52);

  async function seedLong(t: T) {
    const s = await seed(t);
    const long = await t.run(async (ctx) => {
      const sport = (await ctx.db.get(s.base))!;
      void sport;
      const sportId = (await ctx.db.get(s.mets))!.sportId;
      return ctx.db.insert("players", {
        name: LONG_NAME,
        nameNormalized: normalizeEntityName(LONG_NAME),
        sportId,
        lastUpdated: NOW,
      });
    });
    return { ...s, long };
  }

  test("the stored title and Regenerate say 'Mets', and carry the split", async () => {
    const t = convexTest(schema, modules);
    const s = await seedLong(t);
    const cardId = await t.run(async (ctx) =>
      insertTestCard(ctx, {
        selectorOptionId: s.base,
        cardNumber: "21",
        cardName: "Card 21",
        platformData: {},
        sortOrder: 0,
        lastUpdated: NOW,
        playerIds: [s.long],
        teamOnCardIds: [s.mets],
      }),
    );
    const stored = await t.run(async (ctx) => titleForStoredCard(ctx, (await ctx.db.get(cardId))!));
    // The Base word fits back in once the city is gone (row 1, then row 11, then the refill).
    expect(stored.title).toBe(`Topps Chrome Base ${LONG_NAME} #21 Mets`);
    expect(stored.dropped).toEqual([]);
    expect(stored.inputs.teamNames).toEqual(["New York Mets"]);
    expect(stored.inputs.teamSplits).toEqual([{ location: "New York", name: "Mets" }]);
    const preview = await t
      .withIdentity(ADMIN)
      .query(api.selectorOptions.previewListingTitle, { cardId });
    expect(preview.title).toBe(stored.title);
    expect(preview.inputs.teamSplits).toEqual([{ location: "New York", name: "Mets" }]);
  });

  test("a team typed by name (no row) has no split and is dropped whole", async () => {
    const t = convexTest(schema, modules);
    const s = await seedLong(t);
    const cardId = await t.run(async (ctx) =>
      insertTestCard(ctx, {
        selectorOptionId: s.base,
        cardNumber: "21",
        cardName: "Card 21",
        platformData: {},
        sortOrder: 0,
        lastUpdated: NOW,
        playerIds: [s.long],
        pendingTeamNames: ["New York Mets"],
      }),
    );
    const stored = await t.run(async (ctx) => titleForStoredCard(ctx, (await ctx.db.get(cardId))!));
    // Dropped whole; the sport the team's room had cost comes back in its place.
    expect(stored.title).toBe(`Topps Chrome ${LONG_NAME} #21 Baseball`);
    expect(stored.dropped).toEqual(["New York Mets"]);
    expect(stored.inputs.teamSplits).toBeUndefined();
  });

  test("a team row with no location is dropped whole", async () => {
    const t = convexTest(schema, modules);
    const s = await seedLong(t);
    const cardId = await t.run(async (ctx) => {
      await ctx.db.patch(s.mets, { location: undefined, name: "New York Mets" });
      return insertTestCard(ctx, {
        selectorOptionId: s.base,
        cardNumber: "21",
        cardName: "Card 21",
        platformData: {},
        sortOrder: 0,
        lastUpdated: NOW,
        playerIds: [s.long],
        teamOnCardIds: [s.mets],
      });
    });
    const stored = await t.run(async (ctx) => titleForStoredCard(ctx, (await ctx.db.get(cardId))!));
    expect(stored.title).toBe(`Topps Chrome ${LONG_NAME} #21 Baseball`);
    expect(stored.dropped).toEqual(["New York Mets"]);
    expect(stored.inputs.teamSplits).toBeUndefined();
  });

  test("a card the commit chunk inserts with its own team stores what Regenerate offers", async () => {
    const t = convexTest(schema, modules);
    const s = await seedLong(t);
    const result = await t.mutation(internal.selectorOptions.commitCardChecklistChunk, {
      selectorOptionId: s.base,
      sportValue: "Baseball",
      setNameValue: "Topps Chrome",
      ...(await chunkFacts(t, s.base, s.sport)),
      cards: [
        {
          cardNumber: "21",
          cardName: "Card 21",
          playerIds: [s.long],
          teamOnCardIds: [s.mets],
          platformData: {},
          sortOrder: 21,
          playerNames: [LONG_NAME],
          teamNames: ["New York Mets"],
        },
      ],
    });
    const cardId = result.storedIds[0];
    const stored = await t.run(async (ctx) => (await ctx.db.get(cardId))!);
    expect(stored.listingTitle).toBe(`Topps Chrome Base ${LONG_NAME} #21 Mets`);
    const preview = await t
      .withIdentity(ADMIN)
      .query(api.selectorOptions.previewListingTitle, { cardId });
    expect(stored.listingTitle).toBe(preview.title);
  });

  test("a card born with the set's team (no team of its own) is shortened the same way", async () => {
    const t = convexTest(schema, modules);
    const s = await seedLong(t);
    await t.run(async (ctx) => ctx.db.patch(s.base, { teamIds: [s.mets] }));
    const result = await t.mutation(internal.selectorOptions.commitCardChecklistChunk, {
      selectorOptionId: s.base,
      sportValue: "Baseball",
      setNameValue: "Topps Chrome",
      ...(await chunkFacts(t, s.base, s.sport)),
      cards: [
        {
          cardNumber: "21",
          cardName: "Card 21",
          playerIds: [s.long],
          platformData: {},
          sortOrder: 21,
          playerNames: [LONG_NAME],
          teamNames: [],
        },
      ],
    });
    const cardId = result.storedIds[0];
    const stored = await t.run(async (ctx) => (await ctx.db.get(cardId))!);
    expect(stored.teamOnCardIds).toEqual([s.mets]);
    expect(stored.listingTitle).toBe(`Topps Chrome Base ${LONG_NAME} #21 Mets`);
    const preview = await t
      .withIdentity(ADMIN)
      .query(api.selectorOptions.previewListingTitle, { cardId });
    expect(stored.listingTitle).toBe(preview.title);
  });

  test("a hand-added card with a picked team is shortened the same way", async () => {
    const t = convexTest(schema, modules);
    const s = await seedLong(t);
    const cardId = await t.withIdentity(ADMIN).mutation(api.selectorOptions.addCustomCard, {
      selectorOptionId: s.base,
      cardNumber: "21",
      cardName: "Card 21",
      playerIds: [s.long],
      teamOnCardIds: [s.mets],
    });
    const stored = await t.run(async (ctx) => (await ctx.db.get(cardId))!);
    // A hand-added card carries the set's year; the team is the nickname.
    expect(stored.listingTitle).toBe(`2024 Topps Chrome ${LONG_NAME} #21 Mets`);
    const preview = await t
      .withIdentity(ADMIN)
      .query(api.selectorOptions.previewListingTitle, { cardId });
    expect(stored.listingTitle).toBe(preview.title);
  });
});

/**
 * NEO-609 — a variant type that is not "Insert": the type's own row title is
 * the word the title and the description use, singular. The preview
 * (Regenerate), the stored-card path and the commit chunk (handed the
 * prelude's facts by key) must name the very same levels.
 */
describe("a Proof chain: type names from the rows, one title everywhere (NEO-609)", () => {
  const LEVEL = "Animated Autographs Pre-Production Proofs Lazer Red";

  async function seedProof(t: T) {
    return t.run(async (ctx) => {
      const row = (
        level: Doc<"selectorOptions">["level"],
        value: string,
        parentId?: Id<"selectorOptions">,
        features?: Record<string, string>,
      ) =>
        ctx.db.insert("selectorOptions", {
          level,
          value,
          ...(parentId ? { parentId } : {}),
          ...(features ? { features } : {}),
          platformData: {},
          children: [],
          lastUpdated: NOW,
        });
      const sport = await row("sport", "Baseball");
      const year = await row("year", "2026", sport);
      const brand = await row("manufacturer", "Leaf", year, { season: "2026", manufacturer: "Leaf" });
      const set = await row("setName", "Vivid", brand, { season: "2026", manufacturer: "Leaf" });
      const proofType = await row("variantType", "Proof", set, { season: "2026", manufacturer: "Leaf" });
      const proof = await row("insert", LEVEL, proofType, { season: "2026", manufacturer: "Leaf" });
      const leagueId = await ctx.db.insert("leagues", {
        level: "college",
        name: "NCAA",
        nameNormalized: "ncaa",
        sportId: sport,
        lastUpdated: NOW,
      });
      const sunDevils = await ctx.db.insert("teams", {
        name: "Sun Devils baseball",
        location: "Arizona State",
        nameNormalized: normalizeEntityName("Arizona State Sun Devils baseball"),
        sportId: sport,
        leagueId,
        lastUpdated: NOW,
      });
      const carlon = await ctx.db.insert("players", {
        name: "Cole Carlon",
        nameNormalized: normalizeEntityName("Cole Carlon"),
        sportId: sport,
        lastUpdated: NOW,
      });
      return { sport, proof, sunDevils, carlon };
    });
  }

  const WORKED = "2026 Leaf Vivid Animated Autographs Pre-Production Proofs Lazer Red Carlon /1";

  test("the stored card, Regenerate and the chunk-born card all say the worked example", async () => {
    const t = convexTest(schema, modules);
    const s = await seedProof(t);
    const stored = await t.run(async (ctx) =>
      insertTestCard(ctx, {
        selectorOptionId: s.proof,
        cardNumber: "NNO",
        cardName: "Cole Carlon",
        platformData: {},
        sortOrder: 0,
        lastUpdated: NOW,
        playerIds: [s.carlon],
        teamOnCardIds: [s.sunDevils],
        printRun: 1,
        features: { season: "2026", manufacturer: "Leaf" },
      }),
    );
    const viaStored = await t.run(async (ctx) => titleForStoredCard(ctx, (await ctx.db.get(stored))!));
    expect(viaStored.title).toBe(WORKED);
    expect(viaStored.inputs.titleLevels).toEqual([{ name: LEVEL, typeName: "Proof" }]);
    expect(viaStored.dropped).toEqual(["Arizona State Sun Devils baseball", "#NNO", "Cole"]);
    const preview = await t
      .withIdentity(ADMIN)
      .query(api.selectorOptions.previewListingTitle, { cardId: stored });
    expect(preview.title).toBe(WORKED);
    expect(preview.inputs.titleLevels).toEqual([{ name: LEVEL, typeName: "Proof" }]);

    const result = await t.mutation(internal.selectorOptions.commitCardChecklistChunk, {
      selectorOptionId: s.proof,
      sportValue: "Baseball",
      setNameValue: "Vivid",
      // The year and maker reach a title through the leaf's features.
      inheritedFeatures: { season: "2026", manufacturer: "Leaf" },
      ...(await chunkFacts(t, s.proof, s.sport)),
      cards: [
        {
          cardNumber: "NNO2",
          cardName: "Cole Carlon",
          playerIds: [s.carlon],
          teamOnCardIds: [s.sunDevils],
          platformData: {},
          sortOrder: 2,
          printRun: 1,
          playerNames: ["Cole Carlon"],
          teamNames: ["Arizona State Sun Devils baseball"],
        },
      ],
    });
    const born = await t.run(async (ctx) => (await ctx.db.get(result.storedIds[0]))!);
    const regenerated = await t
      .withIdentity(ADMIN)
      .query(api.selectorOptions.previewListingTitle, { cardId: born._id });
    // Same chain, so the same words; only the number differs ("NNO2" is cut too).
    expect(born.listingTitle).toBe(regenerated.title);
    expect(born.listingTitle).toBe(WORKED);
    expect(born.listingTitleTruncated).toBe(true);
    expect(born.listingDescription).toContain(`Proof: ${LEVEL}.`);
  });
});
