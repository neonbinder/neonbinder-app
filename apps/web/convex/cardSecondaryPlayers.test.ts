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
  TOO_MANY_SECONDARY_PLAYERS,
  bornSecondaryPlayerFields,
  bornSecondaryPlayers,
  planSecondaryPlayerIds,
  planSecondaryPlayerLinks,
  setCardSecondaryPlayers,
} from "./cardSecondaryPlayers";
import { MAX_CARD_PLAYERS } from "./features/cardAttention";
import { descriptionForStoredCard } from "./storedCardTitle";

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

  test("refuses a list past twice the cap before reading the card or any player", async () => {
    const s = await setup();
    // A card that is gone: were the card read first, this would be "isn't in
    // NB anymore". The same id repeated: were the list deduped first, it
    // would be one player and fit.
    const gone = await s.t.run(async (ctx) => {
      const id = await insertTestCard(ctx, {
        selectorOptionId: s.fx.futureStarsId,
        cardNumber: "GONE-1",
        cardName: "Gone",
        platformData: {},
        sortOrder: 99,
        lastUpdated: NOW,
      });
      await ctx.db.delete(id);
      return id;
    });
    const playerIds = Array.from({ length: 2 * MAX_CARD_PLAYERS + 1 }, () => s.fx.goodenId);
    await expect(
      s.admin.mutation(api.cardSecondaryPlayers.setSecondaryPlayers, { cardId: gone, playerIds }),
    ).rejects.toThrow(TOO_MANY_SECONDARY_PLAYERS);
    // Exactly twice the cap still reaches the card (and its own refusal).
    await expect(
      s.admin.mutation(api.cardSecondaryPlayers.setSecondaryPlayers, {
        cardId: gone,
        playerIds: playerIds.slice(1),
      }),
    ).rejects.toThrow(/isn't in NB anymore/);
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

describe("the description names the cameos, unless a person wrote it", () => {
  /** Store, as the card's description, what the generator builds for it with `cameos`. */
  const generateInto = (s: S, id: Id<"cardChecklist">, cameos: string[]) =>
    s.t.run(async (ctx) => {
      const card = (await ctx.db.get(id))!;
      const text = await descriptionForStoredCard(ctx, card, cameos);
      await ctx.db.patch(id, { listingDescription: text });
      return text;
    });
  const lines = async (s: S, id: Id<"cardChecklist">) => ((await cardOf(s, id)).listingDescription ?? "").split("\n");
  const set = (s: S, id: Id<"cardChecklist">, playerIds: Array<Id<"players">>) =>
    s.admin.mutation(api.cardSecondaryPlayers.setSecondaryPlayers, { cardId: id, playerIds });

  test("a generated description gains the line after the team: one, then several, then none", async () => {
    const s = await setup();
    const ryan = await newPlayer(s, "Ken Griffey Jr.");
    const plain = await generateInto(s, s.fx.strawberry2, []);
    expect(plain).not.toMatch(/Cameo/);

    await set(s, s.fx.strawberry2, [ryan]);
    const one = await lines(s, s.fx.strawberry2);
    expect(one[one.indexOf("Team: New York Mets.") + 1]).toBe("Cameo: Ken Griffey Jr.");

    await set(s, s.fx.strawberry2, [s.fx.goodenId, ryan]);
    expect(await lines(s, s.fx.strawberry2)).toContain("Cameos: Dwight Gooden, Ken Griffey Jr.");

    await set(s, s.fx.strawberry2, []);
    expect((await cardOf(s, s.fx.strawberry2)).listingDescription).toBe(plain);
  });

  test("a description a person edited is kept, whatever the cameos do", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => ctx.db.patch(s.fx.strawberry2, { listingDescription: "Straw, in his own words." }));
    await set(s, s.fx.strawberry2, [s.fx.goodenId]);
    expect((await cardOf(s, s.fx.strawberry2)).listingDescription).toBe("Straw, in his own words.");
    await set(s, s.fx.strawberry2, []);
    expect((await cardOf(s, s.fx.strawberry2)).listingDescription).toBe("Straw, in his own words.");
  });

  test("a card with no description is left without one", async () => {
    const s = await setup();
    // NEO-535: the shared fixture gives every card a description; this case
    // needs a card with none.
    await s.t.run(async (ctx) => ctx.db.patch(s.fx.strawberry2, { listingDescription: undefined }));
    await set(s, s.fx.strawberry2, [s.fx.goodenId]);
    expect("listingDescription" in (await cardOf(s, s.fx.strawberry2))).toBe(false);
  });

  test("a description generated before cameos were described (no cameo line, cameos already set) still counts as generated", async () => {
    const s = await setup();
    const ryan = await newPlayer(s, "Nolan Ryan");
    await set(s, s.fx.strawberry2, [s.fx.goodenId]);
    // The pre-NEO-528 generator's text: no cameo line though Gooden is one.
    await generateInto(s, s.fx.strawberry2, []);
    await set(s, s.fx.strawberry2, [s.fx.goodenId, ryan]);
    expect(await lines(s, s.fx.strawberry2)).toContain("Cameos: Dwight Gooden, Nolan Ryan.");
  });

  test("an unchanged list writes nothing, the description included", async () => {
    const s = await setup();
    await set(s, s.fx.strawberry2, [s.fx.goodenId]);
    await s.t.run(async (ctx) => ctx.db.patch(s.fx.strawberry2, { listingDescription: "stale" }));
    await set(s, s.fx.strawberry2, [s.fx.goodenId]);
    expect((await cardOf(s, s.fx.strawberry2)).listingDescription).toBe("stale");
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

describe("NEO-528 round 3: a card born with cameos", () => {
  const P = (s: string) => s as Id<"players">;

  test("bornSecondaryPlayerFields: the field to spread, repeats and own players out, cut at the cap, {} when empty", () => {
    const card = { playerIds: [P("a")], playerLinks: [{ playerId: P("b"), nameOnCard: "B" }] };
    expect(bornSecondaryPlayerFields(card, [P("c"), P("a"), P("c"), P("b"), P("d")])).toEqual({
      secondaryPlayerIds: ["c", "d"],
    });
    expect(bornSecondaryPlayerFields(card, [P("a")])).toEqual({});
    expect(bornSecondaryPlayerFields({}, undefined)).toEqual({});
    const many = Array.from({ length: MAX_CARD_PLAYERS + 3 }, (_, i) => P(`p${i}`));
    // Never refused: a new card takes the first MAX_CARD_PLAYERS.
    expect(bornSecondaryPlayerFields({}, many).secondaryPlayerIds).toEqual(many.slice(0, MAX_CARD_PLAYERS));
  });

  test("bornSecondaryPlayers writes the index rows for the list the card was inserted with, and nothing else", async () => {
    const s = await setup();
    const maris = await newPlayer(s, "Roger Maris");
    const { cardId, before } = await s.t.run(async (ctx) => {
      const row = {
        selectorOptionId: s.fx.goldId,
        cardNumber: "99",
        cardName: "Born",
        platformData: {},
        sortOrder: 9,
        lastUpdated: NOW,
        listingDescription: "As generated.",
        sportId: s.fx.sportId,
        ...bornSecondaryPlayerFields({ playerIds: [s.fx.goodenId] }, [s.fx.goodenId, maris, s.fx.strawberryId]),
        playerIds: [s.fx.goodenId],
        playerLinks: [{ playerId: s.fx.goodenId, nameOnCard: "Dwight Gooden" }],
      };
      const id = await insertTestCard(ctx, row);
      const inserted = (await ctx.db.get(id))!;
      await bornSecondaryPlayers(ctx, id, row);
      return { cardId: id, before: inserted };
    });
    const after = await cardOf(s, cardId);
    expect(after).toEqual(before); // the card itself is not patched
    expect(after.secondaryPlayerIds).toEqual([maris, s.fx.strawberryId]);
    expect((await linksOf(s, cardId)).map((l) => [l.playerId, l.sportId])).toEqual([
      [maris, s.fx.sportId],
      [s.fx.strawberryId, s.fx.sportId],
    ]);
  });

  test("bornSecondaryPlayers on a card with no cameos reads and writes nothing", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const calls: string[] = [];
      const db = new Proxy(ctx.db, {
        get(target, prop) {
          const value = Reflect.get(target, prop) as unknown;
          if (typeof value !== "function") return value;
          return (...a: unknown[]) => {
            calls.push(String(prop));
            return (value as (...x: unknown[]) => unknown).apply(target, a);
          };
        },
      });
      await bornSecondaryPlayers({ db } as never, s.fx.gold1, { sportId: s.fx.sportId });
      expect(calls).toEqual([]);
    });
    expect(await linksOf(s, s.fx.gold1)).toEqual([]);
  });
});
