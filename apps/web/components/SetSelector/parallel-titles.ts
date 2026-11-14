import type { Id } from "../../convex/_generated/dataModel";
import type { ListingCardInputs } from "../../convex/features/generateListing";
// Browser-safe: the same three-step rule the parallel build runs.
import { assessParallelCopyTitle } from "../../convex/features/carriedTitle";
import { LISTING_TITLE_KEPT_MAX } from "../../convex/features/listingInputs";
import { LISTING_TITLE_MAX } from "../../convex/features/listingLimits";
import {
  groupTitleAssessments,
  ownWordsOf,
  titleDraftState,
  titleGroupKey,
  type CardTitleAssessment,
  type CardTitlesSource,
  type TitleAnswer,
} from "./card-titles";

/**
 * NEO-535 — the Card titles dialog for a PARALLEL's stored cards: which of
 * them it lists, what each title shows as the operator edits the box, and what
 * Save sends (`api.parallelCopyTitles.saveTitleFixes`).
 *
 * Pure: no Convex, no hooks. `ParallelTitlesDialog` draws it through the
 * wizard's own `CardTitlesStep` (`CardTitlesSource`), so the dialog looks,
 * groups and keys exactly like the step an operator already knows.
 *
 * ## Same rule as the build
 *
 * A card is listed because its STORED title fails (the server picks them:
 * over 80, or flagged cut short). With the box untouched each card shows its
 * stored title. Once the operator edits the box, each card's title is redrawn
 * by the build's own three-step order (`assessParallelCopyTitle`): the
 * builder's title with the new box, else the source's hand edit re-headed,
 * else the builder's result. The server reruns the same order with the box
 * it stores, and writes a kept title only when it comes to the same text.
 */

/** One stored card as `failingTitles` returns it. */
export type StoredTitleCard = {
  cardId: Id<"cardChecklist">;
  cardNumber: string;
  cardName: string;
  /** The stored `listingTitle`. */
  title: string;
  inputs: ListingCardInputs & { playerNames: string[]; teamNames: string[] };
  carriedRest?: string;
};

/** One parallel's part of the dialog. */
export type ParallelTitlesSection = {
  parallelId: Id<"selectorOptions">;
  parallelValue: string;
  boxPrefill: string;
  /** At most 50: what one save may answer. */
  cards: StoredTitleCard[];
  /** Failing cards past `cards`, counted across every page read. */
  moreCount: number;
};

/** Copy (NB voice; Jason reviews while testing). */
export const moreTitlesLine = (n: number) =>
  `And ${n} more after these. Save, then open Card titles again for the rest.`;

/** The stored cards, assessed for `CardTitlesStep` with the box draft (checked) applied. */
export function assessStoredTitleCards(
  cards: readonly StoredTitleCard[],
  listingShortName?: string,
): CardTitleAssessment[] {
  return cards.map((card, index) => {
    const inputs = listingShortName ? { ...card.inputs, setShortName: listingShortName } : card.inputs;
    const title = listingShortName
      ? assessParallelCopyTitle(inputs, card.carriedRest).title
      : card.title;
    const ownWords = ownWordsOf(card.inputs, card.cardNumber);
    return {
      index,
      cardNumber: card.cardNumber,
      cardName: card.cardName,
      title,
      fits: title.length <= LISTING_TITLE_MAX,
      inputs,
      ownWords,
      // Read from the STORED title, never a draft: groups hold still.
      groupKey: titleGroupKey(card.inputs, card.title, ownWords),
      items:
        card.title.length > LISTING_TITLE_MAX
          ? [{ kind: "titleOverLimit", length: card.title.length }]
          : [{ kind: "titleTruncated" }],
    };
  });
}

/** The `CardTitlesStep` source for one section. `scope` names its controls apart from another section's. */
export function parallelTitlesSource(
  section: ParallelTitlesSection,
  scope?: string,
): CardTitlesSource {
  return {
    count: section.cards.length,
    prefill: section.boxPrefill,
    groups: ({ answers, listingShortName }) => ({
      variationGroups: [],
      titleGroups: groupTitleAssessments(
        assessStoredTitleCards(section.cards, listingShortName),
        answers,
      ),
    }),
    ...(section.moreCount > 0
      ? { more: { count: section.moreCount, line: moreTitlesLine(section.moreCount) } }
      : {}),
    ...(scope ? { scope } : {}),
  };
}

/** What Save sends for one section. */
export type SaveTitleFixesArgs = {
  parallelId: Id<"selectorOptions">;
  listingShortName?: string;
  cards: Array<{ cardId: Id<"cardChecklist">; listingTitle?: string; kept?: string }>;
};

/**
 * The save for one section. Every row shown is answered (A5): the operator's
 * own title when one was typed that fits; else the title the row showed, kept
 * (with the box draft applied, when there is one). A draft over the cap
 * answers nothing, so that card stays as it is and stays flagged. The box is
 * sent only when it was edited (`listingShortName` already checked).
 */
export function saveTitleFixesArgs(
  section: ParallelTitlesSection,
  answers: ReadonlyArray<TitleAnswer | undefined>,
  listingShortName?: string,
): SaveTitleFixesArgs {
  const cards: SaveTitleFixesArgs["cards"] = [];
  for (const a of assessStoredTitleCards(section.cards, listingShortName)) {
    const state = titleDraftState(answers[a.index]?.listingTitle, a.title);
    const cardId = section.cards[a.index].cardId;
    if (state.kind === "own") cards.push({ cardId, listingTitle: state.title });
    else if (state.kind === "kept" && a.title.length <= LISTING_TITLE_KEPT_MAX) {
      cards.push({ cardId, kept: a.title });
    }
  }
  return {
    parallelId: section.parallelId,
    ...(listingShortName ? { listingShortName } : {}),
    cards,
  };
}

/** Has the operator changed anything in this section? (Escape asks first when so.) */
export function sectionEdited(
  section: ParallelTitlesSection,
  answers: ReadonlyArray<TitleAnswer | undefined>,
  listingShortName: string | undefined,
): boolean {
  if (listingShortName !== undefined) return true;
  return section.cards.some((card, i) => {
    const draft = answers[i]?.listingTitle;
    return draft !== undefined && draft.trim() !== "" && draft.trim() !== card.title;
  });
}

/** The save results, summed, as one line for the door's status. */
export function savedTitlesLine(totals: {
  saved: number;
  rewritten: number;
  kept: number;
  skipped: number;
  stillFailing: number;
}): string {
  const fixed = totals.saved + totals.rewritten + totals.kept;
  const parts = [
    fixed === 1 ? "Saved 1 title." : `Saved ${fixed} titles.`,
  ];
  if (totals.stillFailing > 0) {
    parts.push(
      totals.stillFailing === 1
        ? "1 still runs long."
        : `${totals.stillFailing} still run long.`,
    );
  }
  if (totals.skipped > 0) {
    parts.push(
      totals.skipped === 1
        ? "1 changed while you were in there, so it was left alone."
        : `${totals.skipped} changed while you were in there, so they were left alone.`,
    );
  }
  return parts.join(" ");
}
