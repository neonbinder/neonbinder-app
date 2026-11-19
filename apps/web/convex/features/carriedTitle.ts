/**
 * NEO-535 — the title a PARALLEL copy of a card is born with, in Jason's order
 * (2026-11-14):
 *
 *   1. The builder's own title for the parallel card (`assessListingTitle`,
 *      the parallel row's box chain included). When it fits with every first
 *      name kept, that is the title.
 *   2. Otherwise the source card's HAND-EDITED title, re-headed: its
 *      description swapped for the parallel's, its `/N` swapped for the
 *      parallel's. Used when that comes to 80 or under.
 *   3. Otherwise the builder's flagged result is stored, and the card goes to
 *      the Card titles dialog.
 *
 * "Failing" is the builder's title over 80 after every cut, or one that
 * sits in Tidy Up (NEO-609: a Tidy Up cut, which includes a lost first name,
 * is still out). A title built from the box that fits with full names is NOT
 * failing: the box is the operator's own answer and it worked.
 *
 * Pure and browser-safe (the dialog reruns the same order when the operator
 * edits the box). Imports only the generator, the cap and the suffix list.
 *
 * ## Reading a hand edit (`carriedTitleRest`)
 *
 * The source title is the operator's, so it is read cautiously, and any doubt
 * means "nothing to carry":
 *
 *   - a source title that is itself flagged (over 80, or cut short) is not an
 *     answer worth copying;
 *   - a source title the builder would write today word for word is not a
 *     hand edit: the parallel's own builder already tried everything it says;
 *   - the description must be found exactly once, as a run of whole words
 *     (case-folded, whitespace-normalised), trying the box text that applied
 *     to the source and each form the builder writes, longest first
 *     (`titleDescriptionForms`);
 *   - the rest may hold no `/digits` token besides the source's own print run
 *     (which is swapped later), so a hand-typed "/25" is never carried onto a
 *     parallel of a different run;
 *   - the rest must still carry every player's surname. Titles written before
 *     the NEO-535 builder could cut surnames; those are not copied.
 */

import {
  assessListingTitle,
  leftOutOfTitle,
  titleDescription,
  titleDescriptionForms,
  type ListingCardInputs,
  type ListingTitleAssessment,
} from "./generateListing";
import { LISTING_TITLE_MAX } from "./listingLimits";
import { isGenerationalSuffix } from "../../lib/players/name-fragment";

/** A `/N` print-run token ("/25"). */
const PRINT_RUN_TOKEN = /^\/\d+$/;

function tokensOf(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

const fold = (word: string) => word.toLowerCase();

/** A word with its leading and trailing punctuation removed, case-folded. */
function bare(word: string): string {
  return word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/** Start indexes where `needle` occurs in `haystack`, as whole folded words. */
function occurrences(haystack: readonly string[], needle: readonly string[]): number[] {
  const out: number[] = [];
  if (needle.length === 0) return out;
  const hay = haystack.map(fold);
  const want = needle.map(fold);
  for (let i = 0; i + want.length <= hay.length; i += 1) {
    if (want.every((w, j) => hay[i + j] === w)) out.push(i);
  }
  return out;
}

/** A player's surname word: the last word, a trailing Jr./Sr./II/III/IV set aside. */
function surnameOf(name: string): string | undefined {
  const words = tokensOf(name);
  if (words.length > 1 && isGenerationalSuffix(words[words.length - 1])) words.pop();
  const last = words[words.length - 1];
  return last ? bare(last) || undefined : undefined;
}

export type CarriedTitleSource = {
  /** The source card's stored `listingTitle`. */
  sourceTitle: string;
  /**
   * The source card is flagged: `listingTitleTruncated`, or a title over the
   * cap. Its title is then no answer to copy.
   */
  sourceFlagged: boolean;
  /** The source card's generator inputs as stored today (`listingInputsForStoredCard`). */
  sourceInputs: ListingCardInputs;
};

/**
 * What a source card's hand-edited title says beyond its description: the
 * words to re-head with a parallel's description, or undefined when there is
 * nothing safe to carry (see the module notes). The source's own `/N`, when
 * the title carries it, is left in place for `assessParallelCopyTitle` to
 * swap; it is the only `/digits` token the answer can hold.
 */
export function carriedTitleRest({
  sourceTitle,
  sourceFlagged,
  sourceInputs,
}: CarriedTitleSource): string | undefined {
  const title = sourceTitle.trim();
  if (!title || sourceFlagged || title.length > LISTING_TITLE_MAX) return undefined;
  // Not a hand edit: the builder would write exactly this today.
  if (assessListingTitle(sourceInputs).title === title) return undefined;

  const words = tokensOf(title);
  const box = sourceInputs.setShortName?.trim();
  const candidates = [...new Set([...(box ? [box] : []), ...titleDescriptionForms(sourceInputs)])]
    .map(tokensOf)
    .filter((c) => c.length > 0)
    .sort((a, b) => b.length - a.length || b.join(" ").length - a.join(" ").length);
  let rest: string[] | undefined;
  for (const candidate of candidates) {
    const at = occurrences(words, candidate);
    if (at.length === 0) continue;
    // Twice is ambiguous: which copy is the description, which the operator's?
    if (at.length > 1) return undefined;
    rest = [...words.slice(0, at[0]), ...words.slice(at[0] + candidate.length)];
    break;
  }
  if (!rest) return undefined;

  // The source's own print run may appear once; any other `/digits` token is
  // a run the parallel may not share.
  const ownRun = sourceInputs.printRun ? `/${sourceInputs.printRun}` : undefined;
  const runTokens = rest.filter((w) => PRINT_RUN_TOKEN.test(w));
  const ownCount = ownRun ? runTokens.filter((w) => w === ownRun).length : 0;
  if (ownCount > 1 || runTokens.length > ownCount) return undefined;

  // Every player's surname must still be there.
  const present = new Set(rest.map(bare).filter(Boolean));
  for (const name of sourceInputs.playerNames ?? []) {
    const surname = surnameOf(name);
    if (surname && !present.has(surname)) return undefined;
  }
  return rest.join(" ");
}

/** `rest` with its `/N` swapped for `printRun`: in place, dropped when unnumbered, appended when missing. */
function withPrintRun(rest: string, printRun: number | undefined): string {
  const words = tokensOf(rest);
  const at = words.findIndex((w) => PRINT_RUN_TOKEN.test(w));
  if (printRun) {
    if (at >= 0) words[at] = `/${printRun}`;
    else words.push(`/${printRun}`);
  } else if (at >= 0) {
    words.splice(at, 1);
  }
  return words.join(" ");
}

export type ParallelCopyTitle = ListingTitleAssessment & {
  /** The title is the source's hand edit, re-headed (step 2). Stored as the operator's own. */
  carried?: true;
  /** Step 3: the builder's result is stored as it stands and the card goes to the dialog. */
  failing: boolean;
};

/**
 * A parallel copy's title, by the three-step order in the module notes.
 * `inputs` are the parallel card's (its own parallel name, print run and box
 * chain); `carriedRest` is `carriedTitleRest` over its source card, when the
 * caller has one.
 *
 * Step 2's description is the builder's own for the parallel card; when that
 * puts the title over 80 and the parallel has box text, the box text instead.
 */
export function assessParallelCopyTitle(
  inputs: ListingCardInputs,
  carriedRest?: string,
): ParallelCopyTitle {
  const builder = assessListingTitle(inputs);
  // NEO-609 — "works" is: fits, and nothing from the Tidy Up line is still
  // out (a whole team, the number, SP, RELIC, a first name, RC, AUTO).
  if (builder.fits && !builder.tidyUp) return { ...builder, failing: false };
  if (carriedRest !== undefined) {
    const rest = withPrintRun(carriedRest, inputs.printRun);
    const headed = (description: string) => [description, rest].filter(Boolean).join(" ");
    let title = headed(titleDescription(inputs));
    const box = inputs.setShortName?.trim();
    if (title.length > LISTING_TITLE_MAX && box) title = headed(box);
    if (title && title.length <= LISTING_TITLE_MAX) {
      return {
        title,
        fits: true,
        // The operator's own words: whatever they left out was their call.
        firstNameLost: false,
        dropped: leftOutOfTitle(inputs, title),
        tidyUp: false,
        coreFits: true,
        carried: true,
        failing: false,
      };
    }
  }
  return { ...builder, failing: true };
}

/**
 * A stored title the Card titles dialog lists: over the cap, or flagged cut
 * short. The one reading the dialog's query, its save and its rewrite share.
 */
export function storedTitleFails(row: {
  listingTitle?: string;
  listingTitleTruncated?: boolean;
}): boolean {
  return (row.listingTitle?.length ?? 0) > LISTING_TITLE_MAX || row.listingTitleTruncated === true;
}
