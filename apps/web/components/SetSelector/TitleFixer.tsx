import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { userFacingMessage } from "@/lib/errors/user-facing-message";
import { Input } from "../primitives/Input";
import { Textarea } from "../primitives/Textarea";
import NeonButton from "../modules/NeonButton";
import { ConfirmDialog } from "../modules/confirm-dialog";
import { attentionItemLabel } from "./card-attention";
import {
  ASPECT_VALUE_MAX,
  LISTING_TITLE_MAX,
  TitleFieldNote,
  TitleLengthAlert,
  TitleLengthMeter,
  titleLengthState,
} from "./TitleLengthMeter";
import { useTitlePreview } from "./useTitlePreview";
import { oneLine } from "./card-titles";
import {
  goToSetNameInTitles,
  useSetNameInTitlesReachable,
} from "./set-name-in-titles-jump";
import type { AttentionFixerProps } from "./cardAttentionRegistry";

/**
 * NEO-101 — the fixer for every title-shaped attention item:
 * `titleOverLimit`, `titleTruncated` and `aspectValueOverLimit`.
 *
 * ## Why one component for three kinds
 *
 * All three are the same sentence with a different reason: "this card's title
 * does not fit, rewrite it". Splitting them into three registry entries would
 * mean a card flagged for two of them gets asked twice, on two screens, about
 * one field — and the second ask would be answered already. So this fixer reads
 * ALL of the card's items (the locked contract hands it the whole list for
 * exactly this reason), states each one, and takes a single write that clears
 * whichever of them apply.
 *
 * ## What it shows, and why that is all
 *
 * - **The card number anchors it**, the way `MissingTeamFixer` does — `#300b`
 *   in neon green, then the name, so the operator recognises the card before
 *   reading the question. No marketplace ref appears anywhere.
 * - **The reasons are listed, not summarised.** "84 characters" and "auto title
 *   was cut short" are different problems with different fixes, and a card can
 *   have both.
 * - **The counter is the same component the drawer uses.** An operator who
 *   learns the bands in one place must not meet a different rule in the other —
 *   see the note on TitleLengthMeter.
 * - **The variation field appears only when it is the problem.** A card flagged
 *   only for its title should not be shown a second field to worry about; the
 *   drawer is where you edit a card, this is where you fix one thing.
 *
 * ## Enter, and what "disabled" means here
 *
 * Enter in either the title or the variation field saves, matching every
 * other keyboard-first dialog in this directory. Save is `aria-disabled`
 * rather than natively disabled while the title is over the cap: native
 * `disabled` removes it from the tab order, and the alert saying WHY it is
 * inert is reached through its `aria-describedby` — the NEO-189 stranding
 * finding, one level up. It is guarded in the handler too, so being
 * activatable costs nothing.
 *
 * The two text inputs get the same `aria-disabled`-not-`disabled` treatment
 * while `busy` (paired with `readOnly` to still block edits) — audit fix,
 * NEO-101: unlike `MissingTeamFixer`'s Enter handler, which lives on an outer
 * wrapper that explicitly excludes INPUT/BUTTON targets, Enter here is bound
 * to the input itself, so `save()`'s `setBusy(true)` would otherwise natively
 * disable the very field that has focus mid-keystroke — the browser force-
 * blurs a newly-disabled focused control to `<body>`, the same focus-park-
 * pattern failure class this codebase has hit and fixed several times
 * (NEO-152, NEO-189, NEO-102's own Fixer siblings).
 */
/** NEO-535 copy, in the NB voice. */
export const TOO_LONG = "Too long to list as-is. Trim it here, or shorten the set name for the whole row.";
/** Said when the title drops back under the cap. */
export const FITS_NOW = "Fits now. Enter saves it.";
const SET_NAME_HOGGING = "Set name hogging it?";
export const TRIM_SET_NAME = "Trim Set name in titles";
/** "Trim Set name in titles" with a typed title that can't be saved first. */
export const TOSS_TYPED_TITLE = "Toss what you typed?";
const TOSS_TYPED_DESCRIPTION =
  "The title's still too long to save, so your typing won't come along. This card keeps what it has now.";
export const TOSS_TYPED_CONFIRM = "Toss it and go";
const TOSS_TYPED_BUSY = "Heading over…";

/** Over the cap, the way the meter and the save guard both count it. */
const overCap = (text: string) => titleLengthState(text.length, LISTING_TITLE_MAX, true).over;

export default function TitleFixer({ row, items, onSaved }: AttentionFixerProps) {
  const updateCard = useMutation(api.selectorOptions.updateCard);

  const [title, setTitle] = useState(row.listingTitle ?? "");
  const [variation, setVariation] = useState(row.cardVariation ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const uid = useId();
  const titleAlertId = `${uid}-title-limit`;
  const saveHintId = `${uid}-save-hint`;
  const variationAlertId = `${uid}-variation-limit`;

  // a11y (NEO-535) — the over-cap line is always mounted. It speaks politely
  // when a card arrives over the cap (the field's description reads it too),
  // as an alert only when the operator's own keystroke takes the title over,
  // and politely again ("Fits now.") when the title drops back under.
  const [overByKeystroke, setOverByKeystroke] = useState(false);
  const [fitsNow, setFitsNow] = useState(false);
  const latestTitle = useRef(title);
  const changeTitle = useCallback((next: string, byKeystroke: boolean) => {
    const wasOver = overCap(latestTitle.current);
    const nowOver = overCap(next);
    latestTitle.current = next;
    if (nowOver && !wasOver) setOverByKeystroke(byKeystroke);
    if (nowOver) setFitsNow(false);
    else if (wasOver) setFitsNow(true);
    setTitle(next);
  }, []);
  const applyGenerated = useCallback((next: string) => changeTitle(next, false), [changeTitle]);
  const [confirmingTrim, setConfirmingTrim] = useState(false);

  const preview = useTitlePreview(row._id, applyGenerated);

  // Only the fields the card was actually flagged for get edited — and written.
  const fixesVariation = items.some((i) => i.kind === "aspectValueOverLimit");
  // NEO-535 — an over-cap title is also flagged "cut short" when it was built
  // from the box; "cut short" beside "too long" contradicts itself, so the
  // longer problem speaks for both.
  const isOverLimit = items.some((i) => i.kind === "titleOverLimit");
  const reasons = isOverLimit ? items.filter((i) => i.kind !== "titleTruncated") : items;
  const canGoToSetName = useSetNameInTitlesReachable();

  const titleState = titleLengthState(title.length, LISTING_TITLE_MAX, true);
  const leftOut = useMemo(() => preview.leftOutOf(title), [preview, title]);
  const titleDirty = title !== (row.listingTitle ?? "");
  const variationDirty = fixesVariation && variation !== (row.cardVariation ?? "");
  const canSave = !busy && !titleState.over;

  // Focus the field the operator is here to edit. The walker remounts this
  // component per card (`key={current._id}`), so this IS "focus on every
  // advance": focus is never left on a control belonging to the card just
  // answered (the NEO-189 stranding finding).
  useEffect(() => {
    const raf = requestAnimationFrame(() => titleRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      // Only the fields on screen. A fixer that wrote the whole row would
      // stomp an edit made in another tab between the walker opening and this
      // click — and it has nothing to say about the fields it never showed.
      await updateCard({
        id: row._id,
        listingTitle: title.trim(),
        ...(fixesVariation ? { cardVariation: variation.trim() } : {}),
      });
      onSaved();
    } catch (e) {
      // ConvexError `data` is the only text that crosses intact — production
      // redacts a plain Error to "Server Error". Shown inline, never as a
      // toast: the fix is in this field, so the reason belongs beside it.
      setError(userFacingMessage(e, "Couldn't save that title. Try again."));
    } finally {
      setBusy(false);
    }
  };

  /**
   * NEO-535 (a11y) — "Trim Set name in titles" closes the walker, which would
   * drop anything typed here. Untouched: go. Typed: ask first (Toss / Cancel).
   * Never save-first: the door shows only while the title is over the cap,
   * so what was typed can never be saved as it stands.
   */
  const trimSetName = () => {
    if (busy) return;
    if (titleDirty || variationDirty) setConfirmingTrim(true);
    else goToSetNameInTitles();
  };

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-xs text-notice-danger-ink">
          {error}
        </p>
      )}

      <div>
        <h3 className="text-sm font-semibold text-ink-2">
          <span className="text-neon-green-text">#{row.cardNumber}</span> {row.cardName}
        </h3>
        {/* a11y (1.3.1): `list-style: none` strips the implicit list/listitem
            role in Safari + VoiceOver. `role="list"` restores it so a screen
            reader still announces "list, N items" for the reasons below. */}
        <ul role="list" className="mt-0.5 list-none text-xs text-ink-3">
          {reasons.map((item) => (
            <li key={item.kind}>{attentionItemLabel(item)}</li>
          ))}
        </ul>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between gap-2 text-xs uppercase tracking-wide text-ink-3">
          <span>Card title</span>
          <span className="flex items-center gap-2">
            <TitleLengthMeter length={title.length} soft />
            <button
              type="button"
              onClick={() => preview.request(titleDirty)}
              // a11y (2.5.3): the visible label cycles through "Rebuilding…"
              // and "Replace?", neither of which is a substring of a fully
              // static name — a voice-control user saying the visible word
              // would not match. The "Replace?" case is left as the fixed
              // string on purpose: CardDetailPanel's own copy of this button
              // is asserted on by name in CardDetailPanel.titleLimits.test.tsx
              // while `confirming` is true, so the two must keep matching
              // names in that state. The confirm status text below (wired via
              // aria-describedby) already tells a screen-reader user what a
              // second click does either way.
              aria-label={
                preview.loading ? "Regenerate card title — rebuilding" : "Regenerate card title"
              }
              aria-describedby={
                preview.confirming ? `${uid}-regen-confirm` : undefined
              }
              // a11y (2.5.8): min-h-6 lifts the label line to a 24px target;
              // the caption type stays as it was.
              className="inline-flex min-h-6 items-center rounded px-1 uppercase tracking-wide text-neon-blue-text underline decoration-dotted focus-outline hover:text-ink"
            >
              {preview.loading
                ? "Rebuilding…"
                : preview.confirming
                  ? "Replace?"
                  : "Regenerate"}
            </button>
          </span>
        </div>
        {/* NEO-535: the drawer's title field shape — wraps and grows with
            its text (two lines to start), so a long title is in view whole on
            a phone. Enter still saves, and a pasted line break reads as a
            space: a title is one line. */}
        <Textarea
          bare
          ref={titleRef}
          rows={2}
          value={title}
          onChange={(e) => {
            changeTitle(oneLine(e.target.value), true);
            preview.cancelConfirm();
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            void save();
          }}
          // No maxLength: a pasted over-length title must stay visible to be
          // fixable. See the same note in CardDetailPanel.
          // The held look (readOnly + aria-disabled while busy) is the
          // Textarea primitive's own; no fade here.
          className="block w-full resize-none p-1.5 text-sm [field-sizing:content]"
          // Anchored to the card number so it cannot collide with the drawer's
          // own "Card title" field in a selector — Maestro's `id:` matcher
          // takes a regex, so `Card title for #.*` still targets it.
          aria-label={`Card title for #${row.cardNumber}`}
          aria-invalid={titleState.over || undefined}
          // The save hint says Enter saves: a wrapping field reads as one
          // where Enter makes a new line.
          aria-describedby={[titleState.over ? titleAlertId : null, saveHintId]
            .filter(Boolean)
            .join(" ")}
          // a11y (audit fix): native `disabled` here would strand focus. Enter
          // in THIS field is what sets `busy` — the moment it goes native-
          // disabled, the browser force-blurs the very input that had focus,
          // straight to <body> (the codebase's recurring focus-park-pattern
          // bug, see accessibility-auditor/focus-park-pattern.md). `readOnly`
          // blocks edits without removing the field from the tab order;
          // `aria-disabled` announces the state. The `canSave` guard in
          // `save()` already makes a second Enter/click harmless, so nothing
          // relies on the native attribute for correctness.
          aria-disabled={busy || undefined}
          readOnly={busy}
        />
        {/* NEO-535 — ONE message for a title past the cap, where there used
            to be three (the length alert, "cut short" and "Left out to
            fit"). Its text never changes while the operator trims; the meter
            above carries the count. Always mounted (a11y): polite on arrival,
            an alert only when a keystroke crosses the cap, and "Fits now."
            when the title drops back under. */}
        <p
          id={titleAlertId}
          role={titleState.over && overByKeystroke ? "alert" : "status"}
          aria-atomic="true"
          className={`mt-1 text-xs empty:hidden ${titleState.over ? "text-notice-danger-ink" : "text-neon-green-text"}`}
        >
          {titleState.over ? TOO_LONG : fitsNow ? FITS_NOW : ""}
        </p>
        {titleState.over && (
          <div className="mt-0.5">
            {canGoToSetName && (
              // The lead, then the way out of it: a quiet neutral action
              // (DESIGN.md: `secondary outline`), size 1 for a 24px target.
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="text-xs text-ink-2">{SET_NAME_HOGGING}</p>
                <NeonButton variant="secondary" outline size="1" type="button" onClick={trimSetName}>
                  {TRIM_SET_NAME}
                </NeonButton>
              </div>
            )}
          </div>
        )}
        {preview.confirming && (
          <p
            id={`${uid}-regen-confirm`}
            role="status"
            aria-atomic="true"
            className="mt-1 text-xs text-neon-blue-text"
          >
            Regenerate again to replace the title you have typed.
          </p>
        )}
        {/* NEO-535: read from the text in the field now, so retyping a
            cut word takes it off the note. Not over the cap: there the one
            message above says what to do, and what else the title lacks
            only matters once it fits. It also says what "cut short" meant,
            so that note is gone. */}
        {!titleState.over && leftOut.length > 0 && (
          <TitleFieldNote>
            Left out to fit: {leftOut.join(", ")}
          </TitleFieldNote>
        )}
        {preview.chips.length > 0 && (
          <ul aria-label="Title built from" className="mt-1.5 flex flex-wrap gap-1">
            {preview.chips.map((chip, idx) => (
              <li
                key={`${chip.label}-${chip.value}-${idx}`}
                className="rounded-full border border-rule-strong bg-raised/60 px-2 py-0.5 text-xs text-ink-2"
              >
                <span className="mr-1 uppercase tracking-wide text-ink-3">
                  {chip.label}
                </span>
                {chip.value}
              </li>
            ))}
          </ul>
        )}
      </div>

      {fixesVariation && (
        <div>
          <div className="mb-1 flex items-center justify-between gap-2 text-xs uppercase tracking-wide text-ink-3">
            <span>Variation</span>
            <TitleLengthMeter length={variation.length} max={ASPECT_VALUE_MAX} />
          </div>
          <Input
            bare
            type="text"
            value={variation}
            onChange={(e) => setVariation(e.target.value)}
            // a11y (audit fix): matches the title field's Enter handler —
            // without this, an operator whose card was flagged ONLY for
            // `aspectValueOverLimit` (this is the only field shown) had no
            // keyboard way to save short of tabbing to the button, breaking
            // this directory's "Enter confirms" convention (see TitleFixer's
            // own header note, and CLAUDE.md's keyboard-first rule).
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              void save();
            }}
            className="w-full p-1.5 text-sm"
            aria-label={`Card variation for #${row.cardNumber}`}
            aria-describedby={[
              variation.length > ASPECT_VALUE_MAX ? variationAlertId : null,
              saveHintId,
            ]
              .filter(Boolean)
              .join(" ")}
            // a11y (audit fix): same reasoning as the title field above — this
            // field can now also trigger `save()` on Enter while it holds
            // focus, so native `disabled` here is the same stranding hazard.
            aria-disabled={busy || undefined}
            readOnly={busy}
          />
          <TitleLengthAlert
            id={variationAlertId}
            length={variation.length}
            max={ASPECT_VALUE_MAX}
            what="Variation"
            blocking={false}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <NeonButton
          aria-disabled={canSave ? undefined : true}
          aria-describedby={titleState.over ? titleAlertId : saveHintId}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save (Enter)"}
        </NeonButton>
      </div>
      {/* gray-400, not gray-500: 500 measures 3.67:1 on this dialog's
          bg-gray-900 and fails 1.4.3 — the recurring bug logged in
          accessibility-auditor/contrast-reference.md. */}
      <p id={saveHintId} className="text-xs text-ink-3">
        {fixesVariation
          ? "Enter saves the title and variation on this card."
          : "Enter saves the title on this card."}
      </p>
      {confirmingTrim && (
        // Not portalled: it sits inside the walker. Its Escape and Tab stop
        // here, so the walker's own Escape (close) and Tab trap never see
        // them while it is up.
        <div
          onKeyDown={(event) => {
            if (event.key === "Escape" || event.key === "Tab") event.stopPropagation();
          }}
        >
          <ConfirmDialog
            title={TOSS_TYPED_TITLE}
            description={TOSS_TYPED_DESCRIPTION}
            confirmLabel={TOSS_TYPED_CONFIRM}
            busyLabel={TOSS_TYPED_BUSY}
            busy={false}
            onConfirm={() => {
              setConfirmingTrim(false);
              goToSetNameInTitles();
            }}
            onCancel={() => setConfirmingTrim(false)}
          />
        </div>
      )}
    </div>
  );
}
