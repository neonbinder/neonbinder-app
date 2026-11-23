/**
 * NEO-101 — `selectorOptions.previewListingTitle`.
 *
 * The query behind the card detail panel's **Regenerate** button and its
 * source-field chips: what the generator WOULD title this stored card today,
 * plus the inputs it used. Read-only; it stores nothing.
 *
 * The load-bearing test here is the last one. `previewListingTitle` resolves
 * its inputs by MIRRORING `commitCardChecklistChunk`'s insert branch by hand
 * (different starting point — a stored row's own `features` versus a merged
 * snapshot computed for a card that does not exist yet — so the two cannot
 * share code without inventing a parameter object shaped like the thing being
 * built). Two hand-kept copies drift, so the contract is pinned as an
 * assertion: preview a freshly committed card and the title must come back
 * byte-identical to the one the commit stored.
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { drainScheduled } from "../lib/testing/drain-scheduled";
import { MAX_CARD_PLAYERS } from "./features/cardAttention";
import type { Id } from "./_generated/dataModel";
import { insertTestCard } from "../lib/testing/card-row";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

const ADMIN_IDENTITY = {
  subject: "admin_user_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_user_001",
  name: "Admin User",
  role: "admin",
};

async function seedSubtree(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const sportId = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      sportConfig: {
        skuCode: "BB",
        league: "MLB",
        espn: { path: "baseball/mlb", leagueName: "Major League Baseball" },
        wikidata: { sportQid: "Q5369", hallOfFameQid: "Q1194380" },
      },
      platformData: {},
      children: [],
      lastUpdated: Date.now(),
    });
    const setNameId = await ctx.db.insert("selectorOptions", {
      level: "setName",
      value: "Chrome",
      platformData: {},
      features: { manufacturer: "Topps", season: "2024" },
      parentId: sportId,
      children: [],
      lastUpdated: Date.now(),
    });
    await ctx.db.patch(sportId, { children: [setNameId] });
    const variantTypeId = await ctx.db.insert("selectorOptions", {
      level: "variantType",
      value: "Base",
      platformData: {},
      features: { manufacturer: "Topps", season: "2024" },
      parentId: setNameId,
      children: [],
      lastUpdated: Date.now(),
    });
    await ctx.db.patch(setNameId, { children: [variantTypeId] });
    return { sportId, setNameId, variantTypeId };
  });
}

async function insertCard(
  t: ReturnType<typeof convexTest>,
  variantTypeId: Id<"selectorOptions">,
  card: Record<string, unknown>,
): Promise<Id<"cardChecklist">> {
  return t.run(async (ctx) =>
    insertTestCard(ctx, {
      selectorOptionId: variantTypeId,
      cardNumber: "50",
      cardName: "A Card",
      platformData: {},
      sortOrder: 0,
      lastUpdated: Date.now(),
      ...card,
    } as never),
  );
}

describe("previewListingTitle (NEO-101)", () => {
  // NEO-247: "reproduces EXACTLY what commitCardChecklist's insert branch
  // stored" (below) commits a card carrying a bsc ref with no resolvable
  // team, which schedules processBscTeamEnrichmentQueue as a side effect.
  // Stub fetch to THROW rather than a canned 200 — same convention as
  // convex/cardChecklist.bscTeamEnrichment.test.ts's NEO-220 fix: the
  // adapter already swallows a request failure ("network unavailable" is a
  // state it handles), and it cannot write anything derived from a payload
  // this file invented. This also removes the "pulling the outbound call
  // forward" concern the drain below used to have to avoid — a thrown stub
  // has nothing sensitive to disturb no matter when it resolves.
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      (async (url: string | URL) => {
        throw new Error(
          `NEO-247: this test file must not reach the network: ${String(url)}`,
        );
      }) as unknown as typeof fetch,
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("resolves player names, the set-name ancestor, and the row's own flags", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { sportId, variantTypeId } = await seedSubtree(t);

    const playerId = await t.run(async (ctx) =>
      ctx.db.insert("players", {
        name: "Elly De La Cruz",
        nameNormalized: "cruz elly de la",
        sportId,
        lastUpdated: Date.now(),
      }),
    );
    const cardId = await insertCard(t, variantTypeId, {
      cardNumber: "50",
      playerIds: [playerId],
      isRookie: true,
      features: { season: "2024", manufacturer: "Topps", parallelName: "Base" },
    });

    const preview = await asAdmin.query(api.selectorOptions.previewListingTitle, {
      cardId,
    });

    // NEO-101: the sport ancestor and the second "Rookie" spelling are part
    // of the packed title now, and both are resolved by THIS query.
    expect(preview.title).toBe(
      "2024 Topps Chrome Base Elly De La Cruz #50 RC Rookie Baseball",
    );
    expect(preview.coreFits).toBe(true);
    expect(preview.tidyUp).toBe(false);
    expect(preview.dropped).toEqual([]);
    // The chips the panel renders come straight off this.
    expect(preview.inputs).toMatchObject({
      cardNumber: "50",
      playerNames: ["Elly De La Cruz"],
      year: "2024",
      manufacturer: "Topps",
      setName: "Chrome",
      parallelName: "Base",
      isRookie: true,
      teamNames: [],
      sport: "Baseball",
    });
  });

  // NEO-645 — `inputs.subjectName` rides the returns validator; a validator
  // that lacks it throws ReturnsValidationError (convex-test enforces returns).
  test("NEO-645: a non-player card with a cameo returns subjectName; a card with no player and no cameo, or a player card, omits it", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { sportId, variantTypeId } = await seedSubtree(t);

    const [playerId, cameoId] = await t.run(async (ctx) => [
      await ctx.db.insert("players", {
        name: "Elly De La Cruz",
        nameNormalized: "cruz elly de la",
        sportId,
        lastUpdated: Date.now(),
      }),
      await ctx.db.insert("players", {
        name: "Chipper Jones",
        nameNormalized: "jones chipper",
        sportId,
        lastUpdated: Date.now(),
      }),
    ]);

    const noPlayer = await insertCard(t, variantTypeId, {
      cardNumber: "1",
      cardName: "Checklist",
    });
    const cameoOnly = await insertCard(t, variantTypeId, {
      cardNumber: "2",
      cardName: "Rookie Class",
      secondaryPlayerIds: [cameoId],
    });
    const playerCard = await insertCard(t, variantTypeId, {
      cardNumber: "3",
      cardName: "Elly De La Cruz",
      playerIds: [playerId],
      secondaryPlayerIds: [cameoId],
    });

    const none = await asAdmin.query(api.selectorOptions.previewListingTitle, {
      cardId: noPlayer,
    });
    expect(none.inputs.subjectName).toBeUndefined();

    const cameo = await asAdmin.query(api.selectorOptions.previewListingTitle, {
      cardId: cameoOnly,
    });
    expect(cameo.inputs.playerNames).toEqual([]);
    expect(cameo.inputs.cameoNames).toEqual(["Chipper Jones"]);
    expect(cameo.inputs.subjectName).toBe("Rookie Class");

    const player = await asAdmin.query(api.selectorOptions.previewListingTitle, {
      cardId: playerCard,
    });
    expect(player.inputs.subjectName).toBeUndefined();
  });

  test("NEO-609: a title that lost a first name says tidyUp, and coreFits is its inverse", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { sportId, variantTypeId } = await seedSubtree(t);
    const NAME = "Bartholomew Maximilian Alexander Christopher Fitzgerald-Worthington";
    const playerId = await t.run(async (ctx) =>
      ctx.db.insert("players", {
        name: NAME,
        nameNormalized: NAME.toLowerCase().split(" ").sort().join(" "),
        sportId,
        lastUpdated: Date.now(),
      }),
    );
    const cardId = await insertCard(t, variantTypeId, {
      cardNumber: "19",
      playerIds: [playerId],
      features: { season: "2024", manufacturer: "Topps", parallelName: "Base" },
    });
    const preview = await asAdmin.query(api.selectorOptions.previewListingTitle, { cardId });
    expect(preview.firstNameLost).toBe(true);
    expect(preview.tidyUp).toBe(true);
    expect(preview.coreFits).toBe(false);
  });

  // NEO-609 — Regenerate in the card drawer stores the previewed title through
  // `updateCard`. A title the generator itself builds for the card as it stands
  // carries the flag its assessment gives it; only a typed one clears it.
  describe("updateCard stores a Regenerate title with the generator's flag", () => {
    const LONG_NAME = "Bartholomew Maximilian Alexander Christopher Fitzgerald-Worthington";

    async function seedTidyUpCard() {
      const t = convexTest(schema, modules);
      const asAdmin = t.withIdentity(ADMIN_IDENTITY);
      const { sportId, variantTypeId } = await seedSubtree(t);
      const playerId = await t.run(async (ctx) =>
        ctx.db.insert("players", {
          name: LONG_NAME,
          nameNormalized: LONG_NAME.toLowerCase().split(" ").sort().join(" "),
          sportId,
          lastUpdated: Date.now(),
        }),
      );
      const cardId = await insertCard(t, variantTypeId, {
        cardNumber: "19",
        playerIds: [playerId],
        features: { season: "2024", manufacturer: "Topps", parallelName: "Base" },
        listingTitle: "Something an earlier build wrote",
        listingTitleTruncated: true,
      });
      return { t, asAdmin, cardId };
    }

    const flagOf = (t: ReturnType<typeof convexTest>, cardId: Id<"cardChecklist">) =>
      t.run(async (ctx) => (await ctx.db.get(cardId))?.listingTitleTruncated ?? null);

    test("the previewed title of a card still in Tidy Up keeps the flag", async () => {
      const { t, asAdmin, cardId } = await seedTidyUpCard();
      const preview = await asAdmin.query(api.selectorOptions.previewListingTitle, { cardId });
      expect(preview.tidyUp).toBe(true);
      await asAdmin.mutation(api.selectorOptions.updateCard, {
        id: cardId,
        listingTitle: preview.title,
      });
      expect(await flagOf(t, cardId)).toBe(true);
    });

    test("a previewed title that fits cleanly clears the flag", async () => {
      const { t, asAdmin, cardId } = await seedTidyUpCard();
      await t.run(async (ctx) => {
        await ctx.db.patch(cardId, { playerIds: [] });
      });
      const preview = await asAdmin.query(api.selectorOptions.previewListingTitle, { cardId });
      expect(preview.coreFits).toBe(true);
      await asAdmin.mutation(api.selectorOptions.updateCard, {
        id: cardId,
        listingTitle: preview.title,
      });
      expect(await flagOf(t, cardId)).toBeNull();
    });

    test("the Tidy Up walker's save (titleReviewed) clears the flag on a generated title still carrying a cut", async () => {
      const { t, asAdmin, cardId } = await seedTidyUpCard();
      const preview = await asAdmin.query(api.selectorOptions.previewListingTitle, { cardId });
      expect(preview.tidyUp).toBe(true);
      await asAdmin.mutation(api.selectorOptions.updateCard, {
        id: cardId,
        listingTitle: preview.title,
        titleReviewed: true,
      });
      expect(await flagOf(t, cardId)).toBeNull();
    });

    test("the walker's save of a title already stored clears the flag too", async () => {
      const { t, asAdmin, cardId } = await seedTidyUpCard();
      await asAdmin.mutation(api.selectorOptions.updateCard, {
        id: cardId,
        listingTitle: "Something an earlier build wrote",
        titleReviewed: true,
      });
      expect(await flagOf(t, cardId)).toBeNull();
    });

    test("a title the operator typed clears the flag", async () => {
      const { t, asAdmin, cardId } = await seedTidyUpCard();
      await asAdmin.mutation(api.selectorOptions.updateCard, {
        id: cardId,
        listingTitle: "2024 Topps Chrome Base #19 Fitzgerald-Worthington",
      });
      expect(await flagOf(t, cardId)).toBeNull();
    });
  });

  test("NEO-535: a stored card on a parallel leaf names the leaf, not the name its features inherited", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { setNameId } = await seedSubtree(t);
    const leafId = await t.run(async (ctx) => {
      const inserts = await ctx.db.insert("selectorOptions", {
        level: "variantType",
        value: "Inserts",
        platformData: {},
        parentId: setNameId,
        children: [],
        lastUpdated: Date.now(),
      });
      const anime = await ctx.db.insert("selectorOptions", {
        level: "insert",
        value: "Anime",
        platformData: {},
        parentId: inserts,
        children: [],
        lastUpdated: Date.now(),
      });
      const red = await ctx.db.insert("selectorOptions", {
        level: "parallel",
        value: "Anime Red Refractors",
        platformData: {},
        features: { manufacturer: "Topps", season: "2024", parallelName: "Base" },
        parentId: anime,
        children: [],
        lastUpdated: Date.now(),
      });
      await ctx.db.patch(inserts, { children: [anime] });
      await ctx.db.patch(anime, { children: [red] });
      return red;
    });
    // Committed before NEO-535: its features carry the leaf's inherited "Base".
    const cardId = await insertCard(t, leafId, {
      cardNumber: "BA-3",
      pendingPlayerNames: ["Murakami"],
      features: { season: "2024", manufacturer: "Topps", parallelName: "Base" },
    });

    const preview = await asAdmin.query(api.selectorOptions.previewListingTitle, { cardId });
    expect(preview.inputs.parallelName).toBe("Anime Red Refractors");
    // The insert's word is said once (the parallel's leading "Anime").
    expect(preview.title.startsWith("2024 Topps Chrome Anime Red Refractors Parallel Murakami")).toBe(true);
  });

  test("falls back to pendingPlayerNames when a custom card has no resolved players", async () => {
    // A hand-added card carries the names the operator TYPED until the next
    // sync reconciles them into `players` rows. Those are the operator's
    // answer, so the preview uses them — exactly as `addCustomCard` does when
    // it generates the title in the first place.
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { variantTypeId } = await seedSubtree(t);

    const cardId = await insertCard(t, variantTypeId, {
      cardNumber: "7",
      isCustom: true,
      pendingPlayerNames: ["Nobody In The Players Table"],
      features: { season: "2024", manufacturer: "Topps" },
    });

    const preview = await asAdmin.query(api.selectorOptions.previewListingTitle, {
      cardId,
    });
    expect(preview.inputs.playerNames).toEqual(["Nobody In The Players Table"]);
    expect(preview.title).toBe(
      "2024 Topps Chrome Base Nobody In The Players Table #7 Baseball",
    );
  });

  test("carries printRun, cardVariation and the feature flags into the title", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { variantTypeId } = await seedSubtree(t);

    const cardId = await insertCard(t, variantTypeId, {
      cardNumber: "300b",
      printRun: 25,
      cardVariation: "Image Variation",
      isRelic: true,
      features: {
        season: "2024",
        manufacturer: "Topps",
        parallelName: "Gold",
        autographed: "On Card",
        shortPrint: "SP",
      },
    });

    const preview = await asAdmin.query(api.selectorOptions.previewListingTitle, {
      cardId,
    });
    // NEO-535: the parallel ("Gold") is part of the description, before the
    // number; the tail keeps its order.
    expect(preview.title).toBe(
      "2024 Topps Chrome Base Gold #300b AUTO RELIC /25 Image Variation SP Baseball",
    );
    expect(preview.inputs.printRun).toBe(25);
    expect(preview.inputs.cardVariation).toBe("Image Variation");
  });

  test("reports fits: false, coreFits: false and what was left out when the row cannot fit", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { sportId, variantTypeId } = await seedSubtree(t);

    const hugeName =
      "An Absurdly Long Player Full Name That Alone Exceeds The Entire Title Budget";
    const playerId = await t.run(async (ctx) =>
      ctx.db.insert("players", {
        name: hugeName,
        nameNormalized: hugeName.toLowerCase(),
        sportId,
        lastUpdated: Date.now(),
      }),
    );
    const cardId = await insertCard(t, variantTypeId, {
      cardNumber: "99999",
      playerIds: [playerId],
      isRookie: true,
      features: { season: "2024", manufacturer: "Topps", autographed: "On Card" },
    });

    const preview = await asAdmin.query(api.selectorOptions.previewListingTitle, {
      cardId,
    });
    // NEO-535, end to end: every cut is made (number, first name, RC, AUTO),
    // the surname part is never cut, and the title STOPs over the cap.
    expect(preview.coreFits).toBe(false);
    expect(preview.fits).toBe(false);
    expect(preview.firstNameLost).toBe(true);
    expect(preview.dropped).toEqual(["#99999", "An", "RC", "AUTO"]);
    expect(preview.title).toBe(
      "2024 Topps Chrome Absurdly Long Player Full Name That Alone Exceeds The Entire Title Budget",
    );
    expect(preview.title.length).toBeGreaterThan(80);
    expect(preview.title).not.toContain("…");
  });

  test("de-dupes and bounds the playerIds fan-out", async () => {
    // NEO-246: `updateCard.playerIds` now dedupes and caps on the WRITE path,
    // so a row that went through it can never reach this bound. The bound stays
    // for rows written before that landed (or by a future caller that skips
    // it): a repeated id must not be read — or printed — twice, and a long
    // array must not turn one query call into an unbounded sequential read
    // walk. Inserted straight into the table here, which is the only way to
    // produce such a row now.
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { sportId, variantTypeId } = await seedSubtree(t);

    const playerIds = await t.run(async (ctx) => {
      const ids: Id<"players">[] = [];
      for (let i = 0; i < MAX_CARD_PLAYERS + 4; i++) {
        ids.push(
          await ctx.db.insert("players", {
            name: `Player ${String(i).padStart(2, "0")}`,
            nameNormalized: `player ${i}`,
            sportId,
            lastUpdated: Date.now(),
          }),
        );
      }
      return ids;
    });

    // A repeated id resolves once.
    const dupeCardId = await insertCard(t, variantTypeId, {
      cardNumber: "1",
      playerIds: [playerIds[0], playerIds[0], playerIds[1], playerIds[0]],
    });
    const dupePreview = await asAdmin.query(
      api.selectorOptions.previewListingTitle,
      { cardId: dupeCardId },
    );
    expect(dupePreview.inputs.playerNames).toEqual(["Player 00", "Player 01"]);

    // An over-cap array reads at most `MAX_CARD_PLAYERS` — the same bound the
    // write path enforces, no longer a local number of this query's own.
    const wideCardId = await insertCard(t, variantTypeId, {
      cardNumber: "2",
      playerIds,
    });
    const widePreview = await asAdmin.query(
      api.selectorOptions.previewListingTitle,
      { cardId: wideCardId },
    );
    expect(widePreview.inputs.playerNames).toHaveLength(MAX_CARD_PLAYERS);
    expect(widePreview.inputs.playerNames[0]).toBe("Player 00");
    // Twenty players lose every first name ("Player") and the title still
    // STOPs over the cap (NEO-535): each surname part stays, none is sliced.
    expect(widePreview.fits).toBe(false);
    expect(widePreview.title.length).toBeGreaterThan(80);
    for (let i = 0; i < MAX_CARD_PLAYERS; i++) {
      expect(widePreview.title).toContain(String(i).padStart(2, "0"));
    }
    expect(widePreview.title).not.toContain("Player");
  });

  test("resolves team names from teamOnCardIds, deduped and bounded", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { sportId, variantTypeId } = await seedSubtree(t);

    const teamIds = await t.run(async (ctx) => {
      const ids: Id<"teams">[] = [];
      for (let i = 0; i < 12; i++) {
        ids.push(
          await ctx.db.insert("teams", {
            name: `Team ${String(i).padStart(2, "0")}`,
            nameNormalized: `team ${i}`,
            sportId,
            lastUpdated: Date.now(),
          }),
        );
      }
      return ids;
    });

    const dupeCardId = await insertCard(t, variantTypeId, {
      cardNumber: "1",
      teamOnCardIds: [teamIds[0], teamIds[0], teamIds[1]],
    });
    const dupePreview = await asAdmin.query(
      api.selectorOptions.previewListingTitle,
      { cardId: dupeCardId },
    );
    expect(dupePreview.inputs.teamNames).toEqual(["Team 00", "Team 01"]);
    expect(dupePreview.inputs.sport).toBe("Baseball");

    // 12 ids, capped at MAX_CARD_TEAMS — the same bound `updateCard` enforces
    // on the write path, here for rows written before that validation landed.
    const wideCardId = await insertCard(t, variantTypeId, {
      cardNumber: "2",
      teamOnCardIds: teamIds,
    });
    const widePreview = await asAdmin.query(
      api.selectorOptions.previewListingTitle,
      { cardId: wideCardId },
    );
    expect(widePreview.inputs.teamNames).toHaveLength(8);
    expect(widePreview.title.length).toBeLessThanOrEqual(80);
  });

  test("falls back to pendingTeamNames for a hand-added card", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { variantTypeId } = await seedSubtree(t);

    const cardId = await insertCard(t, variantTypeId, {
      cardNumber: "9001",
      isCustom: true,
      pendingTeamNames: ["Savannah Bananas"],
      features: { season: "2024", manufacturer: "Topps" },
    });

    const preview = await asAdmin.query(api.selectorOptions.previewListingTitle, {
      cardId,
    });
    expect(preview.inputs.teamNames).toEqual(["Savannah Bananas"]);
    expect(preview.title).toBe(
      "2024 Topps Chrome Base #9001 Savannah Bananas Baseball",
    );
  });

  test("requires admin", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId } = await seedSubtree(t);
    const cardId = await insertCard(t, variantTypeId, {});

    await expect(
      t.withIdentity({ subject: "some_user" }).query(
        api.selectorOptions.previewListingTitle,
        { cardId },
      ),
    ).rejects.toThrow();
    await expect(
      t.query(api.selectorOptions.previewListingTitle, { cardId }),
    ).rejects.toThrow();
  });

  test("a missing card is refused rather than previewed as a blank", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { variantTypeId } = await seedSubtree(t);
    const cardId = await insertCard(t, variantTypeId, {});
    await t.run(async (ctx) => ctx.db.delete(cardId));

    await expect(
      asAdmin.query(api.selectorOptions.previewListingTitle, { cardId }),
    ).rejects.toThrow(/no such card/);
  });

  test("reproduces EXACTLY what commitCardChecklist's insert branch stored", async () => {
    // The contract that keeps the two hand-kept input mappings in step. If
    // this breaks, one of them changed without the other — see the note on
    // `previewListingTitle` in selectorOptions.ts.
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { sportId, variantTypeId } = await seedSubtree(t);
    await asAdmin.mutation(api.players.findOrCreate, {
      name: "Julio Rodriguez",
      sportId,
    });
    // NEO-220: settle the enrichment that creation schedules BEFORE the test
    // goes on. See drain-scheduled.ts.
    await drainScheduled(t);

    await asAdmin.action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: variantTypeId,
      sportId,
      cards: [
        {
          cardNumber: "300b",
          cardName: "Julio Rodriguez",
          team: undefined,
          teams: [],
          players: ["Julio Rodriguez"],
          attributes: ["RC"],
          isRookie: true,
          isRelic: false,
          printRun: 99,
          autographType: "On-Card",
          cardVariation: "Image Variation",
          platformData: { bsc: { ref: "bsc-300b" } },
          unmatched: undefined,
        },
      ],
    });
    // NEO-247: this commit also schedules its own BSC team backfill (the
    // card carries a bsc ref with no resolvable team). Now that fetch is
    // stubbed to throw (above), draining it here has nothing sensitive to
    // pull forward — the old comment about that risk applied only when the
    // stub could return a shape this test hadn't invented.
    await drainScheduled(t);

    const [card] = await t.run(async (ctx) =>
      ctx.db
        .query("cardChecklist")
        .withIndex("by_selector_option", (q) =>
          q.eq("selectorOptionId", variantTypeId),
        )
        .collect(),
    );

    const preview = await asAdmin.query(api.selectorOptions.previewListingTitle, {
      cardId: card._id,
    });
    expect(preview.title).toBe(card.listingTitle);
  });
});
