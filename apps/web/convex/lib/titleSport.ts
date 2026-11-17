/**
 * NEO-590 — which NB sport a sale's listing title names, pure.
 *
 * The Pick List files a sale NB could not tie to a card by its listing's
 * title: the sport is the one of the NB player or team the title names.
 * `pickList.titleSports` asks the search indexes for candidates; this module
 * decides which of them the title really says and whether they agree on one
 * sport. It orders a list only: nothing here matches a card or writes NB data.
 *
 * A candidate counts only when its WHOLE name appears in the title as
 * consecutive whole words, so "Mike Trout" is said by "2011 Topps Update Mike
 * Trout RC" and "Trout" alone is not said by "Rainbow Trout Lure". No alias
 * tables and no guessing: a nickname shared across sports ("Giants", "Cardinals")
 * names two sports and so decides nothing.
 *
 * Pure by contract: no Convex imports, so a unit test needs no deployment.
 */

import { teamFullName } from "../../lib/teams/team-name";
import { clampSearchQuery } from "./searchQueryClamp";
import { nameTokens } from "./entityNearMatch";

/** Words of a title handed to a search index; Convex honours a handful of terms. */
export const TITLE_SEARCH_MAX_TERMS = 16;

/** Hits read per index per title. */
export const TITLE_SEARCH_TAKE = 8;

/** A title, cut to the bound every other typed search honours. */
export function boundedTitle(title: string): string {
  return clampSearchQuery(title);
}

/**
 * THE one definition of a listing title's card-number token (NEO-590): given
 * text that STARTS at a `#`, the `#` and the token after it (`#12`, `# 12`,
 * `#BC-2,`), or null when nothing follows the `#`. `[0]` is the whole match,
 * `[1]` the raw token (trailing punctuation included; callers that want the
 * bare number trim it). `titleNameText` here and `parseListingTitle`
 * (app/collection/final/pick/model.ts) both read the number through this, so
 * the two cannot drift.
 */
export function cardNumberToken(fromHash: string): RegExpExecArray | null {
  return /^#\s*(\S+)/.exec(fromHash);
}

/**
 * The part of a title that names the player and team. A listing title runs
 * year, then set info, then the card number (`#<token>`), then player and
 * team, so the words after the first `#<token>` are searched, and the set's
 * generic words ("Rookie Card") cannot crowd the named player out of the
 * `take` window. The number rule is `cardNumberToken`, shared with
 * `parseListingTitle`. With no `#` token, or nothing with a letter after it,
 * the whole (clamped) title.
 *
 * Clamps the RAW title first (the house rule of searchQueryClamp.ts), so a
 * `#` past the clamp point is never seen and the regexes run on bounded text.
 */
export function titleNameText(title: string): string {
  const text = boundedTitle(title).replace(/\s+/g, " ").trim();
  const at = text.indexOf("#");
  if (at < 0) return text;
  const number = cardNumberToken(text.slice(at));
  if (!number) return text;
  const tail = text.slice(at + number[0].length).trim();
  return /\p{L}/u.test(tail) ? tail : text;
}

/**
 * The text a title is searched by: its words, digit-only ones dropped (a year,
 * a card number or a print run names no player or team), at most
 * `TITLE_SEARCH_MAX_TERMS`. Empty when nothing is left.
 */
export function titleSearchTerm(title: string): string {
  return boundedTitle(title)
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter((word) => word && !/^\p{N}+$/u.test(word))
    .slice(0, TITLE_SEARCH_MAX_TERMS)
    .join(" ");
}

/**
 * The text the `teams` index is searched by: `nameNormalized` is lowercased,
 * accent-folded and stripped of punctuation ("Montréal" is stored "montreal",
 * "St. Louis" "st louis"), so the title is run through the same word chain
 * (`titleWords`), not searched raw. Words with no letter in them (a year, a
 * season "2023-24", a number, a print run) are dropped, at most
 * `TITLE_SEARCH_MAX_TERMS`. Empty when nothing is left.
 */
export function titleTeamSearchTerm(title: string): string {
  return titleWords(title)
    .filter((word) => /\p{L}/u.test(word))
    .slice(0, TITLE_SEARCH_MAX_TERMS)
    .join(" ");
}

/** The title's normalised words, in order, for `nameInTitle`. */
export function titleWords(title: string): string[] {
  // A comma is deleted by the name chain, so "Topps,Mike Trout" would glue to
  // "toppsmike": a comma always ends a word here, spaced or not.
  return nameTokens(boundedTitle(title).replace(/,/g, " "));
}

/** Whether `name`'s words appear in `words` as one consecutive run. */
export function nameInTitle(name: string, words: readonly string[]): boolean {
  const tokens = nameTokens(name);
  if (!tokens.length || tokens.length > words.length) return false;
  for (let at = 0; at + tokens.length <= words.length; at += 1) {
    if (tokens.every((token, i) => words[at + i] === token)) return true;
  }
  return false;
}

/** Whether a team is said by the title: its full "Location Name" or its nickname. */
export function teamInTitle(team: { name: string; location?: string }, words: readonly string[]): boolean {
  return nameInTitle(teamFullName(team), words) || nameInTitle(team.name, words);
}

/** The one sport every list names between them; null when none does or they differ. */
function soleSport(lists: ReadonlyArray<readonly string[]>): string | null {
  const sports = new Set(lists.flat());
  return sports.size === 1 ? [...sports][0] : null;
}

/**
 * The sport a title files under: the players it names when their sports are
 * exactly one, else the teams it names when theirs are exactly one, else null
 * (the row files under Other). `players` and `teams` are the sport ids of the
 * candidates the title says, one list per candidate.
 */
export function decideTitleSport(
  players: ReadonlyArray<readonly string[]>,
  teams: ReadonlyArray<readonly string[]>,
): string | null {
  return soleSport(players) ?? soleSport(teams);
}
