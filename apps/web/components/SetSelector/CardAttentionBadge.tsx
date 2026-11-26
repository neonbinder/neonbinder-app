import { ExclamationTriangleIcon, EyeIcon } from "@heroicons/react/16/solid";
import { tidyItemLabel } from "./card-attention";
import type { TidyAttention } from "./tidy/tile-types";

/**
 * NEO-102 — the checklist grid's first row-level diagnostic mark.
 *
 * ## Design
 *
 * Deliberately one glyph, not a word. The grid is up to 908 rows of
 * `#123 · Card Name · team · badges · Edit Del`, and every horizontal pixel
 * already belongs to something; a "Needs attention" pill would push the
 * platform badges into a second line on narrow columns. So the mark is one
 * small icon in a fixed 20px disc, and the *words* live in its accessible
 * name and tooltip, where they can be as long as they need to be.
 *
 * NEO-645: two levels, the Tidy Up walk's own colours. Pink is "to fix": the
 * card cannot be listed until it is answered. Blue is "to check": a stop for
 * review that never blocks. (This was amber before the walk had levels; amber
 * said "a person is needed" and nothing about how much.) Both are an outlined
 * disc in the row's own reserved slot, so neither reads as one of the row's
 * attribute badges. Colour is never the only carrier: the icon is the tile's own
 * (a warning triangle for "to fix", an eye for "to check"), so the two differ
 * by shape, and the accessible name and the tooltip say which level it is.
 *
 * ## Why it renders inside a caller-reserved slot
 *
 * It must NOT be the thing that changes a row's size. `CardChecklist`'s rows
 * are virtualized, and a row-height or row-width change re-measures the
 * Virtuoso list and reflows everything below it — the long-standing
 * dropped-tap flake that CardChecklistItem's always-reserved subtitle line
 * and always-reserved disclosure slot both exist to prevent. Attention state
 * is exactly the kind that flips under the operator (the background BSC team
 * pass lands, or they fix a card in the walker), so the caller reserves a
 * constant-size slot on every row and this renders into it or not.
 *
 * ## Not interactive, on purpose
 *
 * Fixing happens in `CardAttentionWalker`, reached from the set header — the
 * grid's job here is to say WHICH rows, at a glance. Keeping it a `<span>`
 * also keeps the virtualized list from gaining another tab stop per row.
 * `role="img"` is what makes a non-interactive glyph's `aria-label` count as
 * its accessible name.
 */
export default function CardAttentionBadge({
  attention,
  cardIdentity,
}: {
  /** Not "none": the caller decides whether to render this at all. */
  attention: TidyAttention;
  /**
   * How the row names itself — its card number, and its card name when it has
   * one ("NNO, Jon Larson"). Composed by the caller; see the `cardIdentity`
   * note in CardChecklistItem.
   *
   * NEO-272: this was the card NUMBER alone, and product invariant 7 says a
   * card number is never unique at any scope — on an unnumbered set every mark
   * in the list announced itself as "Card NNO needs attention: …", which
   * defeats the whole point of naming the card in a label that exists to be
   * meaningful out of row context.
   */
  cardIdentity: string;
}) {
  // Every item, joined — one mark can stand for several reasons, and the
  // operator should hear all of them.
  const reasons = attention.items.map(tidyItemLabel).join("; ");
  const fix = attention.level === "fix";
  const Icon = fix ? ExclamationTriangleIcon : EyeIcon;
  return (
    <span
      role="img"
      aria-label={
        fix
          ? `Card ${cardIdentity} needs attention: ${reasons}`
          : `Card ${cardIdentity} is worth a check: ${reasons}`
      }
      title={fix ? `Needs attention: ${reasons}` : `Worth a check: ${reasons}`}
      // a11y (1.4.3 / 1.4.11): the `-text` roles are the neon hues' text-role
      // tokens, which clear 3:1 on the tile wash in both modes (TidyTile).
      className={
        fix
          ? "inline-flex h-5 w-5 items-center justify-center rounded-full border border-neon-pink-text bg-wash-pink text-neon-pink-text"
          : "inline-flex h-5 w-5 items-center justify-center rounded-full border border-neon-blue-text bg-wash-blue text-neon-blue-text"
      }
    >
      <Icon aria-hidden="true" className="h-3 w-3" />
    </span>
  );
}
