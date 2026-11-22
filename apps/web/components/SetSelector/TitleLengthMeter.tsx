import type { ReactNode } from "react";
import {
  ASPECT_VALUE_MAX,
  LISTING_TITLE_MAX,
  LISTING_TITLE_MOBILE_CLIP,
  LISTING_TITLE_SEARCH_CLIP,
} from "../../convex/features/listingLimits";

/**
 * NEO-101 — the length readout for a marketplace-capped field, shared by the
 * card detail drawer and the attention walker's title fixer.
 *
 * ## Why one component for two surfaces
 *
 * The same question ("does this title fit?") is asked in two places that look
 * nothing alike: a right-anchored drawer the operator edits a whole card in,
 * and a one-card-at-a-time dialog that exists only because the title does NOT
 * fit. If the two disagreed about where amber starts, or worded the over-cap
 * message differently, the walker would be teaching an operator a rule the
 * drawer then contradicts. So the bands, the wording and the colour roles live
 * here once and both surfaces render the same two pieces:
 *
 *   - {@link TitleLengthMeter} — `62/80 · may clip in search`, in the field's
 *     label row, ABOVE the input;
 *   - {@link TitleLengthAlert} — the over-cap `role="alert"`, BELOW the input.
 *
 * They are two components rather than one because they render either side of
 * the input, and the input's position in the drawer is load-bearing (Maestro
 * flows key off `id: "Card title"` and the documented drawer field order).
 *
 * ## Colour is never the only signal
 *
 * Every band that is not "fine" carries words: `may clip in search` (both soft
 * bands, NEO-645) and a full sentence in the alert. The colours below are
 * the app's existing roles — grey is neutral, the danger notice ink is over
 * the cap — plus two warm steps between them.
 *
 * ## One set of roles, every surface (NEO-356, NEO-535)
 *
 * This renders on TitleFixer's walker dialog, the wizard's Card titles step
 * and CardDetailPanel's drawer. All three paint with colour roles, which
 * follow the light/dark mode, so each tone reads 4.5:1 on any of them in
 * either mode. Over the cap is neon pink everywhere (NEO-606, Jason: "our
 * error state color is the neon pink"): the text roles, and the field itself
 * through {@link OVER_FIELD_CLASS}. The counter and alert paint `neon-pink-text`
 * directly; the error ink (`notice-danger-ink`) is the same pink, so every error
 * on screen reads as one colour. Dark `neon-pink-text` was lifted to #ff40a3 for
 * 4.5:1 on a graphite card (NEO-356), so the old 4.4:1 worry is gone. There used to be a `surface` prop choosing between two maps that
 * differed only in that tone; NEO-535 folded them into one.
 *
 * ## The bands are display truncation, not rules
 *
 * Only `LISTING_TITLE_MAX` is a rule — eBay rejects an over-length title at
 * listing time (error 70), it does not trim it. 55 and 70 are where eBay's own
 * search results clip a title for a reader; a title past them still lists fine.
 * That is why they warn and only the cap blocks. See
 * convex/features/listingLimits.ts for the sourcing.
 */

/** Which band a length falls in. Ordered least to most serious. */
export type TitleLengthTone = "ok" | "mobile" | "search" | "over";

export type TitleLengthState = {
  tone: TitleLengthTone;
  /** True once the value exceeds the cap — the state that blocks a save. */
  over: boolean;
  /** How many characters past the cap. 0 when within it. */
  overBy: number;
  /** Short phrase for the counter row. `null` in the "ok" band. */
  hint: string | null;
  /**
   * The over-cap FACT, without advice: "84 characters, 4 over the
   * 80-character limit." `null` unless over the cap. The advice that follows it
   * differs per field (the title blocks a save, an aspect value only warns), so
   * it is the alert component's to add, not this function's.
   */
  alert: string | null;
};

/** One tone per band, the same on every surface (see the header note). */
const TONE_CLASS: Record<TitleLengthTone, string> = {
  ok: "text-ink-3",
  mobile: "text-notice-warn-ink",
  search: "text-neon-orange-text",
  over: "text-neon-pink-text",
};

/**
 * NEO-606 — the whole field, not just the note under it, says "too long".
 *
 * Keyed on `data-over`, which {@link overFieldProps} sets from LENGTH alone,
 * never on `aria-invalid`: a refused save also sets `aria-invalid`, and that
 * error keeps its own look (its message stays the danger ink), so the pink box
 * means one thing — past the cap. It goes the moment the text fits. The edge
 * is the pink text role; the ring thickens it to 2px and the tint carries it
 * for anyone who misses a line.
 *
 * Held (`aria-disabled`, or native `disabled`): the grey `button-neutral` fill
 * wins over the tint (`FIELD_OFF`), while the pink edge and ring stay, so a
 * held over-cap field still reads as both. The stacked
 * `aria-disabled:data-[over=true]:` variant carries three attributes' worth of
 * specificity against the tint's two, so the win does not hang on stylesheet
 * order.
 */
export const OVER_FIELD_CLASS =
  "data-[over=true]:border-neon-pink-text data-[over=true]:ring-1 data-[over=true]:ring-neon-pink-text data-[over=true]:bg-neon-pink/10 aria-disabled:data-[over=true]:bg-button-neutral disabled:data-[over=true]:bg-button-neutral";

/** Spread onto a field that wears {@link OVER_FIELD_CLASS}: the length-only hook. */
export function overFieldProps(over: boolean): { "data-over"?: "true" } {
  return over ? { "data-over": "true" } : {};
}

/**
 * NEO-645 — ONE phrase for both soft bands. "May clip on mobile" (55) and "may
 * clip in search" (70) were the same fact, search results cutting the title, at
 * two screen sizes, and an operator read them as two different problems. The
 * thresholds are unchanged (eBay's mobile tiles clip near 55, desktop results
 * near 70); the colour still steps up at 70, and the words no longer change.
 */
export const CLIP_HINT = "may clip in search";

/**
 * Classify a length against a cap.
 *
 * `soft` opts into the display-truncation bands, which belong to the listing
 * TITLE only: an eBay aspect value is not shown in search results, so there is
 * nothing for a "may clip" warning to mean on the variation field — it has a
 * hard cap and nothing else.
 */
export function titleLengthState(
  length: number,
  max: number = LISTING_TITLE_MAX,
  soft = false,
): TitleLengthState {
  if (length > max) {
    const overBy = length - max;
    return {
      tone: "over",
      over: true,
      overBy,
      hint: `${overBy} over`,
      alert: `${length} characters, ${overBy} over the ${max}-character limit.`,
    };
  }
  if (soft && length >= LISTING_TITLE_SEARCH_CLIP) {
    return {
      tone: "search",
      over: false,
      overBy: 0,
      hint: CLIP_HINT,
      alert: null,
    };
  }
  if (soft && length >= LISTING_TITLE_MOBILE_CLIP) {
    return {
      tone: "mobile",
      over: false,
      overBy: 0,
      hint: CLIP_HINT,
      alert: null,
    };
  }
  return { tone: "ok", over: false, overBy: 0, hint: null, alert: null };
}

/** The aspect-value cap, re-exported so a caller needs one import, not two. */
export { ASPECT_VALUE_MAX, LISTING_TITLE_MAX };

/**
 * `62/80 · may clip in search` — the counter for a field's label row.
 *
 * Rendered as plain text, not a live region: it updates on every keystroke, and
 * an assertive readout of a character count while someone is typing is noise.
 * The state that actually needs announcing (over the cap) is
 * {@link TitleLengthAlert}, which is a live region and fires once per crossing.
 */
export function TitleLengthMeter({
  length,
  max = LISTING_TITLE_MAX,
  soft = false,
}: {
  length: number;
  max?: number;
  soft?: boolean;
}) {
  const state = titleLengthState(length, max, soft);
  return (
    <span className={`flex items-center gap-1 tabular-nums ${TONE_CLASS[state.tone]}`}>
      <span>
        {length}/{max}
      </span>
      {state.hint && (
        <>
          {/* aria-hidden: the separator is typographic, and "middle dot" read
              aloud between the count and the phrase is noise. */}
          <span aria-hidden="true">·</span>
          {/* Not uppercase like the label beside it: this is a sentence the
              operator reads, not a field name they scan for. */}
          <span className="normal-case">{state.hint}</span>
        </>
      )}
    </span>
  );
}

/**
 * The over-cap message, below the input.
 *
 * Renders nothing at all within the cap — an always-present region that
 * switched text would announce on every band change, including the two that are
 * advisory.
 *
 * `blocking` picks both the advice and the politeness. The listing title blocks
 * the save, so it is `role="alert"` and says so. An aspect value does NOT block
 * (NEO-101 decision: we do not yet know which NB field maps verbatim to which
 * marketplace aspect, and hard-blocking on a guess is the NEO-189 mistake), so
 * it is `role="status"` and says what the risk is instead of what to do.
 */
export function TitleLengthAlert({
  id,
  length,
  max = LISTING_TITLE_MAX,
  what = "Title",
  blocking = true,
}: {
  id?: string;
  length: number;
  max?: number;
  /** Field name to lead with, so the walker's two fields read distinctly. */
  what?: string;
  /** False for a warn-only field. */
  blocking?: boolean;
}) {
  const state = titleLengthState(length, max);
  if (!state.alert) return null;
  return (
    <p
      id={id}
      role={blocking ? "alert" : "status"}
      aria-atomic="true"
      className={`mt-1 text-xs ${TONE_CLASS.over}`}
    >
      {what} is {state.alert}{" "}
      {blocking
        ? "Shorten it before saving."
        : "You can still save it, but a marketplace that caps this field will reject the value."}
    </p>
  );
}

/**
 * The advisory note used for `listingTitleTruncated` and for the walker's
 * per-item reasons. Same type scale and colour as the counter's soft bands, so
 * "this needs a look" reads as one voice wherever it appears.
 */
export function TitleFieldNote({ children }: { children: ReactNode }) {
  return <p className={`mt-1 text-xs ${TONE_CLASS.mobile}`}>{children}</p>;
}
