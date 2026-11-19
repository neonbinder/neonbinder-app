/**
 * NEO-335 — how a NEW card's listing-title INPUTS are assembled, in one place.
 *
 * ## Why this exists
 *
 * `assessListingTitle` (generateListing.ts) is pure and has always been safe
 * for the browser. What was not shareable was the step BEFORE it: turning a
 * card plus its set into a `ListingCardInputs`. That lived inline in
 * `cardRowCreate.buildCardRowForInsert`, which drags in `sku.ts` and
 * `cardPlayerLinks.ts` and so can never reach the SPA bundle.
 *
 * NEO-335 asks the title question BEFORE save, on the wizard's "Card titles"
 * step, for cards that are not rows yet. A third hand-copied mapping is how
 * the title shown before save and the one written at insert drift apart, so
 * the mapping moved here and both sides call it:
 *
 *   - `buildCardRowForInsert` (server, at insert) — `mergeCardFeatures` +
 *     `listingInputsForCard`, then `titleAttentionItems` decides nothing at
 *     insert but reads the same assessment the row's flag is written from;
 *   - `components/SetSelector/card-titles.ts` (browser, before save) — the
 *     same two calls over a preview card and the set facts
 *     `resolveChecklistEntities` returns as `titleContext`;
 *   - `deriveCardAttention` (both) — `titleAttentionItems` over a STORED row.
 *
 * So "will this card be flagged after save?" and "is this card on the Card
 * titles step?" are one function of one assessment, and cannot disagree.
 *
 * ## Browser-safe, on purpose
 *
 * Imports only pure modules (`generateListing`, `deriveCardFeatures`,
 * `listingLimits`, `../listingShortName`) and a TYPE from `cardAttention`.
 * Keep it that way: the SPA imports this file.
 */

import type { AttentionItem } from "./cardAttention";
import type { Id } from "../_generated/dataModel";
import {
  autographedFromFormat,
  deriveCardObservedFeatures,
  RETIRED_FEATURE_KEYS,
} from "./deriveCardFeatures";
import {
  assessListingTitle,
  leftOutOfTitle,
  titleDescription,
  type ListingCardInputs,
  type ListingTeamSplit,
  type ListingTitleAssessment,
} from "./generateListing";
import { ASPECT_VALUE_MAX, LISTING_TITLE_MAX } from "./listingLimits";
import {
  MAX_LISTING_SHORT_NAME_LENGTH,
  normalizeListingShortName,
  type TitleLevelFact,
} from "../listingShortName";

/**
 * The set-level facts a new card's title reads, resolved once per commit (or
 * once per resolve, for the pre-save step). Same shape the commit prelude
 * hands its chunks; `cardRowCreate.CardRowSetContext` extends it.
 */
export type ListingSetContext = {
  /** The sport row's value — the title's last filler token. */
  sportValue: string;
  /** The nearest `setName` ancestor's value. */
  setNameValue?: string;
  /** NEO-272 — the manufacturer's brand-unknown ROLE; absent = known. */
  manufacturerBrandUnknown?: boolean;
  /** The leaf row's complete `features` snapshot (NEO-71-74). */
  inheritedFeatures?: Record<string, string>;
  /**
   * NEO-335 — the chain's insert-level row's value ("Dugout Collection").
   * Carried with `insertIsRole`; it reaches the title only when that is true.
   */
  insertNameValue?: string;
  /**
   * NEO-335 — the insert-level row's NB role: an insert of an Insert type,
   * the kind read from its variant type's title (NEO-334, `variantRole.ts`,
   * via `titleChainFacts`). The insert name enters the title core on this
   * role, never on the insert row's own level or name.
   */
  insertIsRole?: boolean;
  /**
   * NEO-335 — a directly-synced parallel LEAF's own value, set only when the
   * leaf is a parallel by role (a sub-variant, or an insert-level row under a
   * Parallel type: `derivedVariantFlags`, NEO-334). Used as the parallel token
   * when the features snapshot names no parallel.
   */
  parallelLeafValue?: string;
  /**
   * NEO-535 — the set's box text ("Set name in titles"): the chain's resolved
   * `listingShortName` (nearest self-or-ancestor up to the setName row, with
   * the insert's and parallel's names appended when it sits above them; see
   * `titleChainFacts`), or the operator's draft on the Card titles step, which
   * is written to the leaf and so covers the whole description.
   */
  listingShortName?: string;
  /**
   * NEO-609 — EVERY level of the chain below the set, top level first, with
   * each one's variant type name (`titleChainFacts`). The title names them
   * all. Absent: the levels are built from `insertNameValue` /
   * `parallelLeafValue` as before.
   */
  titleLevels?: TitleLevelFact[];
};

/**
 * NEO-335 — what the wizard's pre-save "Card titles" step needs from the
 * server to title a card that is not a row yet: the set facts above, the
 * set-level team a teamless new card is born with (NEO-277), and the
 * CANONICAL name of every printed player/team spelling on the confirmed cards
 * that already resolves to an NB row. Returned by `resolveChecklistEntities`
 * as `titleContext` (built in `convex/listingTitleContext.ts`).
 *
 * A printed name that is NOT listed did not resolve before the wizard: it is
 * either a name the wizard asks about (its review row's decision says what
 * the card will carry) or one an operator ruled out earlier, which the card
 * will not carry at all. Never a guess from the printed spelling.
 */
export type TitleContext = ListingSetContext & {
  /** Full names of the leaf's set-level teams, in stored order. */
  setTeamNames: string[];
  /**
   * NEO-606 — the Location / Name of the teams this context names (the
   * set-level ones and every resolved printed team) that have a location, in
   * no particular order: a card's team finds its split by whole name. Passed
   * to the generator as `teamSplits`. Optional: an older server sends none.
   */
  teamSplits?: ListingTeamSplit[];
  /**
   * NEO-528 round 3 — the NB name of the player a new card with no player of
   * its own is born with ("Player on every card"), or empty. Optional: an
   * older server sends none.
   */
  setPlayerNames?: string[];
  /** NEO-528 round 3 — that player's id, beside the name; absent when none. */
  setPlayerId?: Id<"players">;
  /**
   * NEO-528 + NEO-535 — the NB names of the cameos a new card is born with
   * (the row's default cameos), in order. Optional: an older server sends
   * none. The pre-save title names them as the insert will.
   */
  setCameoNames?: string[];
  /** Printed spelling (trimmed, verbatim) → the resolved player's name. */
  players: Array<{ printed: string; name: string }>;
  /** Printed spelling (trimmed, verbatim) → the resolved team's full name. */
  teams: Array<{ printed: string; name: string }>;
};

/** The facts a card itself contributes to its features and title. */
export type ListingCardFacts = {
  cardNumber: string;
  isRookie?: boolean;
  isRelic?: boolean;
  /** Observed only: folded into `features.autographed`. */
  autographType?: string;
  cardVariation?: string;
  attributes?: ReadonlyArray<string>;
  printRun?: number;
  /**
   * NEO-312 — the features map to merge onto INSTEAD of the set snapshot (a
   * parallel copy's). The commit and the pre-save step never pass it.
   */
  baseFeatures?: Record<string, string>;
  /**
   * NEO-321 — a parallel copy's own parallel name, applied last. The commit
   * and the pre-save step never pass it.
   */
  parallelName?: string;
};

/**
 * The card's `features` as a new row is born with them: the set snapshot (or
 * a copy's base), then what the card itself shows, then its parallel name.
 * Precedence is NEO-71-74's: inherited < observed.
 *
 * NEO-535 — a card born on a parallel leaf names that leaf, whatever path
 * creates it: a parallel copy passes the leaf's NB name itself
 * (`card.parallelName`, NEO-321), and a card committed through the wizard or
 * added by hand gets the same from the chain (`set.parallelLeafValue`, set by
 * `titleChainFacts` only on a parallel ROLE, read through `variantRole`).
 * The leaf's snapshot often inherits another name ("Base" from a Parallel
 * type), which would leave the parallel out of the title.
 */
export function mergeCardFeatures(
  card: ListingCardFacts,
  set: ListingSetContext,
): Record<string, string> {
  const merged: Record<string, string> = {
    ...(card.baseFeatures ?? set.inheritedFeatures ?? {}),
    ...deriveCardObservedFeatures({
      isRookie: card.isRookie,
      isRelic: card.isRelic,
      autographType: card.autographType,
      cardVariation: card.cardVariation,
      attributes: card.attributes,
    }),
  };
  const ownParallelName = card.parallelName?.trim() || set.parallelLeafValue?.trim();
  if (ownParallelName) merged.parallelName = ownParallelName;
  // NEO-345 — the leaf's autograph FORMAT (`set.inheritedFeatures
  // .autographFormat`: the operator's answer stored on the leaf, or the
  // wizard's draft answer before save). A card carrying AU is born
  // `autographed` with it. Fill-empty, the rule `applyBscAttributeFill` uses
  // on a stored row: an `autographed` the card already has (a parallel
  // copy's insert-card fact, an operator's set-level value) is kept.
  const formatted = autographedFromFormat(
    card.attributes,
    set.inheritedFeatures?.autographFormat,
  );
  if (formatted && (merged.autographed ?? "None") === "None") {
    merged.autographed = formatted;
  }
  // The format is a fact about the LEAF, not about any one card.
  delete merged.autographFormat;
  // NEO-569 — a retired key (the free-text League) is never born on a card,
  // whatever an un-stripped snapshot or a copy's base still carries.
  for (const key of RETIRED_FEATURE_KEYS) delete merged[key];
  return merged;
}

/**
 * The generator's inputs for a new card. `mergedFeatures` is
 * `mergeCardFeatures`' answer for the same card and set — passed in rather
 * than recomputed because the insert also stores it.
 *
 * `playerNames` / `teamNames` are CANONICAL names, in the card's stored order:
 * the title says "Dwight Gooden", not the "Doc Gooden" a card prints (NEO-254).
 */
export function listingInputsForCard(
  card: ListingCardFacts,
  set: ListingSetContext,
  names: {
    playerNames: string[];
    teamNames?: string[];
    teamSplits?: ListingTeamSplit[];
    cameoNames?: string[];
  },
  mergedFeatures: Record<string, string> = mergeCardFeatures(card, set),
): ListingCardInputs {
  // NEO-335 — the insert's name joins the core on the insert row's NB ROLE,
  // never on its level or its name (product invariant 4).
  const insertName =
    set.insertIsRole === true ? set.insertNameValue?.trim() || undefined : undefined;
  // NEO-535 — a card on a parallel leaf names that leaf, as every parallel
  // copy does (NEO-321): the leaf's own NB value, set only on the parallel
  // ROLE (`titleChainFacts` → `derivedVariantFlags`), wins over whatever the
  // features say. Those are often a name the leaf's snapshot inherited ("Base"
  // from a Parallel type) and stored on cards committed before NEO-535, so a
  // stored card's preview and Regenerate name the leaf too. `parallelName` is
  // not an operator-editable feature (`expectedFeatures`), so nothing an
  // operator typed is overridden. Off a parallel leaf the features' name is
  // the parallel token, as before (NEO-335).
  const parallelName =
    set.parallelLeafValue?.trim() || mergedFeatures.parallelName?.trim() || undefined;
  const setShortName = set.listingShortName?.trim() || undefined;
  const titleLevels = set.titleLevels && set.titleLevels.length > 0 ? set.titleLevels : undefined;
  // NEO-335 — the leaf's parallel ROLE earns the parallel its "Parallel"
  // label. `parallelLeafValue` is set by `titleChainFacts` only on that role
  // (`derivedVariantFlags`), so its presence is the role, never its wording.
  const parallelIsRole = !!set.parallelLeafValue?.trim();
  return {
    cardNumber: card.cardNumber,
    playerNames: names.playerNames,
    // NEO-528 — the people also pictured; absent when none, so a card with no
    // cameo builds exactly the inputs it did before.
    ...(names.cameoNames && names.cameoNames.length > 0 ? { cameoNames: names.cameoNames } : {}),
    year: mergedFeatures.season,
    manufacturer: mergedFeatures.manufacturer,
    manufacturerBrandUnknown: set.manufacturerBrandUnknown,
    setName: set.setNameValue,
    ...(insertName ? { insertName } : {}),
    // NEO-609 — absent when the chain has no level, so a Base card builds
    // exactly the inputs it did before.
    ...(titleLevels ? { titleLevels } : {}),
    ...(setShortName ? { setShortName } : {}),
    parallelName,
    ...(parallelIsRole ? { parallelIsRole: true } : {}),
    isRookie: card.isRookie,
    isRelic: card.isRelic,
    autographed: mergedFeatures.autographed,
    printRun: card.printRun,
    shortPrint: mergedFeatures.shortPrint,
    cardVariation: card.cardVariation,
    teamNames: names.teamNames,
    // NEO-606 — absent when no team on the card has a split, so a card without
    // one builds exactly the inputs it did before.
    ...(names.teamSplits && names.teamSplits.length > 0 ? { teamSplits: names.teamSplits } : {}),
    sport: set.sportValue,
  };
}

/** The three title-shaped attention kinds, which this module owns. */
export type TitleAttentionItem = Extract<
  AttentionItem,
  { kind: "titleOverLimit" | "titleTruncated" | "aspectValueOverLimit" }
>;

/** The row fields the title kinds read — a stored row, or a row-to-be. */
export type TitleAttentionFields = {
  listingTitle?: string;
  /** NEO-101 — the generator cut the title's core at creation. */
  listingTitleTruncated?: boolean;
  cardVariation?: string;
};

/**
 * NEO-101 — what a card's title and variation still need from a human.
 *
 * Moved here from `deriveCardAttention` verbatim (it calls this) so the
 * pre-save step asks the same question of a card that is not a row yet.
 *
 * The two title rules are MUTUALLY EXCLUSIVE: a title that is both over the
 * cap and flagged truncated has one thing worth saying — it is too long — and
 * rewriting it clears both. The variation rule is independent and warn-only.
 */
export function titleAttentionItems(row: TitleAttentionFields): TitleAttentionItem[] {
  const items: TitleAttentionItem[] = [];
  const titleLength = row.listingTitle?.length ?? 0;
  if (titleLength > LISTING_TITLE_MAX) {
    items.push({ kind: "titleOverLimit", length: titleLength });
  } else if (row.listingTitleTruncated) {
    items.push({ kind: "titleTruncated" });
  }
  // Measured TRIMMED (NEO-335 adversarial pass): a variation that fits once
  // its stray whitespace is gone is not too long, and a new row stores it
  // trimmed (`storedCardVariation`). Measuring the padding put a card on the
  // pre-save step with nothing the operator could fix.
  const variationLength = row.cardVariation?.trim().length ?? 0;
  if (variationLength > ASPECT_VALUE_MAX) {
    items.push({
      kind: "aspectValueOverLimit",
      field: "cardVariation",
      length: variationLength,
    });
  }
  return items;
}

/**
 * NEO-335 — the `cardVariation` a NEW row stores: the printed one, trimmed;
 * blank is none. `buildCardRowForInsert` writes this, and the pre-save step
 * measures the same value, so the two agree on who is over the aspect cap.
 */
export function storedCardVariation(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * NEO-609 — the `listingTitleTruncated` value a GENERATED title is stored
 * with, from the assessment it was written from: `true` while a Tidy Up cut is
 * still out (or the title came from the box), `undefined` otherwise, which in
 * a patch clears a flag the old title carried. The one reading every writer of
 * a generated title uses (insert, Regenerate, a player link, a team removal);
 * only an operator's own typed title clears the flag without asking it.
 */
export function generatedTitleTruncatedFlag(
  assessment: Pick<ListingTitleAssessment, "coreFits">,
): true | undefined {
  return assessment.coreFits ? undefined : true;
}

/**
 * The row fields a NEW card is born with that `titleAttentionItems` reads,
 * from its assessment — exactly what `buildCardRowForInsert` writes when no
 * operator answer rides on the card.
 */
export function titleAttentionFieldsAtInsert(
  assessment: ListingTitleAssessment,
  cardVariation: string | undefined,
): TitleAttentionFields {
  return {
    listingTitle: assessment.title,
    ...(generatedTitleTruncatedFlag(assessment) ? { listingTitleTruncated: true } : {}),
    cardVariation: storedCardVariation(cardVariation),
  };
}

/**
 * Everything one new card's title comes to, in one call: the merged features,
 * the generator's inputs, its assessment, and the attention items the row
 * would be born with. The pre-save step's single entry point.
 */
export function assessNewCardListing(
  card: ListingCardFacts,
  set: ListingSetContext,
  names: {
    playerNames: string[];
    teamNames?: string[];
    teamSplits?: ListingTeamSplit[];
    cameoNames?: string[];
  },
): {
  mergedFeatures: Record<string, string>;
  inputs: ListingCardInputs;
  assessment: ListingTitleAssessment;
  items: TitleAttentionItem[];
} {
  const mergedFeatures = mergeCardFeatures(card, set);
  const inputs = listingInputsForCard(card, set, names, mergedFeatures);
  const assessment = assessListingTitle(inputs);
  return {
    mergedFeatures,
    inputs,
    assessment,
    items: titleAttentionItems(titleAttentionFieldsAtInsert(assessment, card.cardVariation)),
  };
}

/**
 * NEO-535 — what a title's text leaves out of the card's facts, computed from
 * the text itself (the operator's own words included). Lives beside the
 * generator, which reads the same description; re-exported here for the Card
 * titles step.
 */
export { leftOutOfTitle };

/**
 * NEO-535 — the prefill for the "Set name in titles" box when nothing is
 * stored: the builder's own full description for this set's cards, without
 * the "Insert" / "Parallel" labels ("2026 Leaf Metal 1991 Gold Prospects
 * Autographs Prismatic Silver"). The year and maker come from the leaf's
 * features snapshot, the insert from its NB role. Never the stored box text.
 *
 * The box holds the WHOLE description, parallel included (Jason). A card on
 * a parallel leaf names that leaf: the parallel build gives every copy the
 * leaf's own NB name as its `parallelName` (NEO-321), over whatever the
 * leaf's snapshot inherited (often the "Base" a Parallel type handed down,
 * which the description leaves out). So the description is read for such a
 * card, never a blank one. `card.parallelName` is that name when the caller
 * has the row; otherwise the parallel leaf's value (`parallelLeafValue`,
 * set only on a parallel role) stands in for it.
 */
export function setDescriptionForTitles(
  set: ListingSetContext,
  card: { parallelName?: string } = {},
): string {
  const parallelName = card.parallelName?.trim() || set.parallelLeafValue?.trim() || undefined;
  return titleDescription(
    listingInputsForCard(
      { cardNumber: "", ...(parallelName ? { parallelName } : {}) },
      { ...set, listingShortName: undefined },
      { playerNames: [] },
    ),
  );
}

/**
 * NEO-535 — the bound on a KEPT title (`checkTitleAnswer`): a generated title
 * over eBay's cap is kept as shown, so the bound is not the cap. Generous
 * enough for any real set description plus the card's facts.
 */
export const LISTING_TITLE_KEPT_MAX = 400;

/**
 * NEO-335 — the operator's pre-save title answer, held to the same caps the
 * write paths hold (`updateCard` for the title; the aspect cap for the
 * variation the step asks to be trimmed). Returns the trimmed values, or
 * throws a message naming the card by NB's own card number.
 *
 * Shared by the commit action (refuses the whole commit before any phase
 * writes) and the chunk that writes the row (the writer caps, as the house
 * does for every internal arg that lands in a stored field).
 */
export function checkTitleAnswer(
  answer: {
    listingTitle?: string;
    listingTitleKept?: string;
    cardVariation?: string;
    cardVariationAnswered?: boolean;
  },
  where: string,
): { listingTitle?: string; listingTitleKept?: string; cardVariation?: string } {
  const out: { listingTitle?: string; listingTitleKept?: string; cardVariation?: string } = {};
  // The operator's own title is held to eBay's cap. The KEPT one is the
  // title the step SHOWED, which since NEO-535 may be over the cap (the
  // generator stops rather than cut description words): keeping it only
  // answers the first-name question, and the row is still flagged
  // `titleOverLimit` by its length. It is bounded, not capped.
  for (const field of ["listingTitle", "listingTitleKept"] as const) {
    const raw = answer[field];
    if (raw === undefined) continue;
    const title = raw.trim();
    const limit = field === "listingTitle" ? LISTING_TITLE_MAX : LISTING_TITLE_KEPT_MAX;
    if (title.length > limit) {
      throw new Error(
        `${where}: the title is ${title.length} characters; the limit is ${limit}.`,
      );
    }
    if (title) out[field] = title;
  }
  if (answer.cardVariationAnswered && answer.cardVariation !== undefined) {
    const variation = answer.cardVariation.trim();
    if (variation.length > ASPECT_VALUE_MAX) {
      throw new Error(
        `${where}: the variation is ${variation.length} characters; the limit is ${ASPECT_VALUE_MAX}.`,
      );
    }
    // Empty is no answer: clearing a variation is not what "trim it" asks.
    if (variation) out.cardVariation = variation;
  }
  return out;
}

/**
 * NEO-335 — a short name as the operator typed it, checked BEFORE it is sent:
 * the same rule both write paths apply (`normalizeListingShortName`, the
 * attributes panel's mutation and the commit's batch-level arg), read without
 * throwing so the Card titles step can say what is wrong in place.
 *
 * `value` is the trimmed short name to send (undefined when blank: nothing is
 * sent); `error` is the server's own sentence when it would be refused.
 */
export function checkShortNameAnswer(
  raw: string | undefined,
): { value?: string; error?: string } {
  if (raw === undefined) return {};
  try {
    const value = normalizeListingShortName(raw);
    return value === undefined ? {} : { value };
  } catch (e) {
    const data = (e as { data?: unknown }).data;
    return {
      error:
        typeof data === "string"
          ? data
          : `Set name in titles tops out at ${MAX_LISTING_SHORT_NAME_LENGTH} characters.`,
    };
  }
}
