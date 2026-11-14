import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Theme } from "@radix-ui/themes";
import { useConvex, type ConvexReactClient } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { userFacingMessage } from "@/lib/errors/user-facing-message";
import { activateOnEnter } from "@/lib/dom/activate-on-enter";
import { inertBackground } from "@/lib/dom/inert-background";
import { isEditableTarget } from "@/lib/dom/is-editable-target";
import NeonButton from "../modules/NeonButton";
import { ConfirmDialog } from "../modules/confirm-dialog";
import CardTitlesStep from "./CardTitlesStep";
import { validShortName, type TitleAnswer } from "./card-titles";
import {
  parallelTitlesSource,
  saveTitleFixesArgs,
  savedTitlesLine,
  sectionEdited,
  type ParallelTitlesSection,
  type StoredTitleCard,
} from "./parallel-titles";

/**
 * NEO-535 — the Card titles dialog for a parallel's cards, and the button
 * that opens it.
 *
 * A parallel build titles each copy in Jason's order (the builder's title,
 * else the source's hand edit re-headed, else the builder's flagged result).
 * The copies left flagged are this dialog's: one section per parallel, each
 * the wizard's own `CardTitlesStep` fed the parallel's stored cards
 * (`parallel-titles.ts`), with one Save for the lot.
 *
 * ## Three doors, one handler
 *
 * `ParallelTitlesDoor` is the only way in. The build ticker shows one when a
 * run ends with titles to fix, a parallel's checklist shows one while its
 * cards carry a title flag, and both can open it once on their own when the
 * build that made the titles has just finished (`autoOpenKey`, once per key
 * per tab). That self-open holds back when another dialog is up or the
 * operator is typing in a field: the button stays, and its status line says
 * so. It is never navigation (no route, no search param): it is a fix-up over
 * the page the operator is on.
 *
 * ## Loads before it opens
 *
 * The parallel's failing cards are read ONE-SHOT (`useConvex().query`, never
 * subscribed: a parallel can hold thousands of cards), every page, before the
 * dialog mounts, so it never opens empty. Nothing left to fix → no dialog,
 * and the status line says every title fits.
 *
 * ## Keys and focus
 *
 * Portalled to `document.body` with everything behind it `inert`; Tab is
 * trapped; focus goes back to the door on close. Escape (and Not now, and the
 * scrim) closes, asking first only when something was edited. Escape inside
 * a field first undoes that field's typing (the step's own contract).
 */

/** Copy (NB voice; Jason reviews while testing). */
export const TITLES_DIALOG_TITLE = "Card titles";
const TITLES_DIALOG_LEAD = "Fresh off the build: these titles ran long or lost a first name.";
export const SAVE_TITLES_LABEL = "Save titles";
export const SAVING_TITLES_LABEL = "Saving titles…";
export const NOT_NOW_LABEL = "Not now";
export const LOADING_TITLES_LABEL = "Loading titles…";
export const ALL_TITLES_FIT = "Every title fits now. Nothing to fix.";
export const BOX_NOT_SAVABLE =
  "Set name in titles can't be saved as typed. Fix it, or put it back, then save.";
export const DISCARD_TITLE = "Toss your title edits?";
const DISCARD_DESCRIPTION =
  "Nothing you changed here gets saved. The cards keep the titles they have now.";
export const DISCARD_CONFIRM = "Toss 'em";
const DISCARD_BUSY = "Tossing…";
/** Said when the dialog wanted to open on its own and held back. */
export const heldBackLine = (doorLabel: string) =>
  `Card titles are waiting. Press ${doorLabel} when you're ready.`;
const loadFailedLine = (message: string) => `Couldn't open Card titles: ${message}`;
const saveFailedLine = (message: string) => `Titles not saved: ${message}`;

/** One parallel the door covers. */
export type ParallelTitlesTarget = { id: Id<"selectorOptions">; value: string };

/** Pages one parallel is read in, at most (the build copies at most 5,000 cards). */
const MAX_PAGES = 40;
/** Cards one section lists: what one save may answer. */
const SECTION_CARDS = 50;

/** Keys that already opened (or tried to open) the dialog on their own, this tab. */
const autoOpened = new Set<string>();

/** Test hook: forget which keys have self-opened. */
export function resetParallelTitlesAutoOpen(): void {
  autoOpened.clear();
}

type TitlesClient = Pick<ConvexReactClient, "query" | "mutation">;

function errorText(error: unknown): string {
  return userFacingMessage(error, error instanceof Error ? error.message : "Unknown error");
}

/** Every page of every parallel, before the dialog opens. Sections with nothing to fix are dropped. */
async function loadSections(
  convex: TitlesClient,
  parallels: readonly ParallelTitlesTarget[],
): Promise<ParallelTitlesSection[]> {
  const sections: ParallelTitlesSection[] = [];
  for (const target of parallels) {
    const cards: StoredTitleCard[] = [];
    let failing = 0;
    let boxPrefill = "";
    let value = target.value;
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await convex.query(api.parallelCopyTitles.failingTitles, {
        parallelId: target.id,
        ...(cursor ? { cursor } : {}),
      });
      if (page === 0) {
        boxPrefill = result.boxPrefill;
        value = result.parallel.value;
      }
      failing += result.failingInPage;
      for (const card of result.cards) {
        if (cards.length < SECTION_CARDS) cards.push(card);
      }
      if (result.cursor === null) break;
      cursor = result.cursor;
    }
    if (cards.length > 0) {
      sections.push({
        parallelId: target.id,
        parallelValue: value,
        boxPrefill,
        cards,
        moreCount: Math.max(0, failing - cards.length),
      });
    }
  }
  return sections;
}

function anotherDialogOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"]') !== null;
}

/**
 * The button that opens Card titles for `parallels`, and the status line
 * beside it. Mount it only where there are titles to fix: it reads Convex
 * through `useConvex()`, and only when pressed.
 */
export function ParallelTitlesDoor({
  parallels,
  label,
  autoOpenKey,
  held = false,
  heldDescribedBy,
}: {
  /** Memoise: a new array per render reloads nothing, but re-arms the handler. */
  parallels: readonly ParallelTitlesTarget[];
  /** The button's text and accessible name; distinct per door. */
  label: string;
  /** Open once on its own for this key (the build that made the titles just ended). */
  autoOpenKey?: string;
  /** A build holds this checklist: the door is reachable but does nothing. */
  held?: boolean;
  heldDescribedBy?: string;
}) {
  const convex = useConvex();
  const [loading, setLoading] = useState(false);
  const [sections, setSections] = useState<ParallelTitlesSection[] | null>(null);
  const [status, setStatus] = useState("");
  const doorRef = useRef<HTMLButtonElement | null>(null);
  const loadingRef = useRef(false);

  const open = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setStatus("");
    try {
      const loaded = await loadSections(convex, parallels);
      if (loaded.length === 0) setStatus(ALL_TITLES_FIT);
      else setSections(loaded);
    } catch (error) {
      setStatus(loadFailedLine(errorText(error)));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [convex, parallels]);

  // The self-open: once per key, a beat after mount (so a StrictMode double
  // effect cancels the first try instead of spending the key on it).
  useEffect(() => {
    if (!autoOpenKey || autoOpened.has(autoOpenKey)) return;
    const timer = setTimeout(() => {
      if (autoOpened.has(autoOpenKey)) return;
      autoOpened.add(autoOpenKey);
      if (held || anotherDialogOpen() || isEditableTarget(document.activeElement)) {
        setStatus(heldBackLine(label));
        return;
      }
      void open();
    }, 0);
    return () => clearTimeout(timer);
  }, [autoOpenKey, held, label, open]);

  // Focus back to the door once the dialog has gone (its cleanup released
  // the background first, so the door is focusable again).
  const wasOpenRef = useRef(false);
  useEffect(() => {
    const isOpen = sections !== null;
    if (wasOpenRef.current && !isOpen) doorRef.current?.focus();
    wasOpenRef.current = isOpen;
  }, [sections]);

  const activate = () => {
    if (held || loading) return;
    void open();
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <NeonButton
        ref={doorRef}
        variant="secondary"
        type="button"
        onClick={activate}
        onKeyDown={(event) => activateOnEnter(event, activate, held || loading)}
        aria-disabled={held || loading || undefined}
        aria-busy={loading || undefined}
        aria-haspopup="dialog"
        aria-describedby={held ? heldDescribedBy : undefined}
      >
        {loading ? LOADING_TITLES_LABEL : label}
      </NeonButton>
      {/* Always mounted, so what it says is announced. Polite: nothing here
          stops work. Inherits its ink: it sits in the build ticker's banner
          and on the checklist card, and reads in each one's own text colour. */}
      <span role="status" className="text-xs empty:hidden">
        {status}
      </span>
      {sections && (
        <ParallelTitlesDialog
          sections={sections}
          convex={convex}
          onClose={(saved) => {
            setSections(null);
            setStatus(saved ?? "");
          }}
        />
      )}
    </span>
  );
}

const FOCUSABLE =
  'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), a[href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The dialog itself. Mounted by its door only once its sections are loaded. */
export function ParallelTitlesDialog({
  sections,
  convex,
  onClose,
}: {
  sections: readonly ParallelTitlesSection[];
  convex: TitlesClient;
  /** `saved` is the line to show beside the door after a save. */
  onClose: (saved?: string) => void;
}) {
  const titleId = useId();
  const leadId = useId();
  const errorId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // The steps' settled edits, per section. Kept in refs as well, so a Save
  // pressed right after a field's blur reads the answer that blur settled.
  const [answers, setAnswers] = useState<Array<Array<TitleAnswer | undefined>>>(() =>
    sections.map(() => []),
  );
  const [shortNames, setShortNames] = useState<Array<string | undefined>>(() =>
    sections.map(() => undefined),
  );
  const answersRef = useRef(answers);
  const shortNamesRef = useRef(shortNames);

  // Each section's source is built once: the step regroups whenever it changes.
  const sources = useMemo(
    () =>
      sections.map((section) =>
        parallelTitlesSource(section, sections.length > 1 ? section.parallelValue : undefined),
      ),
    [sections],
  );

  useEffect(() => {
    const release = dialogRef.current ? inertBackground(dialogRef.current) : () => {};
    // The dialog's name and lead are read on arrival; the first field is one
    // Tab away. Never a field: a self-opened dialog must not start a typing
    // session the operator did not ask for.
    panelRef.current?.focus();
    return release;
  }, []);

  // Native `disabled` blurs the pressed Save; hold focus inside meanwhile.
  useEffect(() => {
    if (saving) panelRef.current?.focus();
  }, [saving]);

  const edited = () =>
    sections.some((section, i) =>
      sectionEdited(section, answersRef.current[i] ?? [], shortNamesRef.current[i]),
    );

  const leave = () => {
    if (saving || confirming) return;
    if (edited()) setConfirming(true);
    else onClose();
  };

  const save = async () => {
    if (saving) return;
    const boxes = shortNamesRef.current.map((raw) =>
      raw === undefined ? undefined : validShortName(raw),
    );
    if (shortNamesRef.current.some((raw, i) => raw !== undefined && boxes[i] === undefined)) {
      setError(BOX_NOT_SAVABLE);
      return;
    }
    setSaving(true);
    setError(null);
    const totals = { saved: 0, rewritten: 0, kept: 0, skipped: 0, stillFailing: 0 };
    try {
      for (const [i, section] of sections.entries()) {
        const args = saveTitleFixesArgs(section, answersRef.current[i] ?? [], boxes[i]);
        if (args.cards.length === 0 && args.listingShortName === undefined) continue;
        const result = await convex.mutation(api.parallelCopyTitles.saveTitleFixes, args);
        totals.saved += result.saved;
        totals.rewritten += result.rewritten;
        totals.kept += result.kept;
        totals.skipped += result.skipped;
        totals.stillFailing += result.stillFailing;
      }
      onClose(savedTitlesLine(totals));
    } catch (e) {
      setError(saveFailedLine(errorText(e)));
      setSaving(false);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (confirming) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      leave();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = panelRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <Theme>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={error ? `${leadId} ${errorId}` : leadId}
        className="fixed inset-0 z-[60] flex items-center justify-center bg-scrim p-4"
        onKeyDown={onKeyDown}
        onClick={leave}
      >
        {/* Header / body / footer, only the body scrolls: the buttons and the
            refusal stay on screen at the 1024x629 E2E viewport. The panel is
            inert under the discard confirm, which is not portalled and traps
            Tab only. */}
        <div
          ref={panelRef}
          tabIndex={-1}
          inert={confirming || undefined}
          className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col rounded-lg border border-rule-strong bg-raised-deep shadow-xl shadow-offset outline-none"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="shrink-0 px-5 pt-5 pb-3">
            <h2 id={titleId} className="text-lg font-semibold text-ink">
              {TITLES_DIALOG_TITLE}
            </h2>
            <p id={leadId} className="mt-1 text-sm text-ink-3">
              {TITLES_DIALOG_LEAD}
            </p>
          </div>
          <div className="min-h-0 flex-1 divide-y divide-rule overflow-y-auto px-5">
            {sections.map((section, i) => (
              <TitlesSection
                key={section.parallelId}
                section={section}
                source={sources[i]}
                answers={answers[i] ?? []}
                shortName={shortNames[i]}
                disabled={saving}
                onAnswersChange={(next) => {
                  const all = [...answersRef.current];
                  all[i] = next;
                  answersRef.current = all;
                  setAnswers(all);
                }}
                onShortNameChange={(next) => {
                  const all = [...shortNamesRef.current];
                  all[i] = next;
                  shortNamesRef.current = all;
                  setShortNames(all);
                }}
              />
            ))}
          </div>
          {error && (
            <p id={errorId} role="alert" className="mx-5 mt-3 text-sm text-notice-danger-ink">
              {error}
            </p>
          )}
          <div className="flex shrink-0 flex-wrap gap-3 px-5 pt-3 pb-5">
            <NeonButton
              type="button"
              onClick={() => void save()}
              onKeyDown={(event) => activateOnEnter(event, () => void save(), saving)}
              disabled={saving}
            >
              {saving ? SAVING_TITLES_LABEL : SAVE_TITLES_LABEL}
            </NeonButton>
            <NeonButton
              variant="secondary"
              type="button"
              onClick={leave}
              onKeyDown={(event) => activateOnEnter(event, leave, saving)}
              disabled={saving}
            >
              {NOT_NOW_LABEL}
            </NeonButton>
          </div>
        </div>
        {confirming && (
          <ConfirmDialog
            title={DISCARD_TITLE}
            description={DISCARD_DESCRIPTION}
            confirmLabel={DISCARD_CONFIRM}
            busyLabel={DISCARD_BUSY}
            busy={false}
            onConfirm={() => onClose()}
            onCancel={() => {
              setConfirming(false);
              // The confirm's own restore aimed at a control that was inert;
              // land back on the panel once it is live again.
              requestAnimationFrame(() => panelRef.current?.focus());
            }}
          />
        )}
      </div>
    </Theme>,
    document.body,
  );
}

/** One parallel's part: its name, its count, and the step. */
function TitlesSection({
  section,
  source,
  answers,
  shortName,
  disabled,
  onAnswersChange,
  onShortNameChange,
}: {
  section: ParallelTitlesSection;
  source: ReturnType<typeof parallelTitlesSource>;
  answers: ReadonlyArray<TitleAnswer | undefined>;
  shortName: string | undefined;
  disabled: boolean;
  onAnswersChange: (answers: Array<TitleAnswer | undefined>) => void;
  onShortNameChange: (value: string | undefined) => void;
}) {
  const headingId = useId();
  const total = section.cards.length + section.moreCount;
  return (
    <section aria-labelledby={headingId} className="py-4 first:pt-1">
      <h3 id={headingId} className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">
        <span className="break-words text-neon-green-text">{section.parallelValue}</span>
        <span className="text-xs font-normal text-ink-3 tabular-nums">
          {total === 1 ? "1 title" : `${total} titles`}
        </span>
      </h3>
      <div className="mt-2">
        <CardTitlesStep
          source={source}
          answers={answers}
          onAnswersChange={onAnswersChange}
          shortName={shortName}
          onShortNameChange={onShortNameChange}
          disabled={disabled}
          headingLevel={4}
        />
      </div>
    </section>
  );
}
