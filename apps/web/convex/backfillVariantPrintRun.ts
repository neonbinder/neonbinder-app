/**
 * NEO-616 — fill and repair `selectorOptions.printRun` for rows from before
 * the field (`variantPrintRun.refreshVariantPrintRun` keeps it after).
 * Modelled on `cardCounts.backfillVariantCardCounts`; ships DISARMED.
 *
 * Walks `variantType`, then `insert`, then `parallel`, paging each, and for
 * every row recomputes the shared run from its own cards (`sharedPrintRun`,
 * the one rule). Per row:
 *
 *   filled     no run stored, cards share one: written;
 *   disagreed  a run stored that the cards no longer give (another run, or
 *              none): left alone unless `repair: true`, then written
 *              (`repaired`; a stale run is cleared);
 *   tooBig     more than `RECOUNT_MAX` cards: left alone, counted;
 *   (else)     nothing stored and nothing shared: steady, not counted.
 *
 * It writes no `lastUpdated`. Idempotent: a second run over a steady
 * deployment reports zero everywhere.
 *
 * ## Operator command
 *
 *   # 1. dry run: reports what an armed run would write, writes nothing
 *   npx convex run backfillVariantPrintRun:backfillVariantPrintRun '{}'
 *
 *   # 2. arm the deployment, run for real, disarm
 *   npx convex env set ALLOW_VARIANT_PRINT_RUN_BACKFILL 1
 *   npx convex run backfillVariantPrintRun:backfillVariantPrintRun '{"confirm":"BACKFILL"}'
 *   npx convex env remove ALLOW_VARIANT_PRINT_RUN_BACKFILL
 *
 *   # Re-run until "complete": true; pass the returned `cursor` back to
 *   # resume. Add "repair": true to also rewrite a run that disagrees with
 *   # the cards. Never a public function.
 */
import { ConvexError, v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { CARD_BEARING_LEVELS, parseResumeCursor } from "./cardCounts";
import { readRowPrintRun } from "./variantPrintRun";

const CONFIRM_TOKEN = "BACKFILL";
const ENV_FLAG = "ALLOW_VARIANT_PRINT_RUN_BACKFILL";

function deploymentIsArmed(): boolean {
  const value = process.env[ENV_FLAG];
  return value === "1" || value === "true";
}

/** Rows read per page. */
const ROWS_PER_PAGE = 100;
/**
 * Cards read per page, across its rows. A page stops after the row that
 * crosses this; the next page resumes after that row.
 */
const CARDS_READ_PER_PAGE = 3_000;
/** A call stops after the first page that lands past this; re-run to resume. */
const TIME_BUDGET_MS = 150_000;

const NOT_ARMED_MESSAGE =
  `Refused: this deployment is not armed for the backfill. ` +
  `Set ${ENV_FLAG}=1 on it (npx convex env set ${ENV_FLAG} 1), re-run, and ` +
  `remove the flag afterwards. Nothing was written; the counts below are what ` +
  `an armed run would have done.`;
const APPLIED_MESSAGE = "Applied. Re-run to confirm the steady state.";
const DRY_RUN_MESSAGE =
  `Dry run — nothing written. Arm with ${ENV_FLAG}=1 on the deployment and ` +
  `re-run with {"confirm":"${CONFIRM_TOKEN}"} to apply.`;

const pageResultValidator = v.object({
  scanned: v.number(),
  filled: v.number(),
  repaired: v.number(),
  disagreed: v.number(),
  tooBig: v.number(),
  cardsRead: v.number(),
  /**
   * Set when the page stopped on the card budget before its last row: call
   * again with the SAME cursor and `skip` = this.
   */
  resumeSkip: v.optional(v.number()),
  isDone: v.boolean(),
  continueCursor: v.string(),
});

/**
 * One page of one level. `apply: false` computes the same answer and writes
 * nothing; `apply: true` on a deployment that is not armed throws.
 */
export const backfillVariantPrintRunPage = internalMutation({
  args: {
    level: v.union(v.literal("variantType"), v.literal("insert"), v.literal("parallel")),
    cursor: v.union(v.string(), v.null()),
    /** Rows at the head of this page already handled by an earlier call. */
    skip: v.optional(v.number()),
    apply: v.boolean(),
    repair: v.boolean(),
    numItems: v.optional(v.number()),
  },
  returns: pageResultValidator,
  handler: async (ctx, args) => {
    if (args.apply && !deploymentIsArmed()) {
      throw new ConvexError(NOT_ARMED_MESSAGE);
    }
    const numItems = Math.max(1, Math.min(args.numItems ?? ROWS_PER_PAGE, ROWS_PER_PAGE));
    const page = await ctx.db
      .query("selectorOptions")
      .withIndex("by_level", (q) => q.eq("level", args.level))
      .paginate({ cursor: args.cursor, numItems });

    let filled = 0;
    let repaired = 0;
    let disagreed = 0;
    let tooBig = 0;
    let cardsRead = 0;
    let scanned = 0;
    let resumeSkip: number | undefined;
    const skip = Math.max(0, Math.floor(args.skip ?? 0));
    for (let i = skip; i < page.page.length; i++) {
      // Checked BETWEEN rows, and the first row is always attempted, so a
      // page always advances.
      if (i > skip && cardsRead >= CARDS_READ_PER_PAGE) {
        resumeSkip = i;
        break;
      }
      const row = page.page[i];
      scanned++;
      const read = await readRowPrintRun(ctx, row._id);
      if (read.kind === "tooBig") {
        tooBig++;
        continue;
      }
      cardsRead += read.cards;
      if (row.printRun === read.printRun) continue;
      if (row.printRun === undefined) {
        filled++;
        if (args.apply) await ctx.db.patch(row._id, { printRun: read.printRun });
      } else {
        disagreed++;
        if (args.repair) {
          repaired++;
          if (args.apply) await ctx.db.patch(row._id, { printRun: read.printRun });
        }
      }
    }
    return {
      scanned,
      filled,
      repaired,
      disagreed,
      tooBig,
      cardsRead,
      ...(resumeSkip !== undefined ? { resumeSkip } : {}),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

/**
 * The loop. Dry run by default; `confirm: "BACKFILL"` applies, and only on a
 * deployment armed with `ALLOW_VARIANT_PRINT_RUN_BACKFILL` (otherwise it runs
 * as a dry run and says so). The returned `cursor` is
 * `<level>:<skip>:<page cursor>` and resumes exactly there.
 */
export const backfillVariantPrintRun = internalAction({
  args: {
    confirm: v.optional(v.string()),
    cursor: v.optional(v.string()),
    repair: v.optional(v.literal(true)),
    /** Lowers the rows per page; for tests. */
    numItems: v.optional(v.number()),
  },
  returns: v.object({
    armed: v.boolean(),
    message: v.string(),
    complete: v.boolean(),
    cursor: v.optional(v.string()),
    scanned: v.number(),
    filled: v.number(),
    repaired: v.number(),
    disagreed: v.number(),
    tooBig: v.number(),
  }),
  handler: async (ctx, args) => {
    const intendsToWrite = args.confirm === CONFIRM_TOKEN;
    const refusedForFlag = intendsToWrite && !deploymentIsArmed();
    const armed = intendsToWrite && !refusedForFlag;
    const repair = args.repair === true;
    const startedAt = Date.now();

    let levelIndex = 0;
    let cursor: string | null = null;
    let skip = 0;
    if (args.cursor) {
      const parsed = parseResumeCursor(args.cursor);
      levelIndex = parsed.levelIndex;
      skip = parsed.skip;
      cursor = parsed.cursor;
    }

    const totals = { scanned: 0, filled: 0, repaired: 0, disagreed: 0, tooBig: 0 };
    let complete = false;
    for (;;) {
      if (levelIndex >= CARD_BEARING_LEVELS.length) {
        complete = true;
        break;
      }
      const level = CARD_BEARING_LEVELS[levelIndex];
      const page: {
        scanned: number;
        filled: number;
        repaired: number;
        disagreed: number;
        tooBig: number;
        cardsRead: number;
        resumeSkip?: number;
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runMutation(internal.backfillVariantPrintRun.backfillVariantPrintRunPage, {
        level,
        cursor,
        ...(skip > 0 ? { skip } : {}),
        apply: armed,
        repair,
        ...(args.numItems !== undefined ? { numItems: args.numItems } : {}),
      });
      totals.scanned += page.scanned;
      totals.filled += page.filled;
      totals.repaired += page.repaired;
      totals.disagreed += page.disagreed;
      totals.tooBig += page.tooBig;
      if (page.resumeSkip !== undefined) {
        skip = page.resumeSkip;
      } else if (page.isDone) {
        levelIndex += 1;
        cursor = null;
        skip = 0;
      } else {
        cursor = page.continueCursor;
        skip = 0;
      }
      if (Date.now() - startedAt >= TIME_BUDGET_MS) break;
    }

    // One audit line: counts and flags only.
    console.log(
      JSON.stringify({
        msg: "backfill_variant_print_run",
        armed,
        refusedForFlag,
        repair,
        complete,
        ...totals,
      }),
    );

    const resumeAt =
      complete || levelIndex >= CARD_BEARING_LEVELS.length
        ? undefined
        : `${CARD_BEARING_LEVELS[levelIndex]}:${skip}:${cursor ?? ""}`;
    return {
      armed,
      message: refusedForFlag ? NOT_ARMED_MESSAGE : armed ? APPLIED_MESSAGE : DRY_RUN_MESSAGE,
      complete,
      ...(resumeAt !== undefined ? { cursor: resumeAt } : {}),
      ...totals,
    };
  },
});
