/**
 * NEO-645 (S2) — which players on file are a misspelling of a printed name.
 * Pure: the caller supplies the candidates (`players.nearSpelledPlayers`, read
 * by `tidyNewPlayers`, and `tidyCameo`'s cameo offer), this decides who counts
 * as near.
 *
 * A candidate is near when, under the shared name fold (`entityNameTokens`:
 * accents, case, punctuation):
 *
 *  - the whole name is within an edit distance of the printed one, or
 *  - the surname is within an edit distance and the first names agree (the same
 *    word, or one an initial or a prefix of the other: "J." / "Jack" / "Jackson").
 *
 * The allowed distance is at most 2, and less for a short name: two edits turn
 * "Lee" into "Kim", which is not a spelling mistake, so a surname under 4
 * letters (a whole name under 8) allows none, and one under 6 (12) allows one. A name that folds to the printed one exactly is not "near": it is an
 * exact match, which the Player tile already offers.
 *
 * Advisory only. Nothing here links anything.
 */
import { entityNameTokens } from "../entities/normalize-name";

/** The largest edit distance a near match may be, however long the name. */
export const NEAR_SPELLING_MAX_DISTANCE = 2;

/**
 * Edit distance with an adjacent swap counting as one edit ("Jakcson" is one
 * mistake). Stops early once every cell of a row is over `max`, so a long
 * non-match costs a row or two; returns `max + 1` for "farther than `max`".
 */
export function boundedEditDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let twoBack: number[] | null = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (twoBack && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d = Math.min(d, twoBack[j - 2] + 1);
      }
      row.push(d);
      if (d < rowMin) rowMin = d;
    }
    if (rowMin > max) return max + 1;
    twoBack = prev;
    prev = row;
  }
  return Math.min(prev[b.length], max + 1);
}

/** The distance a word of this length may differ by and still be a misspelling. */
function allowedFor(shorterLength: number, wholeName: boolean): number {
  // A whole name carries spaces and a first name, so it takes more letters than
  // a surname does before one or two edits stop being a different person.
  const [two, one] = wholeName ? [12, 8] : [6, 4];
  if (shorterLength >= two) return NEAR_SPELLING_MAX_DISTANCE;
  if (shorterLength >= one) return 1;
  return 0;
}

function firstNamesAgree(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  // An initial ("j") or a shortening ("jack" for "jackson").
  return short.length >= 1 && long.startsWith(short);
}

/**
 * The edit distance of `candidate` from `printed` when it is a near spelling,
 * else null. 0 never comes back: an identical fold is not a misspelling.
 */
export function nearSpellingDistance(printed: string, candidate: string): number | null {
  const p = entityNameTokens(printed);
  const c = entityNameTokens(candidate);
  if (p.length === 0 || c.length === 0) return null;
  const pFull = p.join(" ");
  const cFull = c.join(" ");
  if (pFull === cFull) return null;
  // The same words in another order are the exact key, not a misspelling.
  if ([...p].sort().join(" ") === [...c].sort().join(" ")) return null;

  let best: number | null = null;
  const note = (d: number) => {
    if (best === null || d < best) best = d;
  };

  const wholeAllowed = allowedFor(Math.min(pFull.length, cFull.length), true);
  if (wholeAllowed > 0) {
    const d = boundedEditDistance(pFull, cFull, wholeAllowed);
    if (d <= wholeAllowed) note(d);
  }

  // The surname on its own, with agreeing first names: "J. Holiday".
  if (p.length >= 2 && c.length >= 2) {
    const pSur = p[p.length - 1];
    const cSur = c[c.length - 1];
    const surAllowed = allowedFor(Math.min(pSur.length, cSur.length), false);
    if (surAllowed > 0 && firstNamesAgree(p[0], c[0])) {
      const d = boundedEditDistance(pSur, cSur, surAllowed);
      if (d <= surAllowed) note(d);
    }
  }
  return best;
}
