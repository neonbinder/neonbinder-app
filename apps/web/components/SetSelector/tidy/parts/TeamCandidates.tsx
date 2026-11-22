import { useEffect, useState } from "react";
import type { Id } from "../../../../convex/_generated/dataModel";
import NeonButton from "../../../modules/NeonButton";

/**
 * NEO-645 — "We've got 3 teams by that name": the team rows a printed name
 * could mean, as one-click links, newest era first.
 *
 * Lifted from the retired `TeamStepContext` (NEO-602), whose candidate list
 * this is. The cards-that-print-the-name half of that component is now the
 * tile's "Printed on #1, #17" line and the open card's players' stints, which
 * `tidyCards.cardContext` already carries.
 *
 * Nothing here decides. A pick goes down the tile's one link path, "Remember …
 * as a name for this team" included.
 */

/** One row of the candidate list. `era` is the label ("1954–present"), "" for an undated row. */
export type TeamCandidate = {
  teamId: Id<"teams">;
  fullName: string;
  era: string;
  league?: string;
};

/**
 * The line over the candidates. A name (or an alias) says "by that name"; a
 * PLACE (`fromPlace`: the candidates are the teams located there, none of them
 * named it) says "from New York".
 */
export function candidatesIntro(count: number, placeName?: string): string {
  const where = placeName?.trim() ? `from ${placeName.trim()}` : "by that name";
  return `We've got ${count} teams ${where}. Pick the one on this card.`;
}

/** "Link to Baltimore Orioles · 1954–present · Major League Baseball". */
export function candidateLinkLabel(candidate: TeamCandidate): string {
  const base = candidate.era ? `${candidate.fullName} · ${candidate.era}` : candidate.fullName;
  return `Link to ${candidate.league ? `${base} · ${candidate.league}` : base}`;
}

/**
 * Every candidate's link name, in order, each one distinct: two rows can print
 * the same name, era and league (two undated rows under one name is the common
 * case), and a button an operator, a screen reader or a spec must tell apart
 * cannot share its name with another.
 */
export function candidateLinkLabels(candidates: readonly TeamCandidate[]): string[] {
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

/**
 * How long a status waits before it carries its sentence: mounted empty and
 * filled one tick later, so a cached answer still CHANGES the text of a live
 * region that is already in the page, which is what a screen reader announces.
 */
export const STATUS_ANNOUNCE_DELAY_MS = 100;

export function useAnnouncedText(text: string): string {
  const [settled, setSettled] = useState("");
  useEffect(() => {
    if (!text) return;
    const timer = setTimeout(() => setSettled(text), STATUS_ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);
  return text && settled === text ? text : "";
}

export default function TeamCandidates({
  candidates,
  printedName,
  fromPlace,
  disabled,
  onLink,
}: {
  candidates: readonly TeamCandidate[];
  /** The team text as the card printed it; named in the lead-in for a place. */
  printedName: string;
  fromPlace?: boolean;
  disabled?: boolean;
  onLink: (teamId: Id<"teams">) => void;
}) {
  const hasCandidates = candidates.length >= 2;
  const linkLabels = candidateLinkLabels(hasCandidates ? candidates : []);
  const intro = useAnnouncedText(
    hasCandidates ? candidatesIntro(candidates.length, fromPlace ? printedName : undefined) : "",
  );

  return (
    <div
      className={
        hasCandidates
          ? "grid gap-2 rounded-md border border-neon-blue-text/40 border-l-4 border-l-selection bg-neon-blue/5 p-3"
          : "contents"
      }
    >
      {/* One wrapper for the whole life of the row, so the intro's live region
          is already mounted, empty, when the candidates arrive. */}
      <p role="status" className="text-sm text-ink-2 empty:hidden">
        {intro}
      </p>
      {hasCandidates && (
        <ul
          role="list"
          // The name is the same sentence the lead-in says, but computed here, so
          // the list is named from its first render (the lead-in's live region
          // fills a beat later, on purpose).
          aria-label={candidatesIntro(candidates.length, fromPlace ? printedName : undefined)}
          className="flex flex-col items-start gap-1.5"
        >
          {candidates.map((candidate, index) => (
            <li key={candidate.teamId} className="max-w-full">
              <NeonButton
                size="1"
                variant="secondary"
                outline
                // A long label wraps inside the button instead of running out
                // of the tile. `min-h-6 py-1` is the same 24px on one line.
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
      )}
    </div>
  );
}
