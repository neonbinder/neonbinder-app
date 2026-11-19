/**
 * NEO-602 — what a TEAM review step shows beside its question.
 *
 * Jason, 2026-11-19: "On that New Team screen we need to show what player/card
 * is triggering it because that is the only way a person knows the right team
 * to link it to." And: "lets list the players stints that we know about."
 *
 * Two things, one read (`entityReviewQueue.teamStepContext`):
 *
 *  1. When the printed name reaches TWO OR MORE team rows, those rows as
 *     one-click links, newest era first. Before this a multi-row name looked
 *     like a brand-new team: an empty search box and a green "Add as New Team".
 *     The wizard's heading stops saying "New Team" for such a step (it reads
 *     the candidates off the row); this is where the choices are.
 *  2. The cards that print the name — number, players as printed — and under
 *     each player the teams we know he played for, with years. That is the
 *     evidence the operator chooses by, and it is shown on EVERY team step,
 *     including a name no row holds.
 *
 * Nothing here decides. A candidate's link goes down the wizard's one link path
 * (`onLink`), "Remember … as a name for this team" included; the list of
 * cards is display. The component owns its own query so that the wizard and
 * every test that renders it without a team step never learn the function
 * (`component-tests-hand-build-the-api-mock`).
 *
 * ## The grammar
 *
 * The same blue-ruled panel the pick step for same-name players wears
 * (`SameNamePlayerPanel`): solid rule = "these are rows we hold, choose one".
 * The cards list is plain text on the dialog ground, because it is evidence,
 * not a control. Text wraps, never truncates: a team label carries its era,
 * and the era is what tells two rows apart.
 */

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { NOTHING_ON_FILE } from "../../lib/players/player-description";
import NeonButton from "../modules/NeonButton";

/** One row of the candidate list, as the server sends it. */
export type TeamStepCandidate = {
  teamId: Id<"teams">;
  fullName: string;
  era: string;
  league?: string;
};

/** The line under the heading when two or more rows answer to the name. */
export function candidatesIntro(count: number): string {
  return `We've got ${count} teams by that name. Pick the one on these cards.`;
}

/** Shown only when the players' stints exist and still do not settle it. */
export const PLAYERS_DONT_SETTLE_LINE = "Players on these cards don't settle which team.";

/** The candidate list's accessible name. */
export const CANDIDATES_LIST_LABEL = "Teams already filed under this name";

/** The cards list's accessible name. */
export const CARDS_LIST_LABEL = "Cards that print this team name";

/** A stint with no years on file. */
export const YEARS_NOT_ON_FILE = "years not on file";

/**
 * "Link to Baltimore Orioles · 1954–present · Major League Baseball". The era
 * is `teamOptionLabel`'s shape (the server sends it ready, "" for an undated
 * row), the league is appended only when the row has one. Two rows share a name and differ in era or league,
 * which is why both ride in the accessible name.
 */
export function candidateLinkLabel(candidate: TeamStepCandidate): string {
  const base = candidate.era ? `${candidate.fullName} · ${candidate.era}` : candidate.fullName;
  return `Link to ${candidate.league ? `${base} · ${candidate.league}` : base}`;
}

/**
 * Every candidate's link name, in order, each one distinct.
 *
 * Two rows can print the same name, era and league (two undated rows under one
 * name is the common case), and a button the operator, a screen reader or a
 * spec must tell apart cannot share its name with another. The rows that would
 * collide are numbered in list order: "… · undated #1", "… · undated #2" for
 * rows with no years, "… · #1" for rows that share years. A row whose label is
 * already unique is left as `candidateLinkLabel` writes it.
 */
export function candidateLinkLabels(candidates: readonly TeamStepCandidate[]): string[] {
  const base = candidates.map(candidateLinkLabel);
  const seen = new Map<string, number>();
  for (const label of base) seen.set(label, (seen.get(label) ?? 0) + 1);
  const next = new Map<string, number>();
  return candidates.map((candidate, index) => {
    const label = base[index];
    if ((seen.get(label) ?? 0) < 2) return label;
    const n = (next.get(label) ?? 0) + 1;
    next.set(label, n);
    return candidate.era ? `${label} · #${n}` : `${label} · undated #${n}`;
  });
}

/** "Printed on 1 card" / "Printed on 12 cards". */
export function printedOnLabel(total: number): string {
  return `Printed on ${total} ${total === 1 ? "card" : "cards"}`;
}

/** "+4 more cards" / "+1 more card". */
export function moreCardsLabel(more: number): string {
  return `+${more} more ${more === 1 ? "card" : "cards"}`;
}

export default function TeamStepContext({
  reviewRowId,
  disabled,
  onLink,
}: {
  reviewRowId: Id<"entityReviewQueue">;
  /** True while another decision is in flight. See the wizard's `busy`. */
  disabled?: boolean;
  /** The wizard's one team-link path, "Remember …" answer included. */
  onLink: (teamId: Id<"teams">) => void;
}) {
  const context = useQuery(api.entityReviewQueue.teamStepContext, { reviewRowId });
  // Unanswered, or a row with nothing to show: the step is exactly what it was,
  // plus the empty live region below (it must already be mounted when the
  // intro lands, or the intro is not announced).
  const candidates = context?.candidates ?? [];
  const cards = context?.cards ?? [];
  const moreCards = context?.moreCards ?? 0;
  const playersDontSettle = context?.playersDontSettle ?? false;
  const total = cards.length + moreCards;
  const hasCandidates = candidates.length >= 2;
  const linkLabels = candidateLinkLabels(hasCandidates ? candidates : []);

  return (
    <div className="space-y-3">
      {/* The panel wrapper is ONE element for the whole life of the step, so the
          intro inside it (the house `role="status"` live region, implied
          polite) is already mounted, empty, when the query answers and its
          text is announced. `contents` drops the wrapper's box until there are
          candidates, so an empty region adds no gap. No focus moves: the
          wizard has already put focus on the step's heading. */}
      <div
        className={
          hasCandidates
            ? "rounded-md border border-neon-blue-text/40 border-l-4 border-l-selection bg-neon-blue/5 p-3 space-y-2"
            : "contents"
        }
      >
        <p role="status" className="text-sm text-ink-2">
          {hasCandidates ? candidatesIntro(candidates.length) : ""}
        </p>
        {hasCandidates && (
          <>
            {playersDontSettle && (
              <p className="text-xs text-ink-3">{PLAYERS_DONT_SETTLE_LINE}</p>
            )}
            {/* role="list": Safari drops list semantics under list-style:none. */}
            <ul
              role="list"
              aria-label={CANDIDATES_LIST_LABEL}
              className="flex flex-col items-start gap-1.5"
            >
              {candidates.map((candidate, index) => (
                <li key={candidate.teamId} className="max-w-full">
                  <NeonButton
                    size="1"
                    variant="secondary"
                    outline
                    // The label is a team's name, era and league: a long one wraps
                    // inside the button instead of running out of the dialog.
                    // `min-h-6 py-1` is the same 24px on one line.
                    className="h-auto min-h-6 max-w-full py-1 text-left wrap-anywhere"
                    aria-disabled={disabled ? true : undefined}
                    onClick={() => {
                      if (disabled) return;
                      onLink(candidate.teamId);
                    }}
                  >
                    {linkLabels[index]}
                  </NeonButton>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {cards.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-sm text-ink-2">{printedOnLabel(total)}</p>
          <ul role="list" aria-label={CARDS_LIST_LABEL} className="space-y-2">
            {cards.map((card, cardIndex) => (
              <li key={`${card.number ?? "none"}-${cardIndex}`} className="flex gap-3">
                {/* A fixed column, so the players of every card line up; a
                    longer number wraps inside it rather than push them. */}
                <span className="w-14 shrink-0 break-words text-xs font-medium text-ink">
                  {card.number ? `#${card.number}` : "No number"}
                </span>
                <ul className="min-w-0 flex-1 space-y-1.5">
                  {card.players.map((player, playerIndex) => (
                    <li
                      key={`${player.name}-${playerIndex}`}
                      className="min-w-0 break-words text-xs text-ink-3"
                    >
                      <span className="text-sm text-ink">{player.name}</span>
                      {player.stints.length === 0 ? (
                        <span className="block italic">{NOTHING_ON_FILE}</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {player.stints.map((stint, stintIndex) => (
                            <li key={`${stint.teamId}-${stintIndex}`}>
                              {stint.years ? (
                                <span className="font-medium text-ink-2">{stint.years}</span>
                              ) : (
                                <span className="italic">{YEARS_NOT_ON_FILE}</span>
                              )}{" "}
                              <span>{stint.label}</span>
                            </li>
                          ))}
                          {player.moreStints > 0 && <li>{`+${player.moreStints} more`}</li>}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {moreCards > 0 && <p className="text-xs text-ink-3">{moreCardsLabel(moreCards)}</p>}
        </div>
      )}
    </div>
  );
}
