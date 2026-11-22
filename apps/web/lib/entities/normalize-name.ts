/**
 * NEO-253 — ONE normalisation of an entity name, for every side of the wire.
 *
 * `players.nameNormalized`, `teams.nameNormalized`, `leagues.nameNormalized`,
 * the `entityReviewSkips` key, the `entityReviewQueue` resume key and the
 * commit prelude's own inline helper all have to answer "is this the same
 * name?" identically. Before this module there were SIX hand-written copies of
 * the same regex chain (`convex/players.ts`, `convex/teams.ts`,
 * `convex/leagues.ts`, two in `convex/selectorOptions.ts`, one in
 * `convex/lib/entityNearMatch.ts`), each with its own comment claiming parity
 * with the others, and `convex/lib/entityNearMatch.test.ts` existed solely to
 * assert that the copies had not drifted. A shared module makes the drift
 * unrepresentable instead of merely detectable.
 *
 * It lives in `lib/` rather than in `convex/` because the browser needs it too:
 * the entity review wizard dedupes a pasted name list with the SAME key the
 * commit then writes, and `convex/players.ts` pulls in `./_generated/server`,
 * so a browser bundle cannot import it. Same reasoning, and the same shelf, as
 * `lib/players/name-limits.ts`.
 *
 * ## What changed in NEO-253: diacritics fold
 *
 * The old chain lowercased and then dropped every character outside
 * `[a-z0-9\s-]`. An accented letter is outside that class, so "José Ramírez"
 * did not merely lose its accents — it SHREDDED into "e jos ram rez", a key
 * that resembles nothing. SportLots spells the name with accents and BSC
 * without, so one player arrived as two unrelated keys and the entity wizard
 * offered to create a second `players` row for a person NB already knew.
 *
 * Jason, 2026-09-04: "We DO need to match José and Jose: if a card says Jose
 * but the player in the database is José we should just link that player, not
 * consider them new."
 *
 * ## What changed in NEO-322: initials
 *
 * Periods are deleted, not turned into separators (see `DROPPED_PUNCTUATION`),
 * so "C.J. Kayfus" keyed as "cj kayfus" while "C. J. Kayfus" keyed as
 * "c j kayfus". Marketplaces and operators write initials both ways, so a
 * player NB already held was offered on production as a new person.
 *
 * The rule: after tokenising, every maximal run of TWO OR MORE adjacent tokens
 * that are each a single letter `a`–`z` is joined into one token, order kept
 * (`joinInitialRuns`). "C. J. Kayfus", "C J Kayfus", "C.J. Kayfus" and
 * "CJ Kayfus" all become "cj kayfus"; "N. H. L." becomes "nhl" in the ordered
 * league key; "Texas A&M" becomes "texas am" before the sort.
 *
 * The join runs BEFORE the token sort, and that matters in its own right: the
 * sort used to scatter initials, so "A. J. Smith" and "J. A. Smith" both keyed
 * as "a j smith" — two different people on one row. Joined first, they key as
 * "aj smith" and "ja smith".
 *
 * Two things are deliberately left alone:
 *
 * - **Digits.** "Big 12" is unchanged, and single digits standing side by
 *   side are numbers, not initials; joining them would fuse values that the
 *   name deliberately keeps apart.
 * - **A lone initial.** A run of one ("P. Mahomes", "Michael A. Taylor") has
 *   nothing to join with. Absorbing it into a neighbour would change the
 *   key of every name with a middle initial, for no match gained.
 *
 * ## A key change means a re-key on every deployment
 *
 * Until NEO-322 this section explained why NEO-253 shipped without a backfill:
 * no production player was staying. That is no longer true — production now
 * holds data that stays — so `convex/rekeyEntityNames.ts` exists, and it MUST
 * be run on every deployment after any change to the chain in this module.
 *
 * A stored key built by an older version of this chain is not merely
 * cosmetic: lookups go through `by_name_normalized_and_sport_id` with the
 * CURRENT key, so a row carrying a stale key is unreachable, and a fresh lookup
 * creates a sibling rather than finding it. The fix for a stale key is always
 * the re-key pass — never a softening of this function to accept both shapes.
 *
 * ### The NEO-643 exception: junk characters, no backfill
 *
 * NEO-643 added `foldNameText`, which DELETES the junk class (the backslash,
 * every Unicode format character, the spacing accent marks; see `NAME_JUNK` in
 * `cleanse-name.ts`) before anything else (BSC writes "Wilmer R\ios" for Ríos),
 * and folds with NFKD, so a full-width or ligature letter keys as its plain
 * letters. The key changes only for a name that contains one of those
 * characters; every other name keys exactly as before. The owner ruled out a
 * backfill, so the usual re-key pass is not run for this change. The affected
 * rows are found with the read-only dry run (`rekeyEntityNames:run '{}'`) and
 * fixed by hand, renaming each with the inline edit. The rule above still
 * stands for any other change to this chain.
 *
 * ### NEO-643: a hyphen is a space when two names are COMPARED, never in a stored key
 *
 * Jason, 2026-11-21: "a hyphen matches a space". "Smith-Jones" = "Smith Jones",
 * "Wilkes-Barre" = "Wilkes Barre", "Topps-Chrome" = "Topps Chrome". The first
 * attempt (36c4005c) put that in the one character fold, so it moved every
 * STORED key: about 2,600 `players` / `teams` / alias rows keyed by main's code
 * became unreachable by lookup, and the wizard offered "Shin-Soo Choo" as a new
 * player. Jason ruled again on 2026-11-22, and the rule now has two halves that
 * this module keeps apart on purpose:
 *
 * - **Stored identity keys keep main's hyphen behaviour exactly.** A hyphen
 *   (the ASCII hyphen-minus) stays INSIDE its token: "Smith-Jones" keys as
 *   "smith-jones", "Wilkes-Barre Barons" as "barons wilkes-barre". That is
 *   `normalizeEntityName`, `normalizeOrderedEntityName` and `entityNameTokens`
 *   as the writers use them (`players`, `playerSports`, `playerAliases`,
 *   `teams`, `teamAliases`, `leagues`, `franchises`, `entityReviewSkips`,
 *   `entityReviewQueue`) and `rekeyEntityNames`. No re-key, no seed change:
 *   for any name without a junk character the key is byte-identical to main's
 *   (pinned in `normalize-name.test.ts`). The second reason is the token
 *   sort: with the dash gone, "Min-jae Kim" and "Jae-min Kim" both sort to
 *   "jae kim min" and would collide on one `players` row, two different people.
 * - **Every COMPARISON that is not stored reads a hyphen as a space.** Card
 *   pairing and the ladder, the card-name and checklist-name keys, the set
 *   reconciliation fold, the selector name tier, search and typeahead, the
 *   career check and `teamNamesMatch` go through the explicit second step:
 *   `dashesToSpaces`, or one of the `*Compare*` helpers below, which apply it
 *   to the raw text and then run the same chain. A caller that compares a name
 *   with a STORED key (a `nameNormalized` it read, a skip key, a lookup by
 *   index) must stay on the stored functions, or it would stop finding the row.
 *
 * So "Smith Jones" does not auto-link to a stored "Smith-Jones": the operator
 * adds an alias. The near-match list still ranks the stored row first, through
 * the pairing ladder's exact rung, which compares with the hyphen as a space.
 *
 * Every other dash form (the en and em dashes, U+2010 to U+2015, the minus sign
 * and the small and full-width forms) was always a separator in the stored key
 * and still is; `foldNameText` turns those into spaces before NFKD so the two
 * full-width forms cannot become a hyphen-minus behind its back.
 *
 * ## What is deliberately NOT normalised here
 *
 * A letter with no canonical decomposition survives the fold and is then
 * dropped by the character class, exactly as it was before: "Ø", "ß", "Æ", "Ł",
 * and every non-Latin script. Folding those needs a transliteration table with
 * per-language rules, and getting one of those subtly wrong silently MERGES two
 * different people — the failure this module exists to prevent, running in
 * reverse. The narrow, reversible fold is the whole of the change.
 */

import { stripNameJunk } from "./cleanse-name";

/** Combining marks left behind by NFKD — the accents themselves. */
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/**
 * Punctuation deleted rather than replaced with a space, so "O'Neal" stays one
 * token and "St. Louis" does not gain an empty one. The curly apostrophe is
 * listed alongside the straight one because marketplace HTML uses both.
 */
const DROPPED_PUNCTUATION = /[.,'"`’]/g;

/**
 * Everything else that is not a key character becomes a separator. The ASCII
 * hyphen-minus is INSIDE the class, so "Wilkes-Barre" stays one token in a
 * stored key, exactly as it always has. (A comparison turns the hyphen into a
 * space first: see `dashesToSpaces`.)
 */
const NON_KEY_CHARS = /[^a-z0-9\s-]/g;

/**
 * Every dash form EXCEPT the ASCII hyphen-minus: the hyphen U+2010, the
 * non-breaking hyphen U+2011, the figure dash U+2012, the en and em dashes, the
 * horizontal bar, the minus sign U+2212, and the small and full-width forms
 * U+FE58, U+FE63 and U+FF0D. In a stored key these have always been separators
 * (the key class drops them); `foldNameText` makes that explicit BEFORE NFKD,
 * which would otherwise turn the small and full-width hyphen-minus into an
 * ASCII one and keep it inside a token.
 */
const OTHER_DASHES = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g;

/** Every dash, the ASCII hyphen-minus included. */
const DASHES = /[-\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g;

/**
 * NEO-643 — the EXPLICIT dash step for a comparison: each dash becomes a space
 * (not collapsed, not trimmed). Applied by callers that compare two names that
 * are not stored keys, never by the stored-key chain. Covers every dash form,
 * so a caller that does not run `foldNameText` (the selector name tier keeps
 * accents) sees the same set.
 */
export function dashesToSpaces(raw: string): string {
  return raw.replace(DASHES, " ");
}

/**
 * Trademark signs. NFKD would spell them out ("™" becomes "TM"), gluing the
 * letters onto the word before; they have always been a separator here, so
 * they are turned into a space before the compatibility decomposition.
 */
const TRADEMARK_SIGNS = /[\u2120\u2122]/g;

/**
 * NEO-643 — the CHARACTER fold both a stored key and a comparison start from:
 * `stripNameJunk` (the junk class is DELETED, each control character becomes a
 * space), decompose to NFKD, drop the combining marks, lowercase.
 *
 * NFKD, not NFD, so a compatibility letter folds onto its plain letters: the
 * full-width "\uFF2Dike" is "mike" and the "\uFB01" ligature is "fi". The stored
 * text (`cleanseExternalName`) stays NFC; only the key folds this far.
 *
 * The junk is DELETED, not turned into a separator, because it sits inside a
 * word: BSC's "Wilmer R\ios" must land on "wilmer rios", the same text as
 * "Wilmer R\u00EDos". That also means "Smith\Jones" keys as "smithjones". See
 * `NAME_JUNK` in `cleanse-name.ts` for the class. U+FFFD, "?", "\u00D8", "\u00DF"
 * and the non-Latin scripts are untouched: a transliteration table would merge
 * different people, and a replacement character is a lost letter we cannot
 * name.
 *
 * What this fold does NOT do is read a hyphen as a space. The ASCII hyphen-minus
 * comes through untouched, because the stored identity keys keep it inside its
 * token (see the module note). A comparison calls `foldNameForCompare`, or
 * `dashesToSpaces` first. (The other dash forms are turned into spaces here, as
 * they always were in the key, so NFKD cannot turn one into a hyphen-minus.)
 *
 * Pure ASCII without a backslash, a backtick or a control character is
 * unchanged apart from case (NFKD is the identity on ASCII), which keeps every
 * existing unaccented key.
 */
export function foldNameText(raw: string): string {
  return stripNameJunk(raw)
    .replace(TRADEMARK_SIGNS, " ")
    .replace(OTHER_DASHES, " ")
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase();
}

/**
 * NEO-643 — the fold for COMPARING two names that are not stored keys: every
 * dash is a space first (Jason, 2026-11-21: "a hyphen matches a space"), then
 * `foldNameText`. Not collapsed and not trimmed, as `foldNameText`.
 *
 * Never for a stored key, and never for a comparison against one: a stored
 * "smith-jones" is only found by a key that kept its hyphen.
 */
export function foldNameForCompare(raw: string): string {
  return foldNameText(dashesToSpaces(raw));
}

/**
 * Kept so the existing importer (`convex/adapters/teamColorCodes.ts`) keeps
 * working. It is `foldNameText` under its old name, so it now also lowercases
 * and deletes junk; that caller lowercased the result anyway, and turns every
 * non-alphanumeric run into a space itself, so a hyphen is already a space there.
 */
export const foldDiacritics = foldNameText;

/** One token that is a single letter — an initial once periods are gone. */
const SINGLE_LETTER = /^[a-z]$/;

/**
 * NEO-322 — join each maximal run of two or more adjacent single-letter tokens
 * into one token, in order: `["c", "j", "kayfus"]` → `["cj", "kayfus"]`.
 *
 * A run of one is left as it is ("p mahomes" stays two tokens), and digits are
 * never joined ("big 12" is unchanged). Expects tokens already folded,
 * lowercased and stripped, which is what `entityNameTokens` hands it. See the
 * module note for why each exclusion exists.
 */
export function joinInitialRuns(tokens: readonly string[]): string[] {
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length >= 2) out.push(run.join(""));
    else out.push(...run);
    run = [];
  };
  for (const token of tokens) {
    if (SINGLE_LETTER.test(token)) {
      run.push(token);
    } else {
      flush();
      out.push(token);
    }
  }
  flush();
  return out;
}

/**
 * The normalised tokens of a name, **in source order**, with runs of initials
 * joined (`joinInitialRuns`).
 *
 * Source order, not the sorted order the dedup keys use, because position
 * carries meaning that sorting destroys: the last token of a player name is the
 * surname, and that is what `players.nearMatches` falls back to searching on
 * when the full-name query misses. Callers that want a dedup key want
 * `normalizeEntityName`, which sorts these.
 */
export function entityNameTokens(raw: string): string[] {
  return joinInitialRuns(unjoinedTokens(raw));
}

/** Fold, lowercase, strip and split — every step of the chain before the join. */
function unjoinedTokens(raw: string): string[] {
  return foldNameText(raw)
    .replace(DROPPED_PUNCTUATION, "")
    .replace(NON_KEY_CHARS, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * NEO-322 — the readings of a TYPEAHEAD query, for matching typed text as
 * prefixes of a stored key's tokens. Never a key itself.
 *
 * `entityNameTokens` joins a run of initials, which is right for a finished
 * name and wrong on the keystroke where the operator has typed the first
 * letter of the NEXT word: "J. T. R", on the way to "J. T. Realmuto", joins to
 * "jtr", the prefix of nothing in "jt realmuto". So when the text ends in two
 * or more single letters, a second reading keeps the last one apart —
 * `["jt", "r"]` — and the caller accepts a row either reading matches. Every
 * other query has exactly one reading, `entityNameTokens(raw)`, first.
 */
export function entityNameQueryReadings(raw: string): string[][] {
  const tokens = unjoinedTokens(raw);
  const joined = joinInitialRuns(tokens);
  const n = tokens.length;
  if (n < 2 || !SINGLE_LETTER.test(tokens[n - 1]) || !SINGLE_LETTER.test(tokens[n - 2])) {
    return [joined];
  }
  return [joined, [...joinInitialRuns(tokens.slice(0, -1)), tokens[n - 1]]];
}

/**
 * The dedup key for `players` and `teams`: fold, lowercase, strip punctuation,
 * collapse whitespace, **token-sort**.
 *
 * The sort is what makes "Smith, John" and "John Smith" one row — marketplaces
 * disagree about that ordering constantly, and a duplicate player row is far
 * more expensive than the theoretical collision between two real names that are
 * anagrams of each other at the token level.
 */
export function normalizeEntityName(raw: string): string {
  return entityNameTokens(raw).sort().join(" ");
}

/**
 * The same key WITHOUT the token sort — `leagues.nameNormalized`.
 *
 * Sorting is a dedup trick for names that arrive in either order ("Yankees, New
 * York"). League names never do, and sorting would collapse "National League"
 * and "League National" into one row.
 */
export function normalizeOrderedEntityName(raw: string): string {
  return entityNameTokens(raw).join(" ");
}

/**
 * NEO-591 — a roster as one key: every name run through `normalizeEntityName`,
 * the empties dropped, duplicates collapsed, sorted, joined with "|". Two
 * cards share a roster key exactly when they name the same players (or
 * teams), in any order and any spelling the fold absorbs.
 */
export function rosterKey(names: readonly string[]): string {
  return [...new Set(names.map(normalizeEntityName).filter(Boolean))].sort().join("|");
}

// ---------------------------------------------------------------------------
// NEO-643 — the COMPARISON readings: the same chain with a hyphen read as a
// space. Never a stored key, never compared against one (see the module note).
// ---------------------------------------------------------------------------

/** `entityNameTokens` for a comparison: "Smith-Jones" is `["smith", "jones"]`. */
export function entityNameCompareTokens(raw: string): string[] {
  return entityNameTokens(dashesToSpaces(raw));
}

/** `entityNameQueryReadings` for typed text matched against a name's tokens. */
export function entityNameCompareReadings(raw: string): string[][] {
  return entityNameQueryReadings(dashesToSpaces(raw));
}

/**
 * `normalizeEntityName` for a comparison: token-sorted, a hyphen a space, so
 * "Smith-Jones" and "Smith Jones" are equal and "Min-jae Kim" and "Jae-min Kim"
 * are too (they are the same three tokens). That is right for asking whether two
 * INCOMING names agree, and wrong for a key that is stored.
 */
export function entityNameCompareKey(raw: string): string {
  return normalizeEntityName(dashesToSpaces(raw));
}

/** `normalizeOrderedEntityName` for a comparison: source order, a hyphen a space. */
export function orderedEntityNameCompareKey(raw: string): string {
  return normalizeOrderedEntityName(dashesToSpaces(raw));
}

/** `rosterKey` for a comparison: every name through `entityNameCompareKey`. */
export function rosterCompareKey(names: readonly string[]): string {
  return [...new Set(names.map(entityNameCompareKey).filter(Boolean))].sort().join("|");
}
