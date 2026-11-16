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
 * The one place a cameo shows in listing text is the DESCRIPTION
 * ("Cameo: Ken Griffey Jr."). The writer keeps it current: when the list
 * changes, a description that still reads exactly as the generator wrote it
 * is rewritten with the new names; one a person edited is kept.
 *
 * The public surface here is one card's list (`setSecondaryPlayers`, the Set
 * Builder card drawer), admin-only. The whole-checklist control lives in
 * `cardPlayersBulk.ts` and writes through this module's writer.
 */

import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin } from "./auth";
import { MAX_CARD_PLAYERS } from "./features/cardAttention";
import { generateListingDescription } from "./features/generateListing";
import {
  playerNameFor,
  titleForStoredCard,
  type StoredCardReadCache,
} from "./storedCardTitle";

type ReadCtx = Pick<QueryCtx, "db">;
type WriteCtx = Pick<MutationCtx, "db">;
type CardRow = Doc<"cardChecklist">;

export const TOO_MANY_SECONDARY_PLAYERS = `A card can have at most ${MAX_CARD_PLAYERS} people under Also on this card.`;
const MISSING_PLAYER = "One of the selected players no longer exists.";

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
 * How the writer treats the card's `listingDescription` when the list changes:
 *
 *   - `"ifUntouched"` (the default): rewritten with the new names only when it
 *     still reads exactly as the generator built it before the change
 *     (`descriptionIsGenerated`); a description a person edited is kept.
 *   - `"always"`: a card inserted in this transaction, whose description the
 *     generator wrote a moment ago (the parallel build's copy).
 *   - `"leave"`: the caller writes the description itself (the bulk player
 *     add, which changes the card's own player in the same breath).
 */
export type CameoDescriptionMode = "ifUntouched" | "always" | "leave";

/** The NB names of `ids`, in order, leaving out any that no longer resolve. */
export async function cameoNamesFor(
  ctx: ReadCtx,
  ids: ReadonlyArray<Id<"players">> | undefined,
  cache?: StoredCardReadCache,
): Promise<string[]> {
  const names: string[] = [];
  for (const id of ids ?? []) {
    const name = await playerNameFor(ctx, id, cache);
    if (name !== null) names.push(name);
  }
  return names;
}

/**
 * Does `stored` read exactly as the generator built it for this card with
 * these cameos? Also true for the description the generator built with NO
 * cameo line: every card described before NEO-528 taught the generator about
 * cameos, including one whose cameos were set before then.
 */
export function descriptionIsGenerated(
  stored: string | undefined,
  inputs: Parameters<typeof generateListingDescription>[0],
  cameoNames: ReadonlyArray<string>,
): boolean {
  if (stored === undefined) return false;
  return (
    stored === generateListingDescription(inputs, { cameoNames }) ||
    stored === generateListingDescription(inputs, { cameoNames: [] })
  );
}

/**
 * Set one card's also-pictured players to `requested` (see
 * `planSecondaryPlayerIds`), and its index rows with it. A player that no
 * longer exists is refused, or with `dropMissing` left out (a copy or a bulk
 * page must not fail on someone else's stale id). Writes nothing when the
 * list is unchanged, past one index read.
 *
 * `fresh: true` is for a card inserted in the same transaction: it has no
 * index rows to diff against, so that read is skipped.
 *
 * `cache` shares player, team and ancestor reads across a page of cards;
 * `description` is the `CameoDescriptionMode`.
 */
export async function setCardSecondaryPlayers(
  ctx: WriteCtx,
  card: CardRow,
  requested: ReadonlyArray<Id<"players">>,
  opts: {
    fresh?: boolean;
    dropMissing?: boolean;
    cache?: StoredCardReadCache;
    description?: CameoDescriptionMode;
  } = {},
): Promise<{
  secondaryPlayerIds: Array<Id<"players">>;
  strippedPrimary: number;
  changed: boolean;
  descriptionRefreshed: boolean;
}> {
  const plan = planSecondaryPlayerIds(card, requested);
  const ids: Array<Id<"players">> = [];
  const names: string[] = [];
  for (const id of plan.ids) {
    const name = await playerNameFor(ctx, id, opts.cache);
    if (name !== null) {
      ids.push(id);
      names.push(name);
    } else if (!opts.dropMissing) throw new ConvexError(MISSING_PLAYER);
  }
  const changed = !sameIds(card.secondaryPlayerIds as string[] | undefined, ids as string[]);
  let descriptionRefreshed = false;
  if (changed) {
    const descriptionPatch: { listingDescription?: string } = {};
    const mode = opts.description ?? "ifUntouched";
    if (mode !== "leave") {
      const { inputs } = await titleForStoredCard(ctx, card, opts.cache);
      const untouched =
        mode === "always" ||
        descriptionIsGenerated(
          card.listingDescription,
          inputs,
          await cameoNamesFor(ctx, card.secondaryPlayerIds, opts.cache),
        );
      const next = generateListingDescription(inputs, { cameoNames: names });
      if (untouched && next !== card.listingDescription) {
        descriptionPatch.listingDescription = next;
        descriptionRefreshed = true;
      }
    }
    await ctx.db.patch(card._id, { secondaryPlayerIds: ids.length > 0 ? ids : undefined, ...descriptionPatch });
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
  return { secondaryPlayerIds: ids, strippedPrimary: plan.strippedPrimary, changed, descriptionRefreshed };
}

// ───────────────────────────────────────────────────────────────────────────
// A card BORN with cameos (NEO-528 round 3)
// ───────────────────────────────────────────────────────────────────────────

/**
 * The cameo field a NEW card is inserted with, for spreading into the insert
 * literal (`...bornSecondaryPlayerFields(card, ids)`), so no other module
 * names the field in a write. `ids` is the planned list
 * (`lib/cardPlayerDefaults.planDefaultCameos`, already resolved to players
 * that exist): repeats and the card's own players are taken out again here
 * and the list is cut at `MAX_CARD_PLAYERS` (a new card is never refused for
 * its defaults). Empty → `{}`, so the field stays absent.
 *
 * After the insert, call `bornSecondaryPlayers` with the inserted row to
 * write its index rows. The caller builds the description with the cameo
 * names (`generateListingDescription(inputs, { cameoNames })`); this writes
 * no text.
 */
export function bornSecondaryPlayerFields(
  card: Pick<CardRow, "playerIds" | "playerLinks">,
  ids: ReadonlyArray<Id<"players">> | undefined,
): { secondaryPlayerIds?: Array<Id<"players">> } {
  const primary = primaryPlayerIdsOf(card);
  const seen = new Set<string>();
  const out: Array<Id<"players">> = [];
  for (const id of ids ?? []) {
    const key = id as string;
    if (seen.has(key) || primary.has(key)) continue;
    seen.add(key);
    out.push(id);
    if (out.length === MAX_CARD_PLAYERS) break;
  }
  return out.length > 0 ? { secondaryPlayerIds: out } : {};
}

/**
 * The index rows for a card inserted in this transaction with
 * `bornSecondaryPlayerFields`. `card` is the inserted row (the insert literal
 * plus its new `_id` is enough). Nothing to do when it has no cameos; never
 * patches the card (its list already reads as stored).
 */
export async function bornSecondaryPlayers(
  ctx: WriteCtx,
  cardId: Id<"cardChecklist">,
  card: Pick<CardRow, "secondaryPlayerIds" | "playerIds" | "playerLinks" | "sportId">,
  cache?: StoredCardReadCache,
): Promise<void> {
  const ids = card.secondaryPlayerIds ?? [];
  if (ids.length === 0) return;
  // The writer with `fresh`: no index read, and the list it would store is
  // the one the card already holds, so it writes only the rows.
  await setCardSecondaryPlayers(ctx, { ...card, _id: cardId } as CardRow, ids, {
    fresh: true,
    dropMissing: true,
    cache,
    description: "leave",
  });
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

/**
 * NEO-535 — one page of a player's cameo index rows on a cursor, for the
 * player-rename description fan-out (`cardDescriptionFanOut`): a card names
 * its cameos in its description, so a cameo's rename reaches it too. The
 * same `[playerId, sportId]` + `_creationTime` cursor `cardPlayerLinkPage`
 * walks; `after` null starts at the beginning.
 */
export async function cardSecondaryPlayerLinkPageAfter(
  ctx: ReadCtx,
  playerId: Id<"players">,
  after: { sportId: Id<"selectorOptions">; creationTime: number } | null,
  limit: number,
): Promise<Array<Doc<"cardSecondaryPlayerLinks">>> {
  if (!after) return await cardSecondaryPlayerLinkPage(ctx, playerId, null, limit);
  const rest = await ctx.db
    .query("cardSecondaryPlayerLinks")
    .withIndex("by_player_and_sport", (q) =>
      q.eq("playerId", playerId).eq("sportId", after.sportId).gt("_creationTime", after.creationTime),
    )
    .take(limit);
  if (rest.length >= limit) return rest;
  const next = await ctx.db
    .query("cardSecondaryPlayerLinks")
    .withIndex("by_player_and_sport", (q) => q.eq("playerId", playerId).gt("sportId", after.sportId))
    .take(limit - rest.length);
  return rest.concat(next);
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
        descriptionRefreshed: result.descriptionRefreshed,
        userId,
      }),
    );
    return { secondaryPlayerIds: result.secondaryPlayerIds, strippedPrimary: result.strippedPrimary };
  },
});
