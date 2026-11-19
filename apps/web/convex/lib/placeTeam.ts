/**
 * The pure half of settling a team printed as a PLACE (NEO-591, collector
 * review): which rows are "at" a text, and the one-row era pick.
 *
 * A published checklist may print a team as its place ("Seattle", "Oklahoma").
 * `checklistCandidates.resolveChecklistPlaceTeams` reads the candidates and
 * settles a text only when exactly one team in the set's league(s) is located
 * there for the set year, and the commit's own lookup of that team's full name
 * lands on the same row. The location test and the pick live here so they can
 * be tested without a deployment. Teams also use `teamLocationIs` to tell a
 * name match from a place match when they offer choices.
 *
 * Pure: no database.
 */
import { normalizeEntityName } from "../../lib/entities/normalize-name";
import { pickTeamForYear, type TeamEraRow } from "../../lib/teams/team-era";

/** True when the row's place is X (the folded, token-sorted key both share). */
export function teamLocationIs(row: { location?: string | null }, x: string): boolean {
  const location = row.location?.trim() ?? "";
  if (!location) return false;
  return normalizeEntityName(location) === normalizeEntityName(x);
}

/**
 * The one row these candidates mean for this set year, or null. A card's
 * year, so a team's past is allowed and its future is not; several survivors,
 * or none, is null.
 */
export function pickPlaceTeam<T extends TeamEraRow>(
  candidates: readonly T[],
  setYear: number | undefined,
): T | null {
  return pickTeamForYear(candidates, setYear, { allowPastEra: true })?.row ?? null;
}
