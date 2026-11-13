/**
 * NEO-528 — a card's also-pictured players (`cardChecklist.secondaryPlayerIds`)
 * and their index (`cardSecondaryPlayerLinks`), through the one writer.
 *
 * Fixture: `seedCollectionCatalog` — Topps Chrome with Base (#1 Gooden, #2
 * Strawberry, #1 Gooden "Sliding"), Inserts › Future Stars (#FS-1 Gooden)
 * and Parallels › Gold Refractor (#1 Gooden /50).
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { seedCollectionCatalog } from "../lib/testing/collection-fixture";
import { insertTestCard } from "../lib/testing/card-row";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import {
  BULK_PAGE,
  TOO_MANY_SECONDARY_PLAYERS,
  planSecondaryPlayerIds,
  planSecondaryPlayerLinks,
  setCardSecondaryPlayers,
} from "./cardSecondaryPlayers";
import { MAX_CARD_PLAYERS } from "./features/cardAttention";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = { subject: "admin_neo528", role: "admin" };
const MEMBER = { subject: "member_neo528", role: "member" };
const NOW = 1_700_000_000_000;

afterEach(() => {
  vi.unstubAllEnvs();
});

async function setup() {
  const t = convexTest(schema, modules);
  const fx = await seedCollectionCatalog(t);
  return { t, fx, admin: t.withIdentity(ADMIN) };
}
type S = Awaited<ReturnType<typeof setup>>;

const cardOf = (s: S, id: Id<"cardChecklist">) => s.t.run(async (ctx) => (await ctx.db.get(id))!);

const linksOf = (s: S, id: Id<"cardChecklist">) =>
  s.t.run(async (ctx) =>
    ctx.db
      .query("cardSecondaryPlayerLinks")
      .withIndex("by_card", (q) => q.eq("cardChecklistId", id))
      .collect(),
  );

const newPlayer = (s: S, name: string, sportId?: Id<"selectorOptions">) =>
  s.t.run(async (ctx) =>
    ctx.db.insert("players", {
      name,
      nameNormalized: normalizeEntityName(name),
      sportId: sportId ?? s.fx.sportId,
      lastUpdated: NOW,
    }),
  );

describe("the pure plan", () => {
  const card = { playerIds: ["a" as Id<"players">], playerLinks: [{ playerId: "b" as Id<"players">, nameOnCard: "B" }] };

  test("dedupes, keeps order, and strips the card's own players (playerIds and playerLinks)", () => {
    const ids = ["c", "a", "c", "b", "d"] as Array<Id<"players">>;
    expect(planSecondaryPlayerIds(card, ids)).toEqual({ ids: ["c", "d"], strippedPrimary: 2 });
  });

  test("refuses more than MAX_CARD_PLAYERS after the strip", () => {
    const ok = Array.from({ length: MAX_CARD_PLAYERS }, (_, i) => `p${i}`) as Array<Id<"players">>;
    expect(planSecondaryPlayerIds(card, [...ok, "a" as Id<"players">]).ids).toHaveLength(MAX_CARD_PLAYERS);
    expect(() => planSecondaryPlayerIds(card, [...ok, "extra" as Id<"players">])).toThrow(TOO_MANY_SECONDARY_PLAYERS);
  });

  test("the index diff keeps one row per player and removes the rest", () => {
    const existing = [
      { _id: "r1" as Id<"cardSecondaryPlayerLinks">, playerId: "a" as Id<"players"> },
      { _id: "r2" as Id<"cardSecondaryPlayerLinks">, playerId: "a" as Id<"players"> },
      { _id: "r3" as Id<"cardSecondaryPlayerLinks">, playerId: "x" as Id<"players"> },
    ];
    expect(planSecondaryPlayerLinks(existing, ["a", "b"] as Array<Id<"players">>)).toEqual({
      toDelete: ["r2", "r3"],
      toInsert: ["b"],
    });
    expect(planSecondaryPlayerLinks(existing, undefined)).toEqual({ toDelete: ["r1", "r2", "r3"], toInsert: [] });
  });
});

describe("setSecondaryPlayers (one card)", () => {
  test("stores the list and its index rows, keyed by the card's sport, without touching lastUpdated", async () => {
    const s = await setup();
    const ryan = await newPlayer(s, "Nolan Ryan");
    const before = await cardOf(s, s.fx.strawberry2);
    const result = await s.admin.mutation(api.cardSecondaryPlayers.setSecondaryPlayers, {
      cardId: s.fx.strawberry2,
      playerIds: [s.fx.goodenId, ryan, s.fx.goodenId],
    });
    expect(result).toEqual({ secondaryPlayerIds: [s.fx.goodenId, ryan], strippedPrimary: 0 });
    const after = await cardOf(s, s.fx.strawberry2);
    expect(after.secondaryPlayerIds).toEqual([s.fx.goodenId, ryan]);
    expect(after.lastUpdated).toBe(before.lastUpdated);
    // Nothing that reads the card's own players changed.
    expect(after.playerIds).toEqual(before.playerIds);
    expect(after.listingTitle).toBe(before.listingTitle);
    const links = await linksOf(s, s.fx.strawberry2);
    expect(links.map((l) => l.playerId).sort()).toEqual([s.fx.goodenId, ryan].sort());
    expect(links.every((l) => l.sportId === s.fx.sportId)).toBe(true);
  });

  test("strips the card's own player and says so", async () => {
    const s = await setup();
    const result = await s.admin.mutation(api.cardSecondaryPlayers.setSecondaryPlayers, {
      cardId: s.fx.strawberry2,
      playerIds: [s.fx.strawberryId, s.fx.goodenId],
    });
    expect(result).toEqual({ secondaryPlayerIds: [s.fx.goodenId], strippedPrimary: 1 });
  });

  test("an empty list removes the field and every index row", async () => {
    const s = await setup();
    await s.admin.mutation(api.cardSecondaryPlayers.setSecondaryPlayers, {
      cardId: s.fx.strawberry2,
      playerIds: [s.fx.goodenId],
    });
    await s.admin.mutation(api.cardSecondaryPlayers.setSecondaryPlayers, { cardId: s.fx.strawberry2, playerIds: [] });
    const after = await cardOf(s, s.fx.strawberry2);
    expect("secondaryPlayerIds" in after).toBe(false);
    expect(await linksOf(s, s.fx.strawberry2)).toEqual([]);
  });

  test("a diff keeps the rows that stay, and an unchanged save writes nothing", async () => {
    const s = await setup();
    const ryan = await newPlayer(s, "Nolan Ryan");
    await s.admin.mutation(api.cardSecondaryPlayers.setSecondaryPlayers, {
      cardId: s.fx.strawberry2,
      playerIds: [s.fx.goodenId, ryan],
    });
    const kept = (await linksOf(s, s.fx.strawberry2)).find((l) => l.playerId === s.fx.goodenId)!;
    await s.admin.mutation(api.cardSecondaryPlayers.setSecondaryPlayers, {
      cardId: s.fx.strawberry2,
      playerIds: [s.fx.goodenId],
    });
    const links = await linksOf(s, s.fx.strawberry2);
    expect(links.map((l) => l._id)).toEqual([kept._id]);

    const unchanged = await s.t.run(async (ctx) => {
      const card = (await ctx.db.get(s.fx.strawberry2))!;
      return setCardSecondaryPlayers(ctx, card, [s.fx.goodenId]);
    });
    expect(unchanged.changed).toBe(false);
    expect((await linksOf(s, s.fx.strawberry2)).map((l) => l._id)).toEqual([kept._id]);
  });

  test("refuses over the cap and a player that no longer exists, writing nothing", async () => {
    const s = await setup();
    const many: Array<Id<"players">> = [];
    for (let i = 0; i <= MAX_CARD_PLAYERS; i++) many.push(await newPlayer(s, `Player ${i}`));
    await expect(
      s.admin.mutation(api.cardSecondaryPlayers.setSecondaryPlayers, { cardId: s.fx.strawberry2, playerIds: many }),
    ).rejects.toThrow(/at most/);
    const gone = await newPlayer(s, "Gone Player");
    await s.t.run(async (ctx) => ctx.db.delete(gone));
    await expect(
      s.admin.mutation(api.cardSecondaryPlayers.setSecondaryPlayers, {
        cardId: s.fx.strawberry2,
        playerIds: [s.fx.goodenId, gone],
      }),
    ).rejects.toThrow(/no longer exists/);
    expect((await cardOf(s, s.fx.strawberry2)).secondaryPlayerIds).toBeUndefined();
    expect(await linksOf(s, s.fx.strawberry2)).toEqual([]);
  });

  test("is admin-only", async () => {
    const s = await setup();
    await expect(
      s.t.withIdentity(MEMBER).mutation(api.cardSecondaryPlayers.setSecondaryPlayers, {
        cardId: s.fx.strawberry2,
        playerIds: [s.fx.goodenId],
      }),
    ).rejects.toThrow(/admin/i);
    await expect(
      s.t.mutation(api.cardSecondaryPlayers.setSecondaryPlayers, { cardId: s.fx.strawberry2, playerIds: [] }),
    ).rejects.toThrow(/not authenticated/i);
  });
});

describe("the bulk control (a checklist and its parallels)", () => {
  type Page = Awaited<ReturnType<S["admin"]["mutation"]>> & {
    cursor: string | null;
    targetId: Id<"selectorOptions">;
    changed: number;
    unchanged: number;
    skippedPrimary: number;
    skippedFull: number;
    scanned: number;
  };

  async function runAll(s: S, op: "add" | "remove", variantId: Id<"selectorOptions">, playerId: Id<"players">) {
    const fn =
      op === "add"
        ? api.cardSecondaryPlayers.addSecondaryPlayerToVariant
        : api.cardSecondaryPlayers.removeSecondaryPlayerFromVariant;
    const pages: Page[] = [];
    let cursor: string | null = null;
    do {
      const page = (await s.admin.mutation(fn, { variantId, playerId, cursor })) as Page;
      pages.push(page);
      cursor = page.cursor;
    } while (cursor !== null && pages.length < 50);
    const sum = (k: "changed" | "unchanged" | "skippedPrimary" | "skippedFull" | "scanned") =>
      pages.reduce((n, p) => n + p[k], 0);
    return {
      pages,
      changed: sum("changed"),
      unchanged: sum("unchanged"),
      skippedPrimary: sum("skippedPrimary"),
      skippedFull: sum("skippedFull"),
      scanned: sum("scanned"),
    };
  }

  test("a Base's targets are itself and the inserts under the set's Parallel types, never another insert", async () => {
    const s = await setup();
    const { targets } = await s.admin.query(api.cardSecondaryPlayers.secondaryPlayerBulkTargets, {
      variantId: s.fx.baseId,
    });
    expect(targets).toEqual([
      { _id: s.fx.baseId, name: "Base", role: "home" },
      { _id: s.fx.goldId, name: "Gold Refractor", role: "parallel" },
    ]);
  });

  test("adds to every home card of the Base and its parallels, skipping the cards he is the subject of", async () => {
    const s = await setup();
    const result = await runAll(s, "add", s.fx.baseId, s.fx.strawberryId);
    // Base: Gooden #1, Strawberry #2 (his own card), Gooden Sliding; Gold: Gooden #1.
    expect(result.scanned).toBe(4);
    expect(result.changed).toBe(3);
    expect(result.skippedPrimary).toBe(1);
    expect(result.pages.map((p) => p.targetId)).toEqual([s.fx.baseId, s.fx.goldId]);
    for (const id of [s.fx.gooden1, s.fx.gooden1Sliding, s.fx.gold1]) {
      expect((await cardOf(s, id)).secondaryPlayerIds).toEqual([s.fx.strawberryId]);
      expect((await linksOf(s, id)).map((l) => l.playerId)).toEqual([s.fx.strawberryId]);
    }
    expect((await cardOf(s, s.fx.strawberry2)).secondaryPlayerIds).toBeUndefined();
    // The Future Stars insert is not a parallel of Base: untouched.
    expect((await cardOf(s, s.fx.futureStar)).secondaryPlayerIds).toBeUndefined();

    // Run again: nothing to do.
    const again = await runAll(s, "add", s.fx.baseId, s.fx.strawberryId);
    expect(again.changed).toBe(0);
    expect(again.unchanged).toBe(3);
  });

  test("remove is the inverse, and leaves other cameos alone", async () => {
    const s = await setup();
    const ryan = await newPlayer(s, "Nolan Ryan");
    await runAll(s, "add", s.fx.baseId, s.fx.strawberryId);
    await runAll(s, "add", s.fx.baseId, ryan);
    const removed = await runAll(s, "remove", s.fx.baseId, s.fx.strawberryId);
    expect(removed.changed).toBe(3);
    expect(removed.unchanged).toBe(1);
    for (const id of [s.fx.gooden1, s.fx.gooden1Sliding, s.fx.gold1]) {
      expect((await cardOf(s, id)).secondaryPlayerIds).toEqual([ryan]);
      expect((await linksOf(s, id)).map((l) => l.playerId)).toEqual([ryan]);
    }
    expect((await cardOf(s, s.fx.strawberry2)).secondaryPlayerIds).toEqual([ryan]);
    const cleared = await runAll(s, "remove", s.fx.baseId, ryan);
    expect(cleared.changed).toBe(4);
    for (const id of [s.fx.gooden1, s.fx.strawberry2, s.fx.gooden1Sliding, s.fx.gold1]) {
      expect((await cardOf(s, id)).secondaryPlayerIds).toBeUndefined();
      expect(await linksOf(s, id)).toEqual([]);
    }
  });

  test("pages a long checklist BULK_PAGE cards at a time, the cursor carrying the client from page to page", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (let i = 0; i < BULK_PAGE + 5; i++) {
        await insertTestCard(ctx, {
          selectorOptionId: s.fx.futureStarsId,
          cardNumber: `X-${i}`,
          cardName: "Extra",
          platformData: {},
          sortOrder: 10 + i,
          lastUpdated: NOW,
        });
      }
    });
    const result = await runAll(s, "add", s.fx.futureStarsId, s.fx.strawberryId);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0].scanned).toBe(BULK_PAGE);
    expect(result.pages[0].cursor).not.toBeNull();
    expect(result.scanned).toBe(BULK_PAGE + 6);
    expect(result.changed).toBe(BULK_PAGE + 6);
  });

  test("a card already holding the most cameos it can is skipped and counted", async () => {
    const s = await setup();
    const full: Array<Id<"players">> = [];
    for (let i = 0; i < MAX_CARD_PLAYERS; i++) full.push(await newPlayer(s, `Full ${i}`));
    await s.admin.mutation(api.cardSecondaryPlayers.setSecondaryPlayers, { cardId: s.fx.gold1, playerIds: full });
    const result = await runAll(s, "add", s.fx.goldId, s.fx.strawberryId);
    expect(result.skippedFull).toBe(1);
    expect((await cardOf(s, s.fx.gold1)).secondaryPlayerIds).toEqual(full);
  });

  test("refuses a marker it did not hand out, a non-card row, and a non-admin", async () => {
    const s = await setup();
    const args = { variantId: s.fx.baseId, playerId: s.fx.goodenId };
    await expect(
      s.admin.mutation(api.cardSecondaryPlayers.addSecondaryPlayerToVariant, { ...args, cursor: "nope" }),
    ).rejects.toThrow(/progress marker/);
    await expect(
      s.admin.mutation(api.cardSecondaryPlayers.addSecondaryPlayerToVariant, {
        ...args,
        cursor: JSON.stringify({ i: 9, c: null }),
      }),
    ).rejects.toThrow(/past the end/);
    await expect(
      s.admin.mutation(api.cardSecondaryPlayers.addSecondaryPlayerToVariant, {
        variantId: s.fx.setId,
        playerId: s.fx.goodenId,
        cursor: null,
      }),
    ).rejects.toThrow(/Pick a checklist/);
    await expect(
      s.t.withIdentity(MEMBER).mutation(api.cardSecondaryPlayers.removeSecondaryPlayerFromVariant, { ...args, cursor: null }),
    ).rejects.toThrow(/admin/i);
    await expect(
      s.t.withIdentity(MEMBER).query(api.cardSecondaryPlayers.secondaryPlayerBulkTargets, { variantId: s.fx.baseId }),
    ).rejects.toThrow(/admin/i);
  });
});

describe("a card delete takes its cameo index rows with it", () => {
  test("deleteCard (through removeCardRow) leaves no orphan row", async () => {
    const s = await setup();
    await s.admin.mutation(api.cardSecondaryPlayers.setSecondaryPlayers, {
      cardId: s.fx.futureStar,
      playerIds: [s.fx.strawberryId],
    });
    expect(await linksOf(s, s.fx.futureStar)).toHaveLength(1);
    await s.admin.mutation(api.selectorOptions.deleteCard, { id: s.fx.futureStar });
    expect(await linksOf(s, s.fx.futureStar)).toEqual([]);
  });

  test("the E2E reset drain empties the table, armed only", async () => {
    const s = await setup();
    await s.admin.mutation(api.cardSecondaryPlayers.setSecondaryPlayers, {
      cardId: s.fx.futureStar,
      playerIds: [s.fx.strawberryId],
    });
    await expect(s.t.mutation(internal.selectorOptions.resetCardSecondaryPlayerLinksBatch, {})).rejects.toThrow(
      /ALLOW_RESET_SET_BUILDER_DATA/,
    );
    vi.stubEnv("ALLOW_RESET_SET_BUILDER_DATA", "true");
    expect(await s.t.mutation(internal.selectorOptions.resetCardSecondaryPlayerLinksBatch, {})).toEqual({
      deleted: 1,
      hasMore: false,
    });
    expect(await linksOf(s, s.fx.futureStar)).toEqual([]);
  });
});

describe("the catalog card names who else is pictured", () => {
  test("secondaryPlayers is absent with none, and leaves out one who is now the card's own player", async () => {
    const s = await setup();
    const signedIn = s.t.withIdentity({ subject: "collector_528" });
    const plain = await signedIn.query(api.collectionCatalog.card, { cardId: s.fx.strawberry2 });
    expect(plain && "secondaryPlayers" in plain).toBe(false);
    await s.admin.mutation(api.cardSecondaryPlayers.setSecondaryPlayers, {
      cardId: s.fx.strawberry2,
      playerIds: [s.fx.goodenId],
    });
    const shown = await signedIn.query(api.collectionCatalog.card, { cardId: s.fx.strawberry2 });
    expect(shown?.secondaryPlayers).toEqual([{ _id: s.fx.goodenId, name: "Dwight Gooden" }]);
    // A later edit makes Gooden the subject: he is shown once, as a player.
    await s.t.run(async (ctx) => {
      await ctx.db.patch(s.fx.strawberry2, {
        playerIds: [s.fx.strawberryId, s.fx.goodenId],
        playerLinks: [
          { playerId: s.fx.strawberryId, nameOnCard: "Darryl Strawberry" },
          { playerId: s.fx.goodenId, nameOnCard: "Dwight Gooden" },
        ],
      });
    });
    const after = await signedIn.query(api.collectionCatalog.card, { cardId: s.fx.strawberry2 });
    expect(after && "secondaryPlayers" in after).toBe(false);
  });
});

describe("the player sport-removal guard counts cameos", () => {
  test("SPORT_HAS_CARDS when the sport's only card pictures him without being about him", async () => {
    const s = await setup();
    const football = await s.t.run(async (ctx) =>
      ctx.db.insert("selectorOptions", {
        level: "sport",
        value: "Football",
        platformData: {},
        children: [],
        lastUpdated: NOW,
      }),
    );
    const bo = await newPlayer(s, "Bo Jackson", football);
    await s.admin.mutation(api.players.setAdditionalSports, { playerId: bo, sportIds: [s.fx.sportId] });
    await s.admin.mutation(api.cardSecondaryPlayers.setSecondaryPlayers, {
      cardId: s.fx.strawberry2,
      playerIds: [bo],
    });
    const err = await s.admin
      .mutation(api.players.setAdditionalSports, { playerId: bo, sportIds: [] })
      .then(() => null, (e: unknown) => e);
    expect((err as { data?: { code?: string; count?: number } } | null)?.data).toMatchObject({
      code: "SPORT_HAS_CARDS",
      count: 1,
    });
    // Once he is off the card, the sport can go.
    await s.admin.mutation(api.cardSecondaryPlayers.setSecondaryPlayers, { cardId: s.fx.strawberry2, playerIds: [] });
    await expect(
      s.admin.mutation(api.players.setAdditionalSports, { playerId: bo, sportIds: [] }),
    ).resolves.toBeNull();
  });
});

describe("a re-sync never touches the cameo list", () => {
  test("committing the checklist again (with a corrected name and players) leaves secondaryPlayerIds and its rows as they were", async () => {
    vi.stubGlobal("fetch", (async (url: string | URL) => {
      throw new Error(`NEO-528: this test must not reach the network: ${String(url)}`);
    }) as unknown as typeof fetch);
    try {
      const t = convexTest(schema, modules);
      const admin = t.withIdentity({ ...ADMIN, issuer: "https://clerk.example.com", tokenIdentifier: "clerk|admin_neo528" });
      const { sportId, leafId } = await t.run(async (ctx) => {
        const sportId = await ctx.db.insert("selectorOptions", {
          level: "sport",
          value: "Baseball",
          sportConfig: { skuCode: "BB", league: "MLB" },
          platformData: {},
          children: [],
          lastUpdated: NOW,
        });
        const setNameId = await ctx.db.insert("selectorOptions", {
          level: "setName",
          value: "Test Set",
          platformData: {},
          features: { manufacturer: "Topps", season: "2024" },
          parentId: sportId,
          children: [],
          lastUpdated: NOW,
        });
        const leafId = await ctx.db.insert("selectorOptions", {
          level: "variantType",
          value: "Base",
          platformData: {},
          features: { manufacturer: "Topps", season: "2024" },
          parentId: setNameId,
          children: [],
          lastUpdated: NOW,
        });
        return { sportId, leafId };
      });
      const wire = (cardName: string, extra: Record<string, unknown> = {}) => ({
        cardNumber: "7",
        cardName,
        team: undefined,
        teams: [],
        players: [],
        attributes: [],
        platformData: { bsc: { ref: "card-7" } },
        ...extra,
      });
      await admin.action(api.selectorOptions.commitCardChecklist, {
        selectorOptionId: leafId,
        sportId,
        cards: [wire("Mickey Mantle")],
      });
      const rows = (): Promise<Array<Doc<"cardChecklist">>> =>
        t.run(async (ctx) =>
          ctx.db
            .query("cardChecklist")
            .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", leafId))
            .collect(),
        );
      const [card] = await rows();
      const maris = await t.run(async (ctx) =>
        ctx.db.insert("players", { name: "Roger Maris", nameNormalized: "roger maris", sportId, lastUpdated: NOW }),
      );
      await admin.mutation(api.cardSecondaryPlayers.setSecondaryPlayers, { cardId: card._id, playerIds: [maris] });
      const linksBefore = await t.run(async (ctx) =>
        ctx.db
          .query("cardSecondaryPlayerLinks")
          .withIndex("by_card", (q) => q.eq("cardChecklistId", card._id))
          .collect(),
      );

      await admin.action(api.selectorOptions.commitCardChecklist, {
        selectorOptionId: leafId,
        sportId,
        cards: [wire("Mickey Mantle Corrected", { applyFields: ["cardName"], baseVersion: card.lastUpdated })],
      });

      const after = await rows();
      expect(after).toHaveLength(1);
      expect(after[0]._id).toBe(card._id);
      expect(after[0].cardName).toBe("Mickey Mantle Corrected");
      expect(after[0].secondaryPlayerIds).toEqual([maris]);
      const linksAfter = await t.run(async (ctx) =>
        ctx.db
          .query("cardSecondaryPlayerLinks")
          .withIndex("by_card", (q) => q.eq("cardChecklistId", card._id))
          .collect(),
      );
      expect(linksAfter).toEqual(linksBefore);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
