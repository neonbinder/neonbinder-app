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
