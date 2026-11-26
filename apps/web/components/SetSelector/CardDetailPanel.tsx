import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Theme } from "@radix-ui/themes";
import { CheckIcon } from "@heroicons/react/20/solid";
import NeonButton from "@/components/modules/NeonButton";
import type { Id } from "../../convex/_generated/dataModel";
import {
  ALL_CARD_DETAIL_SECTIONS,
  CardDetailFields,
  useFieldToast,
  type AncestorLevel,
  type CardDetailCard,
} from "./CardDetailFields";

// The words the drawer's fields say; they live with the fields now and are
// re-exported for the tests and callers that read them here.
export {
  ALSO_PICTURED_HINT,
  ALREADY_A_PLAYER_MESSAGE,
  ALSO_PICTURED_SAVED,
  ALSO_PICTURED_MOVED_TO_PLAYERS,
  NO_TEAM_SAVED_ON_CARD,
  NO_TEAM_CLEARED_ON_CARD,
} from "./CardDetailFields";

/**
 * NEO-25: right-anchored card detail panel. ONE instance serves the whole
 * list; the parent re-keys it on `card._id`.
 *
 * NEO-645: the fields (and their autosave rules, NEO-216) moved to
 * `CardDetailFields`, which renders any subset of sections. This drawer renders
 * all of them, exactly as before, and keeps what is the drawer's own: the
 * backdrop, the header, Escape and the arrow keys, and the footer with the one
 * save confirmation.
 */
type CardDetailPanelProps = {
  card: CardDetailCard;
  // Ancestor chain (sport→…→variant) already queried once in CardChecklist.
  ancestorChain?: Array<AncestorLevel>;
  ancestorSport?: string;
  /** NEO-96: sport-level selectorOptions row id, for the entity pickers. */
  ancestorSportId?: Id<"selectorOptions">;
  /**
   * NEO-331 — the checklist's selectorOptions row (the set being worked on).
   * Orders the Teams picker by the set's league and year; omit and the picker
   * falls back to name order.
   */
  contextOptionId?: Id<"selectorOptions">;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
};

export default function CardDetailPanel({
  card,
  ancestorChain,
  ancestorSport,
  ancestorSportId,
  contextOptionId,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: CardDetailPanelProps) {
  const status = useFieldToast();
  const { toast } = status;

  const focusedInEditable = () => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    return (
      el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.isContentEditable
    );
  };

  // Keyboard: Escape closes; Arrow Up/Down move card selection. Listening on
  // document covers focus inside the TeamPicker popover too. Arrows are
  // ignored while typing in a field (so the caret can move).
  //
  // None of these are guarded any more: there is no unsaved draft to discard.
  // A commit triggered by the blur these actions cause is left to land.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        // a11y (audit fix, NEO-216/217): every OTHER way of closing this
        // drawer (clicking the backdrop, ×, or Done) moves the mouse to a
        // non-focused element first, which the browser turns into a native
        // blur on whatever field the operator was typing in — and that blur
        // is what commits the field under this drawer's autosave-on-blur
        // contract. Escape is the one close path that does NOT touch focus,
        // so without this, a keyboard user who types a new Card name and
        // hits Escape before tabbing away loses the edit silently — a
        // keyboard-only failure mode a mouse user can't hit. Blurring the
        // active field here (a no-op if it isn't one) makes Escape commit
        // exactly like every other close path before it unmounts the drawer;
        // the commit itself is fire-and-forget, same as a blur immediately
        // followed by a click on Done.
        if (focusedInEditable()) {
          (document.activeElement as HTMLElement | null)?.blur();
        }
        onClose();
        return;
      }
      if (focusedInEditable()) return;
      if (e.key === "ArrowDown" && hasNext) {
        e.preventDefault();
        onNext();
      } else if (e.key === "ArrowUp" && hasPrev) {
        e.preventDefault();
        onPrev();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hasPrev, hasNext, onClose, onPrev, onNext]);

  return createPortal(
    // NEO-71-74 QA fix: see BaseSetPicker.tsx for why this nested <Theme> is
    // needed — createPortal(document.body) escapes the root Theme's CSS scope.
    <Theme>
    <div className="fixed inset-0 z-50">
      {/* Backdrop. Clicking it closes. The panel is a sibling layered above,
          so taps inside the panel never reach here — e.g. tapping the Card
          name input to dismiss the TeamPicker popover does not close the
          panel. */}
      <div
        className="absolute inset-0 bg-scrim"
        aria-hidden="true"
        onClick={onClose}
      />
      {/*
        NEO-272 — THE WIDTH IS MEASURED OFF AN 80-CHARACTER TITLE, not picked
        off a breakpoint. Same derivation, same field and the same number as
        `CardAttentionWalker`'s dialog (NEO-271) — read that comment too; this
        is the second surface that edits `listingTitle`, and the two agreeing is
        deliberate rather than coincidental.

        WHY. `Card title` is a field whose budget is counted in CHARACTERS:
        `LISTING_TITLE_MAX` is 80, and `TitleLengthMeter` prints `80/80` in the
        label row directly above the input. At the old
        30rem (480px) the input's content box was 434px, which holds 54
        characters in the widest face below and 63 in the narrowest — the ~60
        Jason counted in the screenshot that opened this, with the trailing
        ` Cleveland Guardians` of an 80/80 title scrolled out of sight. Editing
        the end of a value you cannot see, against a limit measured in
        characters, is guesswork.

        WHICH FONT THE NUMBER IS FROM. This drawer is portalled inside a nested
        Radix `<Theme>` (see the `createPortal` above), whose `.radix-themes`
        rule sets `font-family: var(--default-font-family)` — the system-UI
        stack, NOT the app's Lexend — and Tailwind's preflight gives form
        controls `font: inherit`. So the title input renders in whatever
        `system-ui` resolves to on the machine looking at it, and this is sized
        off the WIDEST candidate rather than the local one. Measured with
        fontTools, summed glyph advances at `text-sm` (14px) over a realistic
        worst-case title:

          DejaVu Sans  (system-ui on the Linux CI runner)  8.07 px/char
          Lexend 400   (the app's page font)               7.80 px/char
          Helvetica / Arial                                7.25 px/char
          SF Pro Text  (system-ui on macOS)                6.84 px/char

        THE ARITHMETIC. 80 × 8.07 = 646px of text. The input adds `p-1.5` plus
        1px borders (14px) and the scrolling body below adds `px-4` (32px), so
        the panel needs 646 + 14 + 32 = 692px. 45rem (720px) clears it by 28px
        and leaves the input a 674px content box — 83 characters in DejaVu Sans,
        86 in Lexend, 98 in SF Pro. Note the body here is `px-4`, not the
        walker's `p-6`, so at the identical 45rem this field is 16px WIDER than
        the walker's; the shared number is the floor for both, never a squeeze
        on either. Do NOT tidy this into a `max-w-*` bucket: `max-w-2xl`
        (672px) is under the measured minimum outright.

        COVERING THE CHECKLIST COSTS NOTHING. 720px is 70% of the 1024px CI
        viewport, which would matter if the 304px left in view were usable —
        but this is `aria-modal="true"` over a full-viewport `bg-black/60`
        backdrop that closes on click, so everything outside the panel was
        already dimmed and non-interactive at 480px. The strip that remains is
        backdrop either way.

        NARROW WINDOWS. `max-w-[95vw]` takes over below a ~758px window
        (720 / 0.95) and `w-full` below the `sm` breakpoint (640px), so a phone
        still gets exactly what it got before: 95vw, with a 5vw sliver of
        backdrop beside it. Nothing in here carries a min-width, so it reflows;
        320px is unaffected because `sm:` never applies there (WCAG 1.4.10).
        The one window that changes character is 640–758px, where the drawer
        goes from a partial overlay to 95vw and the click-the-backdrop dismissal
        narrows to that sliver — still a >=24px target (WCAG 2.5.8), and Escape,
        the × and Done all close it, which is why this is a trade and not a
        regression.

        `animate-slide-in-right` is `translateX(100%)` → `0` (app/globals.css),
        a percentage of the element's OWN width, so a wider panel still starts
        fully off-screen rather than popping into place.
      */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`card-detail-title-${card._id}`}
        className="absolute top-0 right-0 h-full w-full sm:w-[45rem] max-w-[95vw] bg-raised border-l border-rule-strong shadow-xl flex flex-col animate-slide-in-right"
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-rule-strong flex items-center gap-2">
          <h2
            id={`card-detail-title-${card._id}`}
            className="text-sm font-semibold text-ink flex-1 truncate"
          >
            Card #{card.cardNumber}
          </h2>
          <button
            onClick={onPrev}
            disabled={!hasPrev}
            aria-label="Previous card"
            title="Previous card (↑)"
            className="px-2 py-1 text-sm rounded text-ink-3 hover:text-neon-blue-text disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ↑
          </button>
          <button
            onClick={onNext}
            disabled={!hasNext}
            aria-label="Next card"
            title="Next card (↓)"
            className="px-2 py-1 text-sm rounded text-ink-3 hover:text-neon-blue-text disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ↓
          </button>
          <button
            onClick={onClose}
            aria-label="Close card detail"
            title="Close (Esc)"
            className="px-2 py-1 text-lg leading-none rounded text-ink-3 hover:text-neon-pink-text focus:text-neon-pink-text focus-outline"
          >
            ×
          </button>
        </div>

        {/* Scrollable body. No overflow clipping on the TeamPicker section is
            handled by giving the whole body a single scroll container; the
            popover renders within it. */}
        <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
          <CardDetailFields
            card={card}
            ancestorChain={ancestorChain}
            ancestorSport={ancestorSport}
            ancestorSportId={ancestorSportId}
            contextOptionId={contextOptionId}
            sections={ALL_CARD_DETAIL_SECTIONS}
            status={status}
            autoFocusName
          />
        </div>


        {/* Footer.

            The Save and Cancel buttons are gone with the draft they served.
            What replaces them is not nothing: the rule has to be STATED
            (nobody guesses that a drawer with no Save button has already
            saved), and the last element in the dialog has to be focusable, or
            tabbing off the final field lands outside a modal that is still
            open — the NEO-189 stranding finding. "Done" is that element, and
            it does exactly what Escape and the × do. */}
        <div className="px-4 py-3 border-t border-rule-strong flex items-center justify-between gap-3">
          {/* The one save confirmation for the whole drawer, in place of the
              rule it confirms while it shows.

              NEO-47 wanted it where an edit made far down the drawer can
              still see it, which once meant fixed to the viewport, centred
              at the top. NEO-528's audit: there it sat on the drawer's own
              Card name field (on a phone, and on a desktop window narrower
              than the drawer's 45rem). The footer has the same property
              without the cover: it never scrolls away (the body scrolls
              between header and footer), and it is where the operator was
              told that leaving a field saves it. Mounted with its text, as
              the fixed toast was. */}
          {toast ? (
            <span
              className="min-w-0 inline-flex items-center gap-1.5 px-2 py-1 bg-raised-deep border border-neon-green-text/60 rounded text-xs font-medium text-neon-green-text"
              role="status"
              aria-live="polite"
            >
              <CheckIcon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 break-words">{toast}</span>
            </span>
          ) : (
            <span className="text-[10px] text-ink-3">
              Changes save as you leave each field.
            </span>
          )}
          <NeonButton
            type="button"
            size="1"
            onClick={onClose}
            aria-label="Done editing card"
          >
            Done
          </NeonButton>
        </div>
      </div>
    </div>
    </Theme>,
    document.body,
  );
}
