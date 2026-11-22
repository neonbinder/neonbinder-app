import { eraLabel, type TeamEra } from "./team-era";

/**
 * NEO-645 — what tells two same-name teams apart on screen: "Baltimore Orioles"
 * is three rows (the 1901 St. Louis lineage, the 1954 club, a minor-league
 * side), and the league and the years are the only words that separate them in
 * a search result or a chosen chip.
 *
 * Pure, and built from fields the team row and its league row already carry
 * (`yearsActive`, `leagueId` -> the league's abbreviation, else its name); it
 * invents nothing, and says nothing for a field the row does not have.
 *
 * "MLB · 1954–present", "1954–present", "MLB" or "".
 */
export function teamDetailLine(
  league: string | undefined,
  years: TeamEra | undefined,
): string {
  return [league?.trim(), eraLabel(years)].filter((part) => !!part).join(" · ");
}

/** A league's short name where it has one ("MLB"), else its name. */
export function leagueShortName(league: { name: string; abbreviation?: string }): string {
  return league.abbreviation?.trim() || league.name;
}
