/**
 * NEO-528 — "Player on every card": one player put on every card of a
 * checklist and its parallels, from the Set Builder's attributes panel.
 *
 * Its main use is filling a checklist before the set exists anywhere else: a
 * single-player set (every card is Mahomes), or a run of cards that all
 * picture the same face. Two ways in, both additive, both admin-only:
 *
 *   - `addPlayerToVariant` makes them the CARD'S player on every card that
 *     has none yet (`playerIds` + `playerLinks`, the card → player index,
 *     `lastUpdated`). A card that already names anyone, or still carries a
 *     name waiting for review (`pendingPlayerNames`), is left exactly as it
 *     is and counted. A card where they were a cameo is promoted: they become
 *     its player and leave its cameos. No team is ever written (product
 *     invariant 8), and entity review is not touched.
 *   - `addCameoToVariant` adds them under "Also on this card" (the cameo
 *     list, through `cardSecondaryPlayers.setCardSecondaryPlayers`).
 *
 * Neither takes anything away; there is no remove.
 *
 * Listing text follows the card only where nobody has edited it: before a
 * write, a stored title (or description) that still equals what the generator
 * builds for the card is regenerated after it; one a person typed is kept.
 * The title never names a cameo, so only the player add refreshes titles.
 *
 * The walk is client-paged: `everyCardTargets` lists the rows for the
 * progress ledger, and each call does one page of one row, handing back a
 * cursor until it is null.
 */

import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin } from "./auth";
import { MAX_CARD_PLAYERS } from "./features/cardAttention";
import { generateListingDescription } from "./features/generateListing";
import { variantTypeKind } from "./variantRole";
import { syncCardPlayerLinks } from "./cardPlayerLinks";
import {
  cameoNamesFor,
  descriptionIsGenerated,
  primaryPlayerIdsOf,
  setCardSecondaryPlayers,
} from "./cardSecondaryPlayers";
import {
  newStoredCardReadCache,
  playerNameFor,
  titleForStoredCard,
  type StoredCardReadCache,
} from "./storedCardTitle";

type ReadCtx = Pick<QueryCtx, "db">;
type CardRow = Doc<"cardChecklist">;

/**
 * Cards one page reads and writes.
 *
 * The budget is the transaction's ~4,000 database calls (each `get` and each
 * query range is one). A page re-reads its targets first (`bulkTargets`: the
 * variant, up to `MAX_VARIANT_TYPES` variant types and the parallel ranges
 * under them, ~100 calls). Then, per card, the worst case:
 *
 *   - the title and description before and after: the card's own players
 *     (none on a card the player add writes; up to `MAX_CARD_PLAYERS` on a
 *     cameo add), its teams (up to `MAX_CARD_TEAMS`), its cameos (up to
 *     `MAX_CARD_PLAYERS`), each read once per PAGE through the shared cache,
 *     and the ancestor chain, once per page;
 *   - the card → player index (one range) and the cameo index (one range).
 *
 * Every name a card names for the first time on the page is a read, so the
 * pathological page (every card naming 20 players, 19 cameos and 8 teams no
 * other card names) costs about 50 x (20 + 20 + 8 + 2) + 100 = 2,600 calls.
 * `cardPlayersBulk.test.ts` counts that page: 2,410 calls for the cameo add,
 * 1,460 for the player add (every card a promote). At 100 cards the cameo add
 * would be near 4,800, past the limit, hence 50.
 */
export const BULK_PAGE = 50;
/** Parallels a run walks under one checklist (the parallel build's cap). */
export const MAX_BULK_PARALLELS = 500;
/** Variant types read under one set when finding a Base's parallels. */
const MAX_VARIANT_TYPES = 100;

/** The run's player was deleted mid-way (or before the first page). */
export const BULK_MISSING_PLAYER = "Can't find that player anymore. Pick them again.";
/**
 * A cursor this run's checklist no longer matches: its targets changed (a
 * parallel added or removed) or the cursor is not one a page handed out.
 */
export const BULK_CHECKLIST_CHANGED = "This checklist changed mid-way. Give it another go.";

// ───────────────────────────────────────────────────────────────────────────
// The rows a run walks
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
 * The card-bearing rows a run walks, in order: the checklist itself, then its
 * parallels, by shape and the variant type's kind (never a name):
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

/** The rows a run will walk, for the progress ledger. */
export const everyCardTargets = query({
  args: { variantId: v.id("selectorOptions") },
  returns: v.object({ targets: v.array(targetValidator), truncated: v.boolean() }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await bulkTargets(ctx, args.variantId);
  },
});

// ───────────────────────────────────────────────────────────────────────────
// One page
// ───────────────────────────────────────────────────────────────────────────

const bulkPageValidator = v.object({
  /** The row this page worked in (`everyCardTargets` order). */
  targetId: v.id("selectorOptions"),
  targetIndex: v.number(),
  targetCount: v.number(),
  /** Cards this page read. */
  scanned: v.number(),
  /**
   * Cards this page changed: for the player add, every card that now names
   * the player (`promoted` ones included); for the cameo add, every card
   * whose cameos gained them.
   */
  changed: v.number(),
  /** Cards already as asked: already the card's player, or already a cameo. */
  unchanged: v.number(),
  /** Player add: of `changed`, the cards where they were a cameo and moved up. */
  promoted: v.number(),
  /** Cameo add: they are already one of the card's own players. */
  skippedPrimary: v.number(),
  /** Cameo add: the card already lists the most cameos it can. */
  skippedFull: v.number(),
  /** Player add: the card already names someone else. */
  skippedOther: v.number(),
  /** Player add: the card has no player yet but a name waiting for review. */
  skippedPending: v.number(),
  /** Player add: changed cards whose generated title was regenerated. */
  titlesRefreshed: v.number(),
  /** Player add: changed cards whose title a person had typed, kept as is. */
  titlesKept: v.number(),
  /** Pass back for the next page; null when every row is done. */
  cursor: v.union(v.string(), v.null()),
});

export type BulkPage = typeof bulkPageValidator.type;
export type BulkOp = "player" | "cameo";
type Counts = Omit<BulkPage, "targetId" | "targetIndex" | "targetCount" | "cursor">;

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

/**
 * Make `player` the card's player (see the module note for which cards). The
 * card has no player and no pending name when this is called.
 */
async function putPlayerOnCard(
  ctx: MutationCtx,
  card: CardRow,
  player: { _id: Id<"players">; name: string },
  cache: StoredCardReadCache,
  counts: Counts,
): Promise<void> {
  const cameos = card.secondaryPlayerIds ?? [];
  const promote = cameos.some((id) => id === player._id);
  const nextCameos = promote ? cameos.filter((id) => id !== player._id) : cameos;

  // What the generator builds for the card as it stands, to tell generated
  // text from typed text.
  const before = await titleForStoredCard(ctx, card, cache);
  const titleUntouched = card.listingTitle === before.title;
  const descriptionUntouched = descriptionIsGenerated(
    card.listingDescription,
    before.inputs,
    await cameoNamesFor(ctx, cameos, cache),
  );

  const playerLinks = [{ playerId: player._id, nameOnCard: player.name }];
  const next: CardRow = { ...card, playerIds: [player._id], playerLinks, secondaryPlayerIds: nextCameos };
  const text: { listingTitle?: string; listingTitleTruncated?: true | undefined; listingDescription?: string } = {};
  if (titleUntouched || descriptionUntouched) {
    const after = await titleForStoredCard(ctx, next, cache);
    if (titleUntouched) {
      text.listingTitle = after.title;
      // As the commit writes it: flagged only when the generator had to cut
      // the core; undefined in a patch clears a flag the old title carried.
      text.listingTitleTruncated = after.coreFits ? undefined : true;
    }
    if (descriptionUntouched) {
      text.listingDescription = generateListingDescription(after.inputs, {
        cameoNames: await cameoNamesFor(ctx, nextCameos, cache),
      });
    }
  }
  if (titleUntouched) counts.titlesRefreshed++;
  else counts.titlesKept++;

  // NEO-254 — the pair, in one literal, same order.
  await ctx.db.patch(card._id, {
    playerIds: [player._id],
    playerLinks,
    lastUpdated: Date.now(),
    ...text,
  });
  await syncCardPlayerLinks(ctx, card._id, [player._id], card.sportId);
  if (promote) {
    await setCardSecondaryPlayers(ctx, { ...next, secondaryPlayerIds: cameos }, nextCameos, {
      dropMissing: true,
      cache,
      // Written above, with the player and the cameos both changed.
      description: "leave",
    });
    counts.promoted++;
  }
  counts.changed++;
}

/**
 * One page of a run, with no auth check: the mutations below check it first.
 * Exported for the read-budget test.
 */
export async function runBulkPage(
  ctx: MutationCtx,
  args: { variantId: Id<"selectorOptions">; playerId: Id<"players">; cursor: string | null },
  op: BulkOp,
): Promise<BulkPage> {
  const cache = newStoredCardReadCache();
  const player = await ctx.db.get(args.playerId);
  if (!player) throw new ConvexError(BULK_MISSING_PLAYER);
  cache.players.set(player._id as string, player.name);
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
  const counts: Counts = {
    scanned: 0,
    changed: 0,
    unchanged: 0,
    promoted: 0,
    skippedPrimary: 0,
    skippedFull: 0,
    skippedOther: 0,
    skippedPending: 0,
    titlesRefreshed: 0,
    titlesKept: 0,
  };
  const playerKey = args.playerId as string;
  for (const card of page.page) {
    counts.scanned++;
    const primary = primaryPlayerIdsOf(card);
    if (op === "player") {
      // "Do not alter any cards that already have a player set" (Jason).
      if (primary.has(playerKey)) {
        counts.unchanged++;
        continue;
      }
      if (primary.size > 0) {
        counts.skippedOther++;
        continue;
      }
      if ((card.pendingPlayerNames ?? []).length > 0) {
        counts.skippedPending++;
        continue;
      }
      await putPlayerOnCard(ctx, card, player, cache, counts);
      continue;
    }
    const current = (card.secondaryPlayerIds ?? []) as string[];
    if (primary.has(playerKey)) {
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
    const result = await setCardSecondaryPlayers(ctx, card, [...(card.secondaryPlayerIds ?? []), args.playerId], {
      dropMissing: true,
      cache,
    });
    if (result.changed) counts.changed++;
    else counts.unchanged++;
  }
  const cursor = !page.isDone
    ? JSON.stringify({ i: at.i, t: target._id, c: page.continueCursor })
    : at.i + 1 < targets.length
      ? JSON.stringify({ i: at.i + 1, t: targets[at.i + 1]._id, c: null })
      : null;
  return { targetId: target._id, targetIndex: at.i, targetCount: targets.length, ...counts, cursor };
}

async function bulkMutation(
  ctx: MutationCtx,
  args: { variantId: Id<"selectorOptions">; playerId: Id<"players">; cursor: string | null },
  op: BulkOp,
): Promise<BulkPage> {
  const userId = await requireAdmin(ctx);
  const result = await runBulkPage(ctx, args, op);
  // Ids and counts only.
  console.log(
    JSON.stringify({
      msg: "card_players_bulk_page",
      op,
      variantId: args.variantId,
      playerId: args.playerId,
      ...result,
      cursor: undefined,
      done: result.cursor === null,
      userId,
    }),
  );
  return result;
}

const bulkArgs = {
  /** The checklist the operator is on (its parallels come with it). */
  variantId: v.id("selectorOptions"),
  playerId: v.id("players"),
  /** Null for the first page; then the `cursor` the last page returned. */
  cursor: v.union(v.string(), v.null()),
};

/**
 * Make one player the card's player on every home card of a checklist and its
 * parallels that has no player yet, `BULK_PAGE` cards per call. Call again
 * with the returned `cursor` until it is null.
 */
export const addPlayerToVariant = mutation({
  args: bulkArgs,
  returns: bulkPageValidator,
  handler: async (ctx, args) => await bulkMutation(ctx, args, "player"),
});

/**
 * Add one player as a cameo on every home card of a checklist and its
 * parallels, `BULK_PAGE` cards per call. A card where they are already one
 * of the card's own players is skipped and counted (`skippedPrimary`).
 */
export const addCameoToVariant = mutation({
  args: bulkArgs,
  returns: bulkPageValidator,
  handler: async (ctx, args) => await bulkMutation(ctx, args, "cameo"),
});
