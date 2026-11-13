/**
 * NEO-528 round 3 — "Player on every card" as a STORED attribute of any row:
 * the stored values (`setCardPlayerDefault` / `clearCardPlayerDefault`), the
 * lookup a new card makes (`effectiveCardPlayerDefaults`, nearest wins, the
 * parallel relationships), the panel's read (`cardPlayerDefaults`), the walk
 * down from any level (`everyCardTargets`), and that the walk and the lookup
 * agree.
 *
 * Fixture (`seedTree`):
 *
 *   Football › 2026 › Topps
 *     › Profiles (set)
 *         › Base                      (B, cards)
 *         › Inserts › Profiles Ink    (INS, cards)
 *                       › Gold        (GOLD, a parallel of INS, cards)
 *         › Parallels › Silver        (SIL, an insert under a Parallel type:
 *                                      the Base's parallel, cards)
 *     › Chrome (set)
 *         › Base                      (B2, cards)
 *   Baseball (another sport)
 */

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { insertTestCard } from "../lib/testing/card-row";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import {
  BULK_MISSING_PLAYER,
  DEFAULT_CAMEOS_FULL,
  DEFAULT_ROW_MISSING,
  MAX_EVERY_CARD_TARGETS,
  MAX_EVERY_CARD_WALK,
  MAX_UNCOUNTED_PROBES,
  alreadyThePlayerMessage,
  bulkTargets,
  wrongSportMessage,
  cardPlayerDefaultsChain,
  effectiveCardPlayerDefaults,
  type CardPlayerDefaultKind,
} from "./cardPlayersBulk";
import { MAX_CARD_PLAYERS } from "./features/cardAttention";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = { subject: "admin_neo528_defaults", role: "admin" };
const MEMBER = { subject: "member_neo528_defaults", role: "member" };
const NOW = 1_700_000_000_000;

type T = ReturnType<typeof convexTest>;
type RowId = Id<"selectorOptions">;

async function seedTree(t: T) {
  return t.run(async (ctx) => {
    const row = (level: Doc<"selectorOptions">["level"], value: string, parentId?: RowId, cardCount?: number) =>
      ctx.db.insert("selectorOptions", {
        level,
        value,
        ...(parentId ? { parentId } : {}),
        ...(cardCount !== undefined ? { cardCount } : {}),
        platformData: {},
        children: [],
        lastUpdated: NOW,
      });
    const sport = await row("sport", "Football");
    const year = await row("year", "2026", sport);
    const brand = await row("manufacturer", "Topps", year);
    const set = await row("setName", "Profiles", brand);
    const base = await row("variantType", "Base", set, 2);
    const insertsType = await row("variantType", "Inserts", set, 0);
    const ins = await row("insert", "Profiles Ink", insertsType, 1);
    const gold = await row("parallel", "Gold", ins, 1);
    const parallelsType = await row("variantType", "Parallels", set, 0);
    const silver = await row("insert", "Silver", parallelsType, 1);
    const set2 = await row("setName", "Chrome", brand);
    const base2 = await row("variantType", "Base", set2, 1);
    const baseball = await row("sport", "Baseball");
    const player = (name: string, sportId: RowId) =>
      ctx.db.insert("players", { name, nameNormalized: normalizeEntityName(name), sportId, lastUpdated: NOW });
    const mahomes = await player("Patrick Mahomes", sport);
    const kelce = await player("Travis Kelce", sport);
    const allen = await player("Josh Allen", sport);
    const ohtani = await player("Shohei Ohtani", baseball);
    const card = (selectorOptionId: RowId, cardNumber: string) =>
      insertTestCard(ctx, {
        selectorOptionId,
        cardNumber,
        cardName: `Card ${cardNumber}`,
        platformData: {},
        sortOrder: 0,
        lastUpdated: NOW,
      });
    const cards = {
      base1: await card(base, "1"),
      base2: await card(base, "2"),
      ins1: await card(ins, "I-1"),
      gold1: await card(gold, "I-1"),
      silver1: await card(silver, "1"),
      chrome1: await card(base2, "C-1"),
    };
    return {
      sport, year, brand, set, base, insertsType, ins, gold, parallelsType, silver, set2, base2, baseball,
      mahomes, kelce, allen, ohtani, cards,
    };
  });
}
type Tree = Awaited<ReturnType<typeof seedTree>>;

const store = (
  t: T,
  id: RowId,
  values: { defaultPlayerIds?: Array<Id<"players">>; defaultCameoIds?: Array<Id<"players">> },
) => t.run(async (ctx) => ctx.db.patch(id, values));

const effective = (t: T, leaf: RowId, sportId?: RowId) =>
  t.run(async (ctx) => effectiveCardPlayerDefaults(ctx, leaf, sportId ? { sportId } : {}));

const rowOf = (t: T, id: RowId) => t.run(async (ctx) => (await ctx.db.get(id))!);

/** Every row a card can sit on, in the fixture. */
const cardRows = (fx: Tree) => [fx.base, fx.insertsType, fx.ins, fx.gold, fx.parallelsType, fx.silver, fx.base2];
/**
 * Of those, the rows that hold cards: a run walks only these (the Inserts
 * and Parallels types are counted at 0, so there is nothing on them to bring
 * along).
 */
const heldRows = (fx: Tree) => [fx.base, fx.ins, fx.gold, fx.silver, fx.base2];
const everyRow = (fx: Tree) => [fx.sport, fx.year, fx.brand, fx.set, fx.set2, ...cardRows(fx)];

// ───────────────────────────────────────────────────────────────────────────
// The walk up
// ───────────────────────────────────────────────────────────────────────────

describe("cardPlayerDefaultsChain: nearest first, through the row a parallel belongs to", () => {
  test("a plain row walks its parents to the sport", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    const chain = await t.run(async (ctx) => (await cardPlayerDefaultsChain(ctx, fx.base)).map((r) => r._id));
    expect(chain).toEqual([fx.base, fx.set, fx.brand, fx.year, fx.sport]);
  });

  test("a parallel of an insert walks its insert next (its parent)", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    const chain = await t.run(async (ctx) => (await cardPlayerDefaultsChain(ctx, fx.gold)).map((r) => r._id));
    expect(chain).toEqual([fx.gold, fx.ins, fx.insertsType, fx.set, fx.brand, fx.year, fx.sport]);
  });

  test("an insert under a Parallel type walks its own Parallel type, then the set's Base, then the set", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    const chain = await t.run(async (ctx) => (await cardPlayerDefaultsChain(ctx, fx.silver)).map((r) => r._id));
    expect(chain).toEqual([fx.silver, fx.parallelsType, fx.base, fx.set, fx.brand, fx.year, fx.sport]);
  });

  test("an insert under an Insert type has no Base in its walk", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    const chain = await t.run(async (ctx) => (await cardPlayerDefaultsChain(ctx, fx.ins)).map((r) => r._id));
    expect(chain).not.toContain(fx.base);
  });
});

describe("effectiveCardPlayerDefaults: what a new card is born with", () => {
  test("nothing stored anywhere: nothing", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    expect(await effective(t, fx.base)).toEqual({
      playerId: null,
      cameoIds: [],
      player: null,
      cameos: [],
      playerFromId: null,
      cameosFromId: null,
    });
  });

  test("a value at the sport reaches every card row beneath it", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    await store(t, fx.sport, { defaultPlayerIds: [fx.mahomes] });
    for (const leaf of cardRows(fx)) {
      const got = await effective(t, leaf);
      expect(got.player).toEqual({ _id: fx.mahomes, name: "Patrick Mahomes" });
      expect(got.playerFromId).toBe(fx.sport);
    }
  });

  test("nearest wins at several levels: sport < set < variant type < insert < parallel", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    await store(t, fx.sport, { defaultPlayerIds: [fx.allen] });
    await store(t, fx.set, { defaultPlayerIds: [fx.kelce] });
    await store(t, fx.ins, { defaultPlayerIds: [fx.mahomes] });
    expect((await effective(t, fx.base2)).playerFromId).toBe(fx.sport); // another set
    expect((await effective(t, fx.base)).playerFromId).toBe(fx.set);
    expect((await effective(t, fx.ins)).playerFromId).toBe(fx.ins);
    expect((await effective(t, fx.gold)).playerFromId).toBe(fx.ins); // its insert
    await store(t, fx.gold, { defaultPlayerIds: [fx.allen] });
    expect((await effective(t, fx.gold)).player?._id).toBe(fx.allen);
    await store(t, fx.insertsType, { defaultPlayerIds: [fx.allen] });
    expect((await effective(t, fx.ins)).playerFromId).toBe(fx.ins); // own still wins
  });

  test("the Base's parallels: the Parallel type's value outranks the Base's, which outranks the set's", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    await store(t, fx.set, { defaultPlayerIds: [fx.allen] });
    expect((await effective(t, fx.silver)).playerFromId).toBe(fx.set);
    await store(t, fx.base, { defaultPlayerIds: [fx.mahomes] });
    expect((await effective(t, fx.silver)).playerFromId).toBe(fx.base);
    await store(t, fx.parallelsType, { defaultPlayerIds: [fx.kelce] });
    expect((await effective(t, fx.silver)).playerFromId).toBe(fx.parallelsType);
    await store(t, fx.silver, { defaultPlayerIds: [fx.allen] });
    expect((await effective(t, fx.silver)).playerFromId).toBe(fx.silver);
  });

  test("player and cameos resolve independently, and a nearer cameo list replaces a farther one whole", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    await store(t, fx.sport, { defaultCameoIds: [fx.allen, fx.kelce] });
    await store(t, fx.ins, { defaultPlayerIds: [fx.mahomes] });
    const gold = await effective(t, fx.gold);
    expect(gold.playerFromId).toBe(fx.ins);
    expect(gold.cameosFromId).toBe(fx.sport);
    expect(gold.cameoIds).toEqual([fx.allen, fx.kelce]);
    await store(t, fx.set, { defaultCameoIds: [fx.kelce] });
    const after = await effective(t, fx.gold);
    expect(after.cameosFromId).toBe(fx.set);
    expect(after.cameos).toEqual([{ _id: fx.kelce, name: "Travis Kelce" }]); // not merged with Allen
  });

  test("the default player is never also a default cameo", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    await store(t, fx.base, { defaultPlayerIds: [fx.mahomes] });
    await store(t, fx.set, { defaultCameoIds: [fx.mahomes, fx.kelce] });
    expect((await effective(t, fx.base)).cameoIds).toEqual([fx.kelce]);
  });

  test("a winning player who is gone is dropped, not replaced by a farther row's", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    await store(t, fx.sport, { defaultPlayerIds: [fx.kelce] });
    await store(t, fx.base, { defaultPlayerIds: [fx.allen], defaultCameoIds: [fx.allen, fx.kelce] });
    await t.run(async (ctx) => ctx.db.delete(fx.allen));
    const got = await effective(t, fx.base);
    expect(got).toMatchObject({ playerId: null, player: null, playerFromId: fx.base, cameosFromId: fx.base });
    expect(got.cameoIds).toEqual([fx.kelce]);
  });

  test("a default from another sport is dropped at creation (the card's sport, or the chain's)", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    await store(t, fx.set, { defaultPlayerIds: [fx.ohtani], defaultCameoIds: [fx.ohtani, fx.kelce] });
    const got = await effective(t, fx.base);
    expect(got.playerId).toBeNull();
    expect(got.playerFromId).toBe(fx.set);
    expect(got.cameoIds).toEqual([fx.kelce]);
    // The card's own sport, when the caller passes it, decides.
    const asBaseball = await effective(t, fx.base, fx.baseball);
    expect(asBaseball.playerId).toBe(fx.ohtani);
    expect(asBaseball.cameoIds).toEqual([]); // Kelce plays football; Ohtani is the player
  });

  test("a player who ALSO plays the card's sport (playerSports) is kept", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    await t.run(async (ctx) =>
      ctx.db.insert("playerSports", {
        playerId: fx.ohtani,
        sportId: fx.sport,
        nameNormalized: normalizeEntityName("Shohei Ohtani"),
      }),
    );
    await store(t, fx.set, { defaultPlayerIds: [fx.ohtani] });
    expect((await effective(t, fx.base)).playerId).toBe(fx.ohtani);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The walk down, from any level
// ───────────────────────────────────────────────────────────────────────────

describe("everyCardTargets from any level", () => {
  test("a set walks every card row beneath it that holds cards, depth first, with roles and counts", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    const got = await t
      .withIdentity(ADMIN)
      .query(api.cardPlayersBulk.everyCardTargets, { variantId: fx.set, kind: "player" });
    expect(got).toEqual({
      targets: [
        { _id: fx.base, name: "Base", role: "home", cardCount: 2 },
        { _id: fx.ins, name: "Profiles Ink", role: "home", cardCount: 1 },
        { _id: fx.gold, name: "Gold", role: "parallel", cardCount: 1 },
        { _id: fx.silver, name: "Silver", role: "parallel", cardCount: 1 },
      ],
      truncated: false,
      overridden: 0,
    });
  });

  test("the sport walks every set of every year", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    const got = await t.run(async (ctx) => bulkTargets(ctx, fx.sport, "cameo"));
    expect(got.targets.map((x) => x._id)).toEqual([...heldRows(fx)]);
  });

  test("a Base brings the inserts under the set's Parallel types; an insert brings its parallels", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    const fromBase = await t.run(async (ctx) => bulkTargets(ctx, fx.base, "player"));
    expect(fromBase.targets.map((x) => [x._id, x.role])).toEqual([
      [fx.base, "home"],
      [fx.silver, "parallel"],
    ]);
    const fromIns = await t.run(async (ctx) => bulkTargets(ctx, fx.ins, "player"));
    expect(fromIns.targets.map((x) => [x._id, x.role])).toEqual([
      [fx.ins, "home"],
      [fx.gold, "parallel"],
    ]);
  });

  test("rows a nearer own value of THAT kind speaks for are left out and counted", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    await store(t, fx.ins, { defaultPlayerIds: [fx.allen] });
    await store(t, fx.base, { defaultCameoIds: [fx.kelce] });
    const player = await t.run(async (ctx) => bulkTargets(ctx, fx.set, "player"));
    expect(player.targets.map((x) => x._id)).toEqual([fx.base, fx.silver]);
    expect(player.overridden).toBe(2); // INS and its Gold
    const cameo = await t.run(async (ctx) => bulkTargets(ctx, fx.set, "cameo"));
    // The Base's cameos speak for the Base and for Silver (its parallel).
    expect(cameo.targets.map((x) => x._id)).toEqual([fx.ins, fx.gold]);
    expect(cameo.overridden).toBe(2);
  });

  test("the root's OWN value never excludes the root", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    await store(t, fx.ins, { defaultPlayerIds: [fx.allen] });
    const got = await t.run(async (ctx) => bulkTargets(ctx, fx.ins, "player"));
    expect(got.targets.map((x) => x._id)).toEqual([fx.ins, fx.gold]);
  });

  test("a row that is gone is refused; a member is refused", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    const gone = await t.run(async (ctx) => {
      const id = await ctx.db.insert("selectorOptions", {
        level: "insert",
        value: "Gone",
        parentId: fx.insertsType,
        platformData: {},
        children: [],
        lastUpdated: NOW,
      });
      await ctx.db.delete(id);
      return id;
    });
    await expect(
      t.withIdentity(ADMIN).query(api.cardPlayersBulk.everyCardTargets, { variantId: gone, kind: "player" }),
    ).rejects.toThrow(DEFAULT_ROW_MISSING);
    await expect(
      t.withIdentity(MEMBER).query(api.cardPlayersBulk.everyCardTargets, { variantId: fx.set, kind: "player" }),
    ).rejects.toThrow(/admin/i);
  });
});

describe("the walk down and the lookup agree", () => {
  /**
   * For every row R and each kind: the rows a run from R walks are exactly
   * the card rows holding cards whose lookup passes through R with no nearer
   * value; and when R stores a value, exactly the card rows holding cards
   * whose lookup picks R. (An empty row has no card to bring along; its new
   * cards still look the value up.)
   */
  async function assertAgreement(t: T, fx: Tree) {
    const kinds: CardPlayerDefaultKind[] = ["player", "cameo"];
    const source = new Map<string, Record<CardPlayerDefaultKind, string | null>>();
    const chains = new Map<string, string[]>();
    for (const leaf of cardRows(fx)) {
      const got = await effective(t, leaf);
      source.set(leaf, { player: got.playerFromId, cameo: got.cameosFromId });
      chains.set(leaf, await t.run(async (ctx) => (await cardPlayerDefaultsChain(ctx, leaf)).map((r) => r._id as string)));
    }
    for (const root of everyRow(fx)) {
      const row = await rowOf(t, root);
      for (const kind of kinds) {
        const walked = (await t.run(async (ctx) => bulkTargets(ctx, root, kind))).targets.map((x) => x._id as string);
        const expected = heldRows(fx).filter((leaf) => {
          const chain = chains.get(leaf)!;
          const at = chain.indexOf(root);
          if (at === -1) return false;
          const src = source.get(leaf)![kind];
          // No value nearer than the root: the lookup's source is the root
          // or something farther (or nothing).
          return src === null || chain.indexOf(src) >= at;
        });
        expect([...walked].sort(), `${row.value} (${row.level}) ${kind}`).toEqual([...expected].sort());
        const stored = kind === "player" ? row.defaultPlayerIds : row.defaultCameoIds;
        if (stored && stored.length > 0) {
          const picksRoot = heldRows(fx).filter((leaf) => source.get(leaf)![kind] === root);
          expect([...walked].sort(), `${row.value} picks`).toEqual([...picksRoot].sort());
        }
      }
    }
  }

  test("with values at the sport, the set, the Base, an insert and a parallel", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    await store(t, fx.sport, { defaultPlayerIds: [fx.allen], defaultCameoIds: [fx.kelce] });
    await store(t, fx.set, { defaultCameoIds: [fx.allen] });
    await store(t, fx.base, { defaultPlayerIds: [fx.mahomes] });
    await store(t, fx.ins, { defaultCameoIds: [fx.mahomes] });
    await store(t, fx.gold, { defaultPlayerIds: [fx.kelce] });
    await assertAgreement(t, fx);
  });

  test("with values on the Parallel type and Silver only", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    await store(t, fx.parallelsType, { defaultPlayerIds: [fx.allen] });
    await store(t, fx.silver, { defaultCameoIds: [fx.kelce] });
    await assertAgreement(t, fx);
  });

  test("with values on both the Base and the Parallel type (the Parallel type is nearer for Silver)", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    await store(t, fx.base, { defaultPlayerIds: [fx.mahomes], defaultCameoIds: [fx.kelce] });
    await store(t, fx.parallelsType, { defaultPlayerIds: [fx.allen] });
    await assertAgreement(t, fx);
    // The Base's player run leaves Silver to the Parallel type; its cameo run
    // still reaches Silver, whose Parallel type stores no cameos.
    const player = (await t.run(async (ctx) => bulkTargets(ctx, fx.base, "player"))).targets.map((x) => x._id);
    const cameo = (await t.run(async (ctx) => bulkTargets(ctx, fx.base, "cameo"))).targets.map((x) => x._id);
    expect(player).not.toContain(fx.silver);
    expect(cameo).toContain(fx.silver);
  });

  test("with nothing stored", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    await assertAgreement(t, fx);
  });
});

describe("a run from a high row leaves the cards a nearer value speaks for", () => {
  test("addPlayerToVariant from the set skips the insert that stores its own player", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    await store(t, fx.ins, { defaultPlayerIds: [fx.allen] });
    const admin = t.withIdentity(ADMIN);
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: { cursor: string | null } = await admin.mutation(api.cardPlayersBulk.addPlayerToVariant, {
        variantId: fx.set,
        playerId: fx.mahomes,
        cursor,
      });
      cursor = page.cursor;
      pages++;
    } while (cursor !== null && pages < 20);
    const playerOf = (id: Id<"cardChecklist">) => t.run(async (ctx) => (await ctx.db.get(id))!.playerIds ?? null);
    expect(await playerOf(fx.cards.base1)).toEqual([fx.mahomes]);
    expect(await playerOf(fx.cards.silver1)).toEqual([fx.mahomes]);
    expect(await playerOf(fx.cards.ins1)).toBeNull();
    expect(await playerOf(fx.cards.gold1)).toBeNull();
    expect(await playerOf(fx.cards.chrome1)).toBeNull(); // another set
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Storing and clearing
// ───────────────────────────────────────────────────────────────────────────

describe("setCardPlayerDefault / clearCardPlayerDefault", () => {
  async function setup() {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    return { t, fx, admin: t.withIdentity(ADMIN) };
  }
  const fields = async (t: T, id: RowId) => {
    const row = await rowOf(t, id);
    return {
      player: "defaultPlayerIds" in row ? row.defaultPlayerIds : "absent",
      cameos: "defaultCameoIds" in row ? row.defaultCameoIds : "absent",
    };
  };

  test("a player is stored as the one player; a new pick replaces it", async () => {
    const { t, fx, admin } = await setup();
    const set = api.cardPlayersBulk.setCardPlayerDefault;
    expect(await admin.mutation(set, { selectorOptionId: fx.set, kind: "player", playerId: fx.allen })).toEqual({
      playerId: fx.allen,
      cameoIds: [],
    });
    await admin.mutation(set, { selectorOptionId: fx.set, kind: "player", playerId: fx.mahomes });
    expect(await fields(t, fx.set)).toEqual({ player: [fx.mahomes], cameos: "absent" });
  });

  test("picking a cameo as the player moves them out of the cameos", async () => {
    const { t, fx, admin } = await setup();
    const set = api.cardPlayersBulk.setCardPlayerDefault;
    await admin.mutation(set, { selectorOptionId: fx.base, kind: "cameo", playerId: fx.kelce });
    await admin.mutation(set, { selectorOptionId: fx.base, kind: "cameo", playerId: fx.allen });
    await admin.mutation(set, { selectorOptionId: fx.base, kind: "player", playerId: fx.kelce });
    expect(await fields(t, fx.base)).toEqual({ player: [fx.kelce], cameos: [fx.allen] });
    // The last cameo moving up leaves the field absent.
    await admin.mutation(set, { selectorOptionId: fx.base, kind: "player", playerId: fx.allen });
    expect(await fields(t, fx.base)).toEqual({ player: [fx.allen], cameos: "absent" });
  });

  test("cameos add in order, once each; the row's own player is refused as a cameo", async () => {
    const { t, fx, admin } = await setup();
    const set = api.cardPlayersBulk.setCardPlayerDefault;
    await admin.mutation(set, { selectorOptionId: fx.ins, kind: "cameo", playerId: fx.kelce });
    await admin.mutation(set, { selectorOptionId: fx.ins, kind: "cameo", playerId: fx.allen });
    await admin.mutation(set, { selectorOptionId: fx.ins, kind: "cameo", playerId: fx.kelce });
    expect(await fields(t, fx.ins)).toEqual({ player: "absent", cameos: [fx.kelce, fx.allen] });
    await admin.mutation(set, { selectorOptionId: fx.ins, kind: "player", playerId: fx.mahomes });
    await expect(
      admin.mutation(set, { selectorOptionId: fx.ins, kind: "cameo", playerId: fx.mahomes }),
    ).rejects.toThrow(alreadyThePlayerMessage("Patrick Mahomes"));
    expect(alreadyThePlayerMessage("Patrick Mahomes")).toBe("Patrick Mahomes is already the player on every card.");
  });

  test("the cameo list stops at MAX_CARD_PLAYERS", async () => {
    const { t, fx, admin } = await setup();
    const many = await t.run(async (ctx) => {
      const out: Array<Id<"players">> = [];
      for (let i = 0; i <= MAX_CARD_PLAYERS; i++) {
        out.push(
          await ctx.db.insert("players", { name: `P${i}`, nameNormalized: `p${i}`, sportId: fx.sport, lastUpdated: NOW }),
        );
      }
      return out;
    });
    await store(t, fx.set, { defaultCameoIds: many.slice(0, MAX_CARD_PLAYERS) });
    await expect(
      admin.mutation(api.cardPlayersBulk.setCardPlayerDefault, {
        selectorOptionId: fx.set,
        kind: "cameo",
        playerId: many[MAX_CARD_PLAYERS],
      }),
    ).rejects.toThrow(DEFAULT_CAMEOS_FULL);
    // One already there is a no-op, not a refusal.
    await admin.mutation(api.cardPlayersBulk.setCardPlayerDefault, {
      selectorOptionId: fx.set,
      kind: "cameo",
      playerId: many[0],
    });
    expect((await fields(t, fx.set)).cameos).toHaveLength(MAX_CARD_PLAYERS);
  });

  test("works at every level, sport to parallel", async () => {
    const { t, fx, admin } = await setup();
    for (const id of everyRow(fx)) {
      await admin.mutation(api.cardPlayersBulk.setCardPlayerDefault, { selectorOptionId: id, kind: "player", playerId: fx.allen });
      expect((await fields(t, id)).player).toEqual([fx.allen]);
    }
  });

  test("clearing takes one value off, leaves the field absent when empty, and is a no-op when not stored", async () => {
    const { t, fx, admin } = await setup();
    await store(t, fx.set, { defaultPlayerIds: [fx.allen], defaultCameoIds: [fx.kelce, fx.mahomes] });
    const clear = api.cardPlayersBulk.clearCardPlayerDefault;
    await admin.mutation(clear, { selectorOptionId: fx.set, kind: "cameo", playerId: fx.kelce });
    expect(await fields(t, fx.set)).toEqual({ player: [fx.allen], cameos: [fx.mahomes] });
    // Clearing a player who is not the stored one leaves the player.
    await admin.mutation(clear, { selectorOptionId: fx.set, kind: "player", playerId: fx.kelce });
    expect((await fields(t, fx.set)).player).toEqual([fx.allen]);
    await admin.mutation(clear, { selectorOptionId: fx.set, kind: "player", playerId: fx.allen });
    expect(
      await admin.mutation(clear, { selectorOptionId: fx.set, kind: "cameo", playerId: fx.mahomes }),
    ).toEqual({ playerId: null, cameoIds: [] });
    expect(await fields(t, fx.set)).toEqual({ player: "absent", cameos: "absent" });
  });

  test("neither edits a card or the row's lastUpdated", async () => {
    const { t, fx, admin } = await setup();
    const before = await t.run(async (ctx) => ({
      card: await ctx.db.get(fx.cards.base1),
      updated: (await ctx.db.get(fx.base))!.lastUpdated,
    }));
    await admin.mutation(api.cardPlayersBulk.setCardPlayerDefault, { selectorOptionId: fx.base, kind: "player", playerId: fx.allen });
    await admin.mutation(api.cardPlayersBulk.setCardPlayerDefault, { selectorOptionId: fx.base, kind: "cameo", playerId: fx.kelce });
    await admin.mutation(api.cardPlayersBulk.clearCardPlayerDefault, { selectorOptionId: fx.base, kind: "player", playerId: fx.allen });
    const after = await t.run(async (ctx) => ({
      card: await ctx.db.get(fx.cards.base1),
      updated: (await ctx.db.get(fx.base))!.lastUpdated,
    }));
    expect(after).toEqual(before);
  });

  test("refuses a row or a player that is gone, and a member", async () => {
    const { t, fx, admin } = await setup();
    await t.run(async (ctx) => ctx.db.delete(fx.kelce));
    await expect(
      admin.mutation(api.cardPlayersBulk.setCardPlayerDefault, { selectorOptionId: fx.set, kind: "player", playerId: fx.kelce }),
    ).rejects.toThrow(BULK_MISSING_PLAYER);
    await t.run(async (ctx) => ctx.db.delete(fx.base2));
    for (const fn of [api.cardPlayersBulk.setCardPlayerDefault, api.cardPlayersBulk.clearCardPlayerDefault]) {
      await expect(
        admin.mutation(fn, { selectorOptionId: fx.base2, kind: "player", playerId: fx.allen }),
      ).rejects.toThrow(DEFAULT_ROW_MISSING);
      await expect(
        t.withIdentity(MEMBER).mutation(fn, { selectorOptionId: fx.set, kind: "player", playerId: fx.allen }),
      ).rejects.toThrow(/admin/i);
    }
    expect(await fields(t, fx.set)).toEqual({ player: "absent", cameos: "absent" });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The panel's read
// ───────────────────────────────────────────────────────────────────────────

describe("cardPlayerDefaults (the panel's read)", () => {
  const read = (t: T, id: RowId) =>
    t.withIdentity(ADMIN).query(api.cardPlayersBulk.cardPlayerDefaults, { selectorOptionId: id });

  test("own values with names; nothing inherited; counts over the rows a run would walk", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    await store(t, fx.set, { defaultPlayerIds: [fx.allen], defaultCameoIds: [fx.kelce] });
    expect(await read(t, fx.set)).toEqual({
      own: { player: { _id: fx.allen, name: "Josh Allen" }, cameos: [{ _id: fx.kelce, name: "Travis Kelce" }] },
      cardCount: 5,
      cardsToWalk: { player: 5, cameo: 5 },
      truncated: false,
    });
  });

  test("inherited per field from the nearest row above, through the Base for its parallels", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    await store(t, fx.sport, { defaultCameoIds: [fx.kelce] });
    await store(t, fx.base, { defaultPlayerIds: [fx.mahomes] });
    const got = await read(t, fx.silver);
    expect(got).toMatchObject({
      own: { cameos: [] },
      inherited: {
        player: { fromId: fx.base, fromName: "Base", _id: fx.mahomes, name: "Patrick Mahomes" },
        cameos: { fromId: fx.sport, fromName: "Football", list: [{ _id: fx.kelce, name: "Travis Kelce" }] },
      },
      cardCount: 1,
    });
    expect(got!.own.player).toBeUndefined();
    // A row's own value is not "inherited" by itself.
    expect((await read(t, fx.base))!.inherited?.player).toBeUndefined();
  });

  test("cardsToWalk leaves out the cards a nearer value of that kind speaks for", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    await store(t, fx.ins, { defaultPlayerIds: [fx.allen] });
    const got = await read(t, fx.set);
    expect(got).toMatchObject({ cardCount: 5, cardsToWalk: { player: 3, cameo: 5 } });
  });

  test("a row never counted makes the counts unknown (absent, not zero)", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    await t.run(async (ctx) => ctx.db.patch(fx.gold, { cardCount: undefined }));
    const got = await read(t, fx.set);
    expect(got).not.toHaveProperty("cardCount");
    expect(got).not.toHaveProperty("cardsToWalk");
    expect((await read(t, fx.base))!.cardCount).toBe(3); // Base + Silver
  });

  test("a never-counted row with no cards is probed: 0 cards, nothing to walk (a hand-made checklist just saves)", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    // A hand-made set: its Base was never counted (no `cardCount`) and has no cards.
    const { handSet, handBase } = await t.run(async (ctx) => {
      const handSet = await ctx.db.insert("selectorOptions", {
        level: "setName", value: "Hand Made", parentId: fx.brand, platformData: {}, children: [], lastUpdated: NOW,
      });
      const handBase = await ctx.db.insert("selectorOptions", {
        level: "variantType", value: "Base", parentId: handSet, platformData: {}, children: [], lastUpdated: NOW,
      });
      return { handSet, handBase };
    });
    for (const id of [handSet, handBase]) {
      expect(await read(t, id)).toMatchObject({ cardCount: 0, cardsToWalk: { player: 0, cameo: 0 }, truncated: false });
      for (const kind of ["player", "cameo"] as const) {
        const got = await t.withIdentity(ADMIN).query(api.cardPlayersBulk.everyCardTargets, { variantId: id, kind });
        expect(got).toEqual({ targets: [], truncated: false, overridden: 0 });
      }
    }
    // Its first card makes it unknown again (still uncounted) and walked, with no count.
    await t.run(async (ctx) =>
      insertTestCard(ctx, {
        selectorOptionId: handBase, cardNumber: "1", cardName: "Card 1", platformData: {}, sortOrder: 0, lastUpdated: NOW,
      }),
    );
    await t.run(async (ctx) => ctx.db.patch(handBase, { cardCount: undefined }));
    const after = await read(t, handSet);
    expect(after).not.toHaveProperty("cardCount");
    expect(after).not.toHaveProperty("cardsToWalk");
    const walked = await t.withIdentity(ADMIN).query(api.cardPlayersBulk.everyCardTargets, { variantId: handSet, kind: "player" });
    expect(walked.targets).toEqual([{ _id: handBase, name: "Base", role: "home" }]);
  });

  test("a row counted at 0 is not walked, and counts as known", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    expect(await read(t, fx.insertsType)).toMatchObject({ cardCount: 2, cardsToWalk: { player: 2, cameo: 2 } });
    const got = await t.withIdentity(ADMIN).query(api.cardPlayersBulk.everyCardTargets, { variantId: fx.parallelsType, kind: "cameo" });
    expect(got.targets.map((x) => x._id)).toEqual([fx.silver]);
  });

  test("a deleted player is left out of the names", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    await store(t, fx.set, { defaultPlayerIds: [fx.allen], defaultCameoIds: [fx.kelce, fx.mahomes] });
    await t.run(async (ctx) => {
      await ctx.db.delete(fx.allen);
      await ctx.db.delete(fx.kelce);
    });
    expect((await read(t, fx.set))!.own).toEqual({ cameos: [{ _id: fx.mahomes, name: "Patrick Mahomes" }] });
  });

  test("null for a row that is gone; admin-only", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    await t.run(async (ctx) => ctx.db.delete(fx.base2));
    expect(await read(t, fx.base2)).toBeNull();
    await expect(
      t.withIdentity(MEMBER).query(api.cardPlayersBulk.cardPlayerDefaults, { selectorOptionId: fx.set }),
    ).rejects.toThrow(/admin/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The walk's read budget
// ───────────────────────────────────────────────────────────────────────────

/** `ctx.db` with every `get` and every query range counted as one call. */
function countingDb(db: QueryCtx["db"]) {
  const stats = { calls: 0 };
  const wrapped = new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop) as unknown;
      if (prop === "get" || prop === "query") {
        return (...a: unknown[]) => {
          stats.calls++;
          return (value as (...x: unknown[]) => unknown).apply(target, a);
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db: wrapped as QueryCtx["db"], stats };
}

describe("the walk down stays bounded", () => {
  test("past MAX_EVERY_CARD_WALK rows it stops, says truncated, and stays under ~1,000 calls (probes included)", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    await t.run(async (ctx: MutationCtx) => {
      for (let i = 0; i < MAX_EVERY_CARD_WALK + 20; i++) {
        await ctx.db.insert("selectorOptions", {
          level: "insert",
          value: `Insert ${i}`,
          parentId: fx.insertsType,
          platformData: {},
          children: [],
          lastUpdated: NOW,
        });
      }
    });
    const { got, calls } = await t.run(async (ctx) => {
      const { db, stats } = countingDb(ctx.db);
      const result = await bulkTargets({ db }, fx.set, "player");
      return { got: result, calls: stats.calls };
    });
    expect(got.truncated).toBe(true);
    expect(got.targets.length).toBeLessThanOrEqual(MAX_EVERY_CARD_TARGETS);
    // Every added insert is uncounted and empty: the first MAX_UNCOUNTED_PROBES
    // (in walk order) are probed and left out; the rest stay unknown and are walked.
    const names = new Set(got.targets.map((x) => x.name));
    expect(names.has("Insert 0")).toBe(false);
    expect(names.has(`Insert ${MAX_UNCOUNTED_PROBES - 1}`)).toBe(false);
    expect(names.has(`Insert ${MAX_UNCOUNTED_PROBES}`)).toBe(true);
    // A page spends at most ~2,410 calls on its cards (cardPlayersBulk.test.ts);
    // the walk, its probes included, must leave room under the 4,096 limit.
    expect(calls).toBeLessThan(1_000);
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
// The sport check (audit round 3, S2)
// ───────────────────────────────────────────────────────────────────────────

describe("a player who doesn't play the row's sport", () => {
  test("is refused as the player or a cameo, at any level under the sport, in the operator's words", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    const admin = t.withIdentity(ADMIN);
    const message = wrongSportMessage("Shohei Ohtani", "Football");
    expect(message).toBe("Shohei Ohtani doesn't play Football, so they can't go on every card here.");
    for (const id of [fx.sport, fx.set, fx.base, fx.gold]) {
      for (const kind of ["player", "cameo"] as const) {
        await expect(
          admin.mutation(api.cardPlayersBulk.setCardPlayerDefault, { selectorOptionId: id, kind, playerId: fx.ohtani }),
        ).rejects.toThrow(message);
      }
      const row = await rowOf(t, id);
      expect(row.defaultPlayerIds).toBeUndefined();
      expect(row.defaultCameoIds).toBeUndefined();
    }
    // Their own sport's row takes them.
    await admin.mutation(api.cardPlayersBulk.setCardPlayerDefault, {
      selectorOptionId: fx.baseball,
      kind: "player",
      playerId: fx.ohtani,
    });
    expect((await rowOf(t, fx.baseball)).defaultPlayerIds).toEqual([fx.ohtani]);
  });

  test("a player who also plays the row's sport (playerSports) is stored", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("playerSports", {
        playerId: fx.ohtani,
        sportId: fx.sport,
        nameNormalized: normalizeEntityName("Shohei Ohtani"),
      });
    });
    await t.withIdentity(ADMIN).mutation(api.cardPlayersBulk.setCardPlayerDefault, {
      selectorOptionId: fx.set,
      kind: "cameo",
      playerId: fx.ohtani,
    });
    expect((await rowOf(t, fx.set)).defaultCameoIds).toEqual([fx.ohtani]);
  });

  test("a row with no sport above it has nothing to check against and is allowed", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    const orphan = await t.run(async (ctx) =>
      ctx.db.insert("selectorOptions", { level: "setName", value: "Loose", platformData: {}, children: [], lastUpdated: NOW }),
    );
    await t.withIdentity(ADMIN).mutation(api.cardPlayersBulk.setCardPlayerDefault, {
      selectorOptionId: orphan,
      kind: "player",
      playerId: fx.ohtani,
    });
    expect((await rowOf(t, orphan)).defaultPlayerIds).toEqual([fx.ohtani]);
  });

  test("the whole-checklist run leaves a card of another sport alone and counts it (both adds)", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedTree(t);
    // A card under the Football Base stamped Baseball (a set moved between
    // sports): Mahomes never lands on it, as the player or as a cameo.
    const { blank, named } = await t.run(async (ctx) => ({
      blank: await insertTestCard(ctx, {
        selectorOptionId: fx.base,
        cardNumber: "9",
        cardName: "Card 9",
        sportId: fx.baseball,
        platformData: {},
        sortOrder: 9,
        lastUpdated: NOW,
      }),
      named: await insertTestCard(ctx, {
        selectorOptionId: fx.base,
        cardNumber: "10",
        cardName: "Card 10",
        sportId: fx.baseball,
        playerIds: [fx.ohtani],
        playerLinks: [{ playerId: fx.ohtani, nameOnCard: "Shohei Ohtani" }],
        platformData: {},
        sortOrder: 10,
        lastUpdated: NOW,
      }),
    }));
    const admin = t.withIdentity(ADMIN);
    const run = async (fn: typeof api.cardPlayersBulk.addPlayerToVariant) => {
      const totals = { changed: 0, skippedSport: 0 };
      let cursor: string | null = null;
      let pages = 0;
      do {
        const page: { cursor: string | null; changed: number; skippedSport: number } = await admin.mutation(fn, {
          variantId: fx.base,
          playerId: fx.mahomes,
          cursor,
        });
        totals.changed += page.changed;
        totals.skippedSport += page.skippedSport;
        cursor = page.cursor;
        pages++;
      } while (cursor !== null && pages < 20);
      return totals;
    };
    // Player add: base1, base2 and Silver's card are filled; the blank
    // Baseball card is skipped for its sport (the named one is "other").
    expect(await run(api.cardPlayersBulk.addPlayerToVariant)).toEqual({ changed: 3, skippedSport: 1 });
    // Cameo add: the cards Mahomes now heads are skipped as his own; the
    // named Baseball card is skipped for its sport.
    const cameo = await run(api.cardPlayersBulk.addCameoToVariant);
    expect(cameo.skippedSport).toBe(2);
    const after = await t.run(async (ctx) => ({ blank: (await ctx.db.get(blank))!, named: (await ctx.db.get(named))! }));
    expect(after.blank.playerIds).toBeUndefined();
    expect(after.blank.secondaryPlayerIds).toBeUndefined();
    expect(after.named.playerIds).toEqual([fx.ohtani]);
    expect(after.named.secondaryPlayerIds).toBeUndefined();
  });
});
