/**
 * NEO-656 — the armed clear that removes stored Tidy Up review state from cards.
 *
 * Jason, 2026-11-23: "'Seen' is no longer remembered, so blue items come back
 * until fixed. Once you pick a source, the card keeps only the result." And:
 * "it should read real data and display pink/blue as appropriate depending on
 * the current state of the data." Nothing writes these three fields any more
 * (this release), and every reader ignores them. This clears what is already
 * stored so the schema can drop them in the next release (PR2):
 *
 *   - `tidyReviewed`  the fingerprints of blue items an operator had "seen";
 *   - `tidyChecks`    the stored career-gap / new-player / team-fill facts;
 *   - `sourceDisagreements` entries that carry `chosen` (a stored pick): the
 *     whole ENTRY goes, the card already holds the picked links, pending names
 *     and No-team stamp. The field is unset when nothing is left; an entry
 *     nobody picked stays byte for byte.
 *
 * It patches exactly those fields. It never bumps `lastUpdated` (the NEO-203
 * baseVersion), never rebuilds a title, and writes no other field. A second run
 * finds nothing and patches nothing.
 *
 * ## Operator command
 *
 *   # 1. dry run — reports what an armed run would clear, writes nothing
 *   npx convex run clearTidyReviewState:run '{}'
 *
 *   # 2. arm the deployment, run for real
 *   npx convex env set ALLOW_CLEAR_TIDY_REVIEW_STATE 1
 *   npx convex run clearTidyReviewState:run '{"confirm":"CLEAR"}'
 *
 *   # 3. dry run again: tidyReviewed, tidyChecks and chosenEntries read 0; disarm
 *   npx convex run clearTidyReviewState:run '{}'
 *   npx convex env remove ALLOW_CLEAR_TIDY_REVIEW_STATE
 *
 *   # production: the same steps with --prod. Re-run (pass the returned
 *   # `cursor`) until the report says "complete": true.
 *
 * Two independent arms, the NEO-214 pair: `confirm: "CLEAR"` states the intent
 * per invocation, the deployment flag guards the deployment you did not mean to
 * be pointed at. An armed invocation on an unarmed deployment is REPORTED as
 * refused rather than thrown, so the dry-run numbers still come back. No
 * `--identity`: these are internal functions, and the deploy credential is the
 * gate.
 *
 * ## Cost
 *
 * A full scan of `cardChecklist` by creation time (`tidyReviewed` can sit on
 * rows from before NEO-645, so the creation time cannot bound it): a byte-
 * bounded query page returns only the ids that carry any of the three fields,
 * and a mutation of at most `CLEAR_BATCH` re-reads and patches them. The query
 * snapshot has no write footprint; a mutation's read set is only the rows it
 * writes. Delete this module with the schema tightening (PR2).
 */

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

const CONFIRM_TOKEN = "CLEAR";
const ENV_FLAG = "ALLOW_CLEAR_TIDY_REVIEW_STATE";

/** Cards one scan page reads (row- and byte-bounded). */
export const SCAN_PAGE = 500;
export const SCAN_PAGE_BYTES = 8 * 1024 * 1024;
/** Cards one clearing mutation re-reads and patches. */
export const CLEAR_BATCH = 100;
/** A call stops after the first page that lands past this; re-run to resume. */
const TIME_BUDGET_MS = 150_000;

function deploymentIsArmed(): boolean {
  const value = process.env[ENV_FLAG];
  return value === "1" || value === "true";
}

const NOT_ARMED_MESSAGE =
  `Refused: this deployment is not armed for the clear. ` +
  `Set ${ENV_FLAG}=1 on it (npx convex env set ${ENV_FLAG} 1), re-run, and ` +
  `remove the flag afterwards. Nothing was written; the counts below are what ` +
  `an armed run would have cleared.`;
const APPLIED_MESSAGE = "Applied. Run the dry run again: every count should read 0.";
const DRY_RUN_MESSAGE =
  `Dry run — nothing written. Arm with ${ENV_FLAG}=1 on the deployment and ` +
  `re-run with {"confirm":"${CONFIRM_TOKEN}"} to apply.`;

type Card = Pick<Doc<"cardChecklist">, "tidyReviewed" | "tidyChecks" | "sourceDisagreements">;

/**
 * What clearing a card changes: the fields to unset and the counts. Pure, and
 * shared by the dry run and the armed run, so the dry run reports exactly what
 * an armed run would write. Null when the card carries nothing to clear.
 */
type ClearPatch = Pick<
  Partial<Doc<"cardChecklist">>,
  "tidyReviewed" | "tidyChecks" | "sourceDisagreements"
>;

export function planClear(card: Card): {
  patch: ClearPatch;
  tidyReviewed: number;
  tidyChecks: number;
  chosenEntries: number;
} | null {
  const patch: ClearPatch = {};
  const entries = card.sourceDisagreements ?? [];
  const kept = entries.filter((e) => e.chosen === undefined);
  const chosenEntries = entries.length - kept.length;
  if (chosenEntries > 0) {
    patch.sourceDisagreements = kept.length > 0 ? kept : undefined;
  }
  if (card.tidyReviewed !== undefined) patch.tidyReviewed = undefined;
  if (card.tidyChecks !== undefined) patch.tidyChecks = undefined;
  if (Object.keys(patch).length === 0) return null;
  return {
    patch,
    tidyReviewed: card.tidyReviewed !== undefined ? 1 : 0,
    tidyChecks: card.tidyChecks !== undefined ? 1 : 0,
    chosenEntries,
  };
}

/** One byte-bounded page of the table: the ids of the cards that carry any of the three. */
export const findCarriers = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    ids: v.array(v.id("cardChecklist")),
    scanned: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("cardChecklist")
      .withIndex("by_creation_time")
      .paginate({
        numItems: SCAN_PAGE,
        cursor: args.cursor,
        maximumBytesRead: SCAN_PAGE_BYTES,
      });
    return {
      ids: page.page.filter((card) => planClear(card) !== null).map((card) => card._id),
      scanned: page.page.length,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

const countsValidator = v.object({
  cardsPatched: v.number(),
  tidyReviewed: v.number(),
  tidyChecks: v.number(),
  chosenEntries: v.number(),
});

/**
 * Re-read each id and clear it. `apply: false` computes the same plan and writes
 * nothing. Re-asserts the arming itself when applying, so an internal caller
 * that skips the action gets the same refusal.
 */
export const clearBatch = internalMutation({
  args: { ids: v.array(v.id("cardChecklist")), apply: v.boolean() },
  returns: countsValidator,
  handler: async (ctx, args) => {
    if (args.apply && !deploymentIsArmed()) throw new ConvexError(NOT_ARMED_MESSAGE);
    if (args.ids.length > CLEAR_BATCH) {
      throw new ConvexError(`At most ${CLEAR_BATCH} cards are cleared at once.`);
    }
    const counts = { cardsPatched: 0, tidyReviewed: 0, tidyChecks: 0, chosenEntries: 0 };
    for (const id of args.ids) {
      const card = await ctx.db.get(id);
      if (!card) continue;
      const plan = planClear(card);
      if (!plan) continue;
      counts.cardsPatched += 1;
      counts.tidyReviewed += plan.tidyReviewed;
      counts.tidyChecks += plan.tidyChecks;
      counts.chosenEntries += plan.chosenEntries;
      // Only these fields: no `lastUpdated`, no title, no link rows.
      if (args.apply) await ctx.db.patch(id, plan.patch);
    }
    return counts;
  },
});

/**
 * Clear the stored review state. Dry run by default; see the header for the
 * operator commands.
 *
 * Loops pages until the table is walked or the time budget is spent, and returns
 * the cursor to resume from. Idempotent: a clean card is not counted, so a
 * second run reports zeros.
 */
export const run = internalAction({
  args: {
    confirm: v.optional(v.string()),
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    armed: v.boolean(),
    message: v.string(),
    complete: v.boolean(),
    cursor: v.optional(v.string()),
    scanned: v.number(),
    tidyReviewed: v.number(),
    tidyChecks: v.number(),
    chosenEntries: v.number(),
    rowsPatched: v.number(),
  }),
  handler: async (ctx, args) => {
    const intendsToWrite = args.confirm === CONFIRM_TOKEN;
    const refusedForFlag = intendsToWrite && !deploymentIsArmed();
    const armed = intendsToWrite && !refusedForFlag;
    const startedAt = Date.now();

    const totals = { scanned: 0, tidyReviewed: 0, tidyChecks: 0, chosenEntries: 0, rowsPatched: 0 };
    let cursor: string | null = args.cursor ?? null;
    let complete = false;
    for (;;) {
      const page: {
        ids: Array<Id<"cardChecklist">>;
        scanned: number;
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runQuery(internal.clearTidyReviewState.findCarriers, { cursor });
      totals.scanned += page.scanned;
      for (let at = 0; at < page.ids.length; at += CLEAR_BATCH) {
        const counts: {
          cardsPatched: number;
          tidyReviewed: number;
          tidyChecks: number;
          chosenEntries: number;
        } = await ctx.runMutation(internal.clearTidyReviewState.clearBatch, {
          ids: page.ids.slice(at, at + CLEAR_BATCH),
          apply: armed,
        });
        totals.tidyReviewed += counts.tidyReviewed;
        totals.tidyChecks += counts.tidyChecks;
        totals.chosenEntries += counts.chosenEntries;
        totals.rowsPatched += counts.cardsPatched;
      }
      cursor = page.continueCursor;
      if (page.isDone) {
        complete = true;
        break;
      }
      if (Date.now() - startedAt >= TIME_BUDGET_MS) break;
    }

    // One audit line: counts and flags only.
    console.log(
      JSON.stringify({ msg: "clear_tidy_review_state", armed, refusedForFlag, complete, ...totals }),
    );
    return {
      armed,
      message: refusedForFlag ? NOT_ARMED_MESSAGE : armed ? APPLIED_MESSAGE : DRY_RUN_MESSAGE,
      complete,
      ...(complete || cursor === null ? {} : { cursor }),
      ...totals,
    };
  },
});
