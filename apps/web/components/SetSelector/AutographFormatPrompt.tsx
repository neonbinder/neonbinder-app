import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import NeonButton from "../modules/NeonButton";
import { userFacingMessage } from "@/lib/errors/user-facing-message";
import { AUTOGRAPH_CHOICE_LABEL, AUTOGRAPH_FORMATS, type AutographFormat } from "./autograph-format";

/**
 * NEO-345 — how a leaf's autographs are signed: on the card, or on a sticker.
 *
 * No marketplace says which, so it is NB data the operator supplies once per
 * synced leaf, and every card on that leaf carrying the "AU" attribute
 * inherits it as `features.autographed`, with Signed By seeded from its
 * players. NEO-645: the Tidy Up walk's Autograph tile asks per card and per
 * leaf; this prompt is the checklist header's one line for a stored leaf
 * whose AU cards are still marked "None": two buttons, each a
 * `setAutographFormat` on the leaf.
 */

/** The checklist header's one line, for a stored leaf. */
export function autographPromptLine(count: number): string {
  return count === 1
    ? "1 autographed card — on card or sticker?"
    : `${count} autographed cards — on card or sticker?`;
}

/** Said politely while the header prompt's write is in flight. */
export const AUTOGRAPH_PROMPT_SAVING = "Saving…";

/** What the header line says once the answer is saved. */
export function autographPromptSaved(value: AutographFormat): string {
  return `Autographs saved as ${AUTOGRAPH_CHOICE_LABEL[value].toLowerCase()}.`;
}


/**
 * A small drawn card: the hobby's own picture of the question. On card, the
 * ink crosses the card itself; on a sticker, it sits on a label stuck on at a
 * slight angle. Decorative — the radio's name carries the meaning.
 */
function SignatureGlyph({ format }: { format: AutographFormat }) {
  const ink = "M9 36 C 13 26, 17 42, 21 32 S 29 26, 33 34";
  return (
    <svg
      viewBox="0 0 42 56"
      width="30"
      height="40"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <rect x="1.5" y="1.5" width="39" height="53" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="6" y="6" width="30" height="18" rx="1" fill="currentColor" opacity="0.18" />
      {format === "On Card" ? (
        <path d={ink} fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
      ) : (
        <g transform="rotate(-6 21 34)">
          <rect x="6" y="26" width="30" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.75" strokeDasharray="3 2" />
          <path d="M10 37 C 13 29, 17 41, 21 33 S 28 29, 32 35" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
        </g>
      )}
    </svg>
  );
}

/**
 * The prompt's slot once answered: says so, and holds focus for the button
 * that went. It takes focus ONLY when focus has nowhere else to be — on the
 * page itself (the pressed button just unmounted) or still inside the prompt
 * — never from a control the operator has moved to since, so a remount can
 * never steal focus.
 */
function SavedLine({
  value,
  slotRef,
}: {
  value: AutographFormat;
  slotRef: RefObject<HTMLDivElement | null>;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const active = document.activeElement;
    const homeless = active === null || active === document.body;
    if (homeless || (active && slotRef.current?.contains(active))) ref.current?.focus();
  }, [slotRef]);
  return (
    <p
      ref={ref}
      tabIndex={-1}
      role="status"
      className="mb-3 rounded-md border border-control px-3 py-2 text-sm text-ink-2 focus-outline"
    >
      {autographPromptSaved(value)}
    </p>
  );
}

/**
 * The checklist header's prompt for a STORED leaf: its AU cards are still
 * "None" because nobody has said how they are signed. Two buttons, each a
 * `setAutographFormat` on the leaf, which writes the format and cascades it
 * to the leaf's AU cards server-side.
 *
 * Once saved, the host keeps this slot mounted (`saved`) so the line can say
 * so in place, and focus is parked on it — the button that was pressed is
 * gone, and focus must not fall to the page.
 */
export function AutographFormatPrompt({
  selectorOptionId,
  count,
  saved,
  onSaved,
}: {
  selectorOptionId: Id<"selectorOptions">;
  count: number;
  saved?: AutographFormat;
  onSaved: (value: AutographFormat) => void;
}) {
  const setAutographFormat = useMutation(api.autographFormat.setAutographFormat);
  const [busy, setBusy] = useState<AutographFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The slot both states render in, so the saved line can tell where focus is. */
  const slotRef = useRef<HTMLDivElement>(null);
  const errorId = useId();

  const choose = async (value: AutographFormat) => {
    if (busy) return;
    setBusy(value);
    setError(null);
    try {
      await setAutographFormat({ selectorOptionId, value });
      onSaved(value);
    } catch (e) {
      setError(userFacingMessage(e, "Could not save the autograph format"));
    } finally {
      setBusy(null);
    }
  };

  if (saved) {
    return (
      <div ref={slotRef}>
        <SavedLine value={saved} slotRef={slotRef} />
      </div>
    );
  }

  return (
    <div
      ref={slotRef}
      role="group"
      aria-labelledby="autograph-format-prompt"
      className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-neon-green-text/60 px-3 py-2"
    >
      {/* Glyph and line wrap as ONE item with a 16rem basis, the way the
          ReauthNotice / PausedNotice banners hold their text: on a phone the
          pair takes the whole row and the buttons drop beneath it, rather
          than the buttons squeezing the line until words break mid-word. */}
      <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
        <span className="shrink-0 text-neon-green-text">
          <SignatureGlyph format="On Card" />
        </span>
        <p id="autograph-format-prompt" className="min-w-0 flex-1 text-sm text-ink-2">
          {autographPromptLine(count)}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        {AUTOGRAPH_FORMATS.map((format) => (
          <NeonButton
            key={format}
            variant="secondary"
            aria-busy={busy === format || undefined}
            aria-disabled={busy !== null || undefined}
            aria-describedby={error ? errorId : undefined}
            onClick={() => void choose(format)}
          >
            {AUTOGRAPH_CHOICE_LABEL[format]}
          </NeonButton>
        ))}
      </div>
      {/* Both regions are mounted from the start — a live region that
          appears at the moment it speaks is often not heard — and collapse
          while empty. No whitespace inside: `empty:` needs no child nodes. */}
      <p role="status" className="basis-full text-xs text-ink-2 empty:hidden">
        {busy ? AUTOGRAPH_PROMPT_SAVING : null}
      </p>
      <p id={errorId} role="alert" className="basis-full text-xs text-neon-pink-text empty:hidden">
        {error}
      </p>
    </div>
  );
}
