/**
 * NEO-602 — what a same-name PLAYER pick step shows beside its candidates.
 *
 * Jason, 2026-11-19: "I don't know how I would choose between the two active
 * luis castillo. We should show the card number & team from the player on the
 * screen." The pick step listed its candidates (a birth year and a career
 * line each) and said "Pick the one on this card" without showing the card.
 *
 * Two things, one read (`entityReviewQueue.playerStepContext`):
 *
 *  1. The cards that print the name: number, and the team printed on each.
 *  2. For every candidate, the stints we hold, oldest first, with years; a
 *     stint on a team a card printed is marked, so the operator sees which
 *     candidates the printed team could mean. A line above them says how many
 *     do, because "the team did not narrow it" is exactly what an operator
 *     who sees two identical names is asking.
 *
 * Nothing here decides. The candidates are chosen in `SameNamePlayerPanel`;
 * this is evidence under them, the same order the team step uses
 * (`TeamStepContext`: the choices first, the cards after). The component owns
 * its own query so that the wizard and every test that renders it without a
 * pick step never learn the function.
 *
 * Text wraps, never truncates: a team label carries its era-specific name and
 * a long one must stay readable.
 */

import { useId } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { NOTHING_ON_FILE } from "../../lib/players/player-description";
import {
  STATUS_ANNOUNCE_DELAY_MS,
  YEARS_NOT_ON_FILE,
  moreCardsLabel,
  printedOnLabel,
  useAnnouncedText,
} from "./TeamStepContext";

// Shared with the team step, which holds the hook; re-exported for callers that
// already import it from here.
export { STATUS_ANNOUNCE_DELAY_MS };

/**
 * The line above the players list. It is also that list's accessible name
 * (`aria-labelledby`), as "Printed on N cards" is the cards list's: the visible
 * lead-in and the name a screen reader gives the list are the same words.
 */
export const PLAYER_STINTS_HEADING = "Teams we know for each player";

/** A card that names no team. */
export const NO_TEAM_PRINTED = "No team printed";

/** Marks a stint on a team a card printed. */
export const PRINTED_TEAM_MARKER = "printed team";

/** One candidate, as the server sends it. */
export type PlayerStepPlayer = {
  playerId: Id<"players">;
  name: string;
  birthYear?: number;
  stints: Array<{
    teamId: Id<"teams">;
    label: string;
    years: string;
    onPrintedTeam: boolean;
  }>;
  moreStints: number;
  hasPrintedTeam: boolean;
};

/** One card, as the server sends it. */
export type PlayerStepCard = { number?: string; teams: string[] };

/**
 * What tells one candidate from its namesakes, in words: the birth year when we
 * hold one, otherwise the same position wording the pick step's own buttons use
 * when a row has nothing else to go by ("option 2 of 3", see
 * `SameNamePlayerPanel.candidateLinkLabel`). Two candidates with no birth year
 * must never read the same, here or in the status line. The position is the
 * candidate's place in the list this component is given, which is the order the
 * pick step lists its buttons in (the server answers in that order).
 */
function playerQualifier(
  player: Pick<PlayerStepPlayer, "birthYear">,
  index: number,
  total: number,
): string {
  return player.birthYear !== undefined
    ? `b. ${player.birthYear}`
    : `option ${index + 1} of ${total}`;
}

/** "Luis Castillo, b. 1992" or "Luis Castillo, option 2 of 3". */
function playerLabel(
  player: Pick<PlayerStepPlayer, "name" | "birthYear">,
  index: number,
  total: number,
): string {
  return `${player.name}, ${playerQualifier(player, index, total)}`;
}

/**
 * The sentence that answers "did the printed team not match one of them?".
 * Empty when no card names a team: with nothing printed there is nothing to
 * say. Written for the three cases the stints can be in: several candidates
 * have a stint with the team (so it settles nothing), exactly one does (the
 * others have none on file, or the team would have settled it), or none does.
 *
 * "None" and "only one" are read from what the server scanned: it reads at most
 * `PLAYER_STEP_MAX_STINTS_SCANNED` stints of a player, so a printed team past
 * that bound is unknown and counts as no stint on file. The sentence says
 * "on file", which is all it can claim.
 */
export function printedTeamLine(
  cards: ReadonlyArray<PlayerStepCard>,
  players: ReadonlyArray<Pick<PlayerStepPlayer, "name" | "birthYear" | "hasPrintedTeam">>,
): string {
  const printed = new Set(cards.flatMap((card) => card.teams));
  if (printed.size === 0 || players.length === 0) return "";
  const team = printed.size === 1 ? "the printed team" : "a printed team";
  const withTeam = players.filter((player) => player.hasPrintedTeam);
  if (withTeam.length >= 2) {
    return `The printed team doesn't settle it: ${withTeam.length} of these players have a stint with it.`;
  }
  if (withTeam.length === 1) {
    const only = withTeam[0];
    const index = players.indexOf(only);
    return `Only ${only.name} (${playerQualifier(only, index, players.length)}) has a stint on file with ${team}.`;
  }
  return `None of these players has a stint on file with ${team}.`;
}

export default function PlayerStepContext({
  reviewRowId,
}: {
  reviewRowId: Id<"entityReviewQueue">;
}) {
  const context = useQuery(api.entityReviewQueue.playerStepContext, { reviewRowId });
  const cardsHeadingId = useId();
  const playersHeadingId = useId();
  const cards = context?.cards ?? [];
  const players = context?.players ?? [];
  const moreCards = context?.moreCards ?? 0;
  const total = cards.length + moreCards;
  const status = useAnnouncedText(context ? printedTeamLine(cards, players) : "");

  return (
    <div className="mt-3">
      {/* Mounted for the whole life of the step, empty until the query answers
          and then filled one tick later (`useAnnouncedText`), so the sentence is
          announced when it lands even from a cache (the house `role="status"`,
          implied polite). No focus moves. It owns no space while empty: the
          gap below it is its own bottom margin, present only with text. */}
      <p role="status" className={status ? "mb-3 text-sm text-ink-2" : "text-sm text-ink-2"}>
        {status}
      </p>

      <div className="space-y-3">
        {cards.length > 0 && (
          <div className="space-y-1.5">
            <p id={cardsHeadingId} className="text-sm text-ink-2">
              {printedOnLabel(total)}
            </p>
            {/* role="list": Safari drops list semantics under list-style:none. */}
            <ul role="list" aria-labelledby={cardsHeadingId} className="space-y-1.5">
              {cards.map((card, index) => (
                <li key={`${card.number ?? "none"}-${index}`} className="flex gap-3">
                  {/* A fixed column, so the printed teams line up; a longer
                      number wraps inside it rather than push them. */}
                  <span className="w-14 shrink-0 break-words text-xs font-medium text-ink">
                    {card.number ? `#${card.number}` : "No number"}
                  </span>
                  {card.teams.length > 0 ? (
                    <span className="min-w-0 flex-1 break-words text-sm text-ink">
                      {card.teams.join(", ")}
                    </span>
                  ) : (
                    <span className="min-w-0 flex-1 break-words text-xs italic text-ink-3">
                      {NO_TEAM_PRINTED}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {moreCards > 0 && <p className="text-xs text-ink-3">{moreCardsLabel(moreCards)}</p>}
          </div>
        )}

        {players.length > 0 && (
          <div className="space-y-1.5">
            <p id={playersHeadingId} className="text-sm text-ink-2">
              {PLAYER_STINTS_HEADING}
            </p>
            <ul role="list" aria-labelledby={playersHeadingId} className="space-y-2">
              {players.map((player, playerIndex) => (
                <li key={player.playerId} className="min-w-0 break-words text-xs text-ink-3">
                  <span className="text-sm text-ink">
                    {playerLabel(player, playerIndex, players.length)}
                  </span>
                  {player.stints.length === 0 ? (
                    <span className="block italic">{NOTHING_ON_FILE}</span>
                  ) : (
                    <ul role="list" className="space-y-0.5">
                      {player.stints.map((stint, index) => (
                        <li key={`${stint.teamId}-${index}`}>
                          {stint.years ? (
                            <span className="font-medium text-ink-2">{stint.years}</span>
                          ) : (
                            <span className="italic">{YEARS_NOT_ON_FILE}</span>
                          )}{" "}
                          <span>{stint.label}</span>
                          {stint.onPrintedTeam && (
                            <>
                              {" "}
                              {/* A qualifier on the team, in parentheses, so a
                                  screen reader does not run it into the name. */}
                              <span className="font-medium text-neon-blue-text">
                                {`(${PRINTED_TEAM_MARKER})`}
                              </span>
                            </>
                          )}
                        </li>
                      ))}
                      {player.moreStints > 0 && <li>{`+${player.moreStints} more`}</li>}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
