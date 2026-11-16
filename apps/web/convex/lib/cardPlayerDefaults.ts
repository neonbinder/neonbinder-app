/**
 * NEO-528 round 3 — "Player on every card": what ONE card does with the
 * player and cameos a row above it defaults to.
 *
 * Pure: no ctx, no reads. Every place that applies a default goes through
 * these two functions, so they cannot disagree about which cards are left
 * alone:
 *
 *   - a card BORN under a row that carries a default (the checklist commit,
 *     a hand-added card, the parallel build's copy), with the defaults
 *     `cardPlayersBulk.effectiveCardPlayerDefaults` resolved for its row;
 *   - the whole-checklist run over cards that already exist
 *     (`cardPlayersBulk.addPlayerToVariant` / `addCameoToVariant`), with the
 *     one player the operator picked.
 *
 * The rules (Jason, 2026-11-13: "do not alter any cards that already have a
 * player set"):
 *
 *   - the default player goes on a card that names NO player and carries no
 *     name waiting for review; a card naming anyone else, or holding a pending
 *     name, is skipped. A card where the player is a cameo is PROMOTED: they
 *     become its player and leave its cameos.
 *   - default cameos are ADDED to the card's own (kept first, in order),
 *     never one of the card's own players, never twice, and never past
 *     `MAX_CARD_PLAYERS`.
 *
 * Neither ever writes a team (product invariant 8) or removes anything a
 * card already says.
 */

import type { Doc, Id } from "../_generated/dataModel";
import { MAX_CARD_PLAYERS } from "../features/cardAttention";

/** What the planners read of a card. A new card's fields before its insert. */
export type CardPlayerFacts = Partial<
  Pick<Doc<"cardChecklist">, "playerIds" | "playerLinks" | "pendingPlayerNames" | "secondaryPlayerIds">
>;

/**
 * The defaults one card is planned against: the player (at most one; a row
 * stores one) and the cameos, already resolved for the card's row.
 */
export type CardPlayerDefaultIds = {
  playerId: Id<"players"> | null;
  cameoIds: ReadonlyArray<Id<"players">>;
};

/**
 * Did the listing name anyone on this card? True when any printed player
 * string is non-blank, whatever became of it: resolved, waiting for review,
 * or ruled "not a person" in entity review (which leaves the card neither an
 * id nor a pending name).
 *
 * A NEW card the listing named someone on is never born with the "Player on
 * every card" default; it is left blank for the operator (Jason, 2026-11-15;
 * product invariant 8: a data claim holds back a guess). Default cameos still
 * apply. The ONE test for that, read by the checklist commit
 * (`listingNamedPlayer`) and by every client preview of the default (the
 * wizard's teams step, the card titles preview, the positions the checklist
 * hands the wizard), so the preview can never plan a player the save then
 * leaves off. Client-importable: no server imports.
 */
export function listingNamesAPlayer(printed: ReadonlyArray<string> | undefined): boolean {
  return (printed ?? []).some((name) => name.trim().length > 0);
}

/** Every id the card carries as its own players (`playerIds` and `playerLinks`). */
function ownPlayerIds(card: CardPlayerFacts): Set<string> {
  const out = new Set<string>();
  for (const id of card.playerIds ?? []) out.add(id as string);
  for (const link of card.playerLinks ?? []) out.add(link.playerId as string);
  return out;
}

/**
 * The verdict for the default PLAYER on one card:
 *
 *   - `none`: there is no default player;
 *   - `unchanged`: they are already one of the card's players;
 *   - `skip` `other`: the card names someone else (left as it is);
 *   - `skip` `pending`: the card names nobody yet but carries a name waiting
 *     for review (that is the card's own answer; left as it is);
 *   - `fill`: make them the card's player. `promote` when they are one of the
 *     card's cameos now, which they leave.
 *
 * Checked in that order, so a card already theirs is `unchanged` even when it
 * also names someone else.
 */
export type DefaultPlayerPlan =
  | { kind: "none" }
  | { kind: "unchanged" }
  | { kind: "skip"; reason: "other" | "pending" }
  | { kind: "fill"; playerId: Id<"players">; promote: boolean };

export function planDefaultPlayers(card: CardPlayerFacts, defaults: Pick<CardPlayerDefaultIds, "playerId">): DefaultPlayerPlan {
  const playerId = defaults.playerId;
  if (playerId === null) return { kind: "none" };
  const own = ownPlayerIds(card);
  if (own.has(playerId as string)) return { kind: "unchanged" };
  if (own.size > 0) return { kind: "skip", reason: "other" };
  if ((card.pendingPlayerNames ?? []).length > 0) return { kind: "skip", reason: "pending" };
  const promote = (card.secondaryPlayerIds ?? []).some((id) => id === playerId);
  return { kind: "fill", playerId, promote };
}

/**
 * The card's cameo list once the default cameos are added:
 *
 *   - `ids`: the card's own cameos first (in order, repeats and the card's own
 *     players taken out), then each default cameo that is new, until
 *     `MAX_CARD_PLAYERS`;
 *   - `added`: the defaults that went on;
 *   - `already`: defaults the card already lists as a cameo;
 *   - `skippedPrimary`: defaults that are one of the card's own players;
 *   - `skippedFull`: defaults that did not fit under the cap;
 *   - `changed`: `ids` differs from the card's stored list (also true when
 *     only a stale own-player id was taken out).
 *
 * Plan the player first (`planCardPlayerDefaults`): a card the default player
 * just filled must not keep them as a cameo too.
 */
export type DefaultCameoPlan = {
  ids: Array<Id<"players">>;
  added: Array<Id<"players">>;
  already: Array<Id<"players">>;
  skippedPrimary: Array<Id<"players">>;
  skippedFull: Array<Id<"players">>;
  changed: boolean;
};

export function planDefaultCameos(card: CardPlayerFacts, defaults: Pick<CardPlayerDefaultIds, "cameoIds">): DefaultCameoPlan {
  const own = ownPlayerIds(card);
  const stored = card.secondaryPlayerIds ?? [];
  const seen = new Set<string>();
  const ids: Array<Id<"players">> = [];
  for (const id of stored) {
    const key = id as string;
    if (seen.has(key) || own.has(key)) continue;
    seen.add(key);
    ids.push(id);
  }
  const kept = new Set(seen);
  const plan: DefaultCameoPlan = { ids, added: [], already: [], skippedPrimary: [], skippedFull: [], changed: false };
  const asked = new Set<string>();
  for (const id of defaults.cameoIds) {
    const key = id as string;
    if (asked.has(key)) continue;
    asked.add(key);
    if (own.has(key)) plan.skippedPrimary.push(id);
    else if (kept.has(key)) plan.already.push(id);
    else if (ids.length >= MAX_CARD_PLAYERS) plan.skippedFull.push(id);
    else {
      ids.push(id);
      plan.added.push(id);
    }
  }
  plan.changed = ids.length !== stored.length || ids.some((id, i) => id !== stored[i]);
  return plan;
}

/**
 * Both, in the order a card takes them: the player first, then the cameos
 * planned against the card AS the player plan leaves it (so a promoted or
 * filled player is never also a cameo). `playerIds` is the card's player list
 * after the plan: `[playerId]` on a fill, else what it had.
 */
export function planCardPlayerDefaults(
  card: CardPlayerFacts,
  defaults: CardPlayerDefaultIds,
): { player: DefaultPlayerPlan; playerIds: Array<Id<"players">>; cameos: DefaultCameoPlan } {
  const player = planDefaultPlayers(card, defaults);
  const playerIds = player.kind === "fill" ? [player.playerId] : [...(card.playerIds ?? [])];
  const after: CardPlayerFacts =
    player.kind === "fill"
      ? { ...card, playerIds, playerLinks: [{ playerId: player.playerId, nameOnCard: "" }] }
      : card;
  return { player, playerIds, cameos: planDefaultCameos(after, defaults) };
}
