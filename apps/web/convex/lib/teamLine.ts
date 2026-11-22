/**
 * NEO-645 — which cards share a Team answer: main's Tidy Up wizard's "line".
 *
 * The retired Teams step (`teams-on-cards.ts`, `buildTeamsGroups`) put every
 * teamless card of a sync on ONE LINE per player set plus the listing's claim,
 * because cards that share both share their evidence: an answer given to the
 * line is the answer for every card on it. The walk's "Apply to all" offers the
 * same thing from the card the operator just answered, so it reads the same
 * key, on the client (to propose) and on the server (to check).
 *
 *  - The line key is the card's player SET (order, and a player named twice,
 *    never split a line) plus its claim key: the listing's team name when it
 *    printed one NB did not settle (`bscTeamName`), and "the publisher's
 *    checklist settled this card's team" (`teamCheckOutcome: "checklist"`).
 *    A card under a claim never shares a line with a card under another claim
 *    or none (product invariant 8: a data claim holds a guess back, so what
 *    the operator answers about one claim says nothing about another).
 *  - Every card with nobody on it shares ONE line, whatever its claim: there
 *    is no player evidence at all, so no claim can tell two of them apart
 *    (main's `NO_PLAYERS_GROUP_KEY`).
 *  - A card number is never a key.
 *
 * Pure: ids and flags in, strings and booleans out, so the browser can import
 * it.
 */

import { normalizeEntityName } from "../../lib/entities/normalize-name";
import { idSetKey } from "./teamFill";

/** The line every card with nobody on it shares. */
export const NO_PLAYERS_LINE_KEY = "no-players";

/** The fields of a card the line key reads. */
export type TeamLineCard = {
  playerIds?: ReadonlyArray<string>;
  bscTeamName?: string;
  teamCheckOutcome?: string;
};

/** The line a card is on. */
export function teamLineKey(card: TeamLineCard): string {
  const players = idSetKey(card.playerIds ?? []);
  if (players === "") return NO_PLAYERS_LINE_KEY;
  const listed = (card.bscTeamName ?? "").trim();
  const claim =
    (listed ? `|listed:${normalizeEntityName(listed)}` : "") +
    (card.teamCheckOutcome === "checklist" ? "|checklist" : "");
  return `players:${players}${claim}`;
}

/** The fields of a card that say whether it is still waiting for a team. */
export type TeamlessCard = {
  playerIds?: ReadonlyArray<string>;
  pendingPlayerNames?: ReadonlyArray<string>;
  teamOnCardIds?: ReadonlyArray<string>;
  pendingTeamNames?: ReadonlyArray<string>;
  teamNoneConfirmedAt?: number;
  sourceDisagreements?: ReadonlyArray<{ field: string }>;
};

/**
 * A card that could take its line's team: nobody is waiting on a name, it has no
 * team and no team name waiting, it was not answered "No team", and the sources
 * are not in dispute about its teams. Everything else is somebody's answer
 * already, and a line never overwrites one.
 */
export function isTeamlessOnLine(card: TeamlessCard): boolean {
  return (
    (card.pendingPlayerNames ?? []).length === 0 &&
    (card.teamOnCardIds ?? []).length === 0 &&
    (card.pendingTeamNames ?? []).length === 0 &&
    card.teamNoneConfirmedAt === undefined &&
    !(card.sourceDisagreements ?? []).some((d) => d.field === "teams")
  );
}
