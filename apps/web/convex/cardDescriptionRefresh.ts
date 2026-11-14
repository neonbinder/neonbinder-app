/**
 * NEO-535 — a card's listing description follows its facts.
 *
 * `listingDescription` is what a collector's card search reads
 * (`search_listing_description`), and it is written at creation from the
 * card's facts (`generateListingDescription`). A fact corrected afterwards (a
 * team linked, a print run, RC/RELIC/SP, a variation, a player, the number)
 * used to leave the description saying the old thing, so a search for the new
 * fact missed the card.
 *
 * So every write that changes a fact the description carries rebuilds it, on
 * one rule: only when the stored description is exactly what the builder made
 * from the card's facts BEFORE the change. Anything else was written by a
 * person (or from facts changed some other way) and is left alone. No schema
 * flag says "hand-edited": the comparison is the flag.
 *
 * Further rules, each on purpose:
 *  - a write that sets the description itself wins (the operator's words);
 *  - no stored description: nothing is filled here (the description backfill
 *    fills; this only keeps a builder's description current);
 *  - a card whose new facts do not fully resolve (a dangling player or team
 *    id, its row gone) keeps its description: rebuilding from partial data
 *    would drop facts the stored text still carries (the backfill's rule).
 *
 * The card detail panel's Regenerate goes through `regeneratedDescription`,
 * which also rebuilds a description that merely READS as the builder's
 * (`readsAsGeneratedDescription`): the operator asked for a rebuild, and a
 * description built from older facts (a player renamed since) is exactly the
 * one they want rebuilt.
 *
 * Read-only: callers fold the answer into the patch they already write, so a
 * fact change and its description land in one write.
 */

import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  generateListingDescription,
  readsAsGeneratedDescription,
} from "./features/generateListing";
import {
  listingInputsForStoredCard,
  newStoredCardLookupCache,
  type StoredCardLookupCache,
} from "./storedCardTitle";

type CardDoc = Doc<"cardChecklist">;

/**
 * The stored fields `listingInputsForStoredCard` reads. A patch touching none
 * of them cannot change the description, and costs no read.
 */
const DESCRIPTION_FACT_FIELDS = [
  "cardNumber",
  "playerIds",
  "pendingPlayerNames",
  "teamOnCardIds",
  "pendingTeamNames",
  "printRun",
  "isRookie",
  "isRelic",
  "cardVariation",
  "features",
  "selectorOptionId",
] as const satisfies ReadonlyArray<keyof CardDoc>;

/**
 * Does `patch` name a field the description is built from? The cheap,
 * read-free pre-check a caller makes before loading the stored card.
 */
export function patchNamesDescriptionFacts(patch: object): boolean {
  return DESCRIPTION_FACT_FIELDS.some((field) => field in patch);
}

/** Does `patch` change a field the description is built from? */
export function patchTouchesDescriptionFacts(
  before: CardDoc,
  patch: Partial<CardDoc>,
): boolean {
  return DESCRIPTION_FACT_FIELDS.some(
    (field) =>
      field in patch && JSON.stringify(patch[field]) !== JSON.stringify(before[field]),
  );
}

/** The card as it reads once `patch` lands (`undefined` deletes, as in Convex). */
function afterPatch(before: CardDoc, patch: Partial<CardDoc>): CardDoc {
  return { ...before, ...patch };
}

async function descriptionFor(
  ctx: { db: QueryCtx["db"] },
  card: CardDoc,
  cache: StoredCardLookupCache,
): Promise<{ description: string; resolved: boolean }> {
  const { inputs, unresolved } = await listingInputsForStoredCard(ctx, card, cache);
  return {
    description: generateListingDescription(inputs),
    resolved: unresolved.players === 0 && unresolved.teams === 0 && !unresolved.parent,
  };
}

/**
 * The description to write alongside `patch`, or `undefined` to leave the
 * stored one as it is. `before` is the card as stored; `patch` is the write
 * about to land on it. Share `cache` across the cards of one transaction.
 */
export async function refreshedListingDescription(
  ctx: { db: QueryCtx["db"] },
  before: CardDoc,
  patch: Partial<CardDoc>,
  cache: StoredCardLookupCache = newStoredCardLookupCache(),
): Promise<string | undefined> {
  if (patch.listingDescription !== undefined) return undefined;
  const stored = before.listingDescription?.trim();
  if (!stored) return undefined;
  if (!patchTouchesDescriptionFacts(before, patch)) return undefined;

  const was = await descriptionFor(ctx, before, cache);
  if (was.description !== stored) return undefined;
  const next = await descriptionFor(ctx, afterPatch(before, patch), cache);
  if (!next.resolved || next.description === stored) return undefined;
  return next.description;
}

/**
 * Regenerate's description: the builder's description for the card's facts
 * now, when the stored one is absent or reads as the builder's own; otherwise
 * `undefined` (an operator wrote it, so it stays). Also `undefined` when the
 * description is already current, or the facts do not fully resolve.
 */
export async function regeneratedDescription(
  ctx: { db: QueryCtx["db"] },
  card: CardDoc,
): Promise<string | undefined> {
  const stored = card.listingDescription?.trim() ?? "";
  if (stored && !readsAsGeneratedDescription(stored)) return undefined;
  const next = await descriptionFor(ctx, card, newStoredCardLookupCache());
  if (!next.resolved || next.description === stored) return undefined;
  return next.description;
}
