/**
 * NEO-528 round 2 — "Player on every card": one player put on every card of a
 * checklist and its parallels, as the card's player or as a cameo.
 *
 * Fixture A (`seedBlank`): 2026 Topps Profiles, Base + Parallels › Gold, with
 * cards that have no player yet, built here for the player add.
 * Fixture B (`seedCollectionCatalog`): Topps Chrome, every card already naming
 * Gooden or Strawberry, for the cameo add (moved from the round-1 tests).
 */

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { seedCollectionCatalog } from "../lib/testing/collection-fixture";
import { insertTestCard, type TestCardRow } from "../lib/testing/card-row";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import {
  BULK_CHECKLIST_CHANGED,
  BULK_MISSING_PLAYER,
  BULK_PAGE,
  DEFAULT_ROW_MISSING,
  runBulkPage,
  type BulkOp,
  type BulkPage,
} from "./cardPlayersBulk";
import { setCardSecondaryPlayers } from "./cardSecondaryPlayers";
import { descriptionForStoredCard, titleForStoredCard } from "./storedCardTitle";
import { MAX_CARD_PLAYERS, MAX_CARD_TEAMS } from "./features/cardAttention";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = { subject: "admin_neo528_bulk", role: "admin" };
const MEMBER = { subject: "member_neo528_bulk", role: "member" };
const NOW = 1_700_000_000_000;

type T = ReturnType<typeof convexTest>;
type Admin = ReturnType<T["withIdentity"]>;
type Card = Doc<"cardChecklist">;

const cardOf = (t: T, id: Id<"cardChecklist">) => t.run(async (ctx) => (await ctx.db.get(id))!);

const playerLinksOf = (t: T, id: Id<"cardChecklist">) =>
  t.run(async (ctx) =>
    ctx.db
      .query("cardPlayerLinks")
      .withIndex("by_card", (q) => q.eq("cardChecklistId", id))
      .collect(),
  );

const cameoLinksOf = (t: T, id: Id<"cardChecklist">) =>
  t.run(async (ctx) =>
    ctx.db
      .query("cardSecondaryPlayerLinks")
      .withIndex("by_card", (q) => q.eq("cardChecklistId", id))
      .collect(),
  );

/** Every page of one run, summed. */
async function runAll(admin: Admin, op: BulkOp, variantId: Id<"selectorOptions">, playerId: Id<"players">) {
  const fn = op === "player" ? api.cardPlayersBulk.addPlayerToVariant : api.cardPlayersBulk.addCameoToVariant;
  const pages: BulkPage[] = [];
  let cursor: string | null = null;
  do {
    const page: BulkPage = await admin.mutation(fn, { variantId, playerId, cursor });
    pages.push(page);
    cursor = page.cursor;
  } while (cursor !== null && pages.length < 50);
  type Key = Exclude<keyof BulkPage, "targetId" | "targetIndex" | "targetCount" | "cursor">;
  const sum = (k: Key) => pages.reduce((n, p) => n + p[k], 0);
  return {
    pages,
    scanned: sum("scanned"),
    changed: sum("changed"),
    unchanged: sum("unchanged"),
    promoted: sum("promoted"),
    skippedPrimary: sum("skippedPrimary"),
    skippedFull: sum("skippedFull"),
    skippedOther: sum("skippedOther"),
    skippedPending: sum("skippedPending"),
    titlesRefreshed: sum("titlesRefreshed"),
    titlesKept: sum("titlesKept"),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Fixture A: a checklist filled before any player was set
// ───────────────────────────────────────────────────────────────────────────

async function seedBlank(t: T) {
  return t.run(async (ctx) => {
    const row = (
      level: Doc<"selectorOptions">["level"],
      value: string,
      parentId?: Id<"selectorOptions">,
      features?: Record<string, string>,
    ) =>
      ctx.db.insert("selectorOptions", {
        level,
        value,
        ...(parentId ? { parentId } : {}),
        ...(features ? { features } : {}),
        platformData: {},
        children: [],
        lastUpdated: NOW,
      });
    const sportId = await row("sport", "Football");
    const year = await row("year", "2026", sportId);
    const brand = await row("manufacturer", "Topps", year);
    const setId = await row("setName", "Profiles", brand);
    const baseId = await row("variantType", "Base", setId, { season: "2026", manufacturer: "Topps" });
    const parallelsId = await row("variantType", "Parallels", setId);
    const goldId = await row("insert", "Gold", parallelsId, { season: "2026", manufacturer: "Topps" });
    const player = (name: string) =>
      ctx.db.insert("players", { name, nameNormalized: normalizeEntityName(name), sportId, lastUpdated: NOW });
    const mahomes = await player("Patrick Mahomes");
    const kelce = await player("Travis Kelce");
    const allen = await player("Josh Allen");
    const chiefs = await ctx.db.insert("teams", {
      name: "Chiefs",
      location: "Kansas City",
      nameNormalized: normalizeEntityName("Kansas City Chiefs"),
      sportId,
      lastUpdated: NOW,
    });
    return { sportId, setId, baseId, parallelsId, goldId, mahomes, kelce, allen, chiefs };
  });
}
type Blank = Awaited<ReturnType<typeof seedBlank>>;

/**
 * A card as the generator would have written it: title and description are
 * what `titleForStoredCard` / `descriptionForStoredCard` build for it, unless
 * the row says otherwise. Cameos go through the real writer.
 */
async function blankCard(
  ctx: MutationCtx,
  selectorOptionId: Id<"selectorOptions">,
  cardNumber: string,
  extra: Partial<TestCardRow> & { cameos?: Array<Id<"players">> } = {},
): Promise<Id<"cardChecklist">> {
  const { cameos, ...rest } = extra;
  const id = await insertTestCard(ctx, {
    selectorOptionId,
    cardNumber,
    cardName: `Card ${cardNumber}`,
    platformData: {},
    sortOrder: 0,
    lastUpdated: NOW,
    ...rest,
  });
  let card = (await ctx.db.get(id))!;
  if (cameos) {
    await setCardSecondaryPlayers(ctx, card, cameos, { description: "leave" });
    card = (await ctx.db.get(id))!;
  }
  const names: string[] = [];
  for (const c of card.secondaryPlayerIds ?? []) names.push((await ctx.db.get(c))!.name);
  await ctx.db.patch(id, {
    listingTitle: rest.listingTitle ?? (await titleForStoredCard(ctx, card)).title,
    listingDescription: rest.listingDescription ?? (await descriptionForStoredCard(ctx, card, names)),
  });
  return id;
}

/** What the generator builds for the stored card now (with its cameos). */
const generatedNow = (t: T, id: Id<"cardChecklist">) =>
  t.run(async (ctx) => {
    const card = (await ctx.db.get(id))!;
    const names: string[] = [];
    for (const c of card.secondaryPlayerIds ?? []) names.push((await ctx.db.get(c))!.name);
    return {
      title: await titleForStoredCard(ctx, card),
      description: await descriptionForStoredCard(ctx, card, names),
    };
  });

describe("everyCardTargets", () => {
  test("a Base's targets are itself and the inserts under the set's Parallel types", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedCollectionCatalog(t);
    for (const kind of ["player", "cameo"] as const) {
      const { targets, truncated, overridden } = await t
        .withIdentity(ADMIN)
        .query(api.cardPlayersBulk.everyCardTargets, { variantId: fx.baseId, kind });
      expect(truncated).toBe(false);
      expect(overridden).toBe(0);
      expect(targets).toEqual([
        { _id: fx.baseId, name: "Base", role: "home", cardCount: 3 },
        { _id: fx.goldId, name: "Gold Refractor", role: "parallel", cardCount: 1 },
      ]);
    }
  });

  test("is admin-only", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedCollectionCatalog(t);
    await expect(
      t.withIdentity(MEMBER).query(api.cardPlayersBulk.everyCardTargets, { variantId: fx.baseId, kind: "player" }),
    ).rejects.toThrow(/admin/i);
  });
});

describe("addPlayerToVariant: makes them the card's player, only where no one is", () => {
  async function scenario() {
    const t = convexTest(schema, modules);
    const fx = await seedBlank(t);
    const ids = await t.run(async (ctx) => {
      const empty = await blankCard(ctx, fx.baseId, "TP-1", { teamOnCardIds: [fx.chiefs], sortOrder: 1 });
      const typed = await blankCard(ctx, fx.baseId, "TP-2", {
        sortOrder: 2,
        listingTitle: "Profiles TP-2 as I typed it",
        listingDescription: "My own words.",
      });
      const other = await blankCard(ctx, fx.baseId, "TP-3", {
        sortOrder: 3,
        playerIds: [fx.allen],
        playerLinks: [{ playerId: fx.allen, nameOnCard: "Josh Allen" }],
      });
      const pending = await blankCard(ctx, fx.baseId, "TP-4", {
        sortOrder: 4,
        pendingPlayerNames: ["Pat Mahomes II"],
        pendingTeamNames: ["KC"],
      });
      const already = await blankCard(ctx, fx.baseId, "TP-5", {
        sortOrder: 5,
        playerIds: [fx.mahomes],
        playerLinks: [{ playerId: fx.mahomes, nameOnCard: "Pat Mahomes" }],
      });
      const cameo = await blankCard(ctx, fx.baseId, "TP-6", {
        sortOrder: 6,
        teamOnCardIds: [fx.chiefs],
        cameos: [fx.kelce, fx.mahomes],
      });
      const gold = await blankCard(ctx, fx.goldId, "TP-1", { sortOrder: 1 });
      return { empty, typed, other, pending, already, cameo, gold };
    });
    const before = new Map<string, Card>();
    for (const id of Object.values(ids)) before.set(id, await cardOf(t, id));
    const result = await runAll(t.withIdentity(ADMIN), "player", fx.baseId, fx.mahomes);
    return { t, fx, ids, before, result };
  }

  test("the counts: written, promoted, already theirs, and each kind of skip", async () => {
    const { result, fx } = await scenario();
    expect(result.pages.map((p) => p.targetId)).toEqual([fx.baseId, fx.goldId]);
    expect(result).toMatchObject({
      scanned: 7,
      changed: 4, // empty, typed, cameo (promoted), gold
      promoted: 1,
      unchanged: 1,
      skippedOther: 1,
      skippedPending: 1,
      skippedPrimary: 0,
      skippedFull: 0,
      titlesRefreshed: 3,
      titlesKept: 1,
    });
  });

  test("an empty card gets the pair in one order, its index row and a new lastUpdated; its team stays", async () => {
    const { t, fx, ids, before } = await scenario();
    const after = await cardOf(t, ids.empty);
    expect(after.playerIds).toEqual([fx.mahomes]);
    expect(after.playerLinks).toEqual([{ playerId: fx.mahomes, nameOnCard: "Patrick Mahomes" }]);
    expect(after.playerLinks!.map((l) => l.playerId)).toEqual(after.playerIds);
    expect(after.lastUpdated).toBeGreaterThan(NOW);
    expect(after.teamOnCardIds).toEqual(before.get(ids.empty)!.teamOnCardIds);
    expect((await playerLinksOf(t, ids.empty)).map((l) => [l.playerId, l.sportId])).toEqual([
      [fx.mahomes, fx.sportId],
    ]);
    // A card without a team does not get one.
    expect((await cardOf(t, ids.gold)).teamOnCardIds).toBeUndefined();
  });

  test("an untouched title and description are regenerated with the player's name", async () => {
    const { t, ids } = await scenario();
    const after = await cardOf(t, ids.empty);
    const now = await generatedNow(t, ids.empty);
    expect(after.listingTitle).toBe(now.title.title);
    expect(after.listingTitle).toContain("Patrick Mahomes");
    expect(after.listingDescription).toBe(now.description);
    expect(after.listingDescription).toMatch(/card of Patrick Mahomes, #TP-1\./);
    expect("listingTitleTruncated" in after).toBe(false);
  });

  test("a typed title and description are kept as typed", async () => {
    const { t, fx, ids } = await scenario();
    const after = await cardOf(t, ids.typed);
    expect(after.playerIds).toEqual([fx.mahomes]);
    expect(after.listingTitle).toBe("Profiles TP-2 as I typed it");
    expect(after.listingDescription).toBe("My own words.");
  });

  test("cards naming someone else, already naming them, or holding a name to review are not touched at all", async () => {
    const { t, ids, before } = await scenario();
    for (const id of [ids.other, ids.already, ids.pending]) {
      expect(await cardOf(t, id)).toEqual(before.get(id));
    }
    // The pending card keeps its names (players and teams) for review.
    expect((await cardOf(t, ids.pending)).pendingPlayerNames).toEqual(["Pat Mahomes II"]);
    expect((await cardOf(t, ids.pending)).pendingTeamNames).toEqual(["KC"]);
  });

  test("a cameo is promoted: the card's player now, gone from its cameos and their index, description rewritten", async () => {
    const { t, fx, ids, before } = await scenario();
    const after = await cardOf(t, ids.cameo);
    expect(after.playerIds).toEqual([fx.mahomes]);
    expect(after.secondaryPlayerIds).toEqual([fx.kelce]);
    expect((await cameoLinksOf(t, ids.cameo)).map((l) => l.playerId)).toEqual([fx.kelce]);
    expect((await playerLinksOf(t, ids.cameo)).map((l) => l.playerId)).toEqual([fx.mahomes]);
    expect(after.teamOnCardIds).toEqual(before.get(ids.cameo)!.teamOnCardIds);
    expect(before.get(ids.cameo)!.listingDescription).toContain("Cameos: Travis Kelce, Patrick Mahomes.");
    expect(after.listingDescription).toBe((await generatedNow(t, ids.cameo)).description);
    expect(after.listingDescription!.split("\n")).toEqual([
      "Profiles card of Patrick Mahomes, #TP-6.",
      "Team: Kansas City Chiefs.",
      "Cameo: Travis Kelce.",
    ]);
  });

  test("nothing goes to entity review", async () => {
    const { t } = await scenario();
    expect(await t.run(async (ctx) => ctx.db.query("entityReviewQueue").collect())).toEqual([]);
  });

  test("run again: every card already theirs or skipped, nothing written", async () => {
    const { t, fx } = await scenario();
    const again = await runAll(t.withIdentity(ADMIN), "player", fx.baseId, fx.mahomes);
    expect(again).toMatchObject({ changed: 0, unchanged: 5, skippedOther: 1, skippedPending: 1, titlesRefreshed: 0 });
  });

  test("the cut-short flag follows the regenerated title, as the commit writes it: set when the core is cut", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedBlank(t);
    const long = await t.run(async (ctx) =>
      ctx.db.insert("players", {
        name: "Bartholomew Maximilian Fitzgerald-Worthington Alexander Montgomery III",
        nameNormalized: "long",
        sportId: fx.sportId,
        lastUpdated: NOW,
      }),
    );
    const id = await t.run(async (ctx) => blankCard(ctx, fx.goldId, "G-1"));
    expect("listingTitleTruncated" in (await cardOf(t, id))).toBe(false);
    await runAll(t.withIdentity(ADMIN), "player", fx.goldId, long);
    const after = await cardOf(t, id);
    expect(after.listingTitle).toBe((await generatedNow(t, id)).title.title);
    expect(after.listingTitleTruncated).toBe(true);
  });

  test("the cut-short flag follows the regenerated title: cleared when it fits", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedBlank(t);
    const id = await t.run(async (ctx) => blankCard(ctx, fx.goldId, "G-1", { listingTitleTruncated: true }));
    await runAll(t.withIdentity(ADMIN), "player", fx.goldId, fx.mahomes);
    expect("listingTitleTruncated" in (await cardOf(t, id))).toBe(false);
  });
});

describe("addCameoToVariant: one cameo on every card (fixture B)", () => {
  async function setup() {
    const t = convexTest(schema, modules);
    const fx = await seedCollectionCatalog(t);
    return { t, fx, admin: t.withIdentity(ADMIN) };
  }

  test("adds to every home card of the Base and its parallels, skipping the cards he is the subject of", async () => {
    const { t, fx, admin } = await setup();
    const result = await runAll(admin, "cameo", fx.baseId, fx.strawberryId);
    // Base: Gooden #1, Strawberry #2 (his own card), Gooden Sliding; Gold: Gooden #1.
    expect(result).toMatchObject({ scanned: 4, changed: 3, skippedPrimary: 1, promoted: 0, titlesRefreshed: 0 });
    for (const id of [fx.gooden1, fx.gooden1Sliding, fx.gold1]) {
      expect((await cardOf(t, id)).secondaryPlayerIds).toEqual([fx.strawberryId]);
      expect((await cameoLinksOf(t, id)).map((l) => l.playerId)).toEqual([fx.strawberryId]);
    }
    expect((await cardOf(t, fx.strawberry2)).secondaryPlayerIds).toBeUndefined();
    // The Future Stars insert is not a parallel of Base: untouched.
    expect((await cardOf(t, fx.futureStar)).secondaryPlayerIds).toBeUndefined();
    const again = await runAll(admin, "cameo", fx.baseId, fx.strawberryId);
    expect(again).toMatchObject({ changed: 0, unchanged: 3 });
  });

  test("never touches lastUpdated, the card's players, teams or title", async () => {
    const { t, fx, admin } = await setup();
    const before = await cardOf(t, fx.gooden1);
    await runAll(admin, "cameo", fx.baseId, fx.strawberryId);
    const after = await cardOf(t, fx.gooden1);
    expect(after.lastUpdated).toBe(before.lastUpdated);
    expect(after.playerIds).toEqual(before.playerIds);
    expect(after.playerLinks).toEqual(before.playerLinks);
    expect(after.teamOnCardIds).toEqual(before.teamOnCardIds);
    expect(after.pendingPlayerNames).toEqual(before.pendingPlayerNames);
    expect(after.listingTitle).toBe(before.listingTitle);
  });

  test("an untouched description gains the cameo line; an edited one is kept", async () => {
    const { t, fx, admin } = await setup();
    await t.run(async (ctx) => {
      const card = (await ctx.db.get(fx.gooden1))!;
      await ctx.db.patch(fx.gooden1, { listingDescription: await descriptionForStoredCard(ctx, card, []) });
      await ctx.db.patch(fx.gold1, { listingDescription: "Gold, typed by hand." });
    });
    await runAll(admin, "cameo", fx.baseId, fx.strawberryId);
    expect((await cardOf(t, fx.gooden1)).listingDescription).toBe((await generatedNow(t, fx.gooden1)).description);
    expect((await cardOf(t, fx.gooden1)).listingDescription).toContain("Cameo: Darryl Strawberry.");
    expect((await cardOf(t, fx.gold1)).listingDescription).toBe("Gold, typed by hand.");
  });

  test("a card already holding the most cameos it can is skipped and counted", async () => {
    const { t, fx, admin } = await setup();
    const full: Array<Id<"players">> = [];
    await t.run(async (ctx) => {
      for (let i = 0; i < MAX_CARD_PLAYERS; i++) {
        full.push(
          await ctx.db.insert("players", {
            name: `Full ${i}`,
            nameNormalized: `full ${i}`,
            sportId: fx.sportId,
            lastUpdated: NOW,
          }),
        );
      }
    });
    await admin.mutation(api.cardSecondaryPlayers.setSecondaryPlayers, { cardId: fx.gold1, playerIds: full });
    const result = await runAll(admin, "cameo", fx.goldId, fx.strawberryId);
    expect(result.skippedFull).toBe(1);
    expect((await cardOf(t, fx.gold1)).secondaryPlayerIds).toEqual(full);
  });
});

describe("paging, cursors and refusals", () => {
  test("pages a long checklist BULK_PAGE cards at a time, the cursor carrying the client from page to page", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedBlank(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < BULK_PAGE + 5; i++) await blankCard(ctx, fx.goldId, `X-${i}`, { sortOrder: i });
    });
    for (const op of ["cameo", "player"] as const) {
      const result = await runAll(t.withIdentity(ADMIN), op, fx.goldId, fx.mahomes);
      expect(result.pages).toHaveLength(2);
      expect(result.pages[0].scanned).toBe(BULK_PAGE);
      expect(result.pages[0].cursor).not.toBeNull();
      expect(result.scanned).toBe(BULK_PAGE + 5);
    }
  });

  test("each cursor names the row it was handed out for", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedCollectionCatalog(t);
    const first = await t
      .withIdentity(ADMIN)
      .mutation(api.cardPlayersBulk.addCameoToVariant, { variantId: fx.baseId, playerId: fx.strawberryId, cursor: null });
    expect(JSON.parse(first.cursor!)).toEqual({ i: 1, t: fx.goldId, c: null });
  });

  test("a parallel added between pages shifts the rows, and the next page is refused rather than walked as the wrong row", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedCollectionCatalog(t);
    const silverCard = await t.run(async (ctx) => {
      const typeId = await ctx.db.insert("selectorOptions", {
        level: "variantType",
        value: "Parallel",
        platformData: {},
        children: [],
        parentId: fx.setId,
        lastUpdated: NOW,
      });
      const silverId = await ctx.db.insert("selectorOptions", {
        level: "insert",
        value: "Silver",
        platformData: {},
        children: [],
        parentId: typeId,
        lastUpdated: NOW,
      });
      return insertTestCard(ctx, {
        selectorOptionId: silverId,
        cardNumber: "1",
        cardName: "Silver",
        platformData: {},
        sortOrder: 1,
        lastUpdated: NOW,
      });
    });
    const admin = t.withIdentity(ADMIN);
    for (const fn of [api.cardPlayersBulk.addCameoToVariant, api.cardPlayersBulk.addPlayerToVariant]) {
      const args = { variantId: fx.baseId, playerId: fx.strawberryId };
      const p1 = await admin.mutation(fn, { ...args, cursor: null });
      const p2 = await admin.mutation(fn, { ...args, cursor: p1.cursor });
      expect(p2.targetId).toBe(fx.goldId);
      expect(p2.cursor).not.toBeNull();
      const blue = await t.run(async (ctx) =>
        ctx.db.insert("selectorOptions", {
          level: "insert",
          value: "Blue",
          platformData: {},
          children: [],
          parentId: fx.parallelsTypeId,
          lastUpdated: NOW,
        }),
      );
      await expect(admin.mutation(fn, { ...args, cursor: p2.cursor })).rejects.toThrow(BULK_CHECKLIST_CHANGED);
      await t.run(async (ctx) => ctx.db.delete(blue));
    }
    const silver = await cardOf(t, silverCard);
    expect(silver.secondaryPlayerIds).toBeUndefined();
    expect(silver.playerIds).toBeUndefined();
  });

  test("a player deleted before a page is refused in the operator's words, by both adds", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedBlank(t);
    await t.run(async (ctx) => ctx.db.delete(fx.allen));
    for (const fn of [api.cardPlayersBulk.addCameoToVariant, api.cardPlayersBulk.addPlayerToVariant]) {
      await expect(
        t.withIdentity(ADMIN).mutation(fn, { variantId: fx.baseId, playerId: fx.allen, cursor: null }),
      ).rejects.toThrow(BULK_MISSING_PLAYER);
    }
  });

  test("refuses a cursor it did not hand out, a row that is gone, and a non-admin", async () => {
    const t = convexTest(schema, modules);
    const fx = await seedCollectionCatalog(t);
    const admin = t.withIdentity(ADMIN);
    const args = { variantId: fx.baseId, playerId: fx.goodenId };
    for (const fn of [api.cardPlayersBulk.addCameoToVariant, api.cardPlayersBulk.addPlayerToVariant]) {
      await expect(admin.mutation(fn, { ...args, cursor: "nope" })).rejects.toThrow(BULK_CHECKLIST_CHANGED);
      await expect(
        admin.mutation(fn, { ...args, cursor: JSON.stringify({ i: 9, t: fx.goldId, c: null }) }),
      ).rejects.toThrow(BULK_CHECKLIST_CHANGED);
      // A cursor without the target it was handed out for is refused too.
      await expect(admin.mutation(fn, { ...args, cursor: JSON.stringify({ i: 1, c: null }) })).rejects.toThrow(
        BULK_CHECKLIST_CHANGED,
      );
      const gone = await t.run(async (ctx) => {
        const id = await ctx.db.insert("selectorOptions", {
          level: "insert",
          value: "Gone",
          parentId: fx.parallelsTypeId,
          platformData: {},
          children: [],
          lastUpdated: NOW,
        });
        await ctx.db.delete(id);
        return id;
      });
      await expect(admin.mutation(fn, { variantId: gone, playerId: fx.goodenId, cursor: null })).rejects.toThrow(
        DEFAULT_ROW_MISSING,
      );
      await expect(t.withIdentity(MEMBER).mutation(fn, { ...args, cursor: null })).rejects.toThrow(/admin/i);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The read budget of one full page
// ───────────────────────────────────────────────────────────────────────────

/**
 * `ctx.db` with every call counted: each `get` and each query range is one
 * call (Convex's per-transaction limit is 4,096), and every document they
 * return is one read.
 */
function counting(db: MutationCtx["db"]) {
  const stats = { calls: 0, docs: 0 };
  const RANGE = new Set(["withIndex", "order", "filter"]);
  const READ = new Set(["collect", "take", "first", "unique", "paginate"]);
  const wrapQuery = (q: object): object =>
    new Proxy(q, {
      get(target, prop) {
        const value = Reflect.get(target, prop) as unknown;
        if (typeof value !== "function") return value;
        if (RANGE.has(prop as string)) return (...a: unknown[]) => wrapQuery(value.apply(target, a) as object);
        if (READ.has(prop as string)) {
          return async (...a: unknown[]) => {
            const r = (await value.apply(target, a)) as unknown;
            if (Array.isArray(r)) stats.docs += r.length;
            else if (r && typeof r === "object" && "page" in r) stats.docs += (r as { page: unknown[] }).page.length;
            else if (r) stats.docs += 1;
            return r;
          };
        }
        return value.bind(target);
      },
    });
  const wrapped = new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop) as unknown;
      if (prop === "get") {
        return async (...a: unknown[]) => {
          stats.calls++;
          const r = await (value as (...x: unknown[]) => Promise<unknown>).apply(target, a);
          if (r) stats.docs++;
          return r;
        };
      }
      if (prop === "query") {
        return (...a: unknown[]) => {
          stats.calls++;
          return wrapQuery((value as (...x: unknown[]) => object).apply(target, a));
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db: wrapped as MutationCtx["db"], stats };
}

describe("one full page stays inside a transaction's read budget", () => {
  /**
   * The worst page: BULK_PAGE cards, each naming its own MAX_CARD_TEAMS teams
   * and a full list of cameos no other card names, so the page cache saves
   * nothing but the ancestor chain and the run's own player.
   */
  async function worstPage(op: BulkOp) {
    const t = convexTest(schema, modules);
    const fx = await seedBlank(t);
    await t.run(async (ctx) => {
      let n = 0;
      const players = async (count: number) => {
        const out: Array<Id<"players">> = [];
        for (let i = 0; i < count; i++) {
          out.push(
            await ctx.db.insert("players", {
              name: `P${n++}`,
              nameNormalized: `p${n}`,
              sportId: fx.sportId,
              lastUpdated: NOW,
            }),
          );
        }
        return out;
      };
      for (let c = 0; c < BULK_PAGE; c++) {
        const teams: Array<Id<"teams">> = [];
        for (let i = 0; i < MAX_CARD_TEAMS; i++) {
          teams.push(
            await ctx.db.insert("teams", {
              name: `T${c}-${i}`,
              nameNormalized: `t${c}-${i}`,
              sportId: fx.sportId,
              lastUpdated: NOW,
            }),
          );
        }
        // The player add's worst card is a promote: no player, the run's
        // player among a full list of cameos. The cameo add's is a card
        // naming a full list of its own players and one cameo short of full.
        const own = op === "cameo" ? await players(MAX_CARD_PLAYERS) : [];
        const cameos =
          op === "player"
            ? [fx.mahomes, ...(await players(MAX_CARD_PLAYERS - 1))]
            : await players(MAX_CARD_PLAYERS - 1);
        await blankCard(ctx, fx.goldId, `W-${c}`, {
          sortOrder: c,
          teamOnCardIds: teams,
          ...(own.length > 0
            ? { playerIds: own, playerLinks: own.map((playerId) => ({ playerId, nameOnCard: "x" })) }
            : {}),
          cameos,
        });
      }
    });
    return t.run(async (ctx) => {
      const { db, stats } = counting(ctx.db);
      const page = await runBulkPage({ db } as unknown as MutationCtx, {
        variantId: fx.goldId,
        playerId: fx.mahomes,
        cursor: null,
      }, op);
      return { page, stats };
    });
  }

  test("the player add (every card a promote)", async () => {
    const { page, stats } = await worstPage("player");
    expect(page.scanned).toBe(BULK_PAGE);
    expect(page.promoted).toBe(BULK_PAGE);
    expect(stats.calls).toBeLessThan(4096);
    expect(stats.docs).toBeLessThan(16_384);
  }, 60_000);

  test("the cameo add (every card full of its own players)", async () => {
    const { page, stats } = await worstPage("cameo");
    expect(page.scanned).toBe(BULK_PAGE);
    expect(page.changed).toBe(BULK_PAGE);
    expect(stats.calls).toBeLessThan(4096);
    expect(stats.docs).toBeLessThan(16_384);
  }, 60_000);
});
