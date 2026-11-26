import {
  AUTOGRAPH_FORMATS,
  carriesAutographToken,
  isAutographFormat,
  type AutographFormat,
} from "../../convex/features/deriveCardFeatures";

// ---------------------------------------------------------------------------
// NEO-345 — the autograph format question.
//
// An autograph's FORMAT (on the card, or on a sticker) is NB data the
// operator supplies once per synced leaf; no marketplace says which it is.
// The wizard asks for it when a card the save will CREATE carries the "AU"
// attribute and the leaf has no format yet, and the answer travels as the
// commit's batch-level `autographFormat`.
// ---------------------------------------------------------------------------

/**
 * The two answers, as stored in the leaf's `features.autographFormat` — the
 * backend's own vocabulary and predicates (`deriveCardFeatures.ts`, a pure
 * module), so the step's on/off rule is the commit's.
 */
export { AUTOGRAPH_FORMATS, type AutographFormat };

/**
 * The two answers' display names, keyed by the stored value — the wizard's
 * tiles, the checklist prompt's buttons and the Attributes panel's select (under
 * "Edit attributes") all say
 * these words (NEO-345 a11y: one name per answer everywhere).
 */
export const AUTOGRAPH_CHOICE_LABEL: Readonly<Record<AutographFormat, string>> = {
  "On Card": "On card",
  "Sticker/Label": "Sticker",
};

/** A stored value read back as one of the two answers (anything else is none). */
export function asAutographFormat(value: string | undefined | null): AutographFormat | undefined {
  return isAutographFormat(value) ? value : undefined;
}

/** Does this attribute list carry the autograph token? Case-folded, trimmed. */
export function carriesAutograph(attributes: readonly string[] | undefined): boolean {
  return carriesAutographToken(attributes);
}

/**
 * Positions in `cards` the autograph step is about: cards the save will
 * CREATE (not in `existingIndexes`, which re-sync a stored row) that carry
 * "AU". A re-synced row keeps its own features; the stored-leaf prompt in the
 * checklist header is where those are answered.
 */
export function autographCardIndexes(
  cards: readonly { attributes?: readonly string[] }[],
  existingIndexes: readonly number[] = [],
): number[] {
  const existing = new Set(existingIndexes);
  const out: number[] = [];
  cards.forEach((card, i) => {
    if (!existing.has(i) && carriesAutograph(card.attributes)) out.push(i);
  });
  return out;
}
