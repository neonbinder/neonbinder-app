import { stintCoversWindow } from "../../../../convex/lib/teamFill";
import { stintYears } from "./copy";

/** One pill under a gap team on the Team tile: a career team the set's year covers. */
export type CareerSwapOption = { teamId: string; teamName: string; years: string };

/**
 * NEO-672 — the teams a career-gap team on a card can be swapped for: the
 * player's own career teams whose stints cover the set's year.
 *
 * "Covers" is production's window, `stintCoversWindow` (`convex/lib/teamFill`):
 * the set year and the one before it, the same window team-fill reads
 * (`careerTeamVerdict`). An undated stint covers nothing, and a team with
 * several covering stints is one option whose years are those stints, each
 * written as the Career tile's chips write it (`stintYears`: "2024–", "2023–2025"),
 * in career order. Options are newest first: the latest covering `fromYear`
 * leads, ties keep career order. A team already on the card is not offered:
 * only career teams not already on the card get a pill (Jason, 2026-11-25;
 * dropping a team stays on Edit). With no set year there is nothing to cover,
 * so none.
 */
export function careerSwapOptions({
  stints,
  teamsOnCard,
  setYear,
}: {
  stints: ReadonlyArray<{ teamId: string; teamName: string; fromYear?: number; toYear?: number }>;
  teamsOnCard: ReadonlyArray<string>;
  setYear: number | undefined;
}): CareerSwapOption[] {
  if (setYear === undefined) return [];
  const onCard = new Set(teamsOnCard);
  const byTeam = new Map<string, { teamName: string; covering: Array<{ fromYear: number; toYear?: number }> }>();
  for (const s of stints) {
    if (s.fromYear === undefined || onCard.has(s.teamId)) continue;
    const dated = { fromYear: s.fromYear, ...(s.toYear !== undefined ? { toYear: s.toYear } : {}) };
    if (!stintCoversWindow(dated, setYear)) continue;
    const entry = byTeam.get(s.teamId);
    if (entry) entry.covering.push(dated);
    else byTeam.set(s.teamId, { teamName: s.teamName, covering: [dated] });
  }
  const newest = (covering: Array<{ fromYear: number }>) => Math.max(...covering.map((c) => c.fromYear));
  return [...byTeam]
    .sort(([, a], [, b]) => newest(b.covering) - newest(a.covering))
    .map(([teamId, { teamName, covering }]) => ({
      teamId,
      teamName,
      years: covering.map((c) => stintYears(c)).join(", "),
    }));
}
