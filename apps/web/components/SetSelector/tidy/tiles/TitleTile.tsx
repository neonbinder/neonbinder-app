import { useCallback, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { assessListingTitle, titleDescription } from "../../../../convex/features/generateListing";
import { MAX_LISTING_SHORT_NAME_LENGTH } from "../../../../convex/listingShortName";
import { userFacingMessage } from "@/lib/errors/user-facing-message";
import { Input } from "../../../primitives/Input";
import { Textarea } from "../../../primitives/Textarea";
import NeonButton from "../../../modules/NeonButton";
import { oneLine } from "../../card-titles";
import { AUTO_TITLE_CUT_TEXT } from "../../title-copy";
import {
  ASPECT_VALUE_MAX,
  LISTING_TITLE_MAX,
  OVER_FIELD_CLASS,
  TitleLengthAlert,
  TitleLengthMeter,
  overFieldProps,
  titleLengthState,
} from "../../TitleLengthMeter";
import { useTitlePreview } from "../../useTitlePreview";
import { SOURCES_WITH_CHECKLIST, SOURCE_KEYS } from "../../reconciliation-sources";
import { useAnswered } from "../answered";
import { useInlinePart } from "../inline-stack";
import TidyTile, { ApplyToAllButton, TidyNote, WRAP_LABEL_CLASS, type TidyTileLevel } from "../TidyTile";
import type { TidyTileProps } from "../tile-types";

/**
 * NEO-645 callout 7 — "Listing title".
 *
 * - Pink over 80 characters, and then it opens ready to edit. Blue when the
 *   generated title was cut to fit (`titleCut`) or the variation is over the
 *   item-specific cap (`variationOverLimit`). Plain otherwise, because the
 *   tile also carries the purple notes ("Left out", "Numbers didn't match"),
 *   which only ever show on a card that is already a stop.
 * - Regenerate keeps its name. It rebuilds the title (and, like the side
 *   panel's, the description) and saves it when it fits.
 * - "Shorten the set name for every card" opens the set-name field inline.
 *   This card's title updates live as the name is typed; Save writes the name
 *   and retitles every card (`tidyCards.applySetNameToTitles`).
 * - The variation editor appears for `variationOverLimit` only: a variation
 *   over the item-specific cap, the one case the old Card titles step offered
 *   the trim. After a save, "Apply to the N cards with the same variation"
 *   offers the trim to the rest.
 *
 * Everything saves as it is answered (J1) and opens inline, never in a dialog.
 */

/** `tidyCards.MAX_APPLY_CARDS`, hand-copied: the server graph cannot be imported here. Keep in step. */
const MAX_APPLY_CARDS = 100;

const OVER_TEXT = "Over the limit, so it opens ready to edit.";
const FITS_NOW = "Fits now. Enter saves it.";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * One frame after a save closed the part the operator was in: if focus fell to
 * the page (the focused field or button unmounted), the save was an ANSWER and
 * `answered` moves focus on; if it is on a live control (Regenerate, which also
 * saves), leave it there.
 */
function answeredIfLost(answered: () => void) {
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    answered();
  });
}

export default function TitleTile(props: TidyTileProps) {
  // One body per card: a drafted title or an open field never carries over.
  return <TitleTileBody key={props.row._id} {...props} />;
}

function TitleTileBody({ row, attention, leafId, leafCards, setName }: TidyTileProps) {
  const updateCard = useMutation(api.selectorOptions.updateCard);
  const applySetNameToTitles = useMutation(api.tidyCards.applySetNameToTitles);
  const applyVariation = useMutation(api.tidyCards.applyVariation);
  const uid = useId();
  const answered = useAnswered();

  const stored = row.listingTitle ?? "";
  const over = attention.items.some((i) => i.kind === "titleOverLimit");
  const cut = attention.items.some((i) => i.kind === "titleCut");
  const variationOver = attention.items.some((i) => i.kind === "variationOverLimit");
  const level: TidyTileLevel = over ? "fix" : cut || variationOver ? "check" : "plain";

  // ── the title field ───────────────────────────────────────────────────
  // `draft` is null while the title is shown as text; an over-cap title opens
  // already in edit mode.
  const [draft, setDraft] = useState<string | null>(over ? stored : null);
  const [openedByOperator, setOpenedByOperator] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overByKeystroke, setOverByKeystroke] = useState(false);
  const [fitsNow, setFitsNow] = useState(false);
  // The operator has typed in the title box themselves: their words stay, and a
  // set-name preview stops replacing them.
  const [typedOwn, setTypedOwn] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const editButtonRef = useRef<HTMLButtonElement | null>(null);
  const editing = draft !== null;
  const text = draft ?? stored;

  const closeEditor = () => {
    setDraft(null);
    setOpenedByOperator(false);
    setFitsNow(false);
    setTypedOwn(false);
    requestAnimationFrame(() => editButtonRef.current?.focus());
  };
  // An editor that opened itself (over the cap) does not own Esc until the
  // operator touches it, so Esc on arrival still means "Save for later".
  useInlinePart(editing && openedByOperator, closeEditor, titleRef);

  const saveTitle = useCallback(
    async (next: string, regenerate = false) => {
      const trimmed = oneLine(next).trim();
      if (!trimmed || titleLengthState(trimmed.length, LISTING_TITLE_MAX, true).over) return false;
      setBusy(true);
      setError(null);
      try {
        await updateCard({ id: row._id, listingTitle: trimmed });
        if (regenerate) {
          // Like the side panel's Regenerate: a description that reads as the
          // builder's own is rebuilt; one the operator wrote is left alone.
          await updateCard({ id: row._id, regenerateDescription: true }).catch(() => undefined);
        }
        setDraft(null);
        setOpenedByOperator(false);
        setFitsNow(false);
        setTypedOwn(false);
        // The field and its Save button are gone; the walk moves focus on.
        answeredIfLost(answered);
        return true;
      } catch (e) {
        setError(userFacingMessage(e, "Didn't save, try again."));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [row._id, updateCard, answered],
  );

  const applyGenerated = useCallback(
    (title: string) => {
      setDraft(title);
      setFitsNow(false);
      setOverByKeystroke(false);
      setTypedOwn(false);
      void saveTitle(title, true);
    },
    [saveTitle],
  );
  const preview = useTitlePreview(row._id, applyGenerated);
  const previewData = useQuery(api.selectorOptions.previewListingTitle, { cardId: row._id });

  // ── the set name ──────────────────────────────────────────────────────
  const [shortening, setShortening] = useState(false);
  const [setNameDraft, setSetNameDraft] = useState("");
  const [setNameBusy, setSetNameBusy] = useState(false);
  const [setNameError, setSetNameError] = useState<string | null>(null);
  const [setNameSaved, setSetNameSaved] = useState<string | null>(null);
  const setNameRef = useRef<HTMLInputElement | null>(null);
  const shortenButtonRef = useRef<HTMLButtonElement | null>(null);
  const setNamePanelRef = useRef<HTMLDivElement | null>(null);
  const closeSetName = () => {
    setShortening(false);
    requestAnimationFrame(() => shortenButtonRef.current?.focus());
  };
  useInlinePart(shortening, closeSetName, setNamePanelRef);

  const livePreviewTitle = useMemo(() => {
    if (!shortening || !previewData?.inputs) return null;
    const box = setNameDraft.trim();
    return assessListingTitle({ ...previewData.inputs, setShortName: box || undefined }).title;
  }, [shortening, previewData, setNameDraft]);

  const applySetName = async () => {
    const name = setNameDraft.trim();
    if (!name || setNameBusy) return;
    setSetNameBusy(true);
    setSetNameError(null);
    try {
      const result: { scheduled: boolean } = await applySetNameToTitles({
        leafId,
        cardId: row._id,
        listingShortName: name,
        regenerateListing: true,
      });
      setSetNameSaved(
        result.scheduled
          ? "Set name saved. The other cards' titles are updating."
          : "Set name saved.",
      );
      setShortening(false);
      setDraft(null);
      // The panel (field, Save and apply, Cancel) is gone with the save.
      answered();
    } finally {
      setSetNameBusy(false);
    }
  };

  // ── the variation ─────────────────────────────────────────────────────
  const [variationFrom] = useState(() => (row.cardVariation ?? "").trim());
  const [variationDraft, setVariationDraft] = useState(row.cardVariation ?? "");
  const [variationSaved, setVariationSaved] = useState<string | null>(null);
  const [variationBusy, setVariationBusy] = useState(false);
  // Said into an always-mounted status line, empty until a save lands (the tile
  // opens with nothing to announce), and cleared when a save starts so a second
  // save of the same words is a change again.
  const [variationNote, setVariationNote] = useState("");
  const [variationError, setVariationError] = useState<string | null>(null);
  // Only a variation over the aspect cap is offered for trimming; once saved it
  // stays open so "Apply to the N cards" can offer the trim to the rest.
  const showVariation = variationOver || variationSaved !== null;

  const saveVariation = async () => {
    const next = variationDraft.trim();
    if (variationBusy || next === (row.cardVariation ?? "").trim()) return;
    setVariationBusy(true);
    setVariationError(null);
    setVariationNote("");
    try {
      await updateCard({ id: row._id, cardVariation: next, regenerateListing: true });
      setVariationSaved(next);
      setVariationNote("Variation saved.");
    } catch (e) {
      setVariationError(userFacingMessage(e, "Didn't save, try again."));
    } finally {
      setVariationBusy(false);
    }
  };

  const sameVariation = useMemo(
    () =>
      variationSaved === null
        ? []
        : leafCards
            .filter((c) => c._id !== row._id && (c.cardVariation ?? "").trim() === variationFrom)
            .slice(0, MAX_APPLY_CARDS),
    [variationSaved, variationFrom, leafCards, row._id],
  );

  // ── what to say about the title ───────────────────────────────────────
  // While the set name is being shortened, the title (the box too, when it is
  // open) shows this card with the new set name as it is typed, until the
  // operator types a title of their own.
  const shown = livePreviewTitle !== null && !typedOwn ? livePreviewTitle : text;
  const state = titleLengthState(shown.length, LISTING_TITLE_MAX, true);
  // A name still waiting for its answer (a player or team not made yet) is not
  // in the title because it is unanswered, not because it did not fit.
  const waitingNames = useMemo(
    () => [...(row.pendingPlayerNames ?? []), ...(row.pendingTeamNames ?? [])],
    [row.pendingPlayerNames, row.pendingTeamNames],
  );
  const leftOut = useMemo(
    () => preview.leftOutOf(text, waitingNames),
    [preview, text, waitingNames],
  );

  const changeTitle = (next: string) => {
    const wasOver = titleLengthState(shown.length, LISTING_TITLE_MAX, true).over;
    const nowOver = titleLengthState(next.length, LISTING_TITLE_MAX, true).over;
    setOverByKeystroke(nowOver && (wasOver ? overByKeystroke : true));
    if (nowOver) setFitsNow(false);
    else if (wasOver) setFitsNow(true);
    setTypedOwn(true);
    setDraft(next);
  };
  const titleAlertId = `${uid}-title-limit`;
  const variationAlertId = `${uid}-variation-limit`;
  const nbNumbers = row.sourceNumbers;
  const mismatched = useMemo(() => {
    if (!nbNumbers) return null;
    const named = SOURCE_KEYS.flatMap((key) => {
      const num = nbNumbers[key];
      return num ? [{ key, num }] : [];
    });
    if (!named.some((n) => n.num !== row.cardNumber)) return null;
    return named
      .map((n) => `${SOURCES_WITH_CHECKLIST.find((s) => s.key === n.key)?.label ?? n.key} ${n.num}`)
      .join(", ");
  }, [nbNumbers, row.cardNumber]);

  return (
    <TidyTile
      heading="Listing title"
      level={level}
      aside={<TitleLengthMeter length={shown.length} soft />}
    >
      {editing ? (
        <Textarea
          bare
          ref={titleRef}
          rows={2}
          value={shown}
          onChange={(e) => {
            changeTitle(oneLine(e.target.value));
            preview.cancelConfirm();
          }}
          onFocus={() => setOpenedByOperator(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void saveTitle(shown);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              closeEditor();
            }
          }}
          readOnly={busy}
          aria-disabled={busy || undefined}
          className={`block w-full resize-none p-1.5 text-sm [field-sizing:content] ${OVER_FIELD_CLASS}`}
          aria-label={`Card title for #${row.cardNumber}`}
          aria-invalid={state.over || undefined}
          {...overFieldProps(state.over)}
          aria-describedby={state.over ? titleAlertId : undefined}
        />
      ) : (
        <p className="text-sm text-ink wrap-anywhere">{shown || "No title yet"}</p>
      )}

      <p
        id={titleAlertId}
        role={state.over && overByKeystroke ? "alert" : "status"}
        aria-atomic="true"
        className={`text-xs empty:hidden ${state.over ? "text-neon-pink-text" : "text-neon-green-text"}`}
      >
        {state.over ? OVER_TEXT : fitsNow ? FITS_NOW : ""}
      </p>
      {/* Mounted for the life of the tile, so the sentence is a change to a live
          region that is already in the page. */}
      <p role="status" aria-atomic="true" className="text-xs text-neon-blue-text empty:hidden">
        {preview.confirming ? "Regenerate again to replace the title you have typed." : ""}
      </p>

      {cut && !state.over && leftOut.length === 0 && (
        <p className="text-sm text-ink-2">{AUTO_TITLE_CUT_TEXT}</p>
      )}
      {/* One form, cut or not: the purple note. */}
      {!state.over && leftOut.length > 0 && (
        <TidyNote>Left out to fit: {leftOut.join(", ")}</TidyNote>
      )}
      {mismatched && <TidyNote>Numbers didn't match: {mismatched}</TidyNote>}

      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <NeonButton
            variant="primary"
            size="1"
            type="button"
            aria-disabled={busy || state.over || !shown.trim() || undefined}
            onClick={() => void saveTitle(shown)}
          >
            {busy ? "Saving…" : "Save title"}
          </NeonButton>
        ) : (
          <NeonButton
            ref={editButtonRef}
            variant="secondary"
            outline
            size="1"
            type="button"
            onClick={() => {
              setDraft(stored);
              setOpenedByOperator(true);
              requestAnimationFrame(() => titleRef.current?.focus());
            }}
          >
            Edit title
          </NeonButton>
        )}
        <NeonButton
          variant="secondary"
          outline
          size="1"
          type="button"
          aria-label={preview.loading ? "Regenerate card title, rebuilding" : "Regenerate card title"}
          aria-disabled={preview.loading || busy || undefined}
          onClick={() => preview.request(editing && text !== stored)}
        >
          Regenerate
        </NeonButton>
        <NeonButton
          ref={shortenButtonRef}
          variant="secondary"
          outline
          size="1"
          type="button"
          className={WRAP_LABEL_CLASS}
          aria-expanded={shortening}
          aria-controls={shortening ? `${uid}-set-name` : undefined}
          onClick={() => {
            if (shortening) {
              closeSetName();
              return;
            }
            // What the titles open with now: the set's stored short name, else
            // the builder's own description ("1996 Score Dugout Collection …"),
            // never the set row's bare name, which no title says on its own.
            const inputs = previewData?.inputs;
            const current = inputs
              ? inputs.setShortName?.trim() ||
                titleDescription({ ...inputs, setShortName: undefined }).slice(0, MAX_LISTING_SHORT_NAME_LENGTH).trim()
              : "";
            setSetNameDraft(current || setName);
            setSetNameSaved(null);
            setShortening(true);
            requestAnimationFrame(() => setNameRef.current?.focus());
          }}
        >
          Shorten the set name for every card
        </NeonButton>
      </div>
      <p role="alert" className="text-xs text-neon-pink-text empty:hidden">
        {error}
      </p>
      <p role="status" className="text-xs text-neon-green-text empty:hidden">
        {setNameSaved}
      </p>

      {shortening && (
        <div
          ref={setNamePanelRef}
          id={`${uid}-set-name`}
          className="grid gap-2 rounded-lg border border-rule-strong bg-raised-deep p-2.5"
        >
          <p className="text-xs font-medium text-ink">Set name in titles</p>
          <Input
            bare
            ref={setNameRef}
            type="text"
            value={setNameDraft}
            onChange={(e) => setSetNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applySetName().catch((err: unknown) =>
                  setSetNameError(userFacingMessage(err, "Didn't save, try again.")),
                );
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                closeSetName();
              }
            }}
            readOnly={setNameBusy}
            aria-label="Set name in titles"
            className="w-full p-1.5 text-sm"
            placeholder="A shorter name for the set"
          />
          <p className="text-xs text-ink-3 wrap-anywhere">{`Was “${setName}”`}</p>
          <p className="text-xs text-ink-2">
            The title above shows this card with the new set name as you type.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <ApplyToAllButton
              count={setNameDraft.trim() ? leafCards.length : 0}
              label={`Save and apply to all ${plural(leafCards.length, "card", "cards")}`}
              onApply={applySetName}
            />
            <NeonButton
              variant="negative"
              outline
              size="1"
              type="button"
              aria-label="Cancel set name change"
              onClick={closeSetName}
            >
              Cancel
            </NeonButton>
          </div>
          <p role="alert" className="text-xs text-neon-pink-text empty:hidden">
            {setNameError}
          </p>
        </div>
      )}

      {showVariation && (
        <div className="grid gap-1.5 border-t border-rule pt-2">
          <div className="flex items-center justify-between gap-2 text-xs text-ink-2">
            <span>Variation</span>
            <TitleLengthMeter length={variationDraft.length} max={ASPECT_VALUE_MAX} />
          </div>
          <Input
            bare
            type="text"
            value={variationDraft}
            onChange={(e) => setVariationDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void saveVariation();
              }
            }}
            readOnly={variationBusy}
            aria-label="Trim the variation"
            className={`w-full p-1.5 text-sm ${OVER_FIELD_CLASS}`}
            {...overFieldProps(variationDraft.length > ASPECT_VALUE_MAX)}
            aria-describedby={variationDraft.length > ASPECT_VALUE_MAX ? variationAlertId : undefined}
          />
          <TitleLengthAlert
            id={variationAlertId}
            length={variationDraft.length}
            max={ASPECT_VALUE_MAX}
            what="Variation"
            blocking={false}
          />
          <div className="flex flex-wrap items-center gap-2">
            <NeonButton
              variant="primary"
              size="1"
              type="button"
              aria-disabled={variationBusy || undefined}
              onClick={() => void saveVariation()}
            >
              {variationBusy ? "Saving…" : "Save variation"}
            </NeonButton>
            {variationSaved !== null && (
              <ApplyToAllButton
                count={sameVariation.length}
                label={`Apply to the ${plural(sameVariation.length, "card", "cards")} with the same variation`}
                onApply={() =>
                  applyVariation({
                    cardIds: sameVariation.map((c) => c._id),
                    from: variationFrom,
                    to: variationSaved,
                  })
                }
              />
            )}
          </div>
          <p role="alert" className="text-xs text-neon-pink-text empty:hidden">
            {variationError}
          </p>
          <p role="status" className="text-xs text-neon-green-text empty:hidden">
            {variationNote}
          </p>
        </div>
      )}
    </TidyTile>
  );
}
