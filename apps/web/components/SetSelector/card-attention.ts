export * from "../../convex/features/cardAttention";

import {
  deriveCardAttention,
  type AttentionCardRow,
  type LiveAttention,
  type TidyAttentionKind,
} from "../../convex/features/cardAttention";

/**
 * NEO-102 — the SPA's view of the derived "needs attention" rule.
 *
 * The rule itself lives in `convex/features/cardAttention.ts`, which is
 * deliberately pure (no ctx, no db, no async) precisely so the browser can
 * call it on a `getCardChecklist` row — the same trick `expectedFeatures`
 * already uses. Re-exported through this module rather than imported directly
 * at each call site so `components/SetSelector` has ONE seam onto it: the
 * badge, the header count, the grid filter and the Tidy Up walk all import
 * from here.
 *
 * Only the WORDING lives on this side. That is not incidental: how an item is
 * phrased to an operator is a UI decision, and a copy of the string in the
 * Convex module is how the two drift apart — see the note on `AttentionItem`
 * there, which carries no message text for exactly this reason.
 */

/**
 * NEO-335 / PR 451 — "Still looking up teams for N cards." The one sentence
 * for cards waiting on the automatic team lookup (`isAwaitingTeamLookup`):
 * the Tidy Up end screen shows it and the checklist's status
 * line opens with it, so both say the same thing in the same words. The
 * singular keeps "teams": a card can carry more than one. Never names where
 * the lookup goes; the operator does not need a marketplace to blame.
 */
export function stillLookingUpTeams(count: number): string {
  return `Still looking up teams for ${count} ${count === 1 ? "card" : "cards"}.`;
}

/**
 * PR 451 (NEO-487) — the checklist's status line while any of the set's cards
 * wait on the background team lookup. The second sentence is the point of
 * the line: there is nothing to press. NEO-645: only while nothing else needs
 * the operator. With cards on the "N need you" pill the sentence would
 * contradict it, so the line is the lookup count alone. A card the lookup
 * gives up on becomes the operator's through the attention count, not through
 * this line.
 */
export function teamLookupStatusLine(count: number, needYouCount = 0): string {
  return needYouCount > 0
    ? stillLookingUpTeams(count)
    : `${stillLookingUpTeams(count)} Nothing for you to do yet.`;
}

/**
 * NEO-645 — does this card need a person at all? Pink (to fix) or blue (to
 * check). The one question the badge, the "N need you" pill, the grid's
 * attention filter and the Tidy Up walk all ask, so they cannot disagree. A
 * card with only purple notes is not counted: notes never make a stop.
 */
export function needsTidyUp(row: AttentionCardRow, live?: LiveAttention): boolean {
  return deriveCardAttention(row, live).level !== "none";
}

/**
 * NEO-645 — the badge's reason text for each kind `deriveCardAttention`
 * raises. Wording only; the derivation carries no message strings. A `Record`
 * over every kind, so a new kind must say what it is.
 */
export const TIDY_ATTENTION_LABELS: Record<TidyAttentionKind, string> = {
  sourcesDisagree: "the sources disagree",
  playerName: "player name not yet linked",
  needsName: "needs a name",
  teamName: "team name not yet linked",
  noTeam: "no team on this card yet",
  autograph: "autograph format not set",
  titleOverLimit: "title is over the 80-character limit",
  careerGap: "team is missing from the player's career",
  titleCut: "listing title was cut short",
  variationOverLimit: "variation text is over the 65-character limit",
};

/** The reason text for one item. Falls back for a kind a newer deploy added. */
export function tidyItemLabel(item: { kind: string }): string {
  return TIDY_ATTENTION_LABELS[item.kind as TidyAttentionKind] ?? "needs a look";
}
