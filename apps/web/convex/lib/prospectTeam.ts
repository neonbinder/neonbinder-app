/**
 * The pure half of settling a "Prospect (X)" checklist cell's team (NEO-591).
 *
 * Jason, 2026-11-17: in a checklist team cell "Prospect (X)", X is the card's
 * team and must be a minor-league or college team, never an MLB club. The
 * commit resolves a card's team STRINGS by name alone, set-wide
 * (`resolveTeamForSetYear`), so a string cannot carry "minor or college only":
 * left as "Arizona" it would bind silently to an MLB row whose alias is
 * "Arizona". X is therefore settled here, at fetch, before it can become a
 * string (`checklistCandidates.resolveProspectTeams` does the reads):
 *
 *  - candidates are the rows the sport holds under X as a FULL NAME
 *    (`findTeamsByFullName`: name or alias) plus the rows whose LOCATION is X
 *    ("Oklahoma" is the place of the Oklahoma Sooners, a name no row holds
 *    whole);
 *  - only rows in a `minor` or `college` league qualify. A major, an
 *    independent or international league, an "other" league and a row with no
 *    league never do, so an MLB club that shares the place is never offered;
 *  - the set year narrows them (`pickTeamForYear`, a card's year, so a team's
 *    past is allowed); exactly one row may remain;
 *  - and the commit has to agree: the full name of that row must resolve back
 *    to that same row through `resolveTeamForSetYear`, the lookup the Names
 *    gate and the commit prelude run on the string. If it does not (another
 *    row answers to the same name, or the era cannot pick), X is held.
 *
 * Settled: X becomes that row's full name, the string the card carries. Held:
 * X never becomes a team string; the card carries it as `prospectTeam` and the
 * operator chooses (product invariant 8: a data claim holds back a guess, the
 * listing's name is shown as a choice and never written as NB data).
 *
 * Pure: no database. The level filter and the pick live here so the two can be
 * tested without a deployment.
 */
import { normalizeEntityName } from "../../lib/entities/normalize-name";
import { pickTeamForYear, type TeamEraRow } from "../../lib/teams/team-era";

/** The league levels a "Prospect (X)" team may be in. Never `major`. */
export const PROSPECT_TEAM_LEVELS: ReadonlySet<string> = new Set(["minor", "college"]);

/** True when a team in a league of this level may be a prospect's team. */
export function isProspectTeamLevel(level: string | undefined | null): boolean {
  return level !== undefined && level !== null && PROSPECT_TEAM_LEVELS.has(level);
}

/** True when the row's place is X (the folded, token-sorted key both share). */
export function teamLocationIs(row: { location?: string | null }, x: string): boolean {
  const location = row.location?.trim() ?? "";
  if (!location) return false;
  return normalizeEntityName(location) === normalizeEntityName(x);
}

/**
 * The one row X means for this set year, or null. `qualifying` is already
 * filtered to minor / college leagues. A card's year, so a team's past is
 * allowed and its future is not; several survivors, or none, is null.
 */
export function pickProspectTeam<T extends TeamEraRow>(
  qualifying: readonly T[],
  setYear: number | undefined,
): T | null {
  return pickTeamForYear(qualifying, setYear, { allowPastEra: true })?.row ?? null;
}
