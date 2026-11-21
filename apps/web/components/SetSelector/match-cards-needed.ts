/**
 * NEO-640 — does this fetch still need the operator in Match Cards?
 *
 * Match Cards exists for the cards the sources could not line up on their own.
 * When every streamed card is lined up with full confidence, by a pairing that
 * does not need a human second opinion, the dialog is a step the operator can
 * only click through. `CardChecklist` skips it in that case and commits the
 * cards itself, exactly as the dialog's Confirm would (parity is pinned by a
 * unit test: same cards, same empty conflicts).
 *
 * The rule is one-way: this function answers "can the dialog be skipped" by
 * answering its opposite, and it is conservative on purpose. Anything it does
 * not recognise as settled goes to the operator. A skipped dialog cannot be
 * reopened by a mistake of the operator's, only by "Back to Match Cards" in
 * the wizard, so a guess that opens a dialog costs one click and a guess that
 * skips one costs a card pairing nobody looked at.
 *
 * Pure and Convex-free so the same predicate runs against a half-streamed
 * batch (early open: ANY visible row that needs the operator opens the dialog,
 * and a row's answer never changes once written) and against the settled one
 * (skip: NO row needs the operator).
 */

import type { ReadyCandidate } from "./pairing-cards";

/** NEO-496 — a source a card fetch draws from (`fetchCardChecklist`'s `sources`). */
export type FetchSource = "bsc" | "sportlots" | "checklist";

/**
 * The streamed row as `getReadyCandidates` returns it: `ReadyCandidate` (the
 * part `candidateToPairingCard` reads) plus the confidence the server stamped
 * on a marketplace pair. Named here rather than added to `ReadyCandidate`
 * because nothing that builds a `PairingCard` reads it.
 */
export type MatchCandidate = ReadyCandidate & { confidence?: number };

/**
 * Is a confidence "full"? A missing one counts: the server reads an unstamped
 * pair as 1 (`confidence ?? 1`), and the dialog shows a percentage only below
 * it. One definition for the predicate here, the Matched row's % and the
 * checklist chip's %, so the three cannot disagree about what is hidden.
 *
 * Written as the negation of `< 1` so a malformed NaN reads as full, exactly
 * as the `< 1` it replaces did; it is not a score to round, and 0.996 is not
 * full (it prints "100%", which is an existing display quirk, not a rule).
 */
export function isFullConfidence(confidence: number | undefined): boolean {
  return confidence === undefined || !(confidence < 1);
}

/**
 * Does any of these cards need the operator in Match Cards?
 *
 * Jason, 2026-11-21: "we should only skip this if Matched is all at 100%."
 * That sentence is the rule, read literally. With two or more sources the
 * dialog is skipped ONLY when every card would land in its Matched section
 * AND every match it shows there is at full confidence (`isFullConfidence`).
 * Anything the dialog would show under another section (a card only one
 * marketplace has, a checklist row nobody paired), or in Matched at less than
 * 100%, opens it. "Shows less than 100%" and "opens the dialog" are one
 * question answered by one function, so the % on screen and this predicate
 * cannot disagree.
 *
 * What lands in Matched, as `CardPairingModal` seeds it: a marketplace pair
 * (`bucket: "matched"`, both halves present), and a one-marketplace card the
 * server paired with a checklist row (`checklistLink`). What counts as 100%:
 *  - a marketplace pair at full confidence that SAYS how it was paired
 *    (`pairedBy` present: a matched row without one was written before
 *    NEO-640 and is never assumed clean). The names-first core (NEO-591)
 *    already scores a pair by what the sources agree on: the same roster with
 *    the numbers agreeing is 1, the same roster with the numbers differing or
 *    missing 0.9, a near name its score (times 0.9 when the numbers differ),
 *    and a number-only pair whose names disagree 0.9. So a "name" pair at 100%
 *    is one both the names and the numbers confirm, and the % is the whole
 *    answer; nothing here re-derives it;
 *  - no number choice pending: a card carrying `sourceNumbers` shows the
 *    number picker, with the rule's pick preselected (rule 7: an automatic
 *    number choice is the default, never final), so it opens the dialog;
 *  - a checklist link at full confidence, by a number or a case/prefix fold
 *    of one, to a row that prints the same number. A player-name link
 *    (exact or fuzzy) and a link to a row with a different number show a %
 *    or a number note, so they open it;
 *  - no name or roster disagreement between the marketplaces, and none about
 *    WHO is on the card between the checklist and the marketplaces. A
 *    team-only checklist disagreement is not shown in this dialog (the
 *    wizard's "Checklist says otherwise" step settles it before anything is
 *    saved), so it does not open it.
 *
 * One source: today's solo rule, unchanged. A one-source fetch has nothing to
 * line up, so a `matched` row (a pair that should not exist), a name conflict
 * or a roster conflict is the only reason to show it. No sources at all
 * cannot vouch for anything, so any card needs the operator.
 *
 * The rule is conservative on purpose: a skipped dialog costs a pairing
 * nobody looked at, an opened one costs a click.
 */
export function matchCardsNeeded(
  cards: readonly MatchCandidate[],
  sources: readonly FetchSource[],
): boolean {
  if (sources.length === 0) return cards.length > 0;
  if (sources.length === 1) {
    return cards.some(
      (c) => c.bucket === "matched" || !!c.nameConflict || !!c.playersConflict,
    );
  }
  const bothMarketplaces =
    sources.includes("bsc") && sources.includes("sportlots");
  const checklistSource = sources.includes("checklist");
  return cards.some(
    (c) => !isFullyMatched(c, bothMarketplaces, checklistSource),
  );
}

/** Is this one card in Matched, and at 100% there? */
function isFullyMatched(
  c: MatchCandidate,
  bothMarketplaces: boolean,
  checklistSource: boolean,
): boolean {
  // Another section's row, or a disagreement the operator is asked about.
  if (c.bucket === "checklistOnly") return false;
  if (c.nameConflict || c.playersConflict) return false;
  if (c.checklistConflict?.players) return false;
  // A number choice is pending: the picker is on the row (NEO-591). Whatever
  // paired the card, the operator is offered each source's number.
  if (c.sourceNumbers !== undefined || c.numberMinted) return false;

  if (c.bucket === "matched") {
    if (!isFullMarketplacePair(c)) return false;
  } else if (bothMarketplaces) {
    // A card only one marketplace has is the work the dialog does.
    return false;
  }

  if (checklistSource) {
    // Not on the checklist is another section's row; a checklist match below
    // 100% is shown as one.
    const link = c.checklistLink;
    if (!link) return false;
    if (link.via === "playerName" || link.via === "playerFuzzy") return false;
    if (!isFullConfidence(link.confidence)) return false;
    // Same reading as the chip (`serverChecklistChipText`): a blank number
    // is no number.
    if (link.checklistNumber?.trim()) return false;
  }
  return true;
}

/** A BSC + SportLots pair the dialog shows with no % and no note. */
function isFullMarketplacePair(c: MatchCandidate): boolean {
  if (!c.platformData.bsc || !c.platformData.sportlots) return false;
  if (!isFullConfidence(c.confidence)) return false;
  // Written before NEO-640, or by a path that did not say how: unknown.
  return c.pairedBy !== undefined;
}
