/**
 * Fuzzy player- and team-name matching for photo pairing and intake.
 *
 * Card fronts and card backs almost never print a player's name identically.
 * Fronts favour a surname in isolation ("BUEHLER"), or an initialled first
 * name ("P. MAHOMES"); backs carry the full legal name with suffixes ("Ken
 * Griffey Jr."). Matching them needs a normalisation pass plus a small ladder
 * of increasingly permissive comparisons, each of which reports whether it
 * was an *exact* hit — the caller scores exact and fuzzy hits differently.
 *
 * NEO-643: the normalisation is the shared entity-name reading, in its
 * COMPARISON form (`entityNameCompareTokens` in `lib/entities/normalize-name.ts`),
 * so this ladder and the identity keys agree about what an accent, a stray
 * backslash ("Wilmer R\ios" for Ríos) or an initial run is. A hyphen is the one
 * place they differ on purpose: here it is a space ("Smith-Jones" = "Smith
 * Jones", Jason 2026-11-21), while a stored identity key keeps it inside its
 * token. The ladder also drops the generational suffix tokens.
 *
 * Everything here is pure and string-only. It knows nothing about pooling.
 */

import {
  entityNameCompareTokens,
  foldNameForCompare,
} from "../../../lib/entities/normalize-name";

/**
 * Generational and ordinal suffix TOKENS, dropped so "Ken Griffey Jr." and
 * "Ken Griffey" compare equal.
 *
 * NOTE the lone `v`: it is a Roman-numeral suffix (as in "Robert Griffin V"),
 * but it is dropped wherever it stands as a whole token, so "Bobby V"
 * normalises to "bobby". That quirk predates this module and is kept on
 * purpose: the scoring thresholds downstream were tuned against it, and a
 * quiet change here would show up as unexplained pairing drift.
 */
const NAME_SUFFIX_TOKENS: ReadonlySet<string> = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/**
 * Minimum characters a truncated first name must have before it may
 * prefix-match a longer one ("Rob" → "Robert"). One character is deliberately
 * excluded here because the single-initial rule above it already handles that
 * case with its own, stricter reasoning; allowing 1 here as well would make
 * every "A. Smith" match every "Adam Smith" *and* every "Andrew Smith"
 * through this branch.
 */
export const MIN_PREFIX_CHARS = 2;

/**
 * Whether two names refer to the same person, and how confidently.
 *
 * `exact` is only true for a post-normalisation string equality. Every other
 * rung of the ladder (surname-only, initials, prefixes, containment) reports
 * `match: true, exact: false`, which the scorer weights lower.
 */
export interface NameMatch {
  match: boolean;
  exact: boolean;
}

/** Reusable "no match" singleton — the ladder bails out to this from four places. */
export const NO_MATCH: NameMatch = Object.freeze({ match: false, exact: false });

/**
 * A player name as the ladder compares it: the shared entity-name tokens
 * (folded, lowercased, punctuation dropped, a hyphen read as a space, runs of
 * initials joined, source order) with the suffix tokens removed, joined by single spaces.
 *
 * Named `ladderPlayerName` because `players.normalizePlayerName` is the
 * identity key (token-sorted, suffixes kept); the two are different things.
 */
export function ladderPlayerName(name: string): string {
  return entityNameCompareTokens(name)
    .filter((token) => !NAME_SUFFIX_TOKENS.has(token))
    .join(" ");
}

/** Last whitespace-separated token of an already-normalized name. */
export function lastName(normalized: string): string {
  const parts = normalized.split(" ");
  return parts[parts.length - 1];
}

/**
 * Compare two player names through the full permissiveness ladder.
 *
 * Rungs, in order — the first one to fire wins:
 *
 * 1. Exact string equality after normalisation.
 * 2. Surnames differ → definitively not a match. Everything below assumes
 *    the surnames already agree.
 * 3. One first name is a single initial that prefixes the other
 *    ("P. Mahomes" ↔ "Patrick Mahomes").
 * 4. One side is surname-only ("BUEHLER" ↔ "Walker Buehler"). With no first
 *    name available to contradict the surname hit, this is a match. Before
 *    this rung existed it fell through the two-part gate below and returned
 *    nothing, which is what made surname-only fronts unpairable.
 * 5. One first name prefixes the other with at least `MIN_PREFIX_CHARS`
 *    ("Rob" ↔ "Robert"). Otherwise the first names genuinely disagree and
 *    this is not a match, surname agreement notwithstanding.
 */
export function playerNamesMatch(a: string, b: string): NameMatch {
  const na = ladderPlayerName(a);
  const nb = ladderPlayerName(b);

  // 1 — exact after normalisation.
  if (na === nb) {
    return { match: true, exact: true };
  }

  // 2 — surnames must agree for anything below to be considered.
  if (lastName(na) !== lastName(nb)) {
    return NO_MATCH;
  }

  const partsA = na.split(" ");
  const partsB = nb.split(" ");
  const firstA = partsA[0];
  const firstB = partsB[0];

  // 3 — abbreviated first name: "p" matches "patrick".
  if (firstA.length === 1 && firstB.startsWith(firstA)) {
    return { match: true, exact: false };
  }
  if (firstB.length === 1 && firstA.startsWith(firstB)) {
    return { match: true, exact: false };
  }

  // 4 — surname-only on either side.
  if (partsA.length === 1 || partsB.length === 1) {
    return { match: true, exact: false };
  }

  // 5 — truncated first name, e.g. "Rob" vs "Robert".
  const [shorter, longer] =
    firstA.length <= firstB.length ? [firstA, firstB] : [firstB, firstA];
  if (shorter.length >= MIN_PREFIX_CHARS && longer.startsWith(shorter)) {
    return { match: true, exact: false };
  }

  // Surnames agreed but the first names are genuinely different people.
  return NO_MATCH;
}

/**
 * Compare two team names by equality, then by containment either way.
 *
 * Containment carries the load here: a front usually prints only the
 * nickname ("Chiefs") while a back spells out the full club ("Kansas City
 * Chiefs"). No normalisation beyond the shared comparison fold (`foldNameForCompare`:
 * junk characters, accents, case, a hyphen read as a space) and trimming — team names do not carry
 * suffixes or initials, and stripping punctuation would fuse distinct names
 * more often than it would help.
 */
export function teamNamesMatch(a: string, b: string): NameMatch {
  // A dash became a space, so "Wilkes - Barre" is three spaces: collapse them.
  const na = foldNameForCompare(a).replace(/\s+/g, " ").trim();
  const nb = foldNameForCompare(b).replace(/\s+/g, " ").trim();

  if (na === nb) {
    return { match: true, exact: true };
  }
  if (nb.includes(na) || na.includes(nb)) {
    return { match: true, exact: false };
  }

  return NO_MATCH;
}
