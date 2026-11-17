import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Theme } from "@radix-ui/themes";
import { useConvex, type ConvexReactClient } from "convex/react";
import type { FunctionArgs } from "convex/server";
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
 * per tab). That self-open holds back when another dialog is up, when
 * another door is already opening one (`openingDoor`: the ticker's and the
 * checklist's can both fire for one build), or when the operator is typing in
 * a field: the button stays, and its status line says so. It is never
 * navigation (no route, no search param): it is a fix-up over the page the
 * operator is on.
 *
 * A host that drops the door when its flags clear keeps it mounted while it
 * is busy (`onActiveChange`), so a save that clears the last flag never tears
 * the dialog out mid-save; it hears the door's last line (`onStatusChange`) to
 * say it once the door has gone. A host with its own live line (the build
 * ticker) takes the door's line through it (`announceStatus={false}`), so
 * there are never two live regions saying one thing.
 *
 * ## Loads before it opens
 *
 * The parallel's failing cards are read ONE-SHOT (`useConvex().query`, never
 * subscribed: a parallel can hold thousands of cards), every page, before the
 * dialog mounts, so it never opens empty. Once a section holds its
 * `SECTION_CARDS`, later pages ask for counts only (`wantCards: 0`). Nothing
 * left to fix → no dialog, and the status line says every title fits. While
 * it loads the button keeps its name (`aria-busy`) and the status line says
 * "Loading titles…".
 *
 * ## Counts back to the host
 *
 * What the host stored when the build ended goes stale the moment a title is
 * fixed, so the door reports the live count (`onCounts`, per parallel) from
 * what it just read: the load that opens the dialog, and a recount after the
 * dialog closes. The recount is the same one-shot paged `failingTitles` call
 * with `wantCards: 0` (counts only, no card's inputs read, never subscribed).
 * A host that cannot trust a stored count (the build ticker) also asks for one
 * when the door mounts (`countOnMount`), so a reload or a run picked up after
 * leaving never shows a button for titles that were fixed. The latest read
 * wins, and a read that fails says nothing: pressing the button loads
 * and says what is true.
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
/** A box that won't save, named for its parallel (the dialog can hold several). */
export const boxNotSavableLine = (parallel: string) =>
  `${parallel}'s Set name in titles won't save as typed. Fix it or put it back, then save.`;
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

/**
 * The door opening (or showing) Card titles right now, this tab. Another
 * door's self-open holds back while one is set, so the ticker's and the
 * checklist's doors never stack two dialogs for one build. Cleared on close,
 * on nothing-to-fix, on a failed load, and when its door unmounts.
 */
let openingDoor: object | null = null;

/** Test hook: forget which keys have self-opened, and any door mid-open. */
export function resetParallelTitlesAutoOpen(): void {
  autoOpened.clear();
  openingDoor = null;
}

type TitlesClient = Pick<ConvexReactClient, "query" | "mutation">;

function errorText(error: unknown): string {
  return userFacingMessage(error, error instanceof Error ? error.message : "Unknown error");
}

/** How many titles still fail on one parallel. */
export type ParallelTitleCount = { id: Id<"selectorOptions">; count: number };

/** Every page of every parallel, counts only: one-shot, never subscribed. */
async function countFailing(
  convex: TitlesClient,
  parallels: readonly ParallelTitlesTarget[],
): Promise<ParallelTitleCount[]> {
  const counts: ParallelTitleCount[] = [];
  for (const target of parallels) {
    let count = 0;
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const args: FunctionArgs<typeof api.parallelCopyTitles.failingTitles> = {
        parallelId: target.id,
        wantCards: 0,
      };
      if (cursor) args.cursor = cursor;
      const result = await convex.query(api.parallelCopyTitles.failingTitles, args);
      count += result.failingInPage;
      if (result.cursor === null) break;
      cursor = result.cursor;
    }
    counts.push({ id: target.id, count });
  }
  return counts;
}

/**
 * Every page of every parallel, before the dialog opens. Sections with
 * nothing to fix are dropped; `counts` is every parallel's live count.
 */
async function loadSections(
  convex: TitlesClient,
  parallels: readonly ParallelTitlesTarget[],
): Promise<{ sections: ParallelTitlesSection[]; counts: ParallelTitleCount[] }> {
  const sections: ParallelTitlesSection[] = [];
  const counts: ParallelTitleCount[] = [];
  for (const target of parallels) {
    const cards: StoredTitleCard[] = [];
    let failing = 0;
    let boxPrefill = "";
    let value = target.value;
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      // Typed, not spread: a misspelt arg fails the typecheck, not the server.
      const args: FunctionArgs<typeof api.parallelCopyTitles.failingTitles> = {
        parallelId: target.id,
      };
      if (cursor) args.cursor = cursor;
      // The section is full: later pages are read for their counts only.
      if (cards.length >= SECTION_CARDS) args.wantCards = 0;
      const result = await convex.query(api.parallelCopyTitles.failingTitles, args);
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
    counts.push({ id: target.id, count: failing });
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
  return { sections, counts };
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
  onActiveChange,
  onStatusChange,
  onCounts,
  countOnMount = false,
  announceStatus = true,
}: {
  /** Memoise: a new array per render reloads nothing, but re-arms the handler. */
  parallels: readonly ParallelTitlesTarget[];
  /** The button's text and accessible name; distinct per door. Never swapped while loading. */
  label: string;
  /** Open once on its own for this key (the build that made the titles just ended). */
  autoOpenKey?: string;
  /** A build holds this checklist: the door is reachable but does nothing. */
  held?: boolean;
  heldDescribedBy?: string;
  /**
   * True from a press (or self-open) until the dialog closes, or the load ends
   * with nothing to open. A host that mounts the door off a live count keeps
   * it mounted while this is true.
   */
  onActiveChange?: (active: boolean) => void;
  /** Told every line the status shows, so a host can say the last one after the door has gone. */
  onStatusChange?: (line: string) => void;
  /**
   * Told how many titles still fail on each parallel, from the load that
   * opens the dialog and from a recount when it closes. A host that stored a
   * count lowers it here.
   */
  onCounts?: (counts: readonly ParallelTitleCount[]) => void;
  /** Recount once on mount (counts only), for a host whose stored count may be stale. */
  countOnMount?: boolean;
  /**
   * False when the host already has a live line and says the door's lines
   * through it: the line still shows here, but as plain text, never a second
   * live region.
   */
  announceStatus?: boolean;
}) {
  const convex = useConvex();
  const [loading, setLoading] = useState(false);
  const [sections, setSections] = useState<ParallelTitlesSection[] | null>(null);
  const [status, setStatus] = useState("");
  const doorRef = useRef<HTMLButtonElement | null>(null);
  const loadingRef = useRef(false);
  // This door's token for `openingDoor`.
  const [me] = useState(() => ({}));
  const hostRef = useRef({ onActiveChange, onStatusChange, onCounts });
  useEffect(() => {
    hostRef.current = { onActiveChange, onStatusChange, onCounts };
  }, [onActiveChange, onStatusChange, onCounts]);
  // The parallels as of the latest render: a recount must not re-arm on the
  // host narrowing the list as counts come in.
  const parallelsRef = useRef(parallels);
  useEffect(() => {
    parallelsRef.current = parallels;
  }, [parallels]);
  // The newest read of the counts wins: a slower, older one is dropped.
  const countSeq = useRef(0);

  const say = useCallback((line: string) => {
    setStatus(line);
    hostRef.current.onStatusChange?.(line);
  }, []);
  /** This door is done opening: let the next one through, and tell the host. */
  const settle = useCallback(() => {
    if (openingDoor === me) openingDoor = null;
    hostRef.current.onActiveChange?.(false);
  }, [me]);
  // A door unmounting mid-open never leaves the other doors held back.
  useEffect(
    () => () => {
      if (openingDoor === me) openingDoor = null;
    },
    [me],
  );

  /**
   * Counts only, told to the host. Returns what it read, or null when the read
   * failed or a newer one took over. A failed read says nothing: a press says
   * what is true.
   */
  const recount = useCallback(async (): Promise<ParallelTitleCount[] | null> => {
    const token = ++countSeq.current;
    try {
      const counts = await countFailing(convex, parallelsRef.current);
      if (token !== countSeq.current) return null;
      hostRef.current.onCounts?.(counts);
      return counts;
    } catch {
      // Pressing the button loads again and says why it could not.
      return null;
    }
  }, [convex]);

  const open = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    openingDoor ??= me;
    hostRef.current.onActiveChange?.(true);
    setLoading(true);
    // The button keeps its name; this is what says the press took.
    say(LOADING_TITLES_LABEL);
    let opened = false;
    const token = ++countSeq.current;
    try {
      const { sections: loaded, counts } = await loadSections(convex, parallels);
      if (token === countSeq.current) hostRef.current.onCounts?.(counts);
      if (loaded.length === 0) {
        say(ALL_TITLES_FIT);
      } else {
        say("");
        setSections(loaded);
        opened = true;
      }
    } catch (error) {
      say(loadFailedLine(errorText(error)));
    } finally {
      loadingRef.current = false;
      setLoading(false);
      if (!opened) settle();
    }
  }, [convex, parallels, me, say, settle]);

  // A stored count may be stale (a reload, a run picked up after leaving).
  useEffect(() => {
    if (countOnMount) void recount();
    // Once, on mount: later changes to the list are this very count landing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The self-open: once per key, a beat after mount (so a StrictMode double
  // effect cancels the first try instead of spending the key on it).
  useEffect(() => {
    if (!autoOpenKey || autoOpened.has(autoOpenKey)) return;
    const timer = setTimeout(() => {
      if (autoOpened.has(autoOpenKey)) return;
      autoOpened.add(autoOpenKey);
      if (
        held ||
        (openingDoor !== null && openingDoor !== me) ||
        anotherDialogOpen() ||
        isEditableTarget(document.activeElement)
      ) {
        say(heldBackLine(label));
        return;
      }
      // Claimed before the load starts, so a second door's timer in this
      // same tick already sees it.
      openingDoor = me;
      void open();
    }, 0);
    return () => clearTimeout(timer);
  }, [autoOpenKey, held, label, open, me, say]);

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
        {label}
      </NeonButton>
      {/* Always mounted, so what it says is announced. Polite: nothing here
          stops work. Inherits its ink: it sits in the build ticker's banner
          and on the checklist card, and reads in each one's own text colour.
          In the ticker it is plain text: the ticker's own live line says it. */}
      <span role={announceStatus ? "status" : undefined} className="text-xs empty:hidden">
        {status}
      </span>
      {sections && (
        <ParallelTitlesDialog
          sections={sections}
          convex={convex}
          onClose={(saved) => {
            setSections(null);
            say(saved ?? "");
            // A save (even one that stopped partway) moved the count: read it
            // before the door lets go, so the host drops a button that has
            // nothing left to open, or lowers the count it shows. The read
            // is a busy window like a load: a press then does nothing, so a
            // second open can never be released by this one's settle.
            loadingRef.current = true;
            setLoading(true);
            void recount()
              .then((counts) => {
                // Left without a save and the cards were fixed elsewhere: the
                // button is about to go, so say why (a save already said its
                // own line).
                if (!saved && counts && counts.length > 0 && counts.every((c) => c.count === 0)) {
                  say(ALL_TITLES_FIT);
                }
              })
              .finally(() => {
                loadingRef.current = false;
                setLoading(false);
                settle();
              });
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
  const saveRef = useRef<HTMLButtonElement | null>(null);
  // Each parallel's section, so a refusal can land on that parallel's box.
  const sectionRefs = useRef<Array<HTMLElement | null>>([]);
  // A failed save hands focus back to Save once it is pressable again.
  const focusSaveRef = useRef(false);
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
  // When the save fails, Save is live again: focus goes back to it, so the
  // operator is one Enter from trying again, with the reason just announced.
  useEffect(() => {
    if (saving) {
      panelRef.current?.focus();
    } else if (focusSaveRef.current) {
      focusSaveRef.current = false;
      saveRef.current?.focus();
    }
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
    const refused = shortNamesRef.current.findIndex(
      (raw, i) => raw !== undefined && boxes[i] === undefined,
    );
    if (refused >= 0) {
      setError(boxNotSavableLine(sections[refused].parallelValue));
      // The refusal names the parallel; focus goes to its box, the one
      // marked invalid (else the section's first field: the box leads it).
      requestAnimationFrame(() => {
        const section = sectionRefs.current[refused];
        const box =
          section?.querySelector<HTMLElement>('[aria-invalid="true"]') ??
          section?.querySelector<HTMLElement>("textarea");
        box?.focus();
      });
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
      focusSaveRef.current = true;
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
            refusal stay on screen at the 1024x629 E2E viewport, and on a
            phone whose browser bar is showing (dvh, not vh). The panel is
            inert under the discard confirm, which is not portalled and traps
            Tab only. */}
        <div
          ref={panelRef}
          tabIndex={-1}
          inert={confirming || undefined}
          className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col rounded-lg border border-rule-strong bg-raised-deep shadow-xl shadow-offset outline-none"
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
                sectionRef={(node) => {
                  sectionRefs.current[i] = node;
                }}
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
              ref={saveRef}
              type="button"
              onClick={() => void save()}
              onKeyDown={(event) => activateOnEnter(event, () => void save(), saving)}
              disabled={saving}
            >
              {saving ? SAVING_TITLES_LABEL : SAVE_TITLES_LABEL}
            </NeonButton>
            {/* Backing out, so pink (DESIGN.md), like the wizard's Cancel. */}
            <NeonButton
              variant="negative"
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
  sectionRef,
  section,
  source,
  answers,
  shortName,
  disabled,
  onAnswersChange,
  onShortNameChange,
}: {
  sectionRef: (node: HTMLElement | null) => void;
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
    <section ref={sectionRef} aria-labelledby={headingId} className="py-4 first:pt-1">
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
