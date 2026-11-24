/**
 * NEO-645 T4 — the walk's listing title and description, rebuilt on every write.
 *
 * Kept out of `tidyCardWrites.ts` (and its fill / link / league imports) so
 * `selectorOptions.updateCard`, `setCardFeature`, `cardChecklist.confirmCardNoTeam`
 * and `cardSecondaryPlayers.setSecondaryPlayers` can call it for the walk
 * without a static path into the tidy modules. Imports only the stored-card
 * reader, the generator and the retitle queue.
 */

import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  listingInputsForStoredCard,
  newStoredCardReadCache,
  type StoredCardReadCache,
} from "./storedCardTitle";
import { assessListingTitle, generateListingDescription } from "./features/generateListing";
import { generatedTitleTruncatedFlag } from "./features/listingInputs";
import { queueRetitledCardNow } from "./listingTitleRequeue";

type Card = Doc<"cardChecklist">;

/**
 * NEO-645 T4 (Jason, 2026-11-22: "whenever we make a change to anything in
 * this dialog we should be regenerating the title & description to ensure they
 * are up to date", "yes always overwrite we do not need to track if the user
 * has typed in the field"): the listing title and description of `card` as it
 * reads once `patch` lands.
 *
 * `patch` is the write about to land on `card`; the title (and its truncated
 * flag) and the description are added to it. ALWAYS, whatever the stored text
 * is: a title somebody typed is overwritten too, because the walk does not
 * track hand edits. Nothing here asks whether the stored text was the
 * generator's, so a stale one (a cameo or a team the card gained after the
 * title was written, the "Left out to fit" the title then carried) is rebuilt
 * by the very next write.
 *
 * The title is the generator's own (`assessListingTitle`, the commit's path)
 * over the card's stored facts, read exactly as `titleForStoredCard` and
 * Regenerate read them (a printed name still waiting for an answer is the
 * fallback when no player resolved). The description is the builder's
 * (`generateListingDescription`, the backfill's inputs) and is only rewritten
 * when every id on the card still resolves: a dangling player or team would
 * drop facts the stored text still carries.
 *
 * "Left out to fit" is not stored. The tile reads it from the stored title and
 * the card's facts (`leftOutOfTitle`), so a rebuilt title is the whole of
 * recomputing it: it clears when nothing was cut. The one stored cut fact,
 * `listingTitleTruncated`, is set to the new assessment's every time (absent
 * when the core fits), so a title that fits now stops asking for a check.
 *
 * The caller patches, then calls `queueRetitledCardNow` when `titleChanged`.
 */
export async function rebuildListingText(
  ctx: MutationCtx,
  card: Card,
  patch: Partial<Card>,
  titles: StoredCardReadCache,
): Promise<{ titleChanged: boolean }> {
  const next: Card = { ...card, ...patch } as Card;
  const { inputs, unresolved } = await listingInputsForStoredCard(ctx, next, titles);
  const built = assessListingTitle(inputs);
  const truncated = generatedTitleTruncatedFlag(built);
  let titleChanged = false;
  if (built.title !== card.listingTitle) {
    patch.listingTitle = built.title;
    titleChanged = true;
  }
  if (truncated !== card.listingTitleTruncated) patch.listingTitleTruncated = truncated;
  if (
    unresolved.players === 0 &&
    unresolved.teams === 0 &&
    unresolved.cameos === 0 &&
    !unresolved.parent
  ) {
    const description = generateListingDescription(inputs);
    if (description !== card.listingDescription) patch.listingDescription = description;
  }
  return { titleChanged };
}

/**
 * `rebuildListingText` for a write that has already landed (or a card no
 * name change touched): re-reads the card, rebuilds its title and description
 * from what is stored NOW, patches them and queues the eBay retitle when the
 * title moved. The one entry for the walk's writers that patch the card
 * themselves (the cameo writer, a "No team" stamp, a feature, a source pick
 * that changed no name); a no-op when nothing moves. Does not bump
 * `lastUpdated`: the write that came first owns it.
 */
export async function regenerateListingNow(
  ctx: MutationCtx,
  cardId: Id<"cardChecklist">,
  titles: StoredCardReadCache = newStoredCardReadCache(),
): Promise<{ titleChanged: boolean }> {
  const card = await ctx.db.get(cardId);
  if (!card) return { titleChanged: false };
  const patch: Partial<Card> = {};
  const { titleChanged } = await rebuildListingText(ctx, card, patch, titles);
  if (Object.keys(patch).length > 0) await ctx.db.patch(card._id, patch);
  if (titleChanged) await queueRetitledCardNow(ctx, card._id);
  return { titleChanged };
}

