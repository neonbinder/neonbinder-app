/**
 * NEO-528 round 3 — "Player on every card" at card CREATION: the checklist
 * commit's insert branch, a hand-added card (`addCustomCard`), and the
 * pre-save title facts (`titleSetFacts.setPlayerNames`). The parallel build
 * is `parallelChecklistBuild.playerDefaults.test.ts`.
 *
 * The rules under test (spec, round 3):
 *
 *   - a new card that resolved no player and carries no name waiting for
 *     review is born with the default player: `playerIds` and `playerLinks`
 *     naming them in the same order, the card → player index, the listing
 *     title, and Signed By on an autograph;
 *   - a resolved (marketplace) or typed player always wins; a pending name
 *     blocks the player but not the cameos;
 *   - default cameos are born with their index rows and the description's
 *     cameo line (never the title);
 *   - an existing card is never filled; a default that no longer resolves is
 *     dropped, never refuses a card; no team is ever written.
 *
 * Fixture (`seed`):
 *
 *   Football › 2026 › Topps › Profiles (set) › Base (leaf)
 *   Baseball (another sport)
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { insertTestCard } from "../lib/testing/card-row";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import {
  CARDS_PER_COMMIT_CHUNK,
  COMMIT_CHUNK_OP_BUDGET,
  capChunkPlayerDefaults,
  commitCardChecklistChunk,
  commitChunkDefaultAllowance,
  commitChunkSize,
} from "./selectorOptions";
import { syncCardPlayerLinks } from "./cardPlayerLinks";
import { MAX_CARD_PLAYERS } from "./features/cardAttention";
import { cancelScheduled, drainScheduled } from "../lib/testing/drain-scheduled";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = { subject: "admin_neo528_creation", role: "admin" };
const NOW = 1_700_000_000_000;

type T = ReturnType<typeof convexTest>;
type RowId = Id<"selectorOptions">;

beforeEach(() => {
  // Nothing here may reach the network (a hand-added card can schedule a
  // marketplace lookup); a throw is a state every adapter already handles.
  vi.stubGlobal(
    "fetch",
    (async (url: string | URL) => {
      throw new Error(`NEO-528: this test file must not reach the network: ${String(url)}`);
    }) as unknown as typeof fetch,
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function seed(t: T) {
  return t.run(async (ctx) => {
    const row = (level: Doc<"selectorOptions">["level"], value: string, parentId?: RowId) =>
      ctx.db.insert("selectorOptions", {
        level,
        value,
        ...(parentId ? { parentId } : {}),
        platformData: {},
        children: [],
        lastUpdated: NOW,
      });
    const sport = await row("sport", "Football");
    const year = await row("year", "2026", sport);
    const brand = await row("manufacturer", "Topps", year);
    const set = await row("setName", "Profiles", brand);
    const base = await row("variantType", "Base", set);
    const baseball = await row("sport", "Baseball");
    const player = (name: string, sportId: RowId) =>
      ctx.db.insert("players", { name, nameNormalized: normalizeEntityName(name), sportId, lastUpdated: NOW });
    return {
      sport,
      set,
      base,
      mahomes: await player("Patrick Mahomes", sport),
      kelce: await player("Travis Kelce", sport),
      allen: await player("Josh Allen", sport),
      ohtani: await player("Shohei Ohtani", baseball),
    };
  });
}
type Fx = Awaited<ReturnType<typeof seed>>;

const store = (
  t: T,
  id: RowId,
  values: { defaultPlayerIds?: Array<Id<"players">>; defaultCameoIds?: Array<Id<"players">> },
) => t.run(async (ctx) => ctx.db.patch(id, values));

type ChunkCard = {
  cardNumber: string;
  cardName: string;
  platformData: Record<string, never>;
  sortOrder: number;
  playerNames: string[];
  teamNames: string[];
  playerIds?: Array<Id<"players">>;
  playerLinks?: Array<{ playerId: Id<"players">; nameOnCard: string }>;
  pendingPlayerNames?: string[];
  attributes?: string[];
  existingId?: Id<"cardChecklist">;
  applyFields?: string[];
  baseVersion?: number;
};

const wireCard = (n: string, extra: Partial<ChunkCard> = {}): ChunkCard => ({
  cardNumber: n,
  cardName: `Card ${n}`,
  platformData: {},
  sortOrder: Number.parseInt(n, 10) || 0,
  playerNames: [],
  teamNames: [],
  ...extra,
});

function chunkArgs(
  fx: Fx,
  cards: ChunkCard[],
  inheritedFeatures?: Record<string, string>,
  defaultWritesPerCard?: number,
) {
  return {
    selectorOptionId: fx.base,
    sportValue: "Football",
    setNameValue: "Profiles",
    ...(inheritedFeatures ? { inheritedFeatures } : {}),
    ...(defaultWritesPerCard !== undefined ? { defaultWritesPerCard } : {}),
    cards,
  };
}

const commit = (t: T, fx: Fx, cards: ChunkCard[], inheritedFeatures?: Record<string, string>) =>
  t.mutation(internal.selectorOptions.commitCardChecklistChunk, chunkArgs(fx, cards, inheritedFeatures));

async function cardsOn(t: T, leaf: RowId) {
  const rows = await t.run(async (ctx) =>
    ctx.db
      .query("cardChecklist")
      .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", leaf))
      .collect(),
  );
  return new Map(rows.map((r) => [r.cardNumber, r]));
}

const playerIndex = (t: T, cardId: Id<"cardChecklist">) =>
  t.run(async (ctx) =>
    (await ctx.db.query("cardPlayerLinks").collect())
      .filter((l) => l.cardChecklistId === cardId)
      .map((l) => l.playerId),
  );

const cameoIndex = (t: T, cardId: Id<"cardChecklist">) =>
  t.run(async (ctx) =>
    (
      await ctx.db
        .query("cardSecondaryPlayerLinks")
        .withIndex("by_card", (q) => q.eq("cardChecklistId", cardId))
        .collect()
    ).map((l) => ({ playerId: l.playerId, sportId: l.sportId })),
  );

// ───────────────────────────────────────────────────────────────────────────
// The checklist commit's insert branch
// ───────────────────────────────────────────────────────────────────────────

describe("commitCardChecklistChunk — a new card is born with the defaults", () => {
  test("a card with no player gets the default player: ids and links in the same order, the index row, the title", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await store(t, fx.set, { defaultPlayerIds: [fx.mahomes] });
    await commit(t, fx, [wireCard("1")]);

    const card = (await cardsOn(t, fx.base)).get("1")!;
    expect(card.playerIds).toEqual([fx.mahomes]);
    expect(card.playerLinks).toEqual([{ playerId: fx.mahomes, nameOnCard: "Patrick Mahomes" }]);
    expect(card.playerLinks!.map((l) => l.playerId)).toEqual(card.playerIds);
    expect(await playerIndex(t, card._id)).toEqual([fx.mahomes]);
    expect(card.listingTitle).toContain("Patrick Mahomes");
    expect(card.listingDescription).toMatch(/card of Patrick Mahomes, #1\./);
    // Never a team.
    expect(card.teamOnCardIds ?? []).toEqual([]);
    expect(await t.run(async (ctx) => ctx.db.query("cardTeamLinks").collect())).toEqual([]);
  });

  test("an autograph born with the default player has them as Signed By", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await store(t, fx.base, { defaultPlayerIds: [fx.mahomes] });
    await commit(t, fx, [wireCard("1", { attributes: ["AU"] })], { autographFormat: "On Card" });
    const card = (await cardsOn(t, fx.base)).get("1")!;
    expect(card.features?.autographed).toBe("On Card");
    expect(card.features?.signedBy).toBe("Patrick Mahomes");
  });

  test("a marketplace-resolved player is kept, and the default cameos still go on", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await store(t, fx.set, { defaultPlayerIds: [fx.mahomes], defaultCameoIds: [fx.kelce] });
    await commit(t, fx, [
      wireCard("1", {
        playerIds: [fx.allen],
        playerLinks: [{ playerId: fx.allen, nameOnCard: "J. Allen" }],
        playerNames: ["Josh Allen"],
      }),
    ]);
    const card = (await cardsOn(t, fx.base)).get("1")!;
    expect(card.playerIds).toEqual([fx.allen]);
    expect(card.playerLinks).toEqual([{ playerId: fx.allen, nameOnCard: "J. Allen" }]);
    expect(card.listingTitle).toContain("Josh Allen");
    expect(card.listingTitle).not.toContain("Mahomes");
    expect(card.secondaryPlayerIds).toEqual([fx.kelce]);
  });

  test("a default cameo who is the card's own player is not also its cameo", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await store(t, fx.set, { defaultCameoIds: [fx.allen, fx.kelce] });
    await commit(t, fx, [
      wireCard("1", {
        playerIds: [fx.allen],
        playerLinks: [{ playerId: fx.allen, nameOnCard: "Josh Allen" }],
        playerNames: ["Josh Allen"],
      }),
    ]);
    const card = (await cardsOn(t, fx.base)).get("1")!;
    expect(card.secondaryPlayerIds).toEqual([fx.kelce]);
    expect(await cameoIndex(t, card._id)).toEqual([{ playerId: fx.kelce, sportId: fx.sport }]);
    expect(card.listingDescription).toContain("Cameo: Travis Kelce.");
  });

  test("a pending name blocks the default player but not the cameos", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await store(t, fx.set, { defaultPlayerIds: [fx.mahomes], defaultCameoIds: [fx.kelce] });
    await commit(t, fx, [wireCard("1", { pendingPlayerNames: ["Pat Mahomes II"] })]);
    const card = (await cardsOn(t, fx.base)).get("1")!;
    expect(card.playerIds).toBeUndefined();
    expect(card.playerLinks).toBeUndefined();
    expect(card.pendingPlayerNames).toEqual(["Pat Mahomes II"]);
    expect(await playerIndex(t, card._id)).toEqual([]);
    expect(card.secondaryPlayerIds).toEqual([fx.kelce]);
    expect(await cameoIndex(t, card._id)).toEqual([{ playerId: fx.kelce, sportId: fx.sport }]);
  });

  test("cameos are born with their index rows and the description line, in stored order, and named in a title with room", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await store(t, fx.base, { defaultPlayerIds: [fx.mahomes], defaultCameoIds: [fx.kelce, fx.allen] });
    await commit(t, fx, [wireCard("1")]);
    const card = (await cardsOn(t, fx.base)).get("1")!;
    expect(card.secondaryPlayerIds).toEqual([fx.kelce, fx.allen]);
    expect(await cameoIndex(t, card._id)).toEqual([
      { playerId: fx.kelce, sportId: fx.sport },
      { playerId: fx.allen, sportId: fx.sport },
    ]);
    expect(card.listingDescription!.split("\n")).toContain("Cameos: Travis Kelce, Josh Allen.");
    // Jason (NEO-528 + NEO-535 merge): cameos are in the title while it has
    // room, after the card's own player; the first meaningful thing it drops.
    expect(card.listingTitle).toContain("Patrick Mahomes & Travis Kelce & Josh Allen");
  });

  test("a default whose player is gone, or plays another sport, is left off; the card is still born", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await store(t, fx.set, { defaultPlayerIds: [fx.ohtani], defaultCameoIds: [fx.allen, fx.kelce] });
    await t.run(async (ctx) => ctx.db.delete(fx.allen));
    await commit(t, fx, [wireCard("1")]);
    const card = (await cardsOn(t, fx.base)).get("1")!;
    expect(card.playerIds).toBeUndefined();
    expect(card.secondaryPlayerIds).toEqual([fx.kelce]);
  });

  test("an existing card is never filled, even when it has no player", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    const existing = await t.run((ctx) =>
      insertTestCard(ctx, {
        selectorOptionId: fx.base,
        cardNumber: "1",
        cardName: "Card 1",
        listingTitle: "typed",
        platformData: {},
        sortOrder: 1,
        lastUpdated: NOW,
      }),
    );
    await store(t, fx.set, { defaultPlayerIds: [fx.mahomes], defaultCameoIds: [fx.kelce] });
    await commit(t, fx, [wireCard("1", { existingId: existing }), wireCard("2")]);
    const cards = await cardsOn(t, fx.base);
    const old = cards.get("1")!;
    expect(old._id).toBe(existing);
    expect(old.playerIds).toBeUndefined();
    expect(old.playerLinks).toBeUndefined();
    expect(old.secondaryPlayerIds).toBeUndefined();
    expect(old.listingTitle).toBe("typed");
    expect(await playerIndex(t, existing)).toEqual([]);
    expect(await cameoIndex(t, existing)).toEqual([]);
    // The new card beside it is filled.
    expect(cards.get("2")!.playerIds).toEqual([fx.mahomes]);
  });

  test("with no defaults anywhere, the row is exactly what it was before (no cameo field, no extra index rows)", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await commit(t, fx, [wireCard("1")]);
    const card = (await cardsOn(t, fx.base)).get("1")!;
    expect(card.playerIds).toBeUndefined();
    expect(card).not.toHaveProperty("secondaryPlayerIds");
    expect(card.listingDescription).not.toMatch(/Cameo/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// What one full chunk costs with defaults set
// ───────────────────────────────────────────────────────────────────────────

/** `ctx.db` with every call counted: each get, query range, insert, patch, delete and replace. */
function counting(db: MutationCtx["db"]) {
  const stats = { reads: 0, writes: 0 };
  const wrapped = new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop) as unknown;
      if (typeof value !== "function") return value;
      if (prop === "get" || prop === "query") {
        return (...a: unknown[]) => {
          stats.reads++;
          return (value as (...x: unknown[]) => unknown).apply(target, a);
        };
      }
      if (prop === "insert" || prop === "patch" || prop === "delete" || prop === "replace") {
        return (...a: unknown[]) => {
          stats.writes++;
          return (value as (...x: unknown[]) => unknown).apply(target, a);
        };
      }
      return value.bind(target);
    },
  });
  return { db: wrapped as MutationCtx["db"], stats };
}

describe("one full commit chunk with defaults set stays inside the transaction budget", () => {
  async function chunkCost(defaults: { player: boolean; cameos: number }) {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    const cameos = await t.run(async (ctx) => {
      const out: Array<Id<"players">> = [];
      for (let i = 0; i < defaults.cameos; i++) {
        out.push(
          await ctx.db.insert("players", {
            name: `Cameo ${i}`,
            nameNormalized: `cameo ${i}`,
            sportId: fx.sport,
            lastUpdated: NOW,
          }),
        );
      }
      return out;
    });
    await store(t, fx.set, {
      ...(defaults.player ? { defaultPlayerIds: [fx.mahomes] } : {}),
      ...(cameos.length > 0 ? { defaultCameoIds: cameos } : {}),
    });
    const cards = Array.from({ length: CARDS_PER_COMMIT_CHUNK }, (_, i) => wireCard(String(i + 1)));
    const handler = (commitCardChecklistChunk as unknown as {
      _handler: (ctx: MutationCtx, args: ReturnType<typeof chunkArgs>) => Promise<{ storedIds: unknown[] }>;
    })._handler;
    return t.run(async (ctx) => {
      const { db, stats } = counting(ctx.db);
      // Sized as the action sizes it, so the chunk applies every default.
      const sized = (defaults.player ? 1 : 0) + defaults.cameos;
      const result = await handler({ ...ctx, db }, chunkArgs(fx, cards, undefined, sized));
      return { stored: result.storedIds.length, ...stats };
    });
  }

  test("the default player and cameos add only their index writes, and nothing per card to read", async () => {
    const none = await chunkCost({ player: false, cameos: 0 });
    const some = await chunkCost({ player: true, cameos: 2 });
    const full = await chunkCost({ player: true, cameos: MAX_CARD_PLAYERS });
    expect(none.stored).toBe(CARDS_PER_COMMIT_CHUNK);
    expect(some.stored).toBe(CARDS_PER_COMMIT_CHUNK);
    expect(full.stored).toBe(CARDS_PER_COMMIT_CHUNK);
    // Reads: the defaults are looked up once per chunk (the chain and each
    // default player), never once per card.
    expect(some.reads - none.reads).toBeLessThan(20);
    expect(full.reads - none.reads).toBeLessThan(20 + MAX_CARD_PLAYERS);
    // Writes: per card, one player index row and one row per cameo.
    expect(some.writes - none.writes).toBe(CARDS_PER_COMMIT_CHUNK * (1 + 2));
    expect(full.writes - none.writes).toBe(CARDS_PER_COMMIT_CHUNK * (1 + MAX_CARD_PLAYERS));
    console.log(JSON.stringify({ none, some, full }));
  });
});

describe("the commit sizes its chunks for the defaults' index rows", () => {
  test("150 cards with a default player or one cameo; fewer with a long cameo list, never more than the budget", () => {
    expect(commitChunkSize(0)).toBe(CARDS_PER_COMMIT_CHUNK);
    expect(commitChunkSize(1)).toBe(CARDS_PER_COMMIT_CHUNK);
    expect(commitChunkSize(2)).toBe(CARDS_PER_COMMIT_CHUNK);
    const atCap = commitChunkSize(1 + MAX_CARD_PLAYERS);
    expect(atCap).toBeLessThan(CARDS_PER_COMMIT_CHUNK);
    // Measured above: a full chunk with a player and every cameo writes
    // 1 + MAX_CARD_PLAYERS more per card than one without; at this size the
    // chunk writes no more than a 150-card chunk with two such rows per card.
    expect(atCap * (1 + MAX_CARD_PLAYERS)).toBeLessThanOrEqual(CARDS_PER_COMMIT_CHUNK * (6 + 2));
    expect(commitChunkSize(1000)).toBeGreaterThanOrEqual(1);
  });

  test("a commit under a leaf with a long default cameo list runs in smaller chunks and fills every card", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    const cameos = await t.run(async (ctx) => {
      const out: Array<Id<"players">> = [];
      for (let i = 0; i < MAX_CARD_PLAYERS; i++) {
        out.push(
          await ctx.db.insert("players", { name: `Cameo ${i}`, nameNormalized: `cameo ${i}`, sportId: fx.sport, lastUpdated: NOW }),
        );
      }
      return out;
    });
    await store(t, fx.set, { defaultPlayerIds: [fx.mahomes], defaultCameoIds: cameos });
    const COUNT = 100;
    const size = commitChunkSize(1 + MAX_CARD_PLAYERS);
    expect(Math.ceil(COUNT / size)).toBeGreaterThan(1);

    const chunk = commitCardChecklistChunk as unknown as { _handler: (...args: unknown[]) => Promise<unknown> };
    const spy = vi.spyOn(chunk, "_handler");
    try {
      const result = await t.withIdentity(ADMIN).action(api.selectorOptions.commitCardChecklist, {
        selectorOptionId: fx.base,
        sportId: fx.sport,
        cards: Array.from({ length: COUNT }, (_, i) => ({
          cardNumber: String(i + 1),
          cardName: `Card ${i + 1}`,
          players: [],
          teams: [],
          attributes: [],
          platformData: { bsc: { ref: `bsc-${i + 1}` } },
        })),
      });
      expect(result).toMatchObject({ success: true, count: COUNT });
      expect(spy.mock.calls.length).toBe(Math.ceil(COUNT / size));
    } finally {
      spy.mockRestore();
    }
    const cards = await cardsOn(t, fx.base);
    expect(cards.size).toBe(COUNT);
    for (const card of cards.values()) {
      expect(card.playerIds).toEqual([fx.mahomes]);
      expect(card.secondaryPlayerIds).toEqual(cameos);
    }
    await drainScheduled(t);
    await cancelScheduled(t);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// A hand-added card
// ───────────────────────────────────────────────────────────────────────────

describe("addCustomCard — a hand-added card is born with the defaults", () => {
  const add = (t: T, fx: Fx, extra: { playerIds?: Array<Id<"players">>; players?: string[] } = {}) =>
    t.withIdentity(ADMIN).mutation(api.selectorOptions.addCustomCard, {
      selectorOptionId: fx.base,
      cardNumber: "7",
      cardName: "Card 7",
      ...extra,
    });
  const get = (t: T, id: Id<"cardChecklist">) => t.run(async (ctx) => (await ctx.db.get(id))!);

  test("no player picked or typed: the default player and cameos, with their index rows and listing text", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await store(t, fx.set, { defaultPlayerIds: [fx.mahomes], defaultCameoIds: [fx.kelce] });
    const id = await add(t, fx);
    const card = await get(t, id);
    expect(card.playerIds).toEqual([fx.mahomes]);
    expect(card.playerLinks).toEqual([{ playerId: fx.mahomes, nameOnCard: "Patrick Mahomes" }]);
    expect(await playerIndex(t, id)).toEqual([fx.mahomes]);
    expect(card.secondaryPlayerIds).toEqual([fx.kelce]);
    expect(await cameoIndex(t, id)).toEqual([{ playerId: fx.kelce, sportId: fx.sport }]);
    expect(card.listingTitle).toContain("Patrick Mahomes & Travis Kelce");
    expect(card.listingDescription).toContain("Cameo: Travis Kelce.");
    expect(card.teamOnCardIds).toBeUndefined();
  });

  test("a picked player wins; a typed name blocks the player but not the cameos", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await store(t, fx.set, { defaultPlayerIds: [fx.mahomes], defaultCameoIds: [fx.kelce] });
    const picked = await get(t, await add(t, fx, { playerIds: [fx.allen] }));
    expect(picked.playerIds).toEqual([fx.allen]);
    expect(picked.secondaryPlayerIds).toEqual([fx.kelce]);
    const typed = await get(t, await add(t, fx, { players: ["Pat Mahomes II"] }));
    expect(typed.playerIds).toBeUndefined();
    expect(typed.pendingPlayerNames).toEqual(["Pat Mahomes II"]);
    expect(typed.secondaryPlayerIds).toEqual([fx.kelce]);
    // A hand-added card has no listing: it never carries the listing's claim,
    // typed name or not.
    expect(picked).not.toHaveProperty("listingNamedPlayer");
    expect(typed).not.toHaveProperty("listingNamedPlayer");
  });

  test("a default whose player was deleted is dropped and the card is still added", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await store(t, fx.set, { defaultPlayerIds: [fx.mahomes], defaultCameoIds: [fx.allen, fx.kelce] });
    await t.run(async (ctx) => {
      await ctx.db.delete(fx.mahomes);
      await ctx.db.delete(fx.allen);
    });
    const card = await get(t, await add(t, fx));
    expect(card.playerIds).toBeUndefined();
    expect(card.secondaryPlayerIds).toEqual([fx.kelce]);
    expect(await cameoIndex(t, card._id)).toEqual([{ playerId: fx.kelce, sportId: fx.sport }]);
  });

  test("with no defaults the card is born as before", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    const card = await get(t, await add(t, fx));
    expect(card.playerIds).toBeUndefined();
    expect(card).not.toHaveProperty("secondaryPlayerIds");
    expect(await cameoIndex(t, card._id)).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The pre-save title facts
// ───────────────────────────────────────────────────────────────────────────

describe("titleSetFacts — the default player's name and id for the pre-save titles", () => {
  test("names the effective default player (never a cameo) with their id; empty and absent when there is none", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    const facts = () =>
      t.query(internal.listingTitleContext.titleSetFacts, { selectorOptionId: fx.base, sportId: fx.sport });
    expect((await facts()).setPlayerNames).toEqual([]);
    expect(await facts()).not.toHaveProperty("setPlayerId");
    await store(t, fx.set, { defaultCameoIds: [fx.kelce] });
    expect((await facts()).setPlayerNames).toEqual([]);
    expect(await facts()).not.toHaveProperty("setPlayerId");
    await store(t, fx.set, { defaultPlayerIds: [fx.mahomes] });
    expect(await facts()).toMatchObject({ setPlayerNames: ["Patrick Mahomes"], setPlayerId: fx.mahomes });
    // Nearest wins, as at the insert.
    await store(t, fx.base, { defaultPlayerIds: [fx.allen] });
    expect(await facts()).toMatchObject({ setPlayerNames: ["Josh Allen"], setPlayerId: fx.allen });
    // Another sport's player is dropped, as at the insert.
    await store(t, fx.base, { defaultPlayerIds: [fx.ohtani] });
    expect((await facts()).setPlayerNames).toEqual([]);
    expect(await facts()).not.toHaveProperty("setPlayerId");
    // A deleted player is dropped too.
    await store(t, fx.base, { defaultPlayerIds: [fx.kelce] });
    await t.run(async (ctx) => ctx.db.delete(fx.kelce));
    expect(await facts()).not.toHaveProperty("setPlayerId");
    expect((await facts()).setPlayerNames).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Audit round 3: S1, N1, N4
// ───────────────────────────────────────────────────────────────────────────

describe("a re-sync never clears a stored roster (S1)", () => {
  test("an accepted playerIds change with an empty incoming list leaves the player, the links and the index alone", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    const existing = await t.run(async (ctx) => {
      const id = await insertTestCard(ctx, {
        selectorOptionId: fx.base,
        cardNumber: "1",
        cardName: "Card 1",
        playerIds: [fx.mahomes],
        playerLinks: [{ playerId: fx.mahomes, nameOnCard: "Patrick Mahomes" }],
        platformData: {},
        sortOrder: 1,
        lastUpdated: NOW,
      });
      await syncCardPlayerLinks(ctx, id, [fx.mahomes], fx.sport);
      return id;
    });
    for (const playerIds of [[], undefined]) {
      const before = (await cardsOn(t, fx.base)).get("1")!;
      await commit(t, fx, [
        wireCard("1", {
          existingId: existing,
          applyFields: ["playerIds"],
          baseVersion: before.lastUpdated,
          ...(playerIds ? { playerIds, playerLinks: [] } : {}),
        }),
      ]);
      const card = (await cardsOn(t, fx.base)).get("1")!;
      expect(card.playerIds).toEqual([fx.mahomes]);
      expect(card.playerLinks).toEqual([{ playerId: fx.mahomes, nameOnCard: "Patrick Mahomes" }]);
      expect(await playerIndex(t, existing)).toEqual([fx.mahomes]);
    }
    // A non-empty accepted change still writes, as before.
    const before = (await cardsOn(t, fx.base)).get("1")!;
    await commit(t, fx, [
      wireCard("1", {
        existingId: existing,
        applyFields: ["playerIds"],
        baseVersion: before.lastUpdated,
        playerIds: [fx.allen],
        playerLinks: [{ playerId: fx.allen, nameOnCard: "Josh Allen" }],
      }),
    ]);
    const after = (await cardsOn(t, fx.base)).get("1")!;
    expect(after.playerIds).toEqual([fx.allen]);
    expect(await playerIndex(t, existing)).toEqual([fx.allen]);
  });
});

describe("a chunk applies no more default rows than it was sized for (N1)", () => {
  test("the allowance is the sized count; with none sized, the room the chunk's length leaves", () => {
    expect(commitChunkDefaultAllowance(CARDS_PER_COMMIT_CHUNK, 3)).toBe(3);
    expect(commitChunkDefaultAllowance(10, 0)).toBe(0);
    expect(commitChunkDefaultAllowance(CARDS_PER_COMMIT_CHUNK, undefined)).toBe(
      Math.floor(COMMIT_CHUNK_OP_BUDGET / CARDS_PER_COMMIT_CHUNK) - 6,
    );
    // Every size the action can pick leaves the sized count inside the budget.
    for (const sized of [0, 1, 2, 5, 1 + MAX_CARD_PLAYERS]) {
      expect(commitChunkSize(sized) * (6 + Math.max(sized, 1))).toBeLessThanOrEqual(COMMIT_CHUNK_OP_BUDGET);
    }
  });

  test("the cap cuts cameos only, in stored order, and keeps the player", () => {
    const ids = ["p", "a", "b", "c"] as unknown as Array<Id<"players">>;
    const defaults = {
      playerId: ids[0],
      player: { _id: ids[0], name: "P" },
      cameoIds: ids.slice(1),
      cameos: ids.slice(1).map((id) => ({ _id: id, name: String(id) })),
      playerFromId: null,
      cameosFromId: null,
    };
    expect(capChunkPlayerDefaults(defaults, 2).cameoIds).toEqual(["a"]);
    expect(capChunkPlayerDefaults(defaults, 2).cameos.map((c) => c._id)).toEqual(["a"]);
    expect(capChunkPlayerDefaults(defaults, 0)).toMatchObject({ playerId: "p", cameoIds: [] });
    expect(capChunkPlayerDefaults(defaults, 10)).toBe(defaults);
    expect(capChunkPlayerDefaults({ ...defaults, playerId: null, player: null }, 2).cameoIds).toEqual(["a", "b"]);
  });

  test("cameos added after the commit was sized are cut to what the chunk was sized for", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    // Sized for the player and one cameo (2 rows per card) ...
    // ... then the operator widened the list to three.
    await store(t, fx.set, { defaultPlayerIds: [fx.mahomes], defaultCameoIds: [fx.kelce, fx.allen] });
    const extra = await t.run(async (ctx) =>
      ctx.db.insert("players", { name: "Chris Jones", nameNormalized: "chris jones", sportId: fx.sport, lastUpdated: NOW }),
    );
    await store(t, fx.set, { defaultCameoIds: [fx.kelce, fx.allen, extra] });
    const cards = Array.from({ length: commitChunkSize(2) }, (_, i) => wireCard(String(i + 1)));
    await t.mutation(internal.selectorOptions.commitCardChecklistChunk, chunkArgs(fx, cards, undefined, 2));
    const stored = await cardsOn(t, fx.base);
    expect(stored.size).toBe(cards.length);
    for (const card of stored.values()) {
      expect(card.playerIds).toEqual([fx.mahomes]);
      expect(card.secondaryPlayerIds).toEqual([fx.kelce]);
      // The description names exactly the stored cameos.
      expect(card.listingDescription!.split("\n")).toContain("Cameo: Travis Kelce.");
    }
  });
});

describe("a card whose listing named a player is never given the default player (N4)", () => {
  test("a name entity review ruled out stays out of review AND holds back the default; the cameos still go on", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await store(t, fx.set, { defaultPlayerIds: [fx.mahomes], defaultCameoIds: [fx.kelce] });
    // An earlier save ruled "Team Leaders" not a person, for this checklist.
    await t.run(async (ctx) =>
      ctx.db.insert("entityReviewSkips", {
        selectorOptionId: fx.base,
        kind: "player",
        nameNormalized: normalizeEntityName("Team Leaders"),
        name: "Team Leaders",
        skippedAt: NOW,
        skippedByUserId: "admin_earlier",
      }),
    );
    const card = (n: string, players: string[]) => ({
      cardNumber: n,
      cardName: `Card ${n}`,
      players,
      teams: [],
      attributes: [],
      platformData: { bsc: { ref: `bsc-${n}` } },
    });
    const result = await t.withIdentity(ADMIN).action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: fx.base,
      sportId: fx.sport,
      cards: [
        card("1", ["Team Leaders"]),
        card("2", []),
        card("3", ["  "]),
        card("4", ["Josh Allen"]),
        card("5", ["Unknown Rookie"]),
      ],
    });
    expect(result).toMatchObject({ success: true, count: 5 });
    const cards = await cardsOn(t, fx.base);
    const leaders = cards.get("1")!;
    // The listing named someone: no default player, nothing pending (the skip
    // keeps the name out of the next review), the cameo still added.
    expect(leaders.playerIds).toBeUndefined();
    expect(leaders.playerLinks).toBeUndefined();
    expect(leaders.pendingPlayerNames).toBeUndefined();
    expect(await playerIndex(t, leaders._id)).toEqual([]);
    expect(leaders.secondaryPlayerIds).toEqual([fx.kelce]);
    // A card the listing named nobody on (or only blanks) gets the default.
    for (const n of ["2", "3"]) {
      expect(cards.get(n)!.playerIds).toEqual([fx.mahomes]);
      expect(cards.get(n)!.secondaryPlayerIds).toEqual([fx.kelce]);
    }
    // A card naming a person keeps them; the cameo still goes on.
    expect(cards.get("4")!.playerIds).toEqual([fx.allen]);
    expect(cards.get("4")!.secondaryPlayerIds).toEqual([fx.kelce]);
    // A name still waiting for review stays pending and the card is left
    // blank (Jason, 2026-11-15); the cameo still goes on.
    const pending = cards.get("5")!;
    expect(pending.playerIds).toBeUndefined();
    expect(pending.pendingPlayerNames).toEqual(["Unknown Rookie"]);
    expect(pending.secondaryPlayerIds).toEqual([fx.kelce]);
    // The claim is stored on every card whose listing named someone, so a
    // parallel copied from it later holds the default back too; never on a
    // card the listing named nobody on.
    for (const n of ["1", "4", "5"]) expect(cards.get(n)!.listingNamedPlayer, n).toBe(true);
    for (const n of ["2", "3"]) expect(cards.get(n)!, n).not.toHaveProperty("listingNamedPlayer");
    // ... and the checklist query returns it: its returns validator is strict,
    // so a field it does not list would fail the whole read.
    const served = await t
      .withIdentity(ADMIN)
      .query(api.selectorOptions.getCardChecklist, { selectorOptionId: fx.base });
    const byNumber = new Map(served.map((c) => [c.cardNumber, c]));
    expect(byNumber.size).toBe(5);
    for (const n of ["1", "4", "5"]) expect(byNumber.get(n)!.listingNamedPlayer, n).toBe(true);
    for (const n of ["2", "3"]) expect(byNumber.get(n)!, n).not.toHaveProperty("listingNamedPlayer");
    await drainScheduled(t);
    await cancelScheduled(t);
  });
});
