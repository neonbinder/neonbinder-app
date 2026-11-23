/**
 * NEO-645 T3 — "“It Takes Two CPC”, Lindor as a cameo" on the Sources disagree
 * tile.
 *
 * A players disagreement of two single names where one side is exactly one NB
 * player and the other is not a player at all is usually a card that PICTURES
 * the player and is NAMED for something else: BSC says "It Takes Two CPC", the
 * checklist says "Francisco Lindor". One button settles it:
 *
 *   1. the card's name becomes the non-player side's name, through the pick
 *      path every "Use ..." button takes (`tidyPickSource.applyPickToCard`), so
 *      it behaves exactly like "Use “It Takes Two CPC”";
 *   2. the player is added to "Also on this card" (NEO-528), through the
 *      cameo writer;
 *   3. the disagreement is settled (the pick stamps `chosen`);
 *   4. the card's own player stays empty, and the picked name is answered "not
 *      a player" in the same call (`tidyNames.applyAnswer`, the answer the
 *      Player tile's own button gives), so nothing is left to ask: the card has
 *      its cameo, no main player and no stop from this tile;
 *   5. the title and description are rebuilt (T4), with the cameo in them.
 *
 * `cameoOfferFor` is the one reading of "when does the button show": the
 * client shows it from `cardContext.cameoOffer` and the mutation re-reads it,
 * so a stale tab can never write what the server would not offer.
 *
 * "Exactly one NB player" is main's exact-match rule (`resolveName` in
 * `tidyPickSource`, the loader's): a `tidyNames` answer linking a player wins;
 * otherwise exactly ONE player answers to the name and its own PRIMARY name is
 * the name (an alias-only or tied match is a question, never a player here; an
 * unanswered name row does not change that).
 * "Not a player" is the strict reading: a ruled-out name, or a name nobody
 * answers to (no primary, sport or alias match). A name that might be a player
 * (an alias match, a tie, an unanswered lookup that found one) offers nothing.
 * A name that is a near spelling of the player's own (`nearSpellingDistance`)
 * is the same person misspelled,
 * never a title, and offers nothing either.
 */

import { ConvexError, v } from "convex/values";
import { mutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin } from "./auth";
import { sameNamePlayers } from "./players";
import { applyPickToCard, entryFor } from "./tidyPickSource";
import { applyAnswer, resolveName } from "./tidyNames";
import { newNameWriteCache } from "./tidyCardWrites";
import { addCardCameo, cameoIdsOf } from "./cardSecondaryPlayers";
import { playerSurname } from "../lib/players/surname";
import { nearSpellingDistance } from "../lib/players/near-spelling";
import { normalizeEntityName } from "../lib/entities/normalize-name";

type Card = Doc<"cardChecklist">;
type ReadCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;

/** What the shortcut would do, as the tile words it. */
export const cameoOfferValidator = v.object({
  /** The NB player the card would carry as a cameo. */
  playerId: v.id("players"),
  /** The player's surname as NB stores it (the whole name for one word). */
  surname: v.string(),
  /** The non-player side's name: the card's name once picked. */
  name: v.string(),
});

export type CameoOffer = {
  playerId: Id<"players">;
  surname: string;
  name: string;
};

type Side = { kind: "player"; playerId: Id<"players"> } | { kind: "none" } | { kind: "unclear" };

/** What one printed name is, by the pick path's own rules. */
async function sideOf(ctx: ReadCtx, card: Card, name: string): Promise<Side> {
  const key = normalizeEntityName(name);
  const row = await ctx.db
    .query("tidyNames")
    .withIndex("by_scope_kind_name", (q) =>
      q.eq("scopeId", card.selectorOptionId).eq("kind", "player").eq("nameNormalized", key),
    )
    .first();
  const answer = row?.answer;
  if (answer?.kind === "notEntity") return { kind: "none" };
  if (answer?.kind === "linkPlayer") return { kind: "player", playerId: answer.playerId };
  const same = await sameNamePlayers(ctx as MutationCtx, key, card.sportId);
  if (same.length === 0) return { kind: "none" };
  if (same.length === 1 && same[0].nameNormalized === key) {
    return { kind: "player", playerId: same[0]._id };
  }
  return { kind: "unclear" };
}

/**
 * The offer for `card`, or null: the card has an unsettled-or-settled players
 * disagreement of exactly two single-name values, exactly one of which is
 * exactly one NB player and the other is not a player, and that player is not
 * already the card's own player or a cameo.
 */
export async function cameoOfferFor(ctx: ReadCtx, card: Card): Promise<CameoOffer | null> {
  const found = entryFor(card, "players");
  if (!found) return null;
  const values = found.entry.values;
  if (values.length !== 2 || values.some((o) => o.value.length !== 1)) return null;
  const [a, b] = [values[0].value[0], values[1].value[0]];
  if (normalizeEntityName(a) === normalizeEntityName(b)) return null;
  const sideA = await sideOf(ctx, card, a);
  const sideB = await sideOf(ctx, card, b);
  let playerId: Id<"players">;
  let name: string;
  if (sideA.kind === "player" && sideB.kind === "none") {
    playerId = sideA.playerId;
    name = b;
  } else if (sideB.kind === "player" && sideA.kind === "none") {
    playerId = sideB.playerId;
    name = a;
  } else {
    return null;
  }
  const own = new Set<string>([
    ...(card.playerIds ?? []).map(String),
    ...(card.playerLinks ?? []).map((l) => String(l.playerId)),
    ...cameoIdsOf(card).map(String),
  ]);
  if (own.has(String(playerId))) return null;
  const player = await ctx.db.get(playerId);
  if (!player) return null;
  // A near spelling of the player's own name is the same person misspelled
  // ("Jackson Merril" against "Jackson Merrill"), not a title to name the card for.
  if (nearSpellingDistance(name, player.name) !== null) return null;
  return { playerId, surname: playerSurname(player.name), name };
}

/**
 * Settle a players disagreement by naming the card for the non-player side and
 * adding the player as a cameo, in one transaction.
 *
 * Refused (`ConvexError`) when the card is gone or `cameoOfferFor` offers
 * nothing: the server re-reads the whole condition, nothing the client says
 * picks the player or the name. The cameo is written first so the title and
 * description the pick rebuilds already carry it.
 *
 * Returns the player added and the name the card now carries.
 */
export const pickSourceAsCameo = mutation({
  args: { cardId: v.id("cardChecklist") },
  returns: v.object({ playerId: v.id("players"), name: v.string() }),
  handler: async (ctx, args) => {
    const userId = await requireAdmin(ctx);
    const card = await ctx.db.get(args.cardId);
    if (!card) throw new ConvexError("That card is gone. Refresh and try again.");
    const offer = await cameoOfferFor(ctx, card);
    if (!offer) throw new ConvexError("That card has no cameo to offer. Refresh and try again.");

    const cache = newNameWriteCache(ctx);
    await addCardCameo(ctx, card, offer.playerId, cache.titles);
    const fresh = await ctx.db.get(card._id);
    if (!fresh) throw new ConvexError("That card is gone. Refresh and try again.");
    const result = await applyPickToCard(ctx, fresh, {
      field: "players",
      names: [offer.name],
      typed: false,
      userId,
      cache,
    });
    // The picked name is not a player: say so now, so the card is done in one
    // click. The ordinary operator answer (`tidyNames.applyAnswer`), so it takes
    // the name off the card, rebuilds the text and fans out to every card that
    // prints this exact name. A name the pick did not leave pending (it was
    // already ruled out) has nothing to answer.
    if (result.pending) {
      const target = await resolveName(ctx, card._id, "player", offer.name);
      await applyAnswer(ctx, userId, target, { kind: "notEntity" });
    }
    return { playerId: offer.playerId, name: offer.name };
  },
});
