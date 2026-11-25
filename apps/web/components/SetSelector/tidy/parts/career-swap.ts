import { stintCoversWindow } from "../../../../convex/lib/teamFill";
import { stintYearsText } from "./copy";

/** One pill under a gap team on the Team tile: a career team the set's year covers. */
export type CareerSwapOption = { teamId: string; teamName: string; years: string };

/**
 * NEO-672 — the teams a career-gap team on a card can be swapped for: the
 * player's own career teams whose stints cover the set's year.
 *
 * "Covers" is production's window, `stintCoversWindow` (`convex/lib/teamFill`):
 * the set year and the one before it, the same window team-fill reads
 * (`careerTeamVerdict`). An undated stint covers nothing, and a team with
 * several covering stints is one option whose years are those stints merged
 * (`stintYearsText`), in career order. A team already on the card is offered like
 * any other; the swap leaves it once. With no set year there is nothing to
 * cover, so none.
 */
export function careerSwapOptions({
  stints,
  setYear,
}: {
  stints: ReadonlyArray<{ teamId: string; teamName: string; fromYear?: number; toYear?: number }>;
  setYear: number | undefined;
}): CareerSwapOption[] {
  if (setYear === undefined) return [];
  const byTeam = new Map<string, { teamName: string; covering: Array<{ fromYear: number; toYear?: number }> }>();
  for (const s of stints) {
    if (s.fromYear === undefined) continue;
    const dated = { fromYear: s.fromYear, ...(s.toYear !== undefined ? { toYear: s.toYear } : {}) };
    if (!stintCoversWindow(dated, setYear)) continue;
    const entry = byTeam.get(s.teamId);
    if (entry) entry.covering.push(dated);
    else byTeam.set(s.teamId, { teamName: s.teamName, covering: [dated] });
  }
  return [...byTeam].map(([teamId, { teamName, covering }]) => ({
    teamId,
    teamName,
    years: stintYearsText(covering),
  }));
}
