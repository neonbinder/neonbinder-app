/**
 * NEO-535 — a card's listing description follows its facts
 * (`cardDescriptionRefresh`).
 *
 * Pinned, per write path: a fact change rebuilds the description in the same
 * write, but ONLY when the stored description is exactly the builder's for
 * the facts before the change. A hand-edited description, a missing one and
 * one sent in the same call are all left as they are. Regenerate rebuilds a
 * stale description that reads as the builder's and keeps an operator's own.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { generateListingDescription } from "./features/generateListing";
import { listingInputsForStoredCard } from "./storedCardTitle";
import { applyBscAttributeFill } from "./cardChecklist";
import { moveCards } from "./setShapeMove";
import { rehomeSetRowsToBrand } from "./brandRehome";
import { seedCollectionCatalog } from "../lib/testing/collection-fixture";

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

type T = ReturnType<typeof convexTest>;
type CardId = Id<"cardChecklist">;

afterEach(() => {
  vi.useRealTimers();
});

/** What the builder writes for the card as it is stored now. */
async function builderDescription(t: T, id: CardId): Promise<string> {
  return t.run(async (ctx) => {
    const card = (await ctx.db.get(id))!;
    return generateListingDescription((await listingInputsForStoredCard(ctx, card)).inputs);
  });
}

async function storedDescription(t: T, id: CardId): Promise<string | undefined> {
  return t.run(async (ctx) => (await ctx.db.get(id))?.listingDescription);
}

async function setDescription(t: T, id: CardId, text: string | undefined): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.patch(id, { listingDescription: text });
  });
}

/** The fixture with `card`'s description set to exactly the builder's. */
async function setup() {
  const t = convexTest(schema, modules);
  const fx = await seedCollectionCatalog(t);
  for (const id of [fx.gooden1, fx.strawberry2, fx.gold1]) {
    await setDescription(t, id, await builderDescription(t, id));
  }
  return { t, fx, asAdmin: t.withIdentity(ADMIN_IDENTITY) };
}

const HAND_WRITTEN = "Mint condition. Ships in a top loader.";

describe("updateCard: a fact change rebuilds an unedited description", () => {
  test("a new team: the description names it, in the same write", async () => {
    const { t, fx, asAdmin } = await setup();
    expect(await storedDescription(t, fx.strawberry2)).toContain("Team: New York Mets.");

    await asAdmin.mutation(api.selectorOptions.updateCard, {
      id: fx.strawberry2,
      teamOnCardIds: [fx.exposId],
    });

    const after = await storedDescription(t, fx.strawberry2);
    expect(after).toContain("Team: Montreal Expos.");
    expect(after).not.toContain("Mets");
    expect(after).toBe(await builderDescription(t, fx.strawberry2));
  });

  test("print run, RC and a variation all reach the description", async () => {
    const { t, fx, asAdmin } = await setup();
    await asAdmin.mutation(api.selectorOptions.updateCard, {
      id: fx.strawberry2,
      printRun: 25,
      isRookie: true,
      cardVariation: "Batting Helmet",
    });
    const after = await storedDescription(t, fx.strawberry2);
    expect(after).toContain("Serial numbered to 25 (/25).");
    expect(after).toContain("Rookie Card (RC).");
    expect(after).toContain("Variation: Batting Helmet.");
  });

  test("clearing a print run takes it out again", async () => {
    const { t, fx, asAdmin } = await setup();
    expect(await storedDescription(t, fx.gold1)).toContain("(/50)");
    await asAdmin.mutation(api.selectorOptions.updateCard, { id: fx.gold1, printRun: null });
    expect(await storedDescription(t, fx.gold1)).not.toContain("/50");
  });

  test("a hand-edited description is left alone", async () => {
    const { t, fx, asAdmin } = await setup();
    await setDescription(t, fx.strawberry2, HAND_WRITTEN);
    await asAdmin.mutation(api.selectorOptions.updateCard, {
      id: fx.strawberry2,
      teamOnCardIds: [fx.exposId],
      printRun: 25,
    });
    expect(await storedDescription(t, fx.strawberry2)).toBe(HAND_WRITTEN);
  });

  test("a builder-shaped description from OTHER facts is not this card's, so it stays", async () => {
    const { t, fx, asAdmin } = await setup();
    const other = (await builderDescription(t, fx.strawberry2)).replace(
      "New York Mets",
      "Brooklyn Dodgers",
    );
    await setDescription(t, fx.strawberry2, other);
    await asAdmin.mutation(api.selectorOptions.updateCard, {
      id: fx.strawberry2,
      teamOnCardIds: [fx.exposId],
    });
    expect(await storedDescription(t, fx.strawberry2)).toBe(other);
  });

  test("a card with no description is not filled here", async () => {
    const { t, fx, asAdmin } = await setup();
    await setDescription(t, fx.strawberry2, undefined);
    await asAdmin.mutation(api.selectorOptions.updateCard, {
      id: fx.strawberry2,
      teamOnCardIds: [fx.exposId],
    });
    // `t.run` hands an absent field back as null.
    expect(await storedDescription(t, fx.strawberry2)).toBeNull();
  });

  test("a description sent in the same call wins", async () => {
    const { t, fx, asAdmin } = await setup();
    await asAdmin.mutation(api.selectorOptions.updateCard, {
      id: fx.strawberry2,
      teamOnCardIds: [fx.exposId],
      listingDescription: HAND_WRITTEN,
    });
    expect(await storedDescription(t, fx.strawberry2)).toBe(HAND_WRITTEN);
  });

  test("a write that changes no fact leaves the description byte-identical", async () => {
    const { t, fx, asAdmin } = await setup();
    const before = await storedDescription(t, fx.strawberry2);
    await asAdmin.mutation(api.selectorOptions.updateCard, {
      id: fx.strawberry2,
      notes: "Corner ding",
      cardName: "Darryl Strawberry",
    });
    expect(await storedDescription(t, fx.strawberry2)).toBe(before);
  });
});

describe("updateCard regenerateDescription (the drawer's Regenerate)", () => {
  test("rebuilds a stale description that reads as the builder's", async () => {
    const { t, fx, asAdmin } = await setup();
    const stale = (await builderDescription(t, fx.strawberry2)).replace(
      "New York Mets",
      "Brooklyn Dodgers",
    );
    await setDescription(t, fx.strawberry2, stale);
    await asAdmin.mutation(api.selectorOptions.updateCard, {
      id: fx.strawberry2,
      regenerateDescription: true,
    });
    expect(await storedDescription(t, fx.strawberry2)).toBe(
      await builderDescription(t, fx.strawberry2),
    );
  });

  test("fills a missing description", async () => {
    const { t, fx, asAdmin } = await setup();
    await setDescription(t, fx.strawberry2, undefined);
    await asAdmin.mutation(api.selectorOptions.updateCard, {
      id: fx.strawberry2,
      regenerateDescription: true,
    });
    expect(await storedDescription(t, fx.strawberry2)).toBe(
      await builderDescription(t, fx.strawberry2),
    );
  });

  test("keeps an operator's own description", async () => {
    const { t, fx, asAdmin } = await setup();
    await setDescription(t, fx.strawberry2, HAND_WRITTEN);
    const before = await t.run(async (ctx) => (await ctx.db.get(fx.strawberry2))!.lastUpdated);
    await asAdmin.mutation(api.selectorOptions.updateCard, {
      id: fx.strawberry2,
      regenerateDescription: true,
    });
    const card = await t.run(async (ctx) => (await ctx.db.get(fx.strawberry2))!);
    expect(card.listingDescription).toBe(HAND_WRITTEN);
    // Nothing to write, so nothing was written.
    expect(card.lastUpdated).toBe(before);
  });

  test("an operator's own words below the builder's lines keep the whole description", async () => {
    const { t, fx, asAdmin } = await setup();
    const edited = `${(await builderDescription(t, fx.strawberry2)).replace("New York Mets", "Brooklyn Dodgers")}\nSharp corners.`;
    await setDescription(t, fx.strawberry2, edited);
    await asAdmin.mutation(api.selectorOptions.updateCard, {
      id: fx.strawberry2,
      regenerateDescription: true,
    });
    expect(await storedDescription(t, fx.strawberry2)).toBe(edited);
  });
});

describe("the other fact writers", () => {
  test("setCardFeature: a short print reaches the description", async () => {
    const { t, fx, asAdmin } = await setup();
    await asAdmin.mutation(api.selectorOptions.setCardFeature, {
      cardChecklistId: fx.strawberry2,
      key: "shortPrint",
      value: "SSP",
    });
    expect(await storedDescription(t, fx.strawberry2)).toContain("Super Short Print (SSP).");
  });

  test("setCardFeature: a feature the description does not carry writes no description", async () => {
    const { t, fx, asAdmin } = await setup();
    await setDescription(t, fx.strawberry2, HAND_WRITTEN);
    await asAdmin.mutation(api.selectorOptions.setCardFeature, {
      cardChecklistId: fx.strawberry2,
      key: "shortPrint",
      value: "SP",
    });
    expect(await storedDescription(t, fx.strawberry2)).toBe(HAND_WRITTEN);
  });

  test("the BSC attribute fill: RC and a print run reach the description", async () => {
    const { t, fx } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.patch(fx.strawberry2, { attributes: [], isRookie: undefined });
    });
    await setDescription(t, fx.strawberry2, await builderDescription(t, fx.strawberry2));
    await t.run(async (ctx) => {
      const row = (await ctx.db.get(fx.strawberry2))!;
      await applyBscAttributeFill(ctx, row, { tokens: ["RC"], printRun: 99 });
    });
    const after = await storedDescription(t, fx.strawberry2);
    expect(after).toContain("Rookie Card (RC).");
    expect(after).toContain("Serial numbered to 99 (/99).");
  });

  test("the set-level team cascade: a following card's description names the team", async () => {
    const { t, fx } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.patch(fx.strawberry2, { teamOnCardIds: undefined, pendingTeamNames: undefined });
    });
    await setDescription(t, fx.strawberry2, await builderDescription(t, fx.strawberry2));
    await t.mutation(internal.selectorOptions.cascadeSelectorOptionTeams, {
      rootId: fx.baseId,
      previousTeamIds: [],
      teamIds: [fx.exposId],
      nodeIds: [fx.baseId],
      nodeTeamsIndex: 1,
    });
    const card = await t.run(async (ctx) => (await ctx.db.get(fx.strawberry2))!);
    expect(card.teamOnCardIds).toEqual([fx.exposId]);
    expect(card.listingDescription).toContain("Team: Montreal Expos.");
  });

  test("moving cards: the description follows the card to its new row, scheduled", async () => {
    vi.useFakeTimers();
    const { t, fx } = await setup();
    await setDescription(t, fx.gooden1Sliding, HAND_WRITTEN);
    await setDescription(t, fx.gooden1, undefined);
    await t.run(async (ctx) => {
      const moves = [];
      for (const id of [fx.strawberry2, fx.gooden1Sliding, fx.gooden1]) {
        moves.push({ card: (await ctx.db.get(id))!, slotMap: {} });
      }
      await moveCards(ctx, fx.goldId, moves, Date.now());
    });
    // Every moved card with a description is handed over (the tail decides
    // which descriptions are the builder's); gooden1, with none, is not.
    const scheduled = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter(
        (job) => job.name.includes("refreshMovedCardDescriptions"),
      ),
    );
    expect(scheduled).toHaveLength(1);
    expect((scheduled[0].args[0] as { moved: unknown[] }).moved).toEqual([
      { cardId: fx.gooden1Sliding, fromId: fx.baseId },
      { cardId: fx.strawberry2, fromId: fx.baseId },
    ]);

    const result = await t.mutation(internal.setShapeMove.refreshMovedCardDescriptions, {
      moved: [
        { cardId: fx.strawberry2, fromId: fx.baseId },
        { cardId: fx.gooden1Sliding, fromId: fx.baseId },
      ],
      index: 0,
    });
    expect(result).toEqual({ rewritten: 1, done: true });
    const after = await storedDescription(t, fx.strawberry2);
    expect(after).toBe(await builderDescription(t, fx.strawberry2));
    expect(after).toContain("Gold");
    expect(await storedDescription(t, fx.gooden1Sliding)).toBe(HAND_WRITTEN);

    // A re-run writes nothing.
    const again = await t.mutation(internal.setShapeMove.refreshMovedCardDescriptions, {
      moved: [{ cardId: fx.strawberry2, fromId: fx.baseId }],
      index: 0,
    });
    expect(again.rewritten).toBe(0);
  });
});

// ── NEO-535: renames that fan out to the cards beneath ───────────────────────

/** Scheduled fan-out pages still waiting to run. */
async function pendingFanOutPages(t: T): Promise<number> {
  return t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter(
      (job) =>
        job.name.includes("refreshRenamedCardDescriptions") && job.state.kind === "pending",
    ).length,
  );
}

/**
 * `count` more cards of `playerId` on `rowId`, each carrying exactly the
 * builder's description, linked like the fixture's (`cardPlayerLinks`).
 */
async function addDescribedCards(
  t: T,
  fx: Awaited<ReturnType<typeof seedCollectionCatalog>>,
  rowId: Id<"selectorOptions">,
  playerId: Id<"players">,
  count: number,
): Promise<CardId[]> {
  return t.run(async (ctx) => {
    const ids: CardId[] = [];
    for (let i = 0; i < count; i++) {
      const id = (await ctx.db.insert("cardChecklist", {
        selectorOptionId: rowId,
        cardNumber: `X-${i}`,
        cardName: "Bulk card",
        playerIds: [playerId],
        playerLinks: [{ playerId, nameOnCard: "Bulk card" }],
        teamOnCardIds: [fx.metsId],
        listingTitle: `Bulk card ${i}`,
        sportId: fx.sportId,
        platformData: {},
        sortOrder: 100 + i,
        lastUpdated: 0,
      } as never)) as CardId;
      await ctx.db.insert("cardPlayerLinks", {
        cardChecklistId: id,
        playerId,
        sportId: fx.sportId,
      });
      await ctx.db.insert("cardTeamLinks", { cardChecklistId: id, teamId: fx.metsId });
      const card = (await ctx.db.get(id))!;
      await ctx.db.patch(id, {
        listingDescription: generateListingDescription(
          (await listingInputsForStoredCard(ctx, card)).inputs,
        ),
      });
      ids.push(id);
    }
    return ids;
  });
}

describe("renames reach the descriptions of the cards beneath", () => {
  test("a player rename: unedited descriptions follow, a hand-edited one stays, nothing is scheduled", async () => {
    const { t, fx, asAdmin } = await setup();
    await setDescription(t, fx.gold1, HAND_WRITTEN);
    const futureStarBefore = await storedDescription(t, fx.futureStar);

    await asAdmin.mutation(api.players.savePlayerFields, {
      id: fx.goodenId,
      name: "Dwight Eugene Gooden",
    });

    const gooden1 = await storedDescription(t, fx.gooden1);
    expect(gooden1).toContain("Dwight Eugene Gooden");
    expect(gooden1).toBe(await builderDescription(t, fx.gooden1));
    expect(await storedDescription(t, fx.gold1)).toBe(HAND_WRITTEN);
    // The fixture's title-shaped description is not the builder's either.
    expect(await storedDescription(t, fx.futureStar)).toBe(futureStarBefore);
    // Strawberry's card does not carry Gooden.
    expect(await storedDescription(t, fx.strawberry2)).not.toContain("Gooden");
    expect(await pendingFanOutPages(t)).toBe(0);
  });

  test("a team rename and a location edit both reach the description's team line", async () => {
    const { t, fx, asAdmin } = await setup();
    await setDescription(t, fx.gooden1, HAND_WRITTEN);

    await asAdmin.mutation(api.teams.saveTeamFields, { id: fx.metsId, name: "Metropolitans" });
    expect(await storedDescription(t, fx.strawberry2)).toContain("Team: New York Metropolitans.");
    expect(await storedDescription(t, fx.gold1)).toContain("Team: New York Metropolitans.");

    await asAdmin.mutation(api.teams.saveTeamFields, { id: fx.metsId, location: "Queens" });
    expect(await storedDescription(t, fx.strawberry2)).toContain("Team: Queens Metropolitans.");
    expect(await storedDescription(t, fx.strawberry2)).toBe(
      await builderDescription(t, fx.strawberry2),
    );
    expect(await storedDescription(t, fx.gooden1)).toBe(HAND_WRITTEN);
  });

  test("a set rename reaches every card in its subtree; an insert rename reaches its own", async () => {
    const { t, fx, asAdmin } = await setup();
    await setDescription(t, fx.strawberry2, HAND_WRITTEN);

    await asAdmin.mutation(api.selectorOptions.renameSelectorOption, {
      id: fx.setId,
      value: "Topps Chrome Sapphire",
    });
    expect(await storedDescription(t, fx.gooden1)).toContain("Topps Chrome Sapphire");
    expect(await storedDescription(t, fx.gold1)).toContain("Topps Chrome Sapphire");
    expect(await storedDescription(t, fx.strawberry2)).toBe(HAND_WRITTEN);

    await asAdmin.mutation(api.selectorOptions.renameSelectorOption, {
      id: fx.goldId,
      value: "Gold Wave Refractor",
    });
    const gold1 = await storedDescription(t, fx.gold1);
    expect(gold1).toContain("Gold Wave Refractor");
    expect(gold1).toBe(await builderDescription(t, fx.gold1));
    expect(await pendingFanOutPages(t)).toBe(0);
  });

  test("a player with more cards than a page: the first page inline, the rest on the chain", async () => {
    vi.useFakeTimers();
    const { t, fx, asAdmin } = await setup();
    const extra = await addDescribedCards(t, fx, fx.baseId, fx.strawberryId, 150);
    const handEdited = extra[120];
    await setDescription(t, handEdited, HAND_WRITTEN);

    await asAdmin.mutation(api.players.savePlayerFields, {
      id: fx.strawberryId,
      name: "Darryl Eugene Strawberry",
    });
    expect(await pendingFanOutPages(t)).toBe(1);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    for (const id of [fx.strawberry2, ...extra]) {
      if (id === handEdited) continue;
      expect(await storedDescription(t, id)).toContain("Darryl Eugene Strawberry");
    }
    expect(await storedDescription(t, handEdited)).toBe(HAND_WRITTEN);
    expect(await pendingFanOutPages(t)).toBe(0);
  });

  test("a team with more cards than a page: the chain picks up at the inline page's cursor", async () => {
    vi.useFakeTimers();
    const { t, fx, asAdmin } = await setup();
    const extra = await addDescribedCards(t, fx, fx.baseId, fx.strawberryId, 220);

    await asAdmin.mutation(api.teams.saveTeamFields, { id: fx.metsId, name: "Metropolitans" });
    const pages = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) =>
        job.name.includes("refreshRenamedCardDescriptions"),
      ),
    );
    expect(pages).toHaveLength(1);
    const state = (pages[0].args[0] as { state: { kind: string; after: unknown } }).state;
    expect(state).toMatchObject({ kind: "links", after: { creationTime: expect.any(Number) } });

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    for (const id of [fx.strawberry2, fx.gold1, ...extra]) {
      expect(await storedDescription(t, id)).toContain("Team: New York Metropolitans.");
    }
  });

  test("a subtree with more cards than a page: the chain walks on from where the page stopped", async () => {
    vi.useFakeTimers();
    const { t, fx, asAdmin } = await setup();
    const extra = await addDescribedCards(t, fx, fx.goldId, fx.strawberryId, 230);

    await asAdmin.mutation(api.selectorOptions.renameSelectorOption, {
      id: fx.goldId,
      value: "Gold Wave Refractor",
    });
    // 231 cards on the row: 100 inline, then two pages.
    const pages = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) =>
        job.name.includes("refreshRenamedCardDescriptions"),
      ),
    );
    expect(pages).toHaveLength(1);
    const state = (pages[0].args[0] as { state: { kind: string; after?: number } }).state;
    expect(state.kind).toBe("subtree");
    expect(state.after).toBeTypeOf("number");

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    for (const id of [fx.gold1, ...extra]) {
      expect(await storedDescription(t, id)).toContain("Gold Wave Refractor");
    }
  });

  test("a re-run of a finished page writes nothing", async () => {
    const { t, fx, asAdmin } = await setup();
    await asAdmin.mutation(api.players.savePlayerFields, {
      id: fx.goodenId,
      name: "Dwight Eugene Gooden",
    });
    const again = await t.mutation(internal.cardDescriptionFanOut.refreshRenamedCardDescriptions, {
      target: { kind: "player", playerId: fx.goodenId, before: { name: "Dwight Gooden" } },
      state: { kind: "links", after: null },
      pagesLeft: 10,
    });
    expect(again).toEqual({ rewritten: 0, done: true });
  });

  test("a set moved onto the year's Unknown brand stops naming its maker", async () => {
    vi.useFakeTimers();
    const { t, fx } = await setup();
    const unknownId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("selectorOptions", {
        level: "manufacturer",
        value: "Unknown",
        platformData: {},
        parentId: fx.yearId,
        children: [],
        metadata: { isBrandUnknown: true },
        lastUpdated: 0,
      } as never);
      const year = (await ctx.db.get(fx.yearId))!;
      await ctx.db.patch(fx.yearId, { children: [...(year.children ?? []), id] });
      await ctx.db.patch(fx.strawberry2, { features: { manufacturer: "Bowman" } });
      return id;
    });
    await setDescription(t, fx.strawberry2, await builderDescription(t, fx.strawberry2));
    expect(await storedDescription(t, fx.strawberry2)).toContain("Bowman Topps Chrome");

    await t.run(async (ctx) => {
      const set = (await ctx.db.get(fx.setId))!;
      await rehomeSetRowsToBrand(ctx, {
        rows: [set],
        brandId: unknownId,
        allowBrandUnknownTarget: true,
        includeOperatorPlaced: true,
      });
    });
    expect(await pendingFanOutPages(t)).toBe(1);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const after = await storedDescription(t, fx.strawberry2);
    expect(after).not.toContain("Bowman");
    expect(after).toBe(await builderDescription(t, fx.strawberry2));
  });

  test("a brand-to-brand move schedules nothing: no description names a move between brands", async () => {
    const { t, fx } = await setup();
    const bowmanId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("selectorOptions", {
        level: "manufacturer",
        value: "Bowman",
        platformData: {},
        parentId: fx.yearId,
        children: [],
        lastUpdated: 0,
      } as never);
      const year = (await ctx.db.get(fx.yearId))!;
      await ctx.db.patch(fx.yearId, { children: [...(year.children ?? []), id] });
      return id;
    });
    await t.run(async (ctx) => {
      const set = (await ctx.db.get(fx.setId))!;
      await rehomeSetRowsToBrand(ctx, {
        rows: [set],
        brandId: bowmanId,
        includeOperatorPlaced: true,
      });
    });
    expect(await pendingFanOutPages(t)).toBe(0);
  });

  test("the reconciliation modal's title edit reaches the renamed insert's cards", async () => {
    vi.useFakeTimers();
    const { t, fx, asAdmin } = await setup();
    await setDescription(t, fx.futureStar, await builderDescription(t, fx.futureStar));

    await asAdmin.mutation(api.setReconciliation.storeReconciledOptions, {
      level: "insert",
      parentId: fx.insertsTypeId,
      reconciledItems: [
        {
          value: "Future Stars Rookies",
          platformData: {},
          existingId: fx.futureStarsId,
          metadata: undefined,
        },
      ],
    });
    expect(await pendingFanOutPages(t)).toBe(1);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const after = await storedDescription(t, fx.futureStar);
    expect(after).toContain("Future Stars Rookies");
    expect(after).toBe(await builderDescription(t, fx.futureStar));
  });
});

describe("NEO-528 cameos: the description writers keep the cameo line", () => {
  /** Strawberry's card with Gooden also pictured, its description the builder's. */
  async function withCameo() {
    const s = await setup();
    await s.asAdmin.mutation(api.cardSecondaryPlayers.setSecondaryPlayers, {
      cardId: s.fx.strawberry2,
      playerIds: [s.fx.goodenId],
    });
    expect(await storedDescription(s.t, s.fx.strawberry2)).toContain("Cameo: Dwight Gooden.");
    return s;
  }

  test("a fact change rebuilds the description with its cameo line", async () => {
    const { t, fx, asAdmin } = await withCameo();
    await asAdmin.mutation(api.selectorOptions.updateCard, {
      id: fx.strawberry2,
      teamOnCardIds: [fx.exposId],
    });
    const after = (await storedDescription(t, fx.strawberry2))!.split("\n");
    expect(after).toContain("Team: Montreal Expos.");
    expect(after[after.indexOf("Team: Montreal Expos.") + 1]).toBe("Cameo: Dwight Gooden.");
  });

  test("a description written before cameos were described still follows a fact change, and gains the line", async () => {
    const { t, fx, asAdmin } = await withCameo();
    const noCameoLine = await t.run(async (ctx) => {
      const card = (await ctx.db.get(fx.strawberry2))!;
      const { inputs } = await listingInputsForStoredCard(ctx, card);
      return generateListingDescription(inputs, { cameoNames: [] });
    });
    await setDescription(t, fx.strawberry2, noCameoLine);
    expect(await storedDescription(t, fx.strawberry2)).not.toContain("Cameo");
    await asAdmin.mutation(api.selectorOptions.updateCard, {
      id: fx.strawberry2,
      teamOnCardIds: [fx.exposId],
    });
    const after = await storedDescription(t, fx.strawberry2);
    expect(after).toContain("Team: Montreal Expos.");
    expect(after).toContain("Cameo: Dwight Gooden.");
  });

  test("a cameo's rename reaches the cameo line, in the rename's own transaction", async () => {
    const { t, fx, asAdmin } = await withCameo();
    await asAdmin.mutation(api.players.savePlayerFields, {
      id: fx.goodenId,
      name: "Dwight Eugene Gooden",
    });
    const straw = await storedDescription(t, fx.strawberry2);
    expect(straw).toContain("Cameo: Dwight Eugene Gooden.");
    expect(straw).not.toContain("Cameo: Dwight Gooden.");
    // Gooden's own card follows too, and nothing is left for a chain.
    expect(await storedDescription(t, fx.gooden1)).toContain("Dwight Eugene Gooden");
    expect(await pendingFanOutPages(t)).toBe(0);
  });

  test("a hand-written description on a card with a cameo stays through the cameo's rename", async () => {
    const { t, fx, asAdmin } = await withCameo();
    await setDescription(t, fx.strawberry2, HAND_WRITTEN);
    await asAdmin.mutation(api.players.savePlayerFields, {
      id: fx.goodenId,
      name: "Dwight Eugene Gooden",
    });
    expect(await storedDescription(t, fx.strawberry2)).toBe(HAND_WRITTEN);
  });
});
