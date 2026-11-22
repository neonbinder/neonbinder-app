/**
 * NEO-253 (audit) — the key a typeahead FILTERS on, which is not the key the
 * database dedupes on.
 *
 * The three entity pickers (`PlayerPicker`, `TeamPicker`, `CareerTeamEntry`)
 * each filtered with a bare `c.name.toLowerCase().includes(q)` and decided
 * whether to offer "+ Create …" with a bare `c.name.toLowerCase() === q`.
 * Neither folded, so typing "Jose Ramirez" against NB's "José Ramírez" hid the
 * row AND offered to create it — and pressing Create then ran `findOrCreate`,
 * whose key DOES fold, so the operator was shown a create affordance that
 * silently resolved to the row the list had just hidden from them. The UI and
 * the server disagreed about whether a player existed.
 *
 * ## Why this is a separate key from `normalizeEntityName`
 *
 * `normalizeEntityName` token-SORTS. That is right for identity — it is what
 * makes "Smith, John" and "John Smith" one row — and it is fatal for a
 * substring filter: sorted, "New York Yankees" is "new yankees york", which
 * does not contain "new york". Routing the filter through the dedup key would
 * have broken the single most common thing anybody types into these boxes.
 *
 * So the split is by QUESTION, not by convenience:
 *
 *   - "does this row match what I am typing?" → this module. Fold and
 *     lowercase, nothing else, so ASCII behaviour is byte-identical to what it
 *     has always been and only the accents change.
 *   - "does a row already exist that Create would collide with?" →
 *     `normalizeEntityName`, sorting included, because that question must be
 *     answered exactly as `findOrCreate` will answer it. Anything softer offers
 *     Create for a row the server would return; anything harder hides Create
 *     for a name the server would insert.
 */

import {
  entityNameCompareTokens,
  entityNameTokens,
  foldNameForCompare,
} from "./normalize-name";

/**
 * Fold junk characters and diacritics, lowercase, and read a hyphen as a space
 * (`foldNameForCompare`; NEO-643, "a hyphen matches a space"), so typing
 * "smith jo" finds "Smith-Jones". No trimming, no whitespace collapsing, no
 * other punctuation handling — deliberately, so that for pure-ASCII input
 * without a dash this is exactly `String.prototype.toLowerCase` and every
 * existing filter, prefix rank and ordering behaves as it did. Callers trim the
 * QUERY themselves, as they always have.
 */
export function nameSearchKey(raw: string): string {
  return foldNameForCompare(raw);
}

/**
 * Does `name` contain `query`, ignoring case and accents?
 *
 * An empty query matches everything, which is what the pickers want: the list
 * before you type is the full candidate set, not an empty one.
 */
export function nameMatchesQuery(name: string, query: string): boolean {
  const q = nameSearchKey(query.trim());
  return !q || nameSearchKey(name).includes(q);
}

/**
 * Does `name` START with `query`? The pickers rank a prefix hit above a mere
 * substring hit, so typing "New" surfaces "New York Yankees" before "Newark
 * Eagles" before a random mid-name match. Folded on both sides for the same
 * reason the filter is: an accented row that reached the list must not then be
 * ranked as though it had matched by accident.
 */
export function nameHasQueryPrefix(name: string, query: string): boolean {
  const q = nameSearchKey(query.trim());
  return !!q && nameSearchKey(name).startsWith(q);
}

/** Every typed word is the start of SOME word of `words`. */
function everyWordStartsAWord(typed: readonly string[], words: readonly string[]): boolean {
  return typed.every((t) => words.some((word) => word.startsWith(t)));
}

/**
 * NEO-643 — does typed text hit a STORED name? A strict superset of what main
 * answered.
 *
 * Main read the typed text as a stored key reads it (a hyphen stays inside its
 * word) and split the stored `nameNormalized` on spaces. NEO-643 reads a hyphen
 * as a space in typed text, so two sets of readings arrive:
 *
 * - `compareReadings` (`entityNameCompareReadings`): a hyphen is a space, runs
 *   of initials are joined. They are tried against the stored name read the
 *   same way, with the hyphen split and its initials re-joined ("k-c royals"
 *   reads as `["kc", "royals"]`, so "KC Royals", "K C Royals" and "K-C Royals"
 *   all find it), and against the plain hyphen-split words ("wilkes-barre"
 *   reads as `["wilkes", "barre"]`).
 * - `storedReadings` (`entityNameQueryReadings`): main's own reading, tried
 *   against the stored name split on spaces, exactly as main did. Typing a
 *   stored "J-P Arencibia" in full joins to "jp" in the first set and cannot
 *   reach the stored "j-p"; this leg still finds it, so no row main returned
 *   is dropped.
 *
 * `aliases` are text the operator typed, read by the same chains.
 */
export function storedNameMatchesTyped(
  nameNormalized: string,
  compareReadings: readonly (readonly string[])[],
  storedReadings: readonly (readonly string[])[],
  aliases: readonly string[] = [],
): boolean {
  const compareNames = [
    entityNameCompareTokens(nameNormalized),
    nameNormalized.split(/[\s-]+/).filter(Boolean),
    ...aliases.map((alias) => entityNameCompareTokens(alias)),
  ];
  if (
    compareReadings.some(
      (typed) => typed.length > 0 && compareNames.some((words) => everyWordStartsAWord(typed, words)),
    )
  ) {
    return true;
  }
  const storedNames = [
    nameNormalized.split(" ").filter(Boolean),
    ...aliases.map((alias) => entityNameTokens(alias)),
  ];
  return storedReadings.some(
    (typed) => typed.length > 0 && storedNames.some((words) => everyWordStartsAWord(typed, words)),
  );
}
