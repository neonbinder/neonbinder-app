/**
 * NEO-535 — backfill: give every stored card the listing description the
 * generator writes today (`generateListingDescription`), so the collector's
 * card search (`collectionCatalog.search`, index `search_listing_description`)
 * finds it.
 *
 * The search moved from the title to the description in NEO-535: the title is
 * cut to fit eBay's 80 characters, the description keeps every fact NB knows
 * in long and short forms ("Rookie Card (RC)", `/99`, `#16`). A card written
 * before the new generator carries an older description (or none), which the
 * search may not match; a card with none is not in the index at all.
 *
 * ## Operator commands
 *
 *   # 1. dry run — reports what an armed run would do, writes nothing
 *   npx convex run backfillListingDescriptions:run '{}'
 *
 *   # 2. arm the deployment, run for real, disarm
 *   npx convex env set ALLOW_CARD_DESCRIPTION_BACKFILL 1
 *   npx convex run backfillListingDescriptions:run '{"confirm":"BACKFILL"}'
 *   #    a run stops after ~150 s with `continueCursor`; resume with
 *   npx convex run backfillListingDescriptions:run '{"confirm":"BACKFILL","cursor":"<continueCursor>"}'
 *   npx convex env remove ALLOW_CARD_DESCRIPTION_BACKFILL
 *
 *   # 3. confirm the steady state: a dry run reports filled 0, rewritten 0
 *   npx convex run backfillListingDescriptions:run '{}'
 *
 *   # only fill cards with no description, leave every existing one as it is
 *   npx convex run backfillListingDescriptions:run '{"confirm":"BACKFILL","onlyMissing":true}'
 *
 *   # production: the same commands with --prod
 *
 * Two independent arms, the project rule for a scripted admin write (see
 * `backfillBrandUnknownRole.ts`): `confirm: "BACKFILL"` per invocation, and
 * the `ALLOW_CARD_DESCRIPTION_BACKFILL` flag per deployment. Dry run is the
 * default. An armed invocation on an unarmed deployment is REFUSED, not
 * thrown: the action returns the dry-run report with the refusal message, and
 * the page mutation re-checks both arms itself, so calling it directly cannot
 * write either. No `--identity`: internal functions, the deploy credential is
 * the gate.
 *
 * ## What it writes, and what it never touches
 *
 * Only `listingDescription`. Never `listingTitle`, `listingTitleTruncated`
 * or `lastUpdated`: the description is derived from data the card already
 * holds, so nothing about the card changed, and a `lastUpdated` bump across
 * every card would read as a mass edit. It does not queue any listing
 * (`listingOutbox`): pushing the new text to eBay is out of scope (NEO-535
 * decision 3); the next push of each card carries it.
 *
 * Inputs come from `listingInputsForStoredCard`, the same reading Regenerate's
 * title uses, so a card the commit path just wrote reports `unchanged`. Each
 * page shares one lookup cache, so a variant's chain is walked once and each
 * player and team read once.
 *
 * Per card (`planDescription`):
 *   - `unchanged`: the stored description is already what the generator says.
 *   - `filled`: none stored (absent or blank); written. A card with a dangling
 *     player or team id, or a missing row, is still filled from what does
 *     resolve: a card with no description cannot be found at all.
 *   - `rewritten`: a different description is stored; replaced.
 *   - `skippedUnresolved`: a description is stored and the card has a
 *     dangling player or team id or its row is gone. Kept: rewriting from
 *     partial data would drop facts the stored text may still carry.
 *   - `keptExisting` (`onlyMissing` runs only): a different description is
 *     stored and the run was asked to fill missing ones only. Kept.
 *
 * Idempotent: the generator is pure and deterministic, so a second run reports
 * every card `unchanged` (or `skippedUnresolved`) and writes nothing.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { generateListingDescription } from "./features/generateListing";
import {
  listingInputsForStoredCard,
  newStoredCardLookupCache,
  type StoredCardLookupCache,
} from "./storedCardTitle";

/** The string an armed run must carry. */
export const CONFIRM_TOKEN = "BACKFILL";

/** The deployment-level arm. Absent, an armed invocation is refused. */
export const ENV_FLAG = "ALLOW_CARD_DESCRIPTION_BACKFILL";

/** Cards per page mutation (the most `numItems` may ask for). */
export const CARDS_PER_PAGE = 200;

/** The action stops starting new pages after this long and hands back a cursor. */
export const RUN_BUDGET_MS = 150_000;

/** Sample cards reported per run. Counts are always exact. */
export const MAX_SAMPLES = 5;

function deploymentIsArmed(): boolean {
  const value = process.env[ENV_FLAG];
  return value === "1" || value === "true";
}

const NOT_ARMED_MESSAGE =
  `Refused: this deployment is not armed for the description backfill. ` +
  `Set ${ENV_FLAG}=1 on it (npx convex env set ${ENV_FLAG} 1), re-run, and ` +
  `remove the flag afterwards. Nothing was written; the report below is what ` +
  `an armed run would have done.`;

const APPLIED_MESSAGE = "Applied. Re-run as a dry run to confirm the steady state.";

const DRY_RUN_MESSAGE =
  `Dry run — nothing written. Arm with ${ENV_FLAG}=1 on the deployment and ` +
  `re-run with {"confirm":"${CONFIRM_TOKEN}"} to apply.`;

const UNFINISHED_NOTE =
  " Stopped before the end of the table (time budget or maxPages): resume with the returned continueCursor.";

export type DescriptionAction = "filled" | "rewritten" | "unchanged" | "skippedUnresolved" | "keptExisting";

export type DescriptionPlan = {
  action: DescriptionAction;
  /** The generator's description; written only for `filled` / `rewritten`. */
  next: string;
};

/**
 * ONE planner, shared by the dry run and the armed run, so they can only
 * differ in whether the write is applied.
 */
export async function planDescription(
  ctx: { db: QueryCtx["db"] },
  card: Doc<"cardChecklist">,
  cache: StoredCardLookupCache,
  options: { onlyMissing?: boolean } = {},
): Promise<DescriptionPlan> {
  const { inputs, unresolved } = await listingInputsForStoredCard(ctx, card, cache);
  const next = generateListingDescription(inputs);
  const stored = card.listingDescription;
  const hasStored = stored !== undefined && stored.trim().length > 0;
  if (stored === next) return { action: "unchanged", next };
  if (!hasStored) return { action: "filled", next };
  if (options.onlyMissing) return { action: "keptExisting", next };
  const isUnresolved = unresolved.players > 0 || unresolved.teams > 0 || unresolved.parent;
  if (isUnresolved) return { action: "skippedUnresolved", next };
  return { action: "rewritten", next };
}

const countsValidator = v.object({
  scanned: v.number(),
  filled: v.number(),
  rewritten: v.number(),
  unchanged: v.number(),
  skippedUnresolved: v.number(),
  keptExisting: v.number(),
});
type Counts = {
  scanned: number;
  filled: number;
  rewritten: number;
  unchanged: number;
  skippedUnresolved: number;
  keptExisting: number;
};

const sampleValidator = v.object({
  cardId: v.id("cardChecklist"),
  action: v.union(v.literal("filled"), v.literal("rewritten"), v.literal("skippedUnresolved")),
  /** The description the generator writes (on a dry run: would write). */
  description: v.string(),
});
type Sample = {
  cardId: Id<"cardChecklist">;
  action: "filled" | "rewritten" | "skippedUnresolved";
  description: string;
};

function emptyCounts(): Counts {
  return { scanned: 0, filled: 0, rewritten: 0, unchanged: 0, skippedUnresolved: 0, keptExisting: 0 };
}

/**
 * One page of cards in `by_selector_option_and_sort` order, so a page is
 * mostly one variant's cards and the shared cache walks its chain once.
 * Writes only when BOTH arms are present; otherwise reports.
 */
export const backfillListingDescriptionsPage = internalMutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    confirm: v.optional(v.string()),
    /** Cards to read, 1..`CARDS_PER_PAGE` (default the max). */
    numItems: v.optional(v.number()),
    onlyMissing: v.optional(v.boolean()),
  },
  returns: v.object({
    armed: v.boolean(),
    counts: countsValidator,
    samples: v.array(sampleValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const armed = args.confirm === CONFIRM_TOKEN && deploymentIsArmed();
    const requested = Number.isFinite(args.numItems) ? Math.floor(args.numItems as number) : CARDS_PER_PAGE;
    const numItems = Math.max(1, Math.min(CARDS_PER_PAGE, requested));
    const page = await ctx.db
      .query("cardChecklist")
      .withIndex("by_selector_option_and_sort")
      .paginate({ numItems, cursor: args.cursor });

    const cache = newStoredCardLookupCache();
    const counts = emptyCounts();
    const samples: Sample[] = [];
    for (const card of page.page) {
      counts.scanned += 1;
      const plan = await planDescription(ctx, card, cache, { onlyMissing: args.onlyMissing });
      counts[plan.action] += 1;
      if (plan.action === "unchanged" || plan.action === "keptExisting") continue;
      if (samples.length < MAX_SAMPLES) {
        samples.push({ cardId: card._id, action: plan.action, description: plan.next });
      }
      if (armed && (plan.action === "filled" || plan.action === "rewritten")) {
        // ONLY the description: never `lastUpdated`, `listingTitle` or
        // `listingTitleTruncated` (see the header).
        await ctx.db.patch(card._id, { listingDescription: plan.next });
      }
    }
    return {
      armed,
      counts,
      samples,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const run = internalAction({
  args: {
    /** `"BACKFILL"` states the intent to write; anything else is a dry run. */
    confirm: v.optional(v.string()),
    /** A previous run's `continueCursor`; absent starts at the first card. */
    cursor: v.optional(v.string()),
    /** Cards per page, 1..`CARDS_PER_PAGE`. */
    numItems: v.optional(v.number()),
    /** Fill cards with no description only; every stored one is left as it is. */
    onlyMissing: v.optional(v.boolean()),
    /** Stop after this many pages (and hand back the cursor); default no cap but the time budget. */
    maxPages: v.optional(v.number()),
  },
  returns: v.object({
    armed: v.boolean(),
    message: v.string(),
    pages: v.number(),
    isDone: v.boolean(),
    continueCursor: v.optional(v.string()),
    counts: countsValidator,
    /** Up to `MAX_SAMPLES` cards the run wrote (or would write) or kept. */
    samples: v.array(sampleValidator),
  }),
  handler: async (ctx, args) => {
    const intendsToWrite = args.confirm === CONFIRM_TOKEN;
    const refusedForFlag = intendsToWrite && !deploymentIsArmed();
    const startedAt = Date.now();
    const totals = emptyCounts();
    const samples: Sample[] = [];
    let cursor: string | null = args.cursor ?? null;
    let pages = 0;
    let isDone = false;
    let armed = false;
    const maxPages =
      args.maxPages !== undefined && Number.isFinite(args.maxPages)
        ? Math.max(1, Math.floor(args.maxPages))
        : Number.POSITIVE_INFINITY;
    for (;;) {
      const page: {
        armed: boolean;
        counts: Counts;
        samples: Sample[];
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runMutation(internal.backfillListingDescriptions.backfillListingDescriptionsPage, {
        cursor,
        // A refused run never hands the token on: the page is a dry run.
        ...(intendsToWrite && !refusedForFlag ? { confirm: CONFIRM_TOKEN } : {}),
        ...(args.numItems !== undefined ? { numItems: args.numItems } : {}),
        ...(args.onlyMissing ? { onlyMissing: true } : {}),
      });
      pages += 1;
      armed = armed || page.armed;
      for (const key of Object.keys(totals) as Array<keyof Counts>) totals[key] += page.counts[key];
      for (const sample of page.samples) if (samples.length < MAX_SAMPLES) samples.push(sample);
      cursor = page.continueCursor;
      if (page.isDone) {
        isDone = true;
        break;
      }
      if (pages >= maxPages || Date.now() - startedAt >= RUN_BUDGET_MS) break;
    }

    // ONE audit line: counts and flags only, never card text.
    console.log(
      JSON.stringify({
        msg: "backfill_listing_descriptions",
        armed,
        refusedForFlag,
        onlyMissing: args.onlyMissing === true,
        resumed: args.cursor !== undefined,
        pages,
        isDone,
        ...totals,
      }),
    );

    const base = refusedForFlag ? NOT_ARMED_MESSAGE : armed ? APPLIED_MESSAGE : DRY_RUN_MESSAGE;
    return {
      armed,
      message: isDone ? base : base + UNFINISHED_NOTE,
      pages,
      isDone,
      ...(!isDone && cursor !== null ? { continueCursor: cursor } : {}),
      counts: totals,
      samples,
    };
  },
});
