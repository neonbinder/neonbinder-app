import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Textarea } from "../primitives/Textarea";
import NeonButton from "../modules/NeonButton";
import {
  checkShortNameAnswer,
  type TitleContext,
} from "../../convex/features/listingInputs";
import { MAX_LISTING_SHORT_NAME_LENGTH } from "../../convex/listingShortName";
import {
  ASPECT_VALUE_MAX,
  LISTING_TITLE_MAX,
  OVER_FIELD_CLASS,
  overFieldProps,
  TitleLengthMeter,
} from "./TitleLengthMeter";
import {
  buildTitleGroups,
  oneLine,
  retitleDraftsForSetName,
  setNameInTitlesPrefill,
  type CardTitlesSource,
  type PreviewCardForTitles,
  type TitleAnswer,
  type TitleGroup,
  type TitleNameSources,
  type TitleRowView,
  type VariationGroup,
} from "./card-titles";
import type { TeamAnswer } from "./teams-on-cards";

/**
 * NEO-335 — the entity review wizard's "Card titles" step, after Teams.
 *
 * The sync-created title warnings (`titleTruncated`, `aspectValueOverLimit`),
 * asked BEFORE save on the cards that would be born with them, instead of by
 * the attention walker afterwards. `card-titles.ts` decides who is here and
 * what each title says; this draws it and reports the operator's edits up.
 *
 * Two short lists, the one that needs action first:
 *
 *   1. **Variations** too long to list — one field per distinct variation
 *      text, shared by every card that prints it, with a `72/65` meter. The
 *      operator trims it in place; untouched, the card saves as before and
 *      the walker's warn-only item stays.
 *   2. **Titles** that had to leave something out (Tidy Up) or still run over the cap
 *      (NEO-535: the builder never cuts description words to force a fit) —
 *      grouped by what the generated titles left out, each card's title in
 *      its own field, kept by default and editable in place, with the same
 *      `78/80` meter the drawer and the walker use. "Left out to fit" is read
 *      from the text in each field NOW (`leftOutOfTitle`): retyping a cut
 *      word takes it off the note. The group line says what every card on it
 *      is missing; each row says the rest. Groups are read from the generated
 *      titles before any draft, so they never reshuffle while typing.
 *
 * ## It never blocks a save
 *
 * There is no Save here and nothing here can stop the wizard's. A title typed
 * past the cap says "Too long to list as-is." and is not sent: the card saves
 * with its generated title and the walker asks after save, as before. Same for
 * a variation still over 65.
 *
 * ## Edits are local until they settle
 *
 * Each keystroke updates this step only; the wizard hears about it when the
 * field blurs, on Enter, a beat after typing stops, and when the step
 * unmounts — so a long wizard does not re-render per character, and no edit
 * is lost to a Next press.
 *
 * ## Keyboard
 *
 * Tab walks the fields. Enter settles the field in place (it never reaches
 * the wizard's own Enter). Escape undoes what was typed since the field took
 * focus, in place; with nothing to undo it is the wizard's Escape. Focus is
 * never taken on mount.
 *
 * ## Set name in titles (NEO-535)
 *
 * Whenever the step lists titles, one box ABOVE the lists holds the set's
 * whole description as titles open with it (year, maker, set, insert,
 * parallel), prefilled with the set's stored box text or else the builder's
 * own description (`setNameInTitlesPrefill`), capped at 80. It is sent only
 * when edited. Every listed title is regenerated with the edited text as it
 * is typed; the builder decides which cards it rewrites (NEO-637: exactly
 * the ones whose title shows the yellow "Left out to fit" line), and the
 * list itself never changes under the operator's typing. The same goes for
 * a title the operator edited by hand: when its row shows the line, the old
 * set-name text inside the edit is swapped for the new and the rest of the
 * edit is kept (the edit is dropped for the generated title when the old
 * text is no longer in it); when its row shows no line, the edit is left as
 * typed (`changeShort`). The draft settles up like the other edits
 * (`onShortNameChange`), and keys the same way: Enter settles in place,
 * Escape undoes in place.
 *
 * ## A long list is capped
 *
 * A long insert can put hundreds of cards here. The first
 * `TITLE_ROWS_SHOWN` rows are drawn; the rest are counted ("And N more, saved
 * as generated.") and save with their generated titles, exactly as an
 * untouched row does.
 *
 * ## Any source of cards (NEO-535)
 *
 * The wizard hands the step its preview cards. The parallel Card titles
 * dialog hands it a `source` instead (`CardTitlesSource`): a parallel's
 * stored cards, its box prefill, and a line for cards past the page. Same
 * fields, same keys, same groups; the dialog owns the Save.
 */

/** Approved copy (Jason, 2026-10-10). */
const VARIATION_LEAD = "Variation's too long to list. Trim it to 65.";
const TITLE_OVER = "Too long to list as-is.";

/** NEO-535 copy, in the NB voice (no sign-off needed, Jason reviews while testing). */
const TITLES_LEAD = "These titles had to leave something out or still run long. Check what went, then keep 'em or make 'em yours.";
const SHORT_LEAD = "Set name hogging the title? Trim it here and every title below gets it.";
const SHORT_LABEL = "Set name in titles";
const stillOverLine = (n: number) =>
  n === 0 ? "Every title fits now." : n === 1 ? "1 title still runs long." : `${n} titles still run long.`;
/** NEO-535 — an untouched prefill past the cap: not a fault, just not in use yet. */
const PREFILL_OVER = "Over 80, so it's sitting out. Trim it and your titles pick it up.";
const moreRowsLine = (n: number) => `And ${n} more, saved as generated.`;
const USE_GENERATED = "Use generated title";
/**
 * NEO-535 (a11y) — these fields wrap like a text box, where Enter would make a
 * new line; here it locks the field in. Every field is described by this.
 */
export const KEYS_HINT = "Enter locks a field in. Esc takes back what you just typed.";

/**
 * NEO-535 (a11y) — a section's landmark name. Scoped with the parallel's name
 * when the dialog holds several, so "Titles…" never names two regions.
 */
function sectionName(scope: string | undefined, lead: string): { "aria-label": string } | undefined {
  return scope ? { "aria-label": `${scope}: ${lead}` } : undefined;
}

/** Title rows drawn before the rest are counted instead (a long insert). */
export const TITLE_ROWS_SHOWN = 50;

// A title is one line (`oneLine`). The field wraps so the whole 80 characters
// are in view (an `<input>` would scroll most of the title out of sight, and
// seeing it is the point of the step), but a newline is never part of the value.

/**
 * Geometry for both fields: grows with its content (`field-sizing`), two lines
 * where that is unsupported, never resizable by hand.
 */
const FIELD_CLASS = "block w-full resize-none p-1.5 text-sm [field-sizing:content]";

/** How long typing pauses before the wizard hears about an edit. */
const SETTLE_MS = 300;

type Drafts = ReadonlyArray<TitleAnswer | undefined>;

const NO_POSITIONS: readonly number[] = [];

/** `answer` without `field`; undefined when nothing is left. */
function without(answer: TitleAnswer | undefined, field: keyof TitleAnswer): TitleAnswer | undefined {
  if (!answer) return undefined;
  const rest: TitleAnswer = { ...answer };
  delete rest[field];
  return Object.keys(rest).length > 0 ? rest : undefined;
}

function sameDrafts(a: Drafts, b: Drafts): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => JSON.stringify(x ?? null) === JSON.stringify(b[i] ?? null));
}

/** "#12 Mike Trout" — and a count when the same words would name two rows. */
function rowNames(cards: readonly TitleRowView[]): Map<number, string> {
  const base = (c: TitleRowView) => `#${c.cardNumber} ${c.cardName}`.trim();
  const total = new Map<string, number>();
  for (const c of cards) total.set(base(c), (total.get(base(c)) ?? 0) + 1);
  const seen = new Map<string, number>();
  const out = new Map<number, string>();
  for (const c of cards) {
    const name = base(c);
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    out.set(c.index, (total.get(name) ?? 0) > 1 ? `${name}, card ${n} of ${total.get(name)}` : name);
  }
  return out;
}

/** The props both sources share. */
type CardTitlesStepCommon = {
  /** The operator's edits so far, positionally aligned with the cards. */
  answers: ReadonlyArray<TitleAnswer | undefined>;
  /** Told the whole edit list whenever an edit settles. */
  onAnswersChange: (answers: Array<TitleAnswer | undefined>) => void;
  /**
   * NEO-535 — the "Set name in titles" edit as the host last heard it (kept
   * while the step unmounts); undefined = not edited, and the box shows its
   * prefill.
   */
  shortName?: string;
  /**
   * NEO-535 — told the box's text when it settles (blur, Enter, a beat after
   * typing, unmount): trimmed, and undefined unless the operator edited it
   * away from its prefill (blank counts as unedited). Absent: the step shows
   * no box.
   */
  onShortNameChange?: (value: string | undefined) => void;
  /** A commit is in flight; the fields hold still. */
  disabled?: boolean;
  /**
   * The id the step's lead line carries, so the wizard can describe its Next
   * button with it. On the titles lead (what Next does to them) when there
   * are titles on the step, else
   * on the variation lead. Generated when absent.
   */
  headingId?: string;
  /** 4 when the step sits under a host's own h3 (the parallel dialog's sections). */
  headingLevel?: 3 | 4;
};

/** The wizard's step: its preview cards. */
type PreviewCardsProps = {
  source?: undefined;
  /** The confirmed preview cards, in preview order. */
  cards: readonly PreviewCardForTitles[];
  /** `resolveChecklistEntities`' `titleContext`. */
  titleContext: TitleContext;
  /** The Teams step's answers, positionally aligned with `cards`. */
  teamAnswers?: ReadonlyArray<TeamAnswer | undefined>;
  /** The names decided in the wizard — see `TitleNameSources`. */
  names?: TitleNameSources;
  /** Positions that re-sync a stored row: never asked about. */
  existingIndexes?: readonly number[];
};

/** NEO-535 — any other source of cards (the parallel Card titles dialog). */
type SourceProps = {
  source: CardTitlesSource;
  cards?: undefined;
  titleContext?: undefined;
  teamAnswers?: undefined;
  names?: undefined;
  existingIndexes?: undefined;
};

export default function CardTitlesStep({
  source,
  cards,
  titleContext,
  teamAnswers,
  names,
  existingIndexes,
  answers,
  onAnswersChange,
  shortName,
  onShortNameChange,
  disabled = false,
  headingId,
  headingLevel = 3,
}: CardTitlesStepCommon & (PreviewCardsProps | SourceProps)) {
  const uid = useId();
  // How many answer positions there are: the preview's cards, or the source's.
  const count = source ? source.count : (cards?.length ?? 0);
  const [drafts, setDrafts] = useState<Array<TitleAnswer | undefined>>(() =>
    Array.from({ length: count }, (_, i) => answers[i]),
  );
  // The edits as the wizard last heard them.
  const settled = useRef<Drafts>(drafts);
  // Escape's undo point: the edits as they stood when a field took focus.
  // Not the settle point — that moves a beat after typing stops, and Escape
  // after a pause must still undo rather than fall through to the wizard.
  const undoPoint = useRef<Drafts>(drafts);
  const latest = useRef<Drafts>(drafts);
  // Synced after each render (never during one), and declared FIRST so every
  // effect below — the settle timer, the unmount flush — reads this render's.
  useEffect(() => {
    latest.current = drafts;
  }, [drafts]);

  const flush = useCallback(() => {
    const next = latest.current;
    if (sameDrafts(settled.current, next)) return;
    settled.current = next;
    onAnswersChange([...next]);
  }, [onAnswersChange]);

  useEffect(() => {
    const timer = setTimeout(flush, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [drafts, flush]);
  // The step leaving (Next, Back, Save) settles whatever was typed.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);
  useEffect(() => () => flushRef.current(), []);

  // NEO-535 — the box's prefill: the stored box text, else the builder's own
  // description. Read once: the box must not change under the operator.
  const [prefill] = useState(() =>
    source ? source.prefill : titleContext ? setNameInTitlesPrefill(titleContext) : "",
  );
  /** What the box reports: its trimmed text, only when edited away from the prefill. */
  const shortValue = useCallback(
    (raw: string): string | undefined => {
      const trimmed = raw.trim();
      return trimmed && trimmed !== prefill.trim() ? trimmed : undefined;
    },
    [prefill],
  );
  // The box's text, local until it settles (same reasons).
  const [shortDraft, setShortDraft] = useState<string>(() => shortName ?? prefill);
  const shortSettled = useRef<string | undefined>(shortValue(shortName ?? prefill));
  const shortLatest = useRef<string>(shortDraft);
  // Escape's undo point for the short name: its value when it took focus.
  const shortUndo = useRef<string>(shortDraft);
  useEffect(() => {
    shortLatest.current = shortDraft;
  }, [shortDraft]);
  // a11y — the box's text as of its last settle (blur, Enter, a beat after
  // typing, unmount). Its status and refusal are read from this, never from
  // each keystroke, so a screen reader hears the count once per pause.
  const [shortSettledText, setShortSettledText] = useState<string>(() => shortName ?? prefill);
  const flushShort = useCallback(() => {
    setShortSettledText(shortLatest.current);
    const next = shortValue(shortLatest.current);
    if (shortSettled.current === next) return;
    shortSettled.current = next;
    onShortNameChange?.(next);
  }, [onShortNameChange, shortValue]);
  useEffect(() => {
    const timer = setTimeout(flushShort, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [shortDraft, flushShort]);
  const flushShortRef = useRef(flushShort);
  useEffect(() => {
    flushShortRef.current = flushShort;
  }, [flushShort]);
  useEffect(() => () => flushShortRef.current(), []);

  const existing = existingIndexes ?? NO_POSITIONS;
  /** The step's lists for these drafts and box draft, from whichever source. */
  const groupsFor = useCallback(
    (draftAnswers: Drafts, listingShortName: string | undefined) =>
      source
        ? source.groups({ answers: draftAnswers, listingShortName })
        : buildTitleGroups(cards ?? [], titleContext as TitleContext, teamAnswers, {
            names,
            existingIndexes: existing,
            answers: draftAnswers,
            listingShortName,
          }),
    [source, cards, titleContext, teamAnswers, names, existing],
  );
  const shortEdited = shortValue(shortDraft) !== undefined;
  // Only an edit is checked: an untouched prefill is never sent, so a long
  // builder description is no fault of the operator's.
  const shortCheck = useMemo(
    () => (shortEdited ? checkShortNameAnswer(shortDraft) : {}),
    [shortEdited, shortDraft],
  );
  const liveShortName = onShortNameChange && shortEdited ? shortCheck.value : undefined;
  const { variationGroups, titleGroups } = useMemo(
    () => groupsFor(drafts, liveShortName),
    [groupsFor, drafts, liveShortName],
  );
  // The same reading at the last settle, for the box's status and refusal.
  const settledEdited = shortValue(shortSettledText) !== undefined;
  const settledCheck = useMemo(
    () => (settledEdited ? checkShortNameAnswer(shortSettledText) : {}),
    [settledEdited, shortSettledText],
  );
  const settledShortName = onShortNameChange && settledEdited ? settledCheck.value : undefined;
  const settledTitleGroups = useMemo(
    () =>
      settledShortName === liveShortName
        ? titleGroups
        : groupsFor(drafts, settledShortName).titleGroups,
    [settledShortName, liveShortName, titleGroups, groupsFor, drafts],
  );

  /**
   * NEO-637 — the box's text changes (typing, or Escape taking it back). The
   * set name in effect is the checked box text, else the prefill. Titles with
   * no hand edit follow it through the builder's own rule; a hand-edited
   * title whose row shows the yellow "Left out to fit" line has its old
   * set-name text swapped for the new (or is rebuilt when the old text is
   * not in it), and one whose row does not is left as typed
   * (`retitleDraftsForSetName`, read from the lists as they stand now).
   */
  const changeShort = (raw: string) => {
    const text = oneLine(raw);
    const nextEdited = shortValue(text) !== undefined;
    const nextLive = onShortNameChange && nextEdited ? checkShortNameAnswer(text).value : undefined;
    const oldName = liveShortName ?? prefill;
    const newName = nextLive ?? prefill;
    setShortDraft(text);
    if (oldName.trim() !== newName.trim()) {
      setDrafts((prev) => retitleDraftsForSetName(prev, titleGroups, oldName, newName));
    }
  };

  const setField = (indexes: readonly number[], field: keyof TitleAnswer, value: string) => {
    setDrafts((prev) => {
      const next = [...prev];
      while (next.length < count) next.push(undefined);
      for (const i of indexes) next[i] = { ...next[i], [field]: value };
      return next;
    });
  };
  const clearField = (indexes: readonly number[], field: keyof TitleAnswer) => {
    setDrafts((prev) => {
      const next = [...prev];
      for (const i of indexes) next[i] = without(next[i], field);
      return next;
    });
  };
  /** Undo to the focus-time value; true when there was something to undo. */
  const undo = (indexes: readonly number[], field: keyof TitleAnswer): boolean => {
    const changed = indexes.some(
      (i) => (latest.current[i]?.[field] ?? undefined) !== (undoPoint.current[i]?.[field] ?? undefined),
    );
    if (!changed) return false;
    setDrafts((prev) => {
      const next = [...prev];
      for (const i of indexes) {
        const was = undoPoint.current[i]?.[field];
        next[i] = was === undefined ? without(next[i], field) : { ...next[i], [field]: was };
      }
      return next;
    });
    return true;
  };

  /** Enter settles in place; Escape undoes in place, or is the wizard's. */
  const fieldKeys =
    (indexes: readonly number[], field: keyof TitleAnswer) =>
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        flush();
      } else if (event.key === "Escape" && undo(indexes, field)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

  /** Enter settles the short name in place; Escape undoes in place, or is the wizard's. */
  const shortKeys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      flushShort();
    } else if (event.key === "Escape" && shortLatest.current !== shortUndo.current) {
      event.preventDefault();
      event.stopPropagation();
      changeShort(shortUndo.current);
    }
  };

  if (variationGroups.length === 0 && titleGroups.length === 0) return null;
  const Heading = headingLevel === 4 ? "h4" : "h3";
  const scope = source?.scope;
  const shortLabel = scope ? `${SHORT_LABEL} for ${scope}` : SHORT_LABEL;
  // The box shows whenever the step lists titles (membership never reads the
  // draft, so it cannot vanish mid-word).
  const showShortName = !!onShortNameChange && titleGroups.length > 0;
  const variationsId =
    headingId && titleGroups.length === 0 ? headingId : `${uid}-variations`;
  const titlesId = headingId ?? `${uid}-titles`;
  const shortLeadId = `${uid}-short`;
  const shortStatusId = `${uid}-short-status`;
  const shortErrorId = `${uid}-short-error`;
  const shortMeterId = `${uid}-short-meter`;
  const keysHintId = `${uid}-keys`;
  const stillOver = settledTitleGroups.reduce(
    (n, g) => n + g.cards.filter((c) => c.text.trim().length > LISTING_TITLE_MAX).length,
    0,
  );
  // Progress only; a refusal is the alert below. Read at the last settle.
  const shortError = settledCheck.error;
  const shortStatus = settledShortName
    ? stillOverLine(stillOver)
    : !settledEdited && shortSettledText.trim().length > MAX_LISTING_SHORT_NAME_LENGTH
      ? PREFILL_OVER
      : "";

  return (
    <div
      className="space-y-5"
      onFocusCapture={() => {
        undoPoint.current = latest.current;
      }}
    >
      <p id={keysHintId} className="text-xs text-ink-3">
        {KEYS_HINT}
      </p>
      {showShortName && (
        // One answer for every card, set apart from the per-card fields
        // below by a rule down its left edge.
        <section
          aria-labelledby={scope ? undefined : shortLeadId}
          {...sectionName(scope, SHORT_LEAD)}
          className="border-l-2 border-neon-blue-text pl-3"
        >
          <Heading id={shortLeadId} className="text-sm font-normal text-ink-2">
            {SHORT_LEAD}
          </Heading>
          <label className="mt-2 block text-sm text-ink-2">
            {SHORT_LABEL}
            {/* NEO-535: the same wrapping one-line field as the titles
                below, so a long set description stays in view on a phone. */}
            <Textarea
              bare
              rows={2}
              value={shortDraft}
              onChange={(e) => changeShort(e.target.value)}
              onFocus={() => {
                shortUndo.current = shortLatest.current;
              }}
              onBlur={flushShort}
              onKeyDown={shortKeys}
              // No maxLength: the prefill can arrive over the cap and must
              // stay visible to be trimmed. The meter says where the cap is.
              autoComplete="off"
              spellCheck={false}
              aria-label={shortLabel}
              aria-describedby={[shortLeadId, shortMeterId, shortStatusId, shortError ? shortErrorId : null, keysHintId]
                .filter(Boolean)
                .join(" ")}
              aria-invalid={shortCheck.error ? true : undefined}
              aria-disabled={disabled || undefined}
              readOnly={disabled}
              className={`mt-1 ${FIELD_CLASS}`}
            />
          </label>
          <div id={shortMeterId} className="mt-0.5 flex justify-end text-xs">
            <TitleLengthMeter
              length={shortDraft.trim().length}
              max={MAX_LISTING_SHORT_NAME_LENGTH}
            />
          </div>
          {/* Always mounted, so a change is announced. Polite progress, read
              from the box as it last settled, never per keystroke. */}
          <p id={shortStatusId} role="status" className="mt-1 text-xs text-ink-2 empty:hidden">
            {shortStatus}
          </p>
          {shortError && (
            // a11y: a refusal is its own alert. `notice-danger-ink` IS
            // `neon-pink-text` (NEO-606: one pink for errors). On this
            // dialog's `raised-deep` surface it reads 5.5:1 in dark and 5.9:1
            // in light; it would miss on a row or chip tile (`TEXT_NEVER_ON`).
            <p id={shortErrorId} role="alert" className="mt-1 text-xs text-notice-danger-ink">
              {shortError}
            </p>
          )}
        </section>
      )}

      {variationGroups.length > 0 && (
        <section
          aria-labelledby={scope ? undefined : variationsId}
          {...sectionName(scope, VARIATION_LEAD)}
        >
          <Heading id={variationsId} className="text-sm font-normal text-ink-2">
            {VARIATION_LEAD}
          </Heading>
          <ul className="mt-1 divide-y divide-rule">
            {variationGroups.map((group) => (
              <VariationLine
                key={group.key}
                group={group}
                leadId={variationsId}
                hintId={keysHintId}
                value={drafts[group.cards[0].index]?.cardVariation ?? group.variation}
                onChange={(value) =>
                  setField(
                    group.cards.map((c) => c.index),
                    "cardVariation",
                    value,
                  )
                }
                onBlur={flush}
                onKeyDown={fieldKeys(
                  group.cards.map((c) => c.index),
                  "cardVariation",
                )}
                disabled={disabled}
              />
            ))}
          </ul>
        </section>
      )}

      {titleGroups.length > 0 && (
        <section
          aria-labelledby={scope ? undefined : titlesId}
          {...sectionName(scope, TITLES_LEAD)}
        >
          <Heading id={titlesId} className="text-sm font-normal text-ink-2">
            {TITLES_LEAD}
          </Heading>
          <TitleGroups
            groups={titleGroups}
            scope={scope}
            hintId={keysHintId}
            drafts={drafts}
            onChange={(index, value) => setField([index], "listingTitle", value)}
            onReset={(index) => clearField([index], "listingTitle")}
            onBlur={flush}
            keysFor={(index) => fieldKeys([index], "listingTitle")}
            disabled={disabled}
          />
          {source?.more && source.more.count > 0 && (
            <p className="mt-1 text-xs text-ink-3">{source.more.line}</p>
          )}
        </section>
      )}
    </div>
  );
}

function cardsPhrase(cards: VariationGroup["cards"]): string {
  const first = `#${cards[0].cardNumber} ${cards[0].cardName}`.trim();
  if (cards.length === 1) return first;
  const more = cards.length - 1;
  return `${first} and ${more} more ${more === 1 ? "card" : "cards"}`;
}

function VariationLine({
  group,
  leadId,
  hintId,
  value,
  onChange,
  onBlur,
  onKeyDown,
  disabled,
}: {
  group: VariationGroup;
  leadId: string;
  hintId: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  disabled: boolean;
}) {
  const meterId = useId();
  const length = value.trim().length;
  const owner = cardsPhrase(group.cards);
  return (
    <li className="space-y-1 py-2">
      <CardList cards={group.cards} owner={owner} />
      <Textarea
        bare
        rows={2}
        value={value}
        onChange={(e) => onChange(oneLine(e.target.value))}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        // No maxLength: the value arrives over the cap and must stay visible
        // to be trimmed. The meter says where the cap is.
        aria-label={`Variation for ${owner}`}
        aria-describedby={`${leadId} ${meterId} ${hintId}`}
        // Advisory (the card saves with the variation as it is): the pink box
        // follows the length, but the field is not `aria-invalid`.
        {...overFieldProps(length > ASPECT_VALUE_MAX)}
        aria-disabled={disabled || undefined}
        readOnly={disabled}
        className={`${FIELD_CLASS} ${OVER_FIELD_CLASS}`}
      />
      <div id={meterId} className="flex justify-end text-xs">
        <TitleLengthMeter length={length} max={ASPECT_VALUE_MAX} />
      </div>
    </li>
  );
}

/** The card(s) a line is about: one inline, several behind a disclosure. */
function CardList({
  cards,
  owner,
}: {
  cards: VariationGroup["cards"];
  owner: string;
}) {
  if (cards.length === 1) {
    const card = cards[0];
    return (
      <p className="break-words text-sm text-ink-2">
        <span className="text-neon-green-text">#{card.cardNumber}</span> {card.cardName}
      </p>
    );
  }
  return (
    <details className="text-xs text-ink-3">
      {/* py-1 -my-1: a 24px target (SC 2.5.8) without moving the line. */}
      <summary className="-my-1 cursor-pointer rounded py-1 hover:text-ink-2 focus-outline">
        <span className="tabular-nums">{cards.length}</span> cards
      </summary>
      <ul aria-label={`Cards for ${owner}`} className="mt-1 space-y-0.5 pl-3">
        {cards.map((card) => (
          <li key={card.index} className="break-words">
            <span className="text-neon-green-text">#{card.cardNumber}</span> {card.cardName}
          </li>
        ))}
      </ul>
    </details>
  );
}

function TitleGroups({
  groups,
  scope,
  hintId,
  drafts,
  onChange,
  onReset,
  onBlur,
  keysFor,
  disabled,
}: {
  groups: TitleGroup[];
  /** Prefixes each row's name, so two steps' rows never read the same. */
  scope?: string;
  /** The step's keys hint, on every field's description. */
  hintId: string;
  drafts: ReadonlyArray<TitleAnswer | undefined>;
  onChange: (index: number, value: string) => void;
  onReset: (index: number) => void;
  onBlur: () => void;
  keysFor: (index: number) => (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  disabled: boolean;
}) {
  const labels = useMemo(() => rowNames(groups.flatMap((g) => g.cards)), [groups]);
  const uid = useId();
  // NEO-335 — draw at most TITLE_ROWS_SHOWN rows, in list order; count the rest.
  const shown: number[] = [];
  let budget = TITLE_ROWS_SHOWN;
  for (const group of groups) {
    const take = Math.min(group.cards.length, budget);
    shown.push(take);
    budget -= take;
  }
  const total = groups.reduce((n, g) => n + g.cards.length, 0);
  const hidden = total - shown.reduce((n, k) => n + k, 0);
  return (
    <>
      <ul className="mt-1 divide-y divide-rule">
        {groups.map((group, groupIndex) => {
          if (shown[groupIndex] === 0) return null;
          const lineId = `${uid}-group-${groupIndex}`;
          const hasLine = group.leftOut.length > 0;
          return (
            <li key={group.key} className="py-2">
              {/* a11y: a group described by its shared "Left out to fit" line, so
                  tabbing into any of its fields says what they all lack.
                  A div inside the <li> rather than role="group" ON the <li>: that
                  would strip the list item from its <ul> (axe "list"). */}
              <div role="group" aria-describedby={hasLine ? lineId : undefined}>
                {/* The shared reason first, so a run of cards missing the same
                    words reads as one decision. TitleFixer's wording and tone.
                    Absent for a one-card group, and when the cards share
                    nothing: each row states its own. */}
                {hasLine && (
                  <p id={lineId} className="mb-1.5 break-words text-xs text-notice-warn-ink">
                    Left out to fit: {group.leftOut.join(", ")}
                    {group.cards.length > 1 && (
                      <span className="text-ink-3">
                        {" "}
                        (<span className="tabular-nums">{group.cards.length}</span> cards)
                      </span>
                    )}
                  </p>
                )}
                <ul className="space-y-2">
                  {group.cards.slice(0, shown[groupIndex]).map((card) => (
                    <TitleRow
                      key={card.index}
                      card={card}
                      label={`${scope ? `${scope} ` : ""}${labels.get(card.index) ?? `#${card.cardNumber}`}`}
                      draft={drafts[card.index]?.listingTitle}
                      onChange={(value) => onChange(card.index, value)}
                      onReset={() => onReset(card.index)}
                      onBlur={onBlur}
                      onKeyDown={keysFor(card.index)}
                      hintId={hintId}
                      disabled={disabled}
                    />
                  ))}
                </ul>
              </div>
            </li>
          );
        })}
      </ul>
      {hidden > 0 && (
        <p className="mt-1 text-xs text-ink-3">{moreRowsLine(hidden)}</p>
      )}
    </>
  );
}

function TitleRow({
  card,
  label,
  draft,
  onChange,
  onReset,
  onBlur,
  onKeyDown,
  hintId,
  disabled,
}: {
  card: TitleRowView;
  label: string;
  draft: string | undefined;
  onChange: (value: string) => void;
  onReset: () => void;
  onBlur: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  hintId: string;
  disabled: boolean;
}) {
  const meterId = useId();
  const alertId = useId();
  const ownLineId = useId();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const value = draft ?? card.title;
  // Over the cap is read off what the field holds: a generated title can
  // arrive over it (NEO-535), and a kept one is still too long to list.
  const over = value.trim().length > LISTING_TITLE_MAX;
  // Offered whenever the field no longer shows the generated title — including
  // a field cleared to nothing, which still saves the generated one.
  const edited = draft !== undefined && draft.trim() !== card.title;
  return (
    <li className="sm:grid sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] sm:items-start sm:gap-x-3">
      <p className="break-words pt-1.5 text-sm text-ink-2">
        <span className="text-neon-green-text">#{card.cardNumber}</span> {card.cardName}
      </p>
      <div className="min-w-0">
        <Textarea
          bare
          ref={fieldRef}
          rows={2}
          value={value}
          onChange={(e) => onChange(oneLine(e.target.value))}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          // No maxLength: an over-long title must stay visible to be fixed.
          aria-label={`Title for ${label}`}
          aria-describedby={[card.leftOut.length > 0 ? ownLineId : null, meterId, over ? alertId : null, hintId]
            .filter(Boolean)
            .join(" ")}
          aria-invalid={over || undefined}
          {...overFieldProps(over)}
          aria-disabled={disabled || undefined}
          readOnly={disabled}
          className={`${FIELD_CLASS} ${OVER_FIELD_CLASS}`}
        />
        {card.leftOut.length > 0 && (
          // What this card's field lacks beyond its group's line — most often
          // its own names and number, the loss an operator most wants to put
          // back, so it sits right under the field.
          <p id={ownLineId} className="mt-0.5 break-words text-xs text-notice-warn-ink">
            Left out to fit: {card.leftOut.join(", ")}
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 text-xs">
          {edited ? (
            <NeonButton
              variant="secondary"
              outline
              size="1"
              type="button"
              onClick={() => {
                if (disabled) return;
                onReset();
                // a11y: this button unmounts the moment the title is the
                // generated one again, which would drop focus to <body> inside
                // the modal. Hand it to the field it just reset, before the
                // re-render removes the button.
                fieldRef.current?.focus();
              }}
              aria-label={`${USE_GENERATED} for ${label}`}
              // NeonButton draws the held look off aria-disabled (NEO-535):
              // the guard above is what stops the reset while the step saves.
              aria-disabled={disabled || undefined}
            >
              {USE_GENERATED}
            </NeonButton>
          ) : (
            <span />
          )}
          <span id={meterId}>
            {/* Neutral until past the cap (no `soft` bands): every title on
                this step sits near 80, so "may clip in search" would be on
                every row and say nothing. TitleFixer keeps its bands. */}
            <TitleLengthMeter length={value.trim().length} max={LISTING_TITLE_MAX} />
          </span>
        </div>
        {/* Always mounted, so its text is announced when it appears (a live
            region inserted WITH its text often is not). Polite status, not
            an alert: the step never blocks, so nothing here stops work. Its
            text changes only when the title crosses the cap, so it speaks
            once per crossing rather than per keystroke. */}
        <p id={alertId} role="status" className="mt-0.5 text-xs text-neon-pink-text empty:hidden">
          {over ? TITLE_OVER : ""}
        </p>
      </div>
    </li>
  );
}
