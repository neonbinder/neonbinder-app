/**
 * NEO-645 (moved from NEO-637's client rules in `card-titles.ts`) — what a
 * change of the set name in titles does to ONE stored card's title.
 *
 * "Shorten the set name for every card" (`tidyCards.applySetNameToTitles`)
 * writes the leaf's short name and then retitles the leaf's cards in pages.
 * The page decides per card with `retitleForSetName`, which is pure so the
 * unit tests pin each case without a database:
 *
 *  - a GENERATED title (the stored title equals what the generator built for
 *    the card under the OLD set name) is rebuilt under the new one;
 *  - a HAND EDIT that shows "Left out to fit" (the generator would have cut
 *    words the operator's own title is also missing) gets the new set name
 *    swapped in for the old one, the rest of the edit kept
 *    (`swapSetNameInTitle`); when the old text cannot be found, or is there
 *    more than once with none at the start, the builder's own description is
 *    tried, and failing that the edit is dropped and the title is the
 *    generated one;
 *  - ANY OTHER hand edit is left exactly as typed.
 *
 * Pure and browser-safe: no Convex imports beyond types.
 */

import {
  assessListingTitle,
  leftOutOfTitle,
  titleDescription,
  type ListingCardInputs,
} from "./generateListing";
import { ASPECT_VALUE_MAX } from "./listingLimits";

/** A title (or the box) is one line: each run of line breaks reads as one space. */
export function oneLine(raw: string): string {
  return raw.replace(/\s*[\r\n]+\s*/g, " ");
}

/**
 * `text` with the run of `oldName` swapped for `newName`, the rest of the words
 * kept as typed. Case is ignored when finding the run; the replacement is
 * `newName` as written. The run is the one at the start of the title (a set
 * name opens a title); failing that, the only one. Undefined when `oldName` is
 * not in `text` as whole words, is blank, or is in it more than once with none
 * at the start: which copy is the set name is a guess, so the caller tries
 * something else or rebuilds instead.
 */
export function swapSetNameInTitle(
  text: string,
  oldName: string,
  newName: string,
): string | undefined {
  const old = oldName.trim();
  if (!old) return undefined;
  const lower = text.toLowerCase();
  const want = old.toLowerCase();
  const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);
  const runs: number[] = [];
  for (let at = lower.indexOf(want); at >= 0; at = lower.indexOf(want, at + 1)) {
    const end = at + want.length;
    // Whole words only: "Score" is not found inside "Scorecard".
    if (isWordChar(text[at - 1]) && isWordChar(old[0])) continue;
    if (isWordChar(text[end]) && isWordChar(old[old.length - 1])) continue;
    runs.push(at);
  }
  const opening = text.length - text.trimStart().length;
  const at = runs.includes(opening) ? opening : runs.length === 1 ? runs[0] : undefined;
  if (at === undefined) return undefined;
  return oneLine(`${text.slice(0, at)}${newName.trim()}${text.slice(at + want.length)}`);
}

/** Every word of `entry` is one of the card's own player/team/number words. */
function isOwnEntry(entry: string, ownWords: ReadonlySet<string>): boolean {
  const words = entry.toLowerCase().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => ownWords.has(w));
}

/** The words a card's own players, teams and number are made of. */
export function ownWordsOfInputs(inputs: ListingCardInputs): Set<string> {
  return new Set(
    [
      ...(inputs.playerNames ?? []),
      ...(inputs.cameoNames ?? []),
      ...(inputs.teamNames ?? []),
      inputs.cardNumber,
      `#${inputs.cardNumber}`,
    ].flatMap((n) => n.toLowerCase().split(/\s+/).filter(Boolean)),
  );
}

/**
 * Does the stored title show a "Left out to fit" line under `inputs`? The
 * words the generator would have cut that the title is ALSO missing, less the
 * card's own names and number and an over-length variation (which has its own
 * field). Read from the text the field holds now, never the generator's own
 * assessment.
 */
export function titleShowsLeftOut(inputs: ListingCardInputs, title: string): boolean {
  const variation = inputs.cardVariation?.trim();
  const overCapVariation =
    variation && variation.length > ASPECT_VALUE_MAX ? variation : undefined;
  const own = ownWordsOfInputs(inputs);
  return leftOutOfTitle(inputs, title.trim()).some(
    (entry) => entry !== overCapVariation && !isOwnEntry(entry, own),
  );
}

export type SetNameRetitle =
  | { kind: "leave" }
  | { kind: "generated"; title: string; coreFits: boolean }
  | { kind: "swapped"; title: string };

/**
 * Decide one card's title when the set name in effect changes.
 *
 * `inputsAfter` are the card's listing inputs with the NEW set name in effect;
 * `oldShortName` is the leaf's short name before the change (undefined when it
 * had none). `newShortName` is the one just written (undefined when cleared).
 */
export function retitleForSetName(args: {
  storedTitle: string | undefined;
  inputsAfter: ListingCardInputs;
  oldShortName: string | undefined;
  newShortName: string | undefined;
}): SetNameRetitle {
  const { storedTitle, inputsAfter } = args;
  const inputsBefore: ListingCardInputs = {
    ...inputsAfter,
    setShortName: args.oldShortName?.trim() || undefined,
  };
  const before = assessListingTitle(inputsBefore);
  const after = assessListingTitle(inputsAfter);
  const stored = storedTitle?.trim() ?? "";
  // No title yet, or the one the generator built under the old name.
  if (stored === "" || stored === before.title) {
    return stored === after.title
      ? { kind: "leave" }
      : { kind: "generated", title: after.title, coreFits: after.coreFits };
  }
  // A hand edit: only one that shows the line is touched.
  if (!titleShowsLeftOut(inputsBefore, stored)) return { kind: "leave" };
  const newName = args.newShortName?.trim() || titleDescription(inputsAfter);
  const swapped =
    (args.oldShortName ? swapSetNameInTitle(stored, args.oldShortName, newName) : undefined) ??
    swapSetNameInTitle(stored, titleDescription(inputsBefore), newName);
  if (swapped === undefined) {
    return { kind: "generated", title: after.title, coreFits: after.coreFits };
  }
  return swapped === stored ? { kind: "leave" } : { kind: "swapped", title: swapped };
}
