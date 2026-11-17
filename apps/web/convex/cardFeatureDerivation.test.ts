/**
 * NEO-71-74: integration test that `addCustomCard` inherits the complete,
 * self-contained `features` snapshot already resolved on the selectorOption
 * node it's added under — write-once feature snapshots, computed via
 * copy-down at each node's own creation (see
 * convex/features/deriveCardFeatures.ts's `deriveOwnLevelFeatures` and the
 * copy-down wiring in `storeSelectorOptions`/`addCustomSelectorOption`/
 * `storeReconciledOptions`). No ancestor-chain walk happens at card-creation
 * time anymore — `addCustomCard` reads a single node.
 *
 * These tests build the chain via the REAL creation mutation
 * (`addCustomSelectorOption`), in strict parent→child order, so each level's
 * auto-derivation and any operator overrides (via `setSelectorOptionFeature`,
 * applied BEFORE the next child is created) flow forward through copy-down —
 * exercising the real pipeline end-to-end rather than hand-injecting a
 * `features` shape production code could never produce.
 */

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN_IDENTITY = {
  subject: "admin_user_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_user_001",
  name: "Admin User",
  role: "admin",
};

describe("addCustomCard inherits the write-once feature snapshot (NEO-71-74)", () => {
  test("new custom card inherits node-level features + observed features", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);

    const sportId = await asAdmin.mutation(
      api.selectorOptions.addCustomSelectorOption,
      { level: "sport", value: "Baseball" },
    );
    // NEO-569: a new set LINKS its sport's major league when the row exists
    // (it never creates one), so the fixture has it.
    const mlbId = await t.run((ctx) =>
      ctx.db.insert("leagues", {
        name: "Major League Baseball",
        nameNormalized: "major league baseball",
        sportId,
        level: "major",
        lastUpdated: 1_700_000_000_000,
      }),
    );
    const yearId = await asAdmin.mutation(
      api.selectorOptions.addCustomSelectorOption,
      { level: "year", value: "2024", parentId: sportId },
    );
    // auto: own era="Modern (1980-Now)", vintage="false"

    const mfrId = await asAdmin.mutation(
      api.selectorOptions.addCustomSelectorOption,
      { level: "manufacturer", value: "Topps", parentId: yearId },
    );
    // auto: copies era/vintage down + own manufacturer="Topps"

    const setNameId = await asAdmin.mutation(
      api.selectorOptions.addCustomSelectorOption,
      { level: "setName", value: "Topps Chrome", parentId: mfrId },
    );
    // auto: copies everything above down + own isReprint="false"

    const variantTypeId = await asAdmin.mutation(
      api.selectorOptions.addCustomSelectorOption,
      { level: "variantType", value: "Base", parentId: setNameId },
    );
    // auto: copies everything above down + own cardType="Base"

    await asAdmin.mutation(api.selectorOptions.addCustomCard, {
      selectorOptionId: variantTypeId,
      cardNumber: "1",
      cardName: "Aaron Judge",
      attributes: ["RC"],
    });

    const cards = await asAdmin.query(api.selectorOptions.getCardChecklist, {
      selectorOptionId: variantTypeId,
    });
    expect(cards).toHaveLength(1);
    const f = cards[0].features ?? {};

    // NEO-569: no free-text League; the card carries its set's league id
    // instead (the set was born linked to the sport's major league, and a
    // teamless card in a one-league set takes it). Read back through getCardChecklist,
    // whose strict return validator must admit the field.
    expect(f).not.toHaveProperty("league");
    const setLeagueIds = await t.run(async (ctx) => (await ctx.db.get(setNameId))?.leagueIds);
    expect(setLeagueIds).toEqual([mlbId]);
    expect(cards[0].leagueId).toBe(mlbId);
    // Copied down from the leaf node's complete, self-contained snapshot.
    expect(f.era).toBe("Modern (1980-Now)");
    expect(f.vintage).toBe("false");
    expect(f.manufacturer).toBe("Topps");
    expect(f.cardType).toBe("Base");
    // autographed defaults to "None" at setName creation (like isReprint),
    // and copies down through variantType to the card the same way.
    expect(f.autographed).toBe("None");
    // cardSize/cardMaterial/cardThickness/language/countryOfOrigin default
    // the same way at setName creation and copy down identically.
    expect(f.cardSize).toBe("Standard");
    expect(f.cardMaterial).toBe("Card Stock");
    expect(f.cardThickness).toBe("20pt");
    expect(f.language).toBe("English");
    expect(f.countryOfOrigin).toBe("USA");
    // season defaults from the year node and copies down through
    // manufacturer/setName/variantType the same way.
    expect(f.season).toBe("2024");
    // RC attribute → observed rookie (still derived per-card, wins over
    // the inherited snapshot — deriveCardObservedFeatures is unaffected).
    expect(f.isRookie).toBe("true");
  });

  test("operator-set ancestor feature is inherited by a new custom card", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);

    const sportId = await asAdmin.mutation(
      api.selectorOptions.addCustomSelectorOption,
      { level: "sport", value: "Baseball" },
    );
    const setNameId = await asAdmin.mutation(
      api.selectorOptions.addCustomSelectorOption,
      { level: "setName", value: "BBM", parentId: sportId },
    );
    // auto: own isReprint="false"

    // Operator overrides a key at the setName level
    // BEFORE the variantType child is created, so copy-down carries the
    // override forward — this is the single-row edit (NEO-71-74), applied
    // ahead of the next node's creation, not a cascade after the fact.
    await asAdmin.mutation(api.selectorOptions.setSelectorOptionFeature, {
      selectorOptionId: setNameId,
      key: "subsetLabel",
      value: "NPB",
    });

    const variantTypeId = await asAdmin.mutation(
      api.selectorOptions.addCustomSelectorOption,
      { level: "variantType", value: "Base", parentId: setNameId },
    );
    // auto: copies the OVERRIDDEN subsetLabel="NPB" down (copy-down reads the
    // parent's current features at creation time, override included) + own
    // cardType="Base"

    await asAdmin.mutation(api.selectorOptions.addCustomCard, {
      selectorOptionId: variantTypeId,
      cardNumber: "1",
      cardName: "Player",
    });

    const cards = await asAdmin.query(api.selectorOptions.getCardChecklist, {
      selectorOptionId: variantTypeId,
    });
    // The operator override reached the card purely via creation-time
    // copy-down — no cascade involved.
    expect((cards[0].features ?? {}).subsetLabel).toBe("NPB");
  });
});

// ===========================================================================
// NEO-24/71-74 — addCustomCard write-once listingTitle/listingDescription
// ===========================================================================
//
// `generateListingTitle`/`generateListingDescription` (convex/features/
// generateListing.ts) already have full unit coverage in
// generateListing.test.ts for their own string-composition logic. These
// tests instead prove the WIRING into `addCustomCard`: a freshly-added
// custom card gets non-empty, data-reflecting listingTitle/listingDescription
// generated from whatever the node's resolved features + the card's own
// pendingPlayerNames/attributes/cardNumber already establish — using
// `pendingPlayerNames` as display names since a custom card's players
// aren't resolved to real player rows yet at add-time.
describe("addCustomCard generates listingTitle/listingDescription (NEO-24/71-74)", () => {
  test("a freshly added custom card gets a non-empty listingTitle/listingDescription reflecting its data", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);

    const sportId = await asAdmin.mutation(
      api.selectorOptions.addCustomSelectorOption,
      { level: "sport", value: "Baseball" },
    );
    const yearId = await asAdmin.mutation(
      api.selectorOptions.addCustomSelectorOption,
      { level: "year", value: "2024", parentId: sportId },
    );
    const mfrId = await asAdmin.mutation(
      api.selectorOptions.addCustomSelectorOption,
      { level: "manufacturer", value: "Topps", parentId: yearId },
    );
    const setNameId = await asAdmin.mutation(
      api.selectorOptions.addCustomSelectorOption,
      { level: "setName", value: "Chrome", parentId: mfrId },
    );
    const variantTypeId = await asAdmin.mutation(
      api.selectorOptions.addCustomSelectorOption,
      { level: "variantType", value: "Base", parentId: setNameId },
    );

    await asAdmin.mutation(api.selectorOptions.addCustomCard, {
      selectorOptionId: variantTypeId,
      cardNumber: "50",
      cardName: "Elly De La Cruz",
      attributes: ["RC"],
      // Not yet resolved to a real players-table id — addCustomCard uses
      // this pending name directly for display purposes.
      players: ["Elly De La Cruz"],
    });

    const cards = await asAdmin.query(api.selectorOptions.getCardChecklist, {
      selectorOptionId: variantTypeId,
    });
    expect(cards).toHaveLength(1);
    const card = cards[0];

    expect(card.listingTitle).toBeTruthy();
    expect(card.listingTitle).toContain("2024");
    expect(card.listingTitle).toContain("Topps");
    expect(card.listingTitle).toContain("Chrome");
    expect(card.listingTitle).toContain("Elly De La Cruz");
    expect(card.listingTitle).toContain("#50");
    expect(card.listingTitle).toContain("RC");

    expect(card.listingDescription).toBeTruthy();
    expect(card.listingDescription).toContain("Elly De La Cruz");
    expect(card.listingDescription).toContain("#50");
    expect(card.listingDescription).toContain("Rookie Card");
  });

  // NEO-101 — the packed title, on the hand-add path. A custom card has no
  // `teamOnCardIds` yet: the team the operator typed sits in
  // `pendingTeamNames` until a sync resolves it, and that pending name is
  // already treated as an answer everywhere else (see `deriveCardAttention`),
  // so it is what the title says. The sport comes from the ancestor walk that
  // also resolves the set name — one pass, not two.
  test("a custom card's typed team and its sport reach the generated title", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);

    const sportId = await asAdmin.mutation(
      api.selectorOptions.addCustomSelectorOption,
      { level: "sport", value: "Baseball" },
    );
    const yearId = await asAdmin.mutation(
      api.selectorOptions.addCustomSelectorOption,
      { level: "year", value: "2024", parentId: sportId },
    );
    const mfrId = await asAdmin.mutation(
      api.selectorOptions.addCustomSelectorOption,
      { level: "manufacturer", value: "Topps", parentId: yearId },
    );
    const setNameId = await asAdmin.mutation(
      api.selectorOptions.addCustomSelectorOption,
      { level: "setName", value: "Chrome", parentId: mfrId },
    );
    const variantTypeId = await asAdmin.mutation(
      api.selectorOptions.addCustomSelectorOption,
      { level: "variantType", value: "Base", parentId: setNameId },
    );

    await asAdmin.mutation(api.selectorOptions.addCustomCard, {
      selectorOptionId: variantTypeId,
      cardNumber: "12",
      cardName: "Julio Rodriguez",
      attributes: ["RC"],
      players: ["Julio Rodriguez"],
      teams: ["Seattle Mariners"],
    });

    const cards = await asAdmin.query(api.selectorOptions.getCardChecklist, {
      selectorOptionId: variantTypeId,
    });
    const card = cards[0];

    expect(card.listingTitle).toBe(
      "2024 Topps Chrome Julio Rodriguez #12 RC Seattle Mariners Rookie Baseball",
    );
    // Sold listings average 70 characters; NB's used to average 34.
    expect(card.listingTitle!.length).toBeGreaterThanOrEqual(60);
    expect(card.listingTitle!.length).toBeLessThanOrEqual(80);
    expect(card.listingDescription).toContain("Team: Seattle Mariners.");
  });
});
