/**
 * NEO-616 — the print run a variant row carries ("/5"), read from its cards.
 *
 * Pure: no database. `convex/variantPrintRun.ts` reads a row's home cards and
 * writes what this returns; the armed backfill reads it the same way.
 *
 * ## The rule (Jason, 2026-11-19)
 *
 * A row (a variant type, an insert, a parallel: no level or name test) shows a
 * print run when at least `PRINT_RUN_SHARE` of its cards share one. The
 * denominator is EVERY home card on the row: variations count, and so do
 * unnumbered cards, which have no run to share. The most common run (the
 * plurality) must cover the share, so:
 *
 *   9 of 10 cards at /5   -> 5
 *   8 of 10 cards at /5   -> none (80% is under 90%)
 *   5 of 10 at /5, 5 at /10 -> none (a tie, and neither covers the share)
 *   no cards              -> none
 *
 * "None" means the row's `printRun` is cleared. A card's run counts only when
 * it is an integer 1..`MAX_BSC_PRINT_RUN`; anything else is an unnumbered card
 * for this purpose.
 *
 * NB data only: a marketplace never decides it.
 */
import {
  matchPublishedChecklist,
  type ChecklistRowInput,
} from "../../lib/checklists/match-published-checklist";
import { MAX_BSC_PRINT_RUN } from "./bscAttributeTokens";

/** The share of a row's cards one run must cover. */
export const PRINT_RUN_SHARE = 0.9;

/** A card's run when it is a real one, else `undefined`. */
export function validPrintRun(run: number | undefined): number | undefined {
  return run !== undefined && Number.isInteger(run) && run >= 1 && run <= MAX_BSC_PRINT_RUN
    ? run
    : undefined;
}

/**
 * The run at least `PRINT_RUN_SHARE` of `cards` share, or `undefined`.
 * `cards` is every home card of the row, numbered or not.
 */
export function sharedPrintRun(
  cards: ReadonlyArray<{ printRun?: number }>,
): number | undefined {
  const total = cards.length;
  if (total === 0) return undefined;
  const counts = new Map<number, number>();
  for (const card of cards) {
    const run = validPrintRun(card.printRun);
    if (run !== undefined) counts.set(run, (counts.get(run) ?? 0) + 1);
  }
  let best: number | undefined;
  let bestCount = 0;
  for (const [run, count] of counts) {
    if (count > bestCount) {
      best = run;
      bestCount = count;
    }
  }
  // Integer arithmetic: 9 * 10 >= 10 * 9 holds, 8 * 10 >= 10 * 9 does not, and
  // a float share never rounds a boundary the wrong way.
  return best !== undefined && bestCount * 10 >= total * 9 ? best : undefined;
}

/**
 * The print run each source card takes from the parallel's own linked
 * checklist rows, keyed by the card's id.
 *
 * Cards and rows pair with `matchPublishedChecklist`, the one pairing the app
 * uses (rule 7: a name pairs only on an exactly-one match on each side; a
 * number agrees or does not, and a player with several cards is a tie that
 * pairs nothing). A parallel's numbers often differ from its source's (a Mini
 * numbered 89M-1 against a Base numbered 89B-1), so the name pairing is the
 * normal case. A pair whose players disagree is dropped: the row is about
 * someone else, so its run says nothing about this card. Teams do not decide
 * it. A row's run counts only when it is a real one (`validPrintRun`).
 *
 * The cards' numbers are never changed and nothing is written: this only
 * reads which rows pair.
 */
export function printRunsFromChecklistRows<Id extends string>(
  cards: ReadonlyArray<{ id: Id; cardNumber: string; players: readonly string[] }>,
  rows: ReadonlyArray<ChecklistRowInput & { printRun?: number }>,
): Map<Id, number> {
  const runs = new Map<Id, number>();
  if (cards.length === 0 || rows.length === 0) return runs;
  const result = matchPublishedChecklist(
    cards.map((c) => ({ cardNumber: c.cardNumber, players: c.players })),
    rows,
  );
  for (const match of result.matches) {
    if (match.conflict?.players) continue;
    const run = validPrintRun(rows[match.rowIndex].printRun);
    if (run !== undefined) runs.set(cards[match.cardIndex].id, run);
  }
  return runs;
}
