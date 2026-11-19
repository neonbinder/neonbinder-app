/**
 * NEO-535 — a card's listing title changed (`selectorOptions.updateCard`):
 * queue the card for eBay for every owner who holds it in a box and lists, so
 * the new title reaches eBay without anyone pressing Sync.
 *
 * Why: eBay holds back a card whose stored title is over its 80 characters
 * (`lib/ebayListing.ebayListingText`, problem `titleTooLong`) rather than cut
 * it. The fix is an operator shortening the title in the set builder, which
 * changes no copy, so nothing reached the listing outbox and the card waited
 * for a Sync press. The same goes for any retitle of a card already listed:
 * the eBay drain reads only queued cards outside a first run or a Sync press.
 *
 * Same shape as `setShapeMove.queueMovedCopyListings`, the other catalog edit
 * that reaches collectors' listings: the copies are found through
 * `collectionCopies.by_card`, an owner who lists nowhere costs one indexed
 * read, only a copy in a box (inventory) is for sale, and the card is queued
 * through `enqueueListingCards` (eBay only: the title is item content there;
 * BSC lists counts and never reads it). Enqueues only; the drain runs on its
 * usual triggers (the 15-minute cron, a Sync press). Paged, so a card many
 * collectors hold never makes the operator's save heavy: `updateCard` queues
 * inline when the card has at most one page of copies (one indexed read when
 * nobody holds it), and otherwise hands off to a scheduled, paged chain.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { HomeSides } from "./collection";
import { enqueueListingCards, listsAnywhere } from "./listingOutbox";

/** Copies of the card read per page. */
export const RETITLE_COPY_PAGE = 100;

/** Queue the card for eBay for each owner among `copies` who lists and holds one in a box. */
async function queueOwnersOf(
  ctx: MutationCtx,
  cardId: Id<"cardChecklist">,
  copies: ReadonlyArray<{ ownerId: string; homeId: Id<"collectionContainers"> }>,
): Promise<number> {
  const homesByOwner = new Map<string, Set<Id<"collectionContainers">>>();
  for (const copy of copies) {
    const homes = homesByOwner.get(copy.ownerId) ?? new Set();
    homes.add(copy.homeId);
    homesByOwner.set(copy.ownerId, homes);
  }
  let queued = 0;
  for (const [ownerId, homes] of homesByOwner) {
    if (!(await listsAnywhere(ctx, ownerId))) continue;
    const sides = new HomeSides(ctx, ownerId);
    let boxed = false;
    for (const homeId of homes) {
      if (await sides.is(homeId, "inventory")) {
        boxed = true;
        break;
      }
    }
    if (!boxed) continue;
    queued += await enqueueListingCards(ctx, { ownerId, cardIds: [cardId], platforms: ["ebay"] });
  }
  return queued;
}

/**
 * `updateCard`'s inline step. A card held by at most `RETITLE_COPY_PAGE`
 * copies (nearly every card) is queued here, in the save's transaction. A
 * card held by more hands the whole job to the paged `queueRetitledCard`
 * chain instead: `updateCard` may not spend its one `.paginate()` here, so
 * this reads with `take`, one past the page to tell the two apart. Returns
 * the rows written inline.
 */
export async function queueRetitledCardNow(
  ctx: MutationCtx,
  cardId: Id<"cardChecklist">,
): Promise<number> {
  const copies = await ctx.db
    .query("collectionCopies")
    .withIndex("by_card", (q) => q.eq("cardId", cardId))
    .take(RETITLE_COPY_PAGE + 1);
  if (copies.length > RETITLE_COPY_PAGE) {
    await ctx.scheduler.runAfter(0, internal.listingTitleRequeue.queueRetitledCard, { cardId });
    return 0;
  }
  return await queueOwnersOf(ctx, cardId, copies);
}

/**
 * One page of the card's copies (`queueOwnersOf`), scheduling the next page
 * while there is one. Started by `queueRetitledCardNow` for a card with more
 * copies than one page.
 */
export const queueRetitledCard = internalMutation({
  args: {
    cardId: v.id("cardChecklist"),
    /** The previous page's `continueCursor`; absent starts at the first copy. */
    cursor: v.optional(v.string()),
  },
  returns: v.object({ queued: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("collectionCopies")
      .withIndex("by_card", (q) => q.eq("cardId", args.cardId))
      .paginate({ numItems: RETITLE_COPY_PAGE, cursor: args.cursor ?? null });
    const queued = await queueOwnersOf(ctx, args.cardId, page.page);
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.listingTitleRequeue.queueRetitledCard, {
        cardId: args.cardId,
        cursor: page.continueCursor,
      });
    }
    return { queued, isDone: page.isDone };
  },
});
