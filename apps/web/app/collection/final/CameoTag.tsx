import { cameoPhrase } from "./cameo";

/**
 * NEO-528 — the Cameo mark: a card a smart binder takes in only because a
 * player its rule names is pictured on it, not its subject.
 *
 * It must read apart from the player's own card at a glance, and never by
 * colour alone (WCAG 1.4.1). So it differs three ways from every other
 * sticker in a binder: its SHAPE (an oval cameo brooch with a silhouette in
 * it, where "For sale", "Outside the rule" and "Trade" are arrow-cut price
 * stickers), its WORD ("Cameo"), and its PLACE (a pocket wears it on the
 * left edge, between the slab label and the ×N count, which it clears on a
 * phone-width pocket; the price stickers ride the right edge, and never on
 * a cameo: they live only in the rule-less Up for Trade binder). Teal is
 * the one neon no other sticker wears.
 *
 * The word is drawn for the eye; a screen reader hears who the cameo is
 * ("Dan Marino is a cameo on this card"). A pocket carries that in its own
 * accessible name instead, so its sticker is decoration (`PocketCameoTag`).
 */

/** The brooch: an oval frame, a head-and-shoulders silhouette in it. */
export function CameoGlyph({ className = "h-3.5 w-3" }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 14" aria-hidden="true" focusable="false" className={className}>
      <ellipse cx="6" cy="7" rx="5.1" ry="6.1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="6" cy="5.4" r="1.85" fill="currentColor" />
      <path d="M2.9 11.2c.55-1.85 1.7-2.8 3.1-2.8s2.55.95 3.1 2.8" fill="currentColor" />
    </svg>
  );
}

/**
 * The inline tag on a list row (checklist rows, Find cards). `names`: who is
 * pictured (`cameoNames`); the phrase is the tag's whole spoken text.
 */
export function CameoTag({ names }: { names: readonly string[] }) {
  return (
    <span
      title={capitalised(cameoPhrase(names))}
      className="nb-cameo-chip inline-flex shrink-0 items-center gap-1 rounded-full border border-neon-teal-text bg-neon-teal px-1.5 text-xs font-bold leading-5 text-on-neon-teal"
    >
      <CameoGlyph />
      <span aria-hidden="true">Cameo</span>
      <span className="sr-only">{cameoPhrase(names)}</span>
    </span>
  );
}

/** The sticker on a pocket. Decoration: the pocket's own name says it. */
export function PocketCameoTag() {
  return (
    <span aria-hidden="true" className="nb-cameo-tag">
      <CameoGlyph className="h-3 w-2.5" />
      Cameo
    </span>
  );
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
