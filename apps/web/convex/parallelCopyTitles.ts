/**
 * NEO-535 — the Card titles dialog for a PARALLEL's cards.
 *
 * A parallel build copies its source's cards and titles each copy in Jason's
 * order (`features/carriedTitle`): the builder's own title, else the source's
 * hand edit re-headed, else the builder's flagged result. The cards left in
 * that last bucket are this dialog's: over 80 after every cut, or short a
 * first name (`storedTitleFails`). The build only counts them
 * (`titlesToFix`); this module lists and fixes them.
 *
 * ## Three functions
 *
 *   - `failingTitles` (query) — one page of the parallel's cards, the failing
 *     ones with what the client needs to redraw a title as the operator edits
 *     the box. Called ONE-SHOT (`useConvex().query`), never subscribed: a
 *     parallel can hold thousands of cards (CLAUDE.md, "a subscribed query
 *     stays small").
 *   - `saveTitleFixes` (mutation) — the operator's answers for at most
 *     `MAX_TITLE_FIXES` cards, plus the box ("Set name in titles") written to
 *     the parallel row itself.
 *   - `rewriteFailingTitlesPage` (internal) — when the box changed, the
 *     parallel's other failing cards are rewritten with it, a page at a time.
 *
 * ## Safe to call
 *
 * Both public functions are admin-only and refuse a row that does not resolve
 * as a buildable parallel (`resolveBuildSource`), so they can never touch a
 * base or insert checklist. A card that is not on the parallel, or no longer
 * fails, is skipped and counted, never written. Errors carry lengths and caps,
 * never the operator's text. Only a title that actually changed queues the
 * card for eBay (`queueRetitledCardNow`).
 */

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin } from "./auth";
import { parallelSetContext, resolveBuildSource } from "./parallelChecklistBuild";
import {
  listingInputsForStoredCard,
  newStoredCardLookupCache,
  type StoredCardLookupCache,
} from "./storedCardTitle";
import {
  assessParallelCopyTitle,
  carriedTitleRest,
  storedTitleFails,
  type ParallelCopyTitle,
} from "./features/carriedTitle";
import { LISTING_TITLE_KEPT_MAX, setDescriptionForTitles } from "./features/listingInputs";
import { LISTING_TITLE_MAX } from "./features/listingLimits";
import { normalizeListingShortName } from "./listingShortName";
import { queueRetitledCardNow } from "./listingTitleRequeue";
import type { ListingCardInputs } from "./features/generateListing";

/** Cards one `failingTitles` call reads. */
export const FAILING_TITLES_SCAN = 300;
/** Failing cards one `failingTitles` call returns, and one save may answer. */
export const MAX_TITLE_FIXES = 50;
/** Cards one `rewriteFailingTitlesPage` run reads. */
export const REWRITE_TITLES_PAGE = 200;
/** Source cards sharing one number read when looking for a copy's source. */
const SOURCE_NUMBER_MATCHES = 20;

const GONE = "That parallel is gone. Refresh and try again.";

/** The generator inputs as the client re-assesses them (same shape `previewListingTitle` returns). */
const listingInputsValidator = v.object({
  cardNumber: v.string(),
  playerNames: v.array(v.string()),
  year: v.optional(v.string()),
  manufacturer: v.optional(v.string()),
  manufacturerBrandUnknown: v.optional(v.boolean()),
  setName: v.optional(v.string()),
  insertName: v.optional(v.string()),
  setShortName: v.optional(v.string()),
  parallelName: v.optional(v.string()),
  parallelIsRole: v.optional(v.boolean()),
  isRookie: v.optional(v.boolean()),
  isRelic: v.optional(v.boolean()),
  autographed: v.optional(v.string()),
  shortPrint: v.optional(v.string()),
  printRun: v.optional(v.number()),
  cardVariation: v.optional(v.string()),
  teamNames: v.array(v.string()),
  sport: v.optional(v.string()),
});

/** The parallel row, when it resolves as a buildable parallel; throws otherwise. */
async function requireBuildableParallel(
  ctx: { db: QueryCtx["db"] },
  parallelId: Id<"selectorOptions">,
): Promise<{ parallel: Doc<"selectorOptions">; source: Doc<"selectorOptions"> }> {
  const parallel = await ctx.db.get(parallelId);
  if (!parallel) throw new ConvexError(GONE);
  const resolved = await resolveBuildSource(ctx, parallel);
  if (resolved.status === "notBuildable") throw new ConvexError(resolved.message);
  if (resolved.status === "blocked") throw new ConvexError(resolved.blockedReason);
  return { parallel, source: resolved.source };
}

/**
 * The copy's source card on the source row: the one card with the same
 * number AND the same name. Card numbers are not unique (product invariant
 * 7), so anything but exactly one match is no source.
 */
async function sourceCardOf(
  ctx: { db: QueryCtx["db"] },
  sourceRowId: Id<"selectorOptions">,
  card: Doc<"cardChecklist">,
): Promise<Doc<"cardChecklist"> | undefined> {
  const sameNumber = await ctx.db
    .query("cardChecklist")
    .withIndex("by_selector_option_and_number", (q) =>
      q.eq("selectorOptionId", sourceRowId).eq("cardNumber", card.cardNumber),
    )
    .take(SOURCE_NUMBER_MATCHES + 1);
  if (sameNumber.length > SOURCE_NUMBER_MATCHES) return undefined;
  const matches = sameNumber.filter((c) => c.cardName === card.cardName);
  return matches.length === 1 ? matches[0] : undefined;
}

/** A stored copy's inputs today, and its source's carried rest when there is one. */
async function copyTitleInputs(
  ctx: { db: QueryCtx["db"] },
  sourceRowId: Id<"selectorOptions">,
  card: Doc<"cardChecklist">,
  cache: StoredCardLookupCache,
): Promise<{ inputs: ListingCardInputs & { playerNames: string[]; teamNames: string[] }; carriedRest?: string }> {
  const { inputs } = await listingInputsForStoredCard(ctx, card, cache);
  const source = await sourceCardOf(ctx, sourceRowId, card);
  if (!source) return { inputs };
  const { inputs: sourceInputs } = await listingInputsForStoredCard(ctx, source, cache);
  const carriedRest = carriedTitleRest({
    sourceTitle: source.listingTitle,
    sourceFlagged: storedTitleFails(source),
    sourceInputs,
  });
  return carriedRest === undefined ? { inputs } : { inputs, carriedRest };
}

/** What a stored copy's title comes to today, in the three-step order. */
async function copyTitleNow(
  ctx: { db: QueryCtx["db"] },
  sourceRowId: Id<"selectorOptions">,
  card: Doc<"cardChecklist">,
  cache: StoredCardLookupCache,
): Promise<ParallelCopyTitle> {
  const { inputs, carriedRest } = await copyTitleInputs(ctx, sourceRowId, card, cache);
  return assessParallelCopyTitle(inputs, carriedRest);
}

/**
 * The cut-short flag a rewritten copy is stored with: as the build would
 * write it. A carried edit is the operator's own words; a fit with full names
 * (the box's included) is not cut short; a failing title is flagged when it
 * lost a first name or came from the box (an over-cap title is flagged by its
 * length instead).
 */
function truncatedFlagFor(outcome: ParallelCopyTitle): true | undefined {
  return outcome.failing && !outcome.coreFits ? true : undefined;
}

export const failingTitles = query({
  args: {
    parallelId: v.id("selectorOptions"),
    /** The previous call's `cursor`; absent starts at the first card. */
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    parallel: v.object({ _id: v.id("selectorOptions"), value: v.string() }),
    /** What the "Set name in titles" box opens with: the stored box text, else the builder's description. */
    boxPrefill: v.string(),
    /** The page's failing cards, at most `MAX_TITLE_FIXES`, in checklist order. */
    cards: v.array(
      v.object({
        cardId: v.id("cardChecklist"),
        cardNumber: v.string(),
        cardName: v.string(),
        title: v.string(),
        inputs: listingInputsValidator,
        /** The source's hand edit to re-head when the box changes (`carriedTitleRest`). */
        carriedRest: v.optional(v.string()),
      }),
    ),
    /** Failing cards on this page, including any past the `cards` cap. */
    failingInPage: v.number(),
    /** Pass back for the next page; null when this was the last. */
    cursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const { parallel, source } = await requireBuildableParallel(ctx, args.parallelId);
    const set = await parallelSetContext(ctx, parallel);
    const boxPrefill = set.listingShortName?.trim() || setDescriptionForTitles(set);

    const page = await ctx.db
      .query("cardChecklist")
      .withIndex("by_selector_option_and_sort", (q) =>
        q.eq("selectorOptionId", args.parallelId),
      )
      .paginate({ numItems: FAILING_TITLES_SCAN, cursor: args.cursor ?? null });
    const failing = page.page.filter(storedTitleFails);
    const cache = newStoredCardLookupCache();
    const cards = [];
    for (const card of failing.slice(0, MAX_TITLE_FIXES)) {
      const { inputs, carriedRest } = await copyTitleInputs(ctx, source._id, card, cache);
      cards.push({
        cardId: card._id,
        cardNumber: card.cardNumber,
        cardName: card.cardName,
        title: card.listingTitle,
        inputs,
        ...(carriedRest !== undefined ? { carriedRest } : {}),
      });
    }
    return {
      parallel: { _id: parallel._id, value: parallel.value },
      boxPrefill,
      cards,
      failingInPage: failing.length,
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});

/** An operator's own title: trimmed, one line, not blank, within eBay's cap. */
function checkOwnTitle(raw: string): string {
  const title = raw.trim();
  if (!title) throw new ConvexError("Card titles: a title can't be blank.");
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(title)) {
    throw new ConvexError("Card titles: a title is one line, with no control characters.");
  }
  if (title.length > LISTING_TITLE_MAX) {
    throw new ConvexError(
      `Card titles: a title is ${title.length} characters; the limit is ${LISTING_TITLE_MAX}.`,
    );
  }
  return title;
}

async function writeTitle(
  ctx: MutationCtx,
  card: Doc<"cardChecklist">,
  title: string,
  truncated: true | undefined,
): Promise<void> {
  await ctx.db.patch(card._id, {
    listingTitle: title,
    listingTitleTruncated: truncated,
    lastUpdated: Date.now(),
  });
  // A new title is new eBay item content (and the way out of an over-80 hold).
  if (title !== card.listingTitle) await queueRetitledCardNow(ctx, card._id);
}

export const saveTitleFixes = mutation({
  args: {
    parallelId: v.id("selectorOptions"),
    /**
     * The "Set name in titles" box, sent only when the operator edited it:
     * written to the PARALLEL row's `metadata.listingShortName`, and the
     * parallel's other failing cards are rewritten with it.
     */
    listingShortName: v.optional(v.string()),
    cards: v.array(
      v.object({
        cardId: v.id("cardChecklist"),
        /** The operator's own title. */
        listingTitle: v.optional(v.string()),
        /** The title the dialog showed and the operator kept. */
        kept: v.optional(v.string()),
      }),
    ),
  },
  returns: v.object({
    /** Cards given the operator's own title. */
    saved: v.number(),
    /** Cards rewritten to the box-built title the operator saw and kept. */
    rewritten: v.number(),
    /** Cards kept as they stood; their cut-short flag is cleared. */
    kept: v.number(),
    /** Cards not on this parallel, no longer failing, or changed since they were shown. */
    skipped: v.number(),
    /** Cards kept over 80: still too long to list. */
    stillFailing: v.number(),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (args.cards.length > MAX_TITLE_FIXES) {
      throw new ConvexError(
        `Card titles: ${args.cards.length} cards sent; the limit is ${MAX_TITLE_FIXES}.`,
      );
    }
    // Every answer is checked before anything is written.
    type Answer =
      | { cardId: Id<"cardChecklist">; own: string }
      | { cardId: Id<"cardChecklist">; kept: string | undefined };
    const answers = args.cards.map((answer): Answer => {
      if (answer.listingTitle !== undefined) {
        return { cardId: answer.cardId, own: checkOwnTitle(answer.listingTitle) };
      }
      const kept = answer.kept?.trim();
      if (kept !== undefined && kept.length > LISTING_TITLE_KEPT_MAX) {
        throw new ConvexError(
          `Card titles: a kept title is ${kept.length} characters; the limit is ${LISTING_TITLE_KEPT_MAX}.`,
        );
      }
      return { cardId: answer.cardId, kept: kept || undefined };
    });
    const box =
      args.listingShortName === undefined
        ? undefined
        : normalizeListingShortName(args.listingShortName);

    const { parallel, source } = await requireBuildableParallel(ctx, args.parallelId);
    const boxChanged = box !== undefined && box !== parallel.metadata?.listingShortName;
    if (boxChanged) {
      await ctx.db.patch(parallel._id, {
        metadata: { ...(parallel.metadata ?? {}), listingShortName: box },
        lastUpdated: Date.now(),
      });
    }

    const cache = newStoredCardLookupCache();
    let saved = 0;
    let rewritten = 0;
    let kept = 0;
    let skipped = 0;
    let stillFailing = 0;
    for (const answer of answers) {
      const card = await ctx.db.get(answer.cardId);
      if (!card || card.selectorOptionId !== parallel._id || !storedTitleFails(card)) {
        skipped++;
        continue;
      }
      if ("own" in answer) {
        await writeTitle(ctx, card, answer.own, undefined);
        saved++;
        continue;
      }
      if (answer.kept === undefined) {
        skipped++;
        continue;
      }
      if (answer.kept === card.listingTitle) {
        // Kept as it stands: the first-name question is answered. A title
        // over the cap stays flagged by its length.
        if (card.listingTitleTruncated) {
          await ctx.db.patch(card._id, { listingTitleTruncated: undefined, lastUpdated: Date.now() });
        }
        if (answer.kept.length > LISTING_TITLE_MAX) stillFailing++;
        else kept++;
        continue;
      }
      // The dialog showed a title built with the new box. Written only when
      // the server, reading the box just stored, comes to exactly that text:
      // anything else is a title nobody saw.
      if (boxChanged) {
        const now = await copyTitleNow(ctx, source._id, card, cache);
        if (now.title === answer.kept) {
          await writeTitle(ctx, card, now.title, undefined);
          rewritten++;
          if (now.title.length > LISTING_TITLE_MAX) stillFailing++;
          continue;
        }
      }
      skipped++;
    }

    if (boxChanged) {
      await ctx.scheduler.runAfter(0, internal.parallelCopyTitles.rewriteFailingTitlesPage, {
        parallelId: parallel._id,
        box,
      });
    }
    // Counts only, never a title.
    console.log(
      JSON.stringify({
        msg: "parallel_titles_saved",
        parallelId: parallel._id,
        boxChanged,
        saved,
        rewritten,
        kept,
        skipped,
        stillFailing,
      }),
    );
    return { saved, rewritten, kept, skipped, stillFailing };
  },
});

/**
 * One page of the parallel's cards, after the box changed: each card that
 * still fails is retitled in the three-step order with the new box. A title
 * that comes out the same is left alone, so a rerun writes nothing. Stops as
 * soon as the parallel's box is no longer the one this chain started with (a
 * newer save started its own chain), or the row no longer resolves.
 */
export const rewriteFailingTitlesPage = internalMutation({
  args: {
    parallelId: v.id("selectorOptions"),
    /** The box text this chain writes with. */
    box: v.string(),
    cursor: v.optional(v.string()),
  },
  returns: v.object({ rewritten: v.number(), stopped: v.boolean(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const parallel = await ctx.db.get(args.parallelId);
    if (!parallel || parallel.metadata?.listingShortName !== args.box) {
      return { rewritten: 0, stopped: true, isDone: true };
    }
    const resolved = await resolveBuildSource(ctx, parallel);
    if (resolved.status !== "ok") return { rewritten: 0, stopped: true, isDone: true };

    const page = await ctx.db
      .query("cardChecklist")
      .withIndex("by_selector_option_and_sort", (q) =>
        q.eq("selectorOptionId", args.parallelId),
      )
      .paginate({ numItems: REWRITE_TITLES_PAGE, cursor: args.cursor ?? null });
    const cache = newStoredCardLookupCache();
    let rewritten = 0;
    for (const card of page.page) {
      if (!storedTitleFails(card)) continue;
      const now = await copyTitleNow(ctx, resolved.source._id, card, cache);
      if (now.title === card.listingTitle) continue;
      await writeTitle(ctx, card, now.title, truncatedFlagFor(now));
      rewritten++;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.parallelCopyTitles.rewriteFailingTitlesPage, {
        parallelId: args.parallelId,
        box: args.box,
        cursor: page.continueCursor,
      });
    }
    console.log(
      JSON.stringify({
        msg: "parallel_titles_rewritten",
        parallelId: args.parallelId,
        rewritten,
        isDone: page.isDone,
      }),
    );
    return { rewritten, stopped: false, isDone: page.isDone };
  },
});
