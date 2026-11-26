/**
 * NEO-616 — keeps `selectorOptions.printRun` ("/5" beside a variant's name) in
 * step with the row's own cards.
 *
 * The rule is pure and lives in `lib/variantPrintRun.ts` (`sharedPrintRun`):
 * at least 90% of the row's home cards share one run, every card counting in
 * the total. This module reads the cards and writes the answer.
 *
 * ## Who calls it
 *
 *  - the end of `buildParallelChecklist` (the copies carry their runs);
 *  - `selectorOptions.updateCard` (a run changed), `deleteCard` and
 *    `addCustomCard`, scheduled with `runAfter(0)`;
 *  - the commit chunk's re-sync, when an accepted field changed a run;
 *  - the armed backfill (`backfillVariantPrintRun.ts`), which fills what was
 *    never computed and, with `repair`, rewrites what drifted.
 *
 * Any other card writer drifts until the next of those; the backfill's
 * `repair` mode is the cure.
 *
 * ## Bounds and effects
 *
 * One bounded read of the row's home cards (`RECOUNT_MAX + 1`, the same
 * ceiling the card counts use). A row past it is left exactly as it stands.
 * A patch is written only on a change, and never bumps `lastUpdated`: the run
 * is derived, not edited, and moving the stamp would reorder "recently
 * changed" lists. Idempotent, so a retried or doubled call is harmless.
 *
 * NB data only: no marketplace value decides it (a built card's run may come
 * from a marketplace or a checklist, but it is the CARD's run by then).
 */
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { CARD_BEARING_LEVELS, RECOUNT_MAX } from "./cardCounts";
import { sharedPrintRun } from "./lib/variantPrintRun";

type DbCtx = { db: MutationCtx["db"] };

/** What reading one row's cards found. */
export type RowPrintRun =
  | { kind: "read"; printRun: number | undefined; cards: number }
  | { kind: "tooBig" };

/**
 * The run the row's cards share (per `sharedPrintRun`), or `tooBig` when the
 * row holds more than `RECOUNT_MAX` cards and cannot be read whole.
 */
export async function readRowPrintRun(
  ctx: DbCtx,
  rowId: Id<"selectorOptions">,
): Promise<RowPrintRun> {
  const cards = await ctx.db
    .query("cardChecklist")
    .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", rowId))
    .take(RECOUNT_MAX + 1);
  if (cards.length > RECOUNT_MAX) return { kind: "tooBig" };
  return { kind: "read", printRun: sharedPrintRun(cards), cards: cards.length };
}

export const refreshOutcomeValidator = v.union(
  /** The row now carries a run it did not (or a different one). */
  v.literal("set"),
  /** The row carried a run and no longer does. */
  v.literal("cleared"),
  v.literal("unchanged"),
  /** The row is gone, or is not a level that holds cards. */
  v.literal("skipped"),
  /** More cards than one read can take: the stored value was left alone. */
  v.literal("tooBig"),
);

/**
 * Recompute one row's `printRun` from its cards and write it when it differs.
 * Internal: no auth gate; callers are the mutations and actions named in the
 * header. `printRun` is returned when the row carries one afterwards.
 */
export const refreshVariantPrintRun = internalMutation({
  args: { selectorOptionId: v.id("selectorOptions") },
  returns: v.object({
    outcome: refreshOutcomeValidator,
    printRun: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.selectorOptionId);
    if (!row || !(CARD_BEARING_LEVELS as readonly string[]).includes(row.level)) {
      return { outcome: "skipped" as const };
    }
    const read = await readRowPrintRun(ctx, row._id);
    if (read.kind === "tooBig") {
      console.warn(
        JSON.stringify({ msg: "variant_print_run_skipped_too_big", selectorOptionId: row._id }),
      );
      return {
        outcome: "tooBig" as const,
        ...(row.printRun !== undefined ? { printRun: row.printRun } : {}),
      };
    }
    if (row.printRun === read.printRun) {
      return {
        outcome: "unchanged" as const,
        ...(read.printRun !== undefined ? { printRun: read.printRun } : {}),
      };
    }
    // No `lastUpdated`: see the header.
    await ctx.db.patch(row._id, { printRun: read.printRun });
    return read.printRun !== undefined
      ? { outcome: "set" as const, printRun: read.printRun }
      : { outcome: "cleared" as const };
  },
});
