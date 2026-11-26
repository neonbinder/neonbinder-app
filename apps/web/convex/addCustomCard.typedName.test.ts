/**
 * NEO-645 (S7), on NEO-656's storage — a hand-added card that carries a player
 * NAME but no linked player (a typed name, the legacy `players` argument) keeps
 * the name pending on the card, and the Player tile reads it from there. Without
 * it the card is pink on the walk's list and the tile is empty. The card is the
 * only record: no name row and no printed row exist (NEO-656).
 */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { deriveCardAttention } from "./features/cardAttention";
import { cancelScheduled } from "../lib/testing/drain-scheduled";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = { subject: "admin_s7", role: "admin" };
type T = ReturnType<typeof convexTest>;
const live: T[] = [];
const newT = () => {
  const t = convexTest(schema, modules);
  live.push(t);
  return t;
};
afterEach(async () => {
  for (const t of live.splice(0)) await cancelScheduled(t);
});

async function tree(t: T) {
  return t.run(async (ctx) => {
    const sportId = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      sportConfig: { skuCode: "BB", league: "MLB" },
      platformData: {},
      children: [],
      lastUpdated: Date.now(),
    });
    const setId = await ctx.db.insert("selectorOptions", {
      level: "setName",
      value: "Chrome",
      platformData: {},
      parentId: sportId,
      children: [],
      lastUpdated: Date.now(),
    });
    const leafId = await ctx.db.insert("selectorOptions", {
      level: "variantType",
      value: "Insert",
      platformData: {},
      features: { season: "2025" },
      parentId: setId,
      children: [],
      lastUpdated: Date.now(),
    });
    return { sportId, leafId };
  });
}

const add = (t: T, leafId: Id<"selectorOptions">, over: Record<string, unknown> = {}) =>
  t.withIdentity(ADMIN).mutation(api.selectorOptions.addCustomCard, {
    selectorOptionId: leafId,
    cardNumber: "FS-3",
    cardName: "Jackson Holliday",
    players: ["Jackson Holliday"],
    ...over,
  });

describe("addCustomCard with a typed player name (NEO-645 S7)", () => {
  test("the card is pink on the Player item, and the tile reads the name off the card", async () => {
    const t = newT();
    const { leafId } = await tree(t);
    const id = await add(t, leafId);

    const card = (await t.run((ctx) => ctx.db.get(id)))!;
    expect(card.pendingPlayerNames).toEqual(["Jackson Holliday"]);
    expect(card.playerIds ?? []).toEqual([]);
    expect(deriveCardAttention(card).items).toContainEqual({
      level: "fix",
      kind: "playerName",
      names: ["Jackson Holliday"],
    });

    // What the tile reads: the name, with its row, ready to be answered.
    const context = await t.withIdentity(ADMIN).query(api.tidyCards.cardContext, { cardId: id });
    expect(context?.names).toHaveLength(1);
    expect(context?.names[0]).toMatchObject({
      kind: "player",
      printed: "Jackson Holliday",
      order: 0,
      pending: true,
    });
  });

  test("a card added with no name at all has no names for the tile", async () => {
    const t = newT();
    const { leafId } = await tree(t);
    const id = await add(t, leafId, { players: undefined, cardName: "Checklist" });
    const context = await t.withIdentity(ADMIN).query(api.tidyCards.cardContext, { cardId: id });
    expect(context?.names).toEqual([]);
  });

  test("a name typed onto an existing card by hand (updateCard) reaches the tile the same way", async () => {
    const t = newT();
    const { leafId } = await tree(t);
    const id = await add(t, leafId, { players: undefined });

    await t.withIdentity(ADMIN).mutation(api.selectorOptions.updateCard, {
      id,
      pendingPlayerNames: ["Jackson Holliday"],
    });

    const context = await t.withIdentity(ADMIN).query(api.tidyCards.cardContext, { cardId: id });
    expect(context?.names.map((n) => [n.kind, n.printed, n.pending])).toEqual([
      ["player", "Jackson Holliday", true],
    ]);
  });
});
