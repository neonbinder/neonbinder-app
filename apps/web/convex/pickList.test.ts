/**
 * NEO-500 — the Pick List's functions (`convex/pickList.ts`): a starter set
 * written with the functions. What is on the list, the legacy-sale fallback
 * (decision 7), the pulled mark and its refusals, the owner check on photos
 * and the sport code on cards.
 */

import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { seedCollectionCatalog } from "../lib/testing/collection-fixture";
import { buildListingSku } from "./lib/listingSku";
import { normalizePlayerName } from "./players";
import { normalizeTeamName } from "./teams";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

/** See `listingSales.test.ts`: convex-test ids carry no Convex checksum. */
vi.mock("./lib/listingSku", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/listingSku")>();
  const byCode = new Map(Object.entries(actual.BSC_CONDITION_SKU_CODE).map(([c, code]) => [code, c]));
  return {
    ...actual,
    buildListingSku: (p: { cardId: string; bscCondition: keyof typeof actual.BSC_CONDITION_SKU_CODE; boxId: string }) =>
      `NB1-${p.cardId}-${actual.BSC_CONDITION_SKU_CODE[p.bscCondition]}-${p.boxId}`,
    parseListingSku: (sku: string | null | undefined) => {
      const m = typeof sku === "string" ? /^NB1-([0-9A-Za-z]+)-([A-Z]{2,5})-([0-9A-Za-z]+)$/.exec(sku) : null;
      const bscCondition = m ? byCode.get(m[2]) : undefined;
      return m && bscCondition ? { cardId: m[1], bscCondition, boxId: m[3] } : null;
    },
  };
});

const ME = { subject: "pick-me" };
const THEM = { subject: "pick-them" };

type SaleItem = Doc<"marketplaceSales">["items"][number];

async function setup() {
  const t = convexTest(schema, modules);
  const fx = await seedCollectionCatalog(t);
  const ids = await t.run(async (ctx) => {
    await ctx.db.patch(fx.sportId, { sportConfig: { skuCode: "BB" } });
    const box = await ctx.db.insert("collectionContainers", { ownerId: ME.subject, kind: "box", name: "Box 2", lastUpdated: 0 });
    const theirBox = await ctx.db.insert("collectionContainers", { ownerId: THEM.subject, kind: "box", name: "Theirs", lastUpdated: 0 });
    const copy = await ctx.db.insert("collectionCopies", {
      ownerId: ME.subject, cardId: fx.gooden1, variantId: fx.baseId, setId: fx.setId, homeId: box,
      slot: 2, quantity: 1, condition: "Near Mint", hasPhotos: true, lastUpdated: 0,
    });
    const theirCopy = await ctx.db.insert("collectionCopies", {
      ownerId: THEM.subject, cardId: fx.gooden1, variantId: fx.baseId, setId: fx.setId, homeId: theirBox,
      quantity: 1, condition: "Near Mint", hasPhotos: true, lastUpdated: 0,
    });
    const photo = (ownerId: string, copyId: Id<"collectionCopies">, token: string) =>
      ctx.db.insert("collectionCopyPhotos", {
        ownerId, copyId, side: "front", token, contentType: "image/jpeg", imageBytes: 1, thumbBytes: 1, status: "live", since: 0,
      });
    await photo(ME.subject, copy, "a".repeat(32));
    await photo(THEM.subject, theirCopy, "b".repeat(32));
    return { box, theirBox, copy, theirCopy };
  });

  const sale = (
    ownerId: string,
    orderNo: string,
    orderDate: number,
    items: SaleItem[],
    extra: Partial<Doc<"marketplaceSales">> = {},
  ) =>
    t.run(async (ctx) =>
      ctx.db.insert("marketplaceSales", {
        ownerId, platform: "bsc", orderId: `id-${orderNo}`, orderNo, orderDate, status: "READY_TO_SHIP",
        totals: {}, items, firstSeenAt: orderDate, lastUpdated: orderDate, ...extra,
      }),
    );
  const applied = (over: Partial<SaleItem> = {}): SaleItem => ({
    platformCardId: "bsc-1", cardId: fx.gooden1, condition: "near_mint", quantity: 1, priceCents: 100,
    applied: true, appliedAt: 1, ...over,
  });
  return { t, fx, ids, sale, applied, me: t.withIdentity(ME), them: t.withIdentity(THEM) };
}

describe("open", () => {
  test("an open order's lines, the box they name, and a shipped or another owner's order left off", async () => {
    const { ids, sale, applied, me } = await setup();
    await sale(ME.subject, "A-1", 1000, [
      applied({ from: [{ homeId: ids.box, copyId: ids.copy, quantity: 1, slot: 2, condition: "Near Mint" }], lastOnes: true }),
      { platformCardId: "bsc-x", condition: "near_mint", quantity: 1, priceCents: 5, applied: false, problem: "unmatched" },
    ], { pullOpen: true });
    await sale(ME.subject, "A-2", 2000, [applied()], { status: "SHIPPED" });
    await sale(THEM.subject, "B-1", 3000, [applied()], { pullOpen: true });

    const open = await me.query(api.pickList.open, {});
    expect(open.truncated).toBe(false);
    expect(open.lines.map((l) => [l.orderNo, l.cantFind ?? null, l.lastOnes ?? null])).toEqual([
      ["A-1", null, true],
      ["A-1", "unmatched", null],
    ]);
    expect(open.lines[0].from).toEqual([{ copyId: ids.copy, boxId: ids.box, slot: 2, quantity: 1, condition: "Near Mint" }]);
    expect(open.boxes).toEqual([{ id: ids.box, name: "Box 2" }]);
    // No marketplace card id or SKU leaves.
    expect(JSON.stringify(open)).not.toContain("bsc-1");
    expect(JSON.stringify(open)).not.toContain("bsc-x");
  });

  test("a sale applied before NEO-500 (no pullOpen, no from) shows as Box not recorded, with the SKU's box", async () => {
    const { fx, ids, sale, applied, me } = await setup();
    const sku = buildListingSku({ cardId: fx.gooden1, bscCondition: "near_mint", boxId: ids.box });
    await sale(ME.subject, "L-1", 1000, [applied({ sellerSku: sku })]);
    const open = await me.query(api.pickList.open, {});
    expect(open.lines).toHaveLength(1);
    expect(open.lines[0]).toMatchObject({ orderNo: "L-1", boxUnrecorded: true, skuBoxId: ids.box, from: [] });
    expect(JSON.stringify(open)).not.toContain("NB1-");
  });

  test("past the open-order read the list is cut short and keeps the oldest orders", async () => {
    const { t, applied, me } = await setup();
    await t.run(async (ctx) => {
      // The newest 100 sales have shipped, so the temporary date window adds nothing.
      for (let i = 0; i < 100; i += 1) {
        await ctx.db.insert("marketplaceSales", {
          ownerId: ME.subject, platform: "bsc", orderId: `s-${i}`, orderNo: `S-${i}`, orderDate: 10_000 + i,
          status: "SHIPPED", totals: {}, items: [applied()], firstSeenAt: 0, lastUpdated: 0,
        });
      }
      // 201 open orders, oldest O-1.
      for (let i = 1; i <= 201; i += 1) {
        await ctx.db.insert("marketplaceSales", {
          ownerId: ME.subject, platform: "bsc", orderId: `o-${i}`, orderNo: `O-${i}`, orderDate: i,
          status: "READY_TO_SHIP", totals: {}, items: [applied()], pullOpen: true, firstSeenAt: 0, lastUpdated: 0,
        });
      }
    });
    const open = await me.query(api.pickList.open, {});
    expect(open.truncated).toBe(true);
    const orders = open.lines.map((l) => l.orderNo);
    expect(orders).toHaveLength(200);
    expect(orders[0]).toBe("O-1");
    expect(orders).toContain("O-200");
    expect(orders).not.toContain("O-201");
  });

  test("anonymous is refused", async () => {
    const { t } = await setup();
    await expect(t.query(api.pickList.open, {})).rejects.toThrow(/Not authenticated/);
  });
});

describe("setPulled", () => {
  test("marks a line pulled (off the list, pullOpen cleared) and Undo puts it back", async () => {
    const { t, sale, applied, me } = await setup();
    const saleId = await sale(ME.subject, "A-1", 1000, [applied()], { pullOpen: true });
    const [line] = (await me.query(api.pickList.open, {})).lines;

    expect(await me.mutation(api.pickList.setPulled, { ids: [line.id], pulled: true })).toEqual({ updated: 1 });
    expect((await me.query(api.pickList.open, {})).lines).toEqual([]);
    expect((await t.run((ctx) => ctx.db.get(saleId)))?.pullOpen).toBeUndefined();

    expect(await me.mutation(api.pickList.setPulled, { ids: [line.id], pulled: false })).toEqual({ updated: 1 });
    expect((await me.query(api.pickList.open, {})).lines.map((l) => l.id)).toEqual([line.id]);
    expect((await t.run((ctx) => ctx.db.get(saleId)))?.pullOpen).toBe(true);
  });

  test("another owner's line is refused and nothing is written", async () => {
    const { t, sale, applied, me, them } = await setup();
    const saleId = await sale(THEM.subject, "B-1", 1000, [applied()], { pullOpen: true });
    const [line] = (await them.query(api.pickList.open, {})).lines;
    await expect(me.mutation(api.pickList.setPulled, { ids: [line.id], pulled: true })).rejects.toThrow(/Pick List/);
    await expect(me.mutation(api.pickList.setPulled, { ids: ["not-a-line"], pulled: true })).rejects.toThrow(/Pick List/);
    expect((await t.run((ctx) => ctx.db.get(saleId)))?.items[0].pulledAt).toBeUndefined();
  });
});

describe("soldPhotos and cards", () => {
  test("photos of the caller's copies only, even once the copy row is gone", async () => {
    const { t, ids, me } = await setup();
    await t.run((ctx) => ctx.db.delete(ids.copy));
    const photos = await me.query(api.pickList.soldPhotos, { copyIds: [ids.copy, ids.theirCopy] });
    expect(photos.map((p) => p.copyId)).toEqual([ids.copy]);
    expect(photos[0].front?.thumbUrl).toMatch(/\/copy-photo\/a{32}\/thumb$/);
  });

  test("cards carry the sport's own code; a bad id is null", async () => {
    const { fx, me } = await setup();
    const out = await me.query(api.pickList.cards, { cardIds: [fx.gooden1, "nope"] });
    expect(out[0]?.sportCode).toBe("BB");
    expect(out[0]?.card.cardNumber).toBe("1");
    expect(out[1]).toBeNull();
  });
});

describe("NEO-509: a Can't find it line's own words", () => {
  test("open carries the sale's listed card on an unmatched line only, as stored", async () => {
    const { fx, sale, applied, me } = await setup();
    const listed = { sport: "Baseball", sportId: fx.sportId, year: "2024", setName: "Topps", players: "Dwight Gooden", cardNo: "1", variant: "Base" };
    await sale(ME.subject, "W-1", 1000, [
      applied(),
      { platformCardId: "bsc-y", condition: "near_mint", quantity: 1, priceCents: 5, applied: false, problem: "unmatched", listed },
      { platformCardId: "bsc-z", condition: "near_mint", quantity: 1, priceCents: 5, applied: false, problem: "unmatched" },
    ], { pullOpen: true });
    const open = await me.query(api.pickList.open, {});
    expect(open.lines.map((l) => l.listed ?? null)).toEqual([null, listed, null]);
  });

  test("a linkMismatch line carries its listed card too, and an unmatched line with none carries none", async () => {
    const { fx, sale, me } = await setup();
    const listed = { sport: "Baseball", sportId: fx.sportId, year: "2024", setName: "Topps", cardNo: "1", variant: "Base" };
    await sale(ME.subject, "W-2", 1000, [
      { platformCardId: "bsc-m", condition: "near_mint", quantity: 1, priceCents: 5, applied: false, problem: "linkMismatch", listed },
      { platformCardId: "bsc-n", condition: "near_mint", quantity: 1, priceCents: 5, applied: false, problem: "linkMismatch" },
    ], { pullOpen: true });
    const open = await me.query(api.pickList.open, {});
    expect(open.lines.map((l) => [l.cantFind, l.listed ?? null])).toEqual([
      ["linkMismatch", listed],
      ["linkMismatch", null],
    ]);
  });

  test("sports names NB's sport and its code; a bad id or a row that is no sport is null", async () => {
    const { fx, me } = await setup();
    const out = await me.query(api.pickList.sports, { sportIds: [fx.sportId, fx.setId, "nope"] });
    expect(out).toEqual([{ id: fx.sportId, name: "Baseball", code: "BB" }, null, null]);
  });

  test("sports refuses more than its limit and an anonymous caller", async () => {
    const { t, fx, me } = await setup();
    await expect(me.query(api.pickList.sports, { sportIds: Array.from({ length: 21 }, () => fx.sportId) })).rejects.toThrow(/at most 20/);
    await expect(t.query(api.pickList.sports, { sportIds: [] })).rejects.toThrow(/Not authenticated/);
  });
});

describe("NEO-590: titleSports", () => {
  async function world() {
    const { t, me } = await setup();
    const sport = (value: string, skuCode: string) =>
      t.run(async (ctx) =>
        ctx.db.insert("selectorOptions", {
          level: "sport", value, platformData: {}, children: [], sportConfig: { skuCode, league: value.toUpperCase() }, lastUpdated: 0,
        }),
      );
    const baseball = await sport("Pitching Baseball", "PB");
    const football = await sport("Gridiron Football", "GF");
    const hockey = await sport("Ice Hockey", "IH");
    // `playerSports` is the authority for a player's extra sports; the row's `alsoSportIds`
    // is a display copy (NEO-318), so the helper writes both as `syncPlayerSports` does.
    const player = (name: string, sportId: Id<"selectorOptions">, alsoSportIds?: Id<"selectorOptions">[]) =>
      t.run(async (ctx) => {
        const nameNormalized = normalizePlayerName(name);
        const id = await ctx.db.insert("players", { name, nameNormalized, sportId, ...(alsoSportIds ? { alsoSportIds } : {}), lastUpdated: 0 });
        for (const also of alsoSportIds ?? []) await ctx.db.insert("playerSports", { playerId: id, sportId: also, nameNormalized });
        return id;
      });
    const team = (name: string, sportId: Id<"selectorOptions">, location?: string) =>
      t.run(async (ctx) =>
        ctx.db.insert("teams", {
          name, ...(location ? { location } : {}), nameNormalized: normalizeTeamName(location ? `${location} ${name}` : name), sportId, lastUpdated: 0,
        }),
      );
    return { t, me, baseball, football, hockey, player, team };
  }

  test("a one-sport player named in full files the title under that sport", async () => {
    const w = await world();
    await w.player("Zorbo Quillfeather", w.baseball);
    const out = await w.me.query(api.pickList.titleSports, { titles: ["2024 Topps Chrome #12 Zorbo Quillfeather RC"] });
    expect(out).toEqual([{ id: w.baseball, name: "Pitching Baseball", code: "PB" }]);
  });

  test("a partial player name is not the player", async () => {
    const w = await world();
    await w.player("Zorbo Quillfeather", w.baseball);
    const out = await w.me.query(api.pickList.titleSports, { titles: ["Quillfeather duck decoy", "Zorbo lot of 10"] });
    expect(out).toEqual([null, null]);
  });

  test("players in two different sports decide nothing, and no team means null", async () => {
    const w = await world();
    await w.player("Zorbo Quillfeather", w.baseball);
    await w.player("Wimble Snarfdagger", w.football);
    const out = await w.me.query(api.pickList.titleSports, { titles: ["Zorbo Quillfeather Wimble Snarfdagger dual"] });
    expect(out).toEqual([null]);
  });

  test("a player in two sports falls back to the team the title names", async () => {
    const w = await world();
    await w.player("Zorbo Quillfeather", w.baseball, [w.football]);
    await w.team("Krakens", w.football, "Harbor");
    const out = await w.me.query(api.pickList.titleSports, { titles: ["Zorbo Quillfeather Harbor Krakens card"] });
    expect(out).toEqual([{ id: w.football, name: "Gridiron Football", code: "GF" }]);
  });

  test("a player's extra sports come from playerSports, not the alsoSportIds display copy", async () => {
    const w = await world();
    const id = await w.player("Zorbo Quillfeather", w.baseball);
    await w.team("Krakens", w.football, "Harbor");
    // A stale display copy naming football, with no playerSports row: the copy decides nothing.
    await w.t.run(async (ctx) => ctx.db.patch(id, { alsoSportIds: [w.football] }));
    const out = await w.me.query(api.pickList.titleSports, { titles: ["Zorbo Quillfeather Harbor Krakens card"] });
    expect(out).toEqual([{ id: w.baseball, name: "Pitching Baseball", code: "PB" }]);
  });

  test("a team whose name carries an accent or punctuation is found by the plain words of a title", async () => {
    const w = await world();
    await w.team("Canadiens", w.hockey, "Montréal");
    await w.team("Blues", w.hockey, "St. Louis");
    const out = await w.me.query(api.pickList.titleSports, {
      titles: ["Montreal Canadiens pennant", "Montréal Canadiens pennant", "St Louis Blues puck", "St. Louis Blues puck"],
    });
    const hit = { id: w.hockey, name: "Ice Hockey", code: "IH" };
    expect(out).toEqual([hit, hit, hit, hit]);
  });

  test("a nickname shared by teams of two sports is null", async () => {
    const w = await world();
    await w.team("Krakens", w.baseball, "Harbor");
    await w.team("Krakens", w.football, "Bay");
    const out = await w.me.query(api.pickList.titleSports, { titles: ["Krakens pennant"] });
    expect(out).toEqual([null]);
  });

  test("a shared nickname is settled by a player of one sport", async () => {
    const w = await world();
    await w.team("Krakens", w.baseball, "Harbor");
    await w.team("Krakens", w.football, "Bay");
    await w.player("Zorbo Quillfeather", w.football);
    const out = await w.me.query(api.pickList.titleSports, { titles: ["Zorbo Quillfeather Krakens auto"] });
    expect(out).toEqual([{ id: w.football, name: "Gridiron Football", code: "GF" }]);
  });

  test("a team named by its full name files under its sport", async () => {
    const w = await world();
    await w.team("Krakens", w.hockey, "Harbor");
    const out = await w.me.query(api.pickList.titleSports, { titles: ["Harbor Krakens team set"] });
    expect(out).toEqual([{ id: w.hockey, name: "Ice Hockey", code: "IH" }]);
  });

  test("answers line up with the titles, a repeated title answers alike, and a title with no words is null", async () => {
    const w = await world();
    await w.player("Zorbo Quillfeather", w.baseball);
    const out = await w.me.query(api.pickList.titleSports, {
      titles: ["Zorbo Quillfeather", "2024 #12", "Zorbo Quillfeather", "", "nobody here"],
    });
    const hit = { id: w.baseball, name: "Pitching Baseball", code: "PB" };
    expect(out).toEqual([hit, null, hit, null, null]);
  });

  test("take-8 boundary: with a card number, eight look-alikes of the set's words no longer cut the named player off", async () => {
    // Only the words after the `#<token>` are searched, so the set's generic words ("Rookie Card")
    // cannot fill the page with other players.
    const w = await world();
    for (let i = 0; i < 9; i += 1) await w.player(`Rookie Card Rookie Card Filler${i}`, w.football);
    await w.player("Zorbo Quillfeather", w.baseball);
    const out = await w.me.query(api.pickList.titleSports, { titles: ["2023 Rookie Card #12 Zorbo Quillfeather"] });
    expect(out).toEqual([{ id: w.baseball, name: "Pitching Baseball", code: "PB" }]);
  });

  test("take-8 boundary, no # in the title: a named player outranked by eight look-alike hits is cut off and the title files under Other", async () => {
    // Display order only (NEO-590): with no card number the whole title is searched, ranked by relevance, not by
    // "named in full". Fillers repeating the title's generic words outrank the named player, so once they
    // fill the page the player is never read and the row files under Other (null). Pinned, not endorsed.
    const w = await world();
    for (let i = 0; i < 8; i += 1) await w.player(`Rookie Card Rookie Card Filler${i}`, w.football);
    await w.player("Zorbo Quillfeather", w.baseball);
    const out = await w.me.query(api.pickList.titleSports, { titles: ["Zorbo Quillfeather Rookie Card"] });
    expect(out).toEqual([null]);
  });

  test("take-8 boundary control: with seven look-alike hits beside it the named player still decides the sport", async () => {
    const w = await world();
    for (let i = 0; i < 7; i += 1) await w.player(`Rookie Card Rookie Card Filler${i}`, w.football);
    await w.player("Zorbo Quillfeather", w.baseball);
    const out = await w.me.query(api.pickList.titleSports, { titles: ["Zorbo Quillfeather Rookie Card"] });
    expect(out).toEqual([{ id: w.baseball, name: "Pitching Baseball", code: "PB" }]);
  });

  test("a player whose sport row is gone files the title under Other without throwing", async () => {
    const w = await world();
    await w.player("Zorbo Quillfeather", w.baseball);
    await w.t.run(async (ctx) => ctx.db.delete(w.baseball));
    await expect(w.me.query(api.pickList.titleSports, { titles: ["Zorbo Quillfeather RC"] })).resolves.toEqual([null]);
  });

  test("a player whose sportId is a row that is not a sport files the title under Other", async () => {
    const w = await world();
    const notSport = await w.t.run(async (ctx) =>
      ctx.db.insert("selectorOptions", { level: "year", value: "2024", platformData: {}, children: [], lastUpdated: 0 }),
    );
    await w.player("Zorbo Quillfeather", notSport);
    await expect(w.me.query(api.pickList.titleSports, { titles: ["Zorbo Quillfeather RC"] })).resolves.toEqual([null]);
  });

  test("refuses more than its limit and an anonymous caller", async () => {
    const w = await world();
    await expect(w.me.query(api.pickList.titleSports, { titles: Array.from({ length: 21 }, (_, i) => `t${i}`) })).rejects.toThrow(/at most 20/);
    await expect(w.t.query(api.pickList.titleSports, { titles: [] })).rejects.toThrow(/Not authenticated/);
    await expect(w.me.query(api.pickList.titleSports, { titles: Array.from({ length: 20 }, (_, i) => `t${i}`) })).resolves.toHaveLength(20);
  });
});
