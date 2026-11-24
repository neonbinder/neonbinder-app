/**
 * NEO-313, on NEO-656's gate links — a cross-sport LINK survives the commit.
 *
 * The gate's own link (`resolveChecklistEntities` -> `gateLinks`, origin
 * `setHistory`) names a football-only player for a baseball card; the commit
 * re-checks it, and `playerIds` and `playerLinks` both carry the guest.
 *
 * Gone with NEO-656: an operator's link is made on the card in the walk and is
 * never handed to the commit, and nothing stores an "also add the set's sport"
 * answer, so `addSetSport` at commit (and its walked-sport security fix and
 * `alsoSportIds` write) no longer exist.
 */

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { normalizePlayerName } from "./players";
import { insertTestCard } from "../lib/testing/card-row";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

type T = ReturnType<typeof convexTest>;

const ADMIN_IDENTITY = {
  subject: "admin_cross_sport_commit",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_cross_sport_commit",
  role: "admin",
};

async function seedSport(t: T, value: string): Promise<Id<"selectorOptions">> {
  return t.run(async (ctx) =>
    ctx.db.insert("selectorOptions", {
      level: "sport",
      value,
      platformData: {},
      children: [],
      lastUpdated: Date.now(),
    }),
  );
}

async function seedBaseballSet(t: T) {
  return t.run(async (ctx) => {
    const sportId = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      platformData: {},
      children: [],
      lastUpdated: Date.now(),
    });
    const setNameId = await ctx.db.insert("selectorOptions", {
      level: "setName",
      value: "Chrome",
      platformData: {},
      parentId: sportId,
      children: [],
      lastUpdated: Date.now(),
    });
    await ctx.db.patch(sportId, { children: [setNameId] });
    const variantTypeId = await ctx.db.insert("selectorOptions", {
      level: "variantType",
      value: "Base",
      platformData: {},
      parentId: setNameId,
      children: [],
      lastUpdated: Date.now(),
    });
    await ctx.db.patch(setNameId, { children: [variantTypeId] });
    return { sportId, setNameId, variantTypeId };
  });
}

function makeCard(overrides: Partial<{ cardNumber: string; players: string[] }> = {}) {
  return {
    cardNumber: overrides.cardNumber ?? "1",
    cardName: "Card",
    team: undefined,
    teams: [],
    players: overrides.players ?? [],
    attributes: [],
    isRookie: false,
    isRelic: false,
    printRun: undefined,
    autographType: undefined,
    cardVariation: undefined,
    platformData: {},
    unmatched: undefined,
  };
}

async function insertPlayer(
  t: T,
  opts: { name: string; sportId: Id<"selectorOptions"> },
): Promise<Id<"players">> {
  return t.run(async (ctx) =>
    ctx.db.insert("players", {
      name: opts.name,
      nameNormalized: normalizePlayerName(opts.name),
      sportId: opts.sportId,
      lastUpdated: Date.now(),
    }),
  );
}

describe("NEO-313: a cross-sport gate link at commit", () => {
  test("a cross-sport LINK survives the commit: playerIds and playerLinks both carry the guest", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, setNameId } = await seedBaseballSet(t);
    const football = await seedSport(t, "Football");
    const fields = await insertPlayer(t, { name: "Justin Fields", sportId: football });
    // The server proves a cross-sport `setHistory` label (NEO-656, C1): the set's
    // own earlier commit, on a sibling variant, linked this printed name to him.
    await t.run(async (ctx) => {
      const sibling = await ctx.db.insert("selectorOptions", {
        level: "variantType",
        value: "Insert",
        platformData: {},
        features: { manufacturer: "Topps", season: "2024" },
        parentId: setNameId,
        children: [],
        lastUpdated: Date.now(),
      });
      await insertTestCard(ctx, {
        selectorOptionId: sibling,
        cardNumber: "H1",
        cardName: "Earlier commit",
        playerIds: [fields],
        playerLinks: [{ playerId: fields, nameOnCard: "Justin Fields" }],
        platformData: {},
        sortOrder: 0,
        lastUpdated: Date.now(),
      });
    });

    await t.withIdentity(ADMIN_IDENTITY).action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: variantTypeId,
      sportId: (await seedBaseballSet(t)).sportId,
      gateLinks: [{ kind: "player" as const, name: "Justin Fields", playerId: fields, origin: "setHistory" as const }],
      cards: [makeCard({ players: ["Justin Fields"] })],
    });

    const cards = await t.run((ctx) =>
      ctx.db
        .query("cardChecklist")
        .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", variantTypeId))
        .collect(),
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].playerIds).toEqual([fields]);
    expect(cards[0].playerLinks).toEqual([
      { playerId: fields, nameOnCard: "Justin Fields" },
    ]);
  });

  test("a cross-sport guest keeps playerIds and playerLinks as one list, same order", async () => {
    // Same invariant `cardPlayerLinks.test.ts` pins generally, specifically for
    // a CROSS-SPORT guest — the shape most likely to be special-cased by an
    // incomplete fix ("guests don't get a printed-name link").
    const t = convexTest(schema, modules);
    const { variantTypeId, setNameId } = await seedBaseballSet(t);
    const football = await seedSport(t, "Football");
    const fields = await insertPlayer(t, { name: "Justin Fields", sportId: football });
    // The server proves a cross-sport `setHistory` label (NEO-656, C1): the set's
    // own earlier commit, on a sibling variant, linked this printed name to him.
    await t.run(async (ctx) => {
      const sibling = await ctx.db.insert("selectorOptions", {
        level: "variantType",
        value: "Insert",
        platformData: {},
        features: { manufacturer: "Topps", season: "2024" },
        parentId: setNameId,
        children: [],
        lastUpdated: Date.now(),
      });
      await insertTestCard(ctx, {
        selectorOptionId: sibling,
        cardNumber: "H1",
        cardName: "Earlier commit",
        playerIds: [fields],
        playerLinks: [{ playerId: fields, nameOnCard: "Justin Fields" }],
        platformData: {},
        sortOrder: 0,
        lastUpdated: Date.now(),
      });
    });

    await t.withIdentity(ADMIN_IDENTITY).action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: variantTypeId,
      sportId: (await seedBaseballSet(t)).sportId,
      gateLinks: [{ kind: "player" as const, name: "Justin Fields", playerId: fields, origin: "setHistory" as const }],
      cards: [makeCard({ players: ["Justin Fields"] })],
    });

    const [card] = await t.run((ctx) =>
      ctx.db
        .query("cardChecklist")
        .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", variantTypeId))
        .collect(),
    );
    expect(card.playerLinks?.map((l) => l.playerId)).toEqual(card.playerIds);
  });
});
