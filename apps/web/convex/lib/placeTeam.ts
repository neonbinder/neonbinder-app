/**
 * The pure half of settling a team printed as a PLACE (NEO-591, collector
 * review): which rows are "at" a text, and the one-row era pick.
 *
 * A published checklist may print a team as its place ("Seattle", "Oklahoma").
 * `checklistCandidates.resolveChecklistPlaceTeams` reads the candidates and
 * settles a text at pairing only when exactly ONE team in the set's league(s),
 * across ALL its eras, is located there, and the commit's own lookup of that
 * team's full name lands on the same row.
 *
 * Where several in-league teams share the place (the 1969 Seattle Pilots and
 * the Mariners) the set year never chooses between them (Jason, 2026-11-20): a
 * retro Pilots card printed "Seattle" would link to the Mariners without a
 * word. The text stays as printed, and the card's PLAYERS decide at the Names
 * gate and the commit (`resolveCardTeamName` with `placeLeagueIds`, the card
 * rule with `playersMustDecide`), else the operator does.
 *
 * The location test and the pick live here so they can be tested without a
 * deployment. Teams also use `teamLocationIs` to tell a name match from a
 * place match when they offer choices.
 *
 * Pure: no database.
 */
import { normalizeEntityName } from "../../lib/entities/normalize-name";
import { MAX_PLAYER_NAME_LENGTH } from "../../lib/players/name-limits";
import { pickTeamForYear, type TeamEraRow } from "../../lib/teams/team-era";

/** True when the row's place is X (the folded, token-sorted key both share). */
export function teamLocationIs(row: { location?: string | null }, x: string): boolean {
  const location = row.location?.trim() ?? "";
  if (!location) return false;
  return normalizeEntityName(location) === normalizeEntityName(x);
}

/**
 * The text as a place to look up, or null when it is not read as one: blank,
 * longer than a name can be, or with a comma (the whole-name-first resolver
 * owns those). One rule for the pairing resolver and the card rule's place leg,
 * so what pairing leaves alone the gate does not read either.
 */
export function placeTextOrNull(raw: string): string | null {
  const x = raw.trim();
  if (!x || x.length > MAX_PLAYER_NAME_LENGTH || x.includes(",")) return null;
  return x;
}

/**
 * The one row these candidates mean, or null. `candidates` is EVERY in-league
 * team at the place, whatever its era: a lone one is the pick (a card can show
 * a team's past, never its future, so a lone team that had not begun by the set
 * year is not), and two or more are never settled here, whatever the year says.
 * That is the players' (or the operator's) to decide.
 */
export function pickPlaceTeam<T extends TeamEraRow>(
  candidates: readonly T[],
  setYear: number | undefined,
): T | null {
  if (candidates.length !== 1) return null;
  return pickTeamForYear(candidates, setYear, { allowPastEra: true })?.row ?? null;
}
