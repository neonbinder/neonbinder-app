/**
 * NEO-528 — players PICTURED on a card who are not its subject ("also
 * pictured", a cameo), and the ONE writer of both places that fact lives:
 *
 *   - `cardChecklist.secondaryPlayerIds`, the card's own list (absent when
 *     empty, never an id already in `playerIds` at write time);
 *   - `cardSecondaryPlayerLinks`, the same list stored flat, one row per
 *     (card, player), because Convex cannot index array members. A smart
 *     binder whose cameo option is on walks it (`binderRules.leafCards`).
 *
 * The table is DERIVED from the field and nothing else; if the two ever
 * disagree the card wins. So exactly these helpers touch either:
 * `setCardSecondaryPlayers` for every write and
 * `deleteCardSecondaryPlayerLinks` for every card delete (from
 * `cardRowDelete.removeCardRow`). `cardSecondaryPlayers.pin.test.ts` greps
 * every other module for anything else. The E2E reset drain
 * (`selectorOptions.resetCardSecondaryPlayerLinksBatch`) is the named
 * exception.
 *
 * NB data, admin-entered only. Never derived from a marketplace, never
 * touched by a re-sync (the field is not in `NB_CONTENT_FIELDS`), and kept
 * out of everything that reads `playerIds`: listing titles, the sync diff,
 * entity review, team suggestions, collector player search and the admin
 * cards-for-player list. A write does not bump `lastUpdated`: that stamp is
 * the re-sync's base version for the card's synced content, which a cameo
 * is not part of.
 *
 * The public surface is admin-only: one card's list (`setSecondaryPlayers`,
 * the Set Builder card drawer) and one player added to or removed from every
 * card of a checklist and its parallels, a page per call, the client driving
 * the pages (`addSecondaryPlayerToVariant`, `removeSecondaryPlayerFromVariant`,
 * `secondaryPlayerBulkTargets` for the progress ledger).
 */

import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin } from "./auth";
import { MAX_CARD_PLAYERS } from "./features/cardAttention";
import { variantTypeKind } from "./variantRole";

type ReadCtx = Pick<QueryCtx, "db">;
type WriteCtx = Pick<MutationCtx, "db">;
type CardRow = Doc<"cardChecklist">;

/**
 * Cards one bulk page reads and writes. A card it changes costs up to ~22
 * database reads: the card itself, one `get` per player its new list names
 * (up to `MAX_CARD_PLAYERS`, so the writer can refuse a deleted one) and one
 * read of its index rows by `by_card`; plus a few writes. A card it skips
 * costs only its own read. On top of the cards, every page re-reads
 * `bulkTargets`: the variant, up to `MAX_VARIANT_TYPES` variant types and up
 * to `MAX_BULK_PARALLELS` parallel rows. So a page reads at most about
 * 100 x 22 + 601 documents.
 */
export const BULK_PAGE = 100;
/** Parallels a bulk run walks under one checklist (the parallel build's cap). */
export const MAX_BULK_PARALLELS = 500;
/** Variant types read under one set when finding a Base's parallels. */
const MAX_VARIANT_TYPES = 100;

export const TOO_MANY_SECONDARY_PLAYERS = `A card can have at most ${MAX_CARD_PLAYERS} people under Also on this card.`;
const MISSING_PLAYER = "One of the selected players no longer exists.";
/** A bulk run's player was deleted mid-way (or before the first page). */
export const BULK_MISSING_PLAYER = "Can't find that player anymore. Pick them again.";
/**
 * A bulk cursor this run's checklist no longer matches: its targets changed
 * (a parallel added or removed) or the cursor is not one a page handed out.
 */
export const BULK_CHECKLIST_CHANGED = "This checklist changed mid-way. Give it another go.";

// ───────────────────────────────────────────────────────────────────────────
// Pure pieces
// ───────────────────────────────────────────────────────────────────────────

/** Every id the card carries as its own players (`playerIds` and `playerLinks`). */
export function primaryPlayerIdsOf(card: Pick<CardRow, "playerIds" | "playerLinks">): Set<string> {
  const out = new Set<string>();
  for (const id of card.playerIds ?? []) out.add(id as string);
  for (const link of card.playerLinks ?? []) out.add(link.playerId as string);
  return out;
}

/**
 * The list a write stores: `requested` without repeats, in its order, with
 * every id the card already carries as a player taken out. Refuses (throws)
 * past `MAX_CARD_PLAYERS`. `strippedPrimary` counts the ids taken out.
 */
export function planSecondaryPlayerIds(
  card: Pick<CardRow, "playerIds" | "playerLinks">,
  requested: ReadonlyArray<Id<"players">>,
): { ids: Array<Id<"players">>; strippedPrimary: number } {
  const primary = primaryPlayerIdsOf(card);
  const seen = new Set<string>();
  const ids: Array<Id<"players">> = [];
  let strippedPrimary = 0;
  for (const id of requested) {
    if (seen.has(id as string)) continue;
    seen.add(id as string);
    if (primary.has(id as string)) {
      strippedPrimary++;
      continue;
    }
    ids.push(id);
  }
  if (ids.length > MAX_CARD_PLAYERS) throw new ConvexError(TOO_MANY_SECONDARY_PLAYERS);
  return { ids, strippedPrimary };
}

/**
 * What one card's index rows must change by to match its list. A player
 * listed twice gets ONE row; a duplicate stored row is removed.
 */
export function planSecondaryPlayerLinks(
  existing: ReadonlyArray<Pick<Doc<"cardSecondaryPlayerLinks">, "_id" | "playerId">>,
  wantedIds: ReadonlyArray<Id<"players">> | undefined,
): { toDelete: Array<Id<"cardSecondaryPlayerLinks">>; toInsert: Array<Id<"players">> } {
  const wanted = new Set<string>(wantedIds ?? []);
  const held = new Set<string>();
  const toDelete: Array<Id<"cardSecondaryPlayerLinks">> = [];
  for (const row of existing) {
    const key = row.playerId as string;
    if (wanted.has(key) && !held.has(key)) {
      held.add(key);
      continue;
    }
    toDelete.push(row._id);
  }
  const toInsert: Array<Id<"players">> = [];
  for (const key of wanted) if (!held.has(key)) toInsert.push(key as Id<"players">);
  return { toDelete, toInsert };
}

function sameIds(a: ReadonlyArray<string> | undefined, b: ReadonlyArray<string>): boolean {
  const left = a ?? [];
  return left.length === b.length && left.every((id, i) => id === b[i]);
}

// ───────────────────────────────────────────────────────────────────────────
// The ONE writer
// ───────────────────────────────────────────────────────────────────────────

/**
 * Set one card's also-pictured players to `requested` (see
 * `planSecondaryPlayerIds`), and its index rows with it. A player that no
 * longer exists is refused, or with `dropMissing` left out (a copy or a bulk
 * page must not fail on someone else's stale id). Writes nothing when the
 * list is unchanged, past one index read.
 *
 * `fresh: true` is for a card inserted in the same transaction: it has no
 * index rows to diff against, so that read is skipped.
 */
export async function setCardSecondaryPlayers(
  ctx: WriteCtx,
  card: CardRow,
  requested: ReadonlyArray<Id<"players">>,
  opts: { fresh?: boolean; dropMissing?: boolean } = {},
): Promise<{ secondaryPlayerIds: Array<Id<"players">>; strippedPrimary: number; changed: boolean }> {
  const plan = planSecondaryPlayerIds(card, requested);
  const ids: Array<Id<"players">> = [];
  for (const id of plan.ids) {
    if (await ctx.db.get(id)) ids.push(id);
    else if (!opts.dropMissing) throw new ConvexError(MISSING_PLAYER);
  }
  const changed = !sameIds(card.secondaryPlayerIds as string[] | undefined, ids as string[]);
  if (changed) {
    await ctx.db.patch(card._id, { secondaryPlayerIds: ids.length > 0 ? ids : undefined });
  }
  if (!(opts.fresh && ids.length === 0)) {
    const existing = opts.fresh
      ? []
      : await ctx.db
          .query("cardSecondaryPlayerLinks")
          .withIndex("by_card", (q) => q.eq("cardChecklistId", card._id))
          .collect();
    const links = planSecondaryPlayerLinks(existing, ids);
    for (const id of links.toDelete) await ctx.db.delete(id);
    for (const playerId of links.toInsert) {
      await ctx.db.insert("cardSecondaryPlayerLinks", {
        cardChecklistId: card._id,
        playerId,
        sportId: card.sportId,
      });
    }
  }
  return { secondaryPlayerIds: ids, strippedPrimary: plan.strippedPrimary, changed };
}

/**
 * Every index row for one card, removed. Called by `removeCardRow`, beside
 * the card delete, in the same transaction. Returns the ids for a caller
 * that logs every row it deletes.
 */
export async function deleteCardSecondaryPlayerLinks(
  ctx: WriteCtx,
  cardId: Id<"cardChecklist">,
): Promise<Array<Id<"cardSecondaryPlayerLinks">>> {
  const rows = await ctx.db
    .query("cardSecondaryPlayerLinks")
    .withIndex("by_card", (q) => q.eq("cardChecklistId", cardId))
    .collect();
  for (const row of rows) await ctx.db.delete(row._id);
  return rows.map((row) => row._id);
}

/**
 * Up to `limit` index rows for a player: every sport (`sportId` null), or one
 * sport (the player sport-removal guard). A READ that lives here so this
 * module stays the one writer and a sanctioned reader of the table.
 */
export async function cardSecondaryPlayerLinkPage(
  ctx: ReadCtx,
  playerId: Id<"players">,
  sportId: Id<"selectorOptions"> | null,
  limit: number,
): Promise<Array<Doc<"cardSecondaryPlayerLinks">>> {
  return await ctx.db
    .query("cardSecondaryPlayerLinks")
    .withIndex("by_player_and_sport", (q) =>
      sportId === null ? q.eq("playerId", playerId) : q.eq("playerId", playerId).eq("sportId", sportId),
    )
    .take(limit);
}

// ───────────────────────────────────────────────────────────────────────────
// One card (the Set Builder card drawer)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Set one card's "Also pictured" players, replacing the list. Ids the card
 * already carries as its own players are left out (and counted in
 * `strippedPrimary`), so a cameo is never also the subject.
 */
export const setSecondaryPlayers = mutation({
  args: {
    cardId: v.id("cardChecklist"),
    playerIds: v.array(v.id("players")),
  },
  returns: v.object({
    secondaryPlayerIds: v.array(v.id("players")),
    strippedPrimary: v.number(),
  }),
  handler: async (ctx, args) => {
    const userId = await requireAdmin(ctx);
    // Twice the cap leaves room for the card's own players riding along (the
    // writer strips them); past that nothing can fit, so refuse before
    // reading the card or a single player.
    if (args.playerIds.length > 2 * MAX_CARD_PLAYERS) {
      throw new ConvexError(TOO_MANY_SECONDARY_PLAYERS);
    }
    const card = await ctx.db.get(args.cardId);
    if (!card) throw new ConvexError("That card isn't in NB anymore.");
    const result = await setCardSecondaryPlayers(ctx, card, args.playerIds);
    // Ids and counts only.
    console.log(
      JSON.stringify({
        msg: "card_secondary_players_set",
        cardId: card._id,
        count: result.secondaryPlayerIds.length,
        strippedPrimary: result.strippedPrimary,
        changed: result.changed,
        userId,
      }),
    );
    return { secondaryPlayerIds: result.secondaryPlayerIds, strippedPrimary: result.strippedPrimary };
  },
});

// ───────────────────────────────────────────────────────────────────────────
// A checklist and its parallels (the Set Builder bulk control)
// ───────────────────────────────────────────────────────────────────────────

const targetValidator = v.object({
  _id: v.id("selectorOptions"),
  /** The row's own NB name. */
  name: v.string(),
  /** The checklist asked about, or one of its parallels. */
  role: v.union(v.literal("home"), v.literal("parallel")),
});

type Target = typeof targetValidator.type;

/**
 * The card-bearing rows a bulk run walks, in order: the checklist itself,
 * then its parallels, by shape and the variant type's kind (never a name):
 *
 *   - an `insert` row → its `parallel` children (sub-variants);
 *   - a Base variant type → every insert under the set's Parallel variant
 *     types (the base set's parallels, NEO-321);
 *   - anything else card-bearing → itself alone.
 *
 * Only HOME cards are touched (`by_selector_option`): a card cross-listed
 * into a checklist belongs to the set it was printed in.
 */
export async function bulkTargets(
  ctx: ReadCtx,
  variantId: Id<"selectorOptions">,
): Promise<{ targets: Target[]; truncated: boolean }> {
  const variant = await ctx.db.get(variantId);
  if (!variant || (variant.level !== "variantType" && variant.level !== "insert" && variant.level !== "parallel")) {
    throw new ConvexError("Pick a checklist (a variant type, insert or parallel) to change its cards.");
  }
  const targets: Target[] = [{ _id: variant._id, name: variant.value, role: "home" }];
  let truncated = false;
  const addChildren = async (parentId: Id<"selectorOptions">, level: "parallel" | "insert") => {
    const room = MAX_BULK_PARALLELS - (targets.length - 1);
    if (room <= 0) {
      truncated = true;
      return;
    }
    const rows = await ctx.db
      .query("selectorOptions")
      .withIndex("by_level_and_parent", (q) => q.eq("level", level).eq("parentId", parentId))
      .take(room + 1);
    if (rows.length > room) truncated = true;
    for (const row of rows.slice(0, room)) targets.push({ _id: row._id, name: row.value, role: "parallel" });
  };
  if (variant.level === "insert") {
    await addChildren(variant._id, "parallel");
  } else if (variant.level === "variantType" && variantTypeKind(variant) === "base" && variant.parentId) {
    const setId = variant.parentId;
    const types = await ctx.db
      .query("selectorOptions")
      .withIndex("by_level_and_parent", (q) => q.eq("level", "variantType").eq("parentId", setId))
      .take(MAX_VARIANT_TYPES);
    for (const type of types) {
      if (type._id !== variant._id && variantTypeKind(type) === "parallel") await addChildren(type._id, "insert");
    }
  }
  return { targets, truncated };
}

/** The rows a bulk run will walk, for the progress ledger. */
export const secondaryPlayerBulkTargets = query({
  args: { variantId: v.id("selectorOptions") },
  returns: v.object({ targets: v.array(targetValidator), truncated: v.boolean() }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await bulkTargets(ctx, args.variantId);
  },
});

const bulkPageValidator = v.object({
  /** The row this page worked in (`secondaryPlayerBulkTargets` order). */
  targetId: v.id("selectorOptions"),
  targetIndex: v.number(),
  targetCount: v.number(),
  /** Cards this page read. */
  scanned: v.number(),
  /** Cards whose list this page changed. */
  changed: v.number(),
  /** Cards already as asked (already listed for an add, not listed for a remove). */
  unchanged: v.number(),
  /** Add only: the player is already one of the card's own players. */
  skippedPrimary: v.number(),
  /** Add only: the card already lists the most also-pictured players it can. */
  skippedFull: v.number(),
  /** Pass back for the next page; null when every row is done. */
  cursor: v.union(v.string(), v.null()),
});

type BulkPage = typeof bulkPageValidator.type;

/**
 * Where a run is: `i` the target's index in `bulkTargets` order, `t` that
 * target's id (so a parallel added or removed between pages, which shifts
 * every index after it, is refused rather than walked as the wrong row), and
 * `c` the page cursor inside it. Null for the first page.
 */
type BulkCursor = { i: number; t: string | null; c: string | null };

export function parseCursor(raw: string | null): BulkCursor {
  if (raw === null) return { i: 0, t: null, c: null };
  try {
    const parsed = JSON.parse(raw) as { i?: unknown; t?: unknown; c?: unknown };
    if (
      typeof parsed.i === "number" &&
      Number.isInteger(parsed.i) &&
      parsed.i >= 0 &&
      typeof parsed.t === "string" &&
      (parsed.c === null || typeof parsed.c === "string")
    ) {
      return { i: parsed.i, t: parsed.t, c: parsed.c };
    }
  } catch {
    // fall through
  }
  throw new ConvexError(BULK_CHECKLIST_CHANGED);
}

async function bulkPage(
  ctx: MutationCtx,
  args: { variantId: Id<"selectorOptions">; playerId: Id<"players">; cursor: string | null },
  op: "add" | "remove",
): Promise<BulkPage> {
  const userId = await requireAdmin(ctx);
  if (op === "add" && !(await ctx.db.get(args.playerId))) throw new ConvexError(BULK_MISSING_PLAYER);
  const at = parseCursor(args.cursor);
  const { targets } = await bulkTargets(ctx, args.variantId);
  // The cursor names the row it was handed out for; a checklist whose
  // parallels moved under the run would otherwise send this page into a
  // different row's cards with another row's page cursor.
  if (at.i >= targets.length || (at.t !== null && (targets[at.i]._id as string) !== at.t)) {
    throw new ConvexError(BULK_CHECKLIST_CHANGED);
  }
  const target = targets[at.i];
  const page = await ctx.db
    .query("cardChecklist")
    .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", target._id))
    .paginate({ cursor: at.c, numItems: BULK_PAGE });
  const counts = { scanned: 0, changed: 0, unchanged: 0, skippedPrimary: 0, skippedFull: 0 };
  const playerKey = args.playerId as string;
  for (const card of page.page) {
    counts.scanned++;
    const current = (card.secondaryPlayerIds ?? []) as string[];
    if (op === "add") {
      if (primaryPlayerIdsOf(card).has(playerKey)) {
        counts.skippedPrimary++;
        continue;
      }
      if (current.includes(playerKey)) {
        counts.unchanged++;
        continue;
      }
      if (current.length >= MAX_CARD_PLAYERS) {
        counts.skippedFull++;
        continue;
      }
      const result = await setCardSecondaryPlayers(
        ctx,
        card,
        [...(card.secondaryPlayerIds ?? []), args.playerId],
        { dropMissing: true },
      );
      if (result.changed) counts.changed++;
      else counts.unchanged++;
    } else {
      if (!current.includes(playerKey)) {
        counts.unchanged++;
        continue;
      }
      const result = await setCardSecondaryPlayers(
        ctx,
        card,
        (card.secondaryPlayerIds ?? []).filter((id) => id !== args.playerId),
        { dropMissing: true },
      );
      if (result.changed) counts.changed++;
      else counts.unchanged++;
    }
  }
  const cursor = !page.isDone
    ? JSON.stringify({ i: at.i, t: target._id, c: page.continueCursor })
    : at.i + 1 < targets.length
      ? JSON.stringify({ i: at.i + 1, t: targets[at.i + 1]._id, c: null })
      : null;
  // Ids and counts only.
  console.log(
    JSON.stringify({
      msg: "card_secondary_players_bulk_page",
      op,
      variantId: args.variantId,
      targetId: target._id,
      playerId: args.playerId,
      ...counts,
      done: cursor === null,
      userId,
    }),
  );
  return { targetId: target._id, targetIndex: at.i, targetCount: targets.length, ...counts, cursor };
}

const bulkArgs = {
  /** The checklist the operator is on (its parallels come with it). */
  variantId: v.id("selectorOptions"),
  playerId: v.id("players"),
  /** Null for the first page; then the `cursor` the last page returned. */
  cursor: v.union(v.string(), v.null()),
};

/**
 * Add one also-pictured player to every home card of a checklist and of its
 * parallels (`bulkTargets`), `BULK_PAGE` cards per call. Call again with the
 * returned `cursor` until it is null. A card where he is already one of the
 * card's own players is skipped and counted (`skippedPrimary`).
 */
export const addSecondaryPlayerToVariant = mutation({
  args: bulkArgs,
  returns: bulkPageValidator,
  handler: async (ctx, args) => await bulkPage(ctx, args, "add"),
});

/** The inverse of `addSecondaryPlayerToVariant`: take one player off, page by page. */
export const removeSecondaryPlayerFromVariant = mutation({
  args: bulkArgs,
  returns: bulkPageValidator,
  handler: async (ctx, args) => await bulkPage(ctx, args, "remove"),
});
