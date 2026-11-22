import {
  startTransition,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Theme } from "@radix-ui/themes";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { inertBackground } from "@/lib/dom/inert-background";
import { isEditableTarget } from "@/lib/dom/is-editable-target";
import NeonButton from "../../modules/NeonButton";
import HintedLabel from "../HintedLabel";
import WizardChrome from "../WizardChrome";
import {
  currentReviewKeys,
  deriveCardAttention,
  isAwaitingTeamLookup,
  needsTidyUp,
  teamLookupStatusLine,
} from "../card-attention";
import type { CardChecklistRow } from "../card-checklist-row";
import { AnsweredProvider } from "./answered";
import AddAllNewPlayers from "./AddAllNewPlayers";
import { InlineStackProvider, useCloseTopInlinePart, useInlineStackOpen } from "./inline-stack";
import type { VariantKind } from "../../../app/collection/final/data/types";
import TidyCardFace from "./TidyCardFace";
import type { TidyTileProps } from "./tile-types";
import AutographTile from "./tiles/AutographTile";
import CareerTile from "./tiles/CareerTile";
import MoreAboutTile from "./tiles/MoreAboutTile";
import PlayerTile from "./tiles/PlayerTile";
import SourcesDisagreeTile from "./tiles/SourcesDisagreeTile";
import TeamTile from "./tiles/TeamTile";
import TitleTile from "./tiles/TitleTile";
import { useTidyKeys } from "./useTidyKeys";
import { useOpenCardLookups } from "./useOpenCardLookups";
import { TIDY_DONE, useTidyWalkUrl } from "./useTidyWalkUrl";
import {
  cardsLeft,
  cardsLeftText,
  cardsSkipped,
  cardsSkippedText,
  cardsTallyText,
  loadSitting,
  nextCardId,
  pendingLookupKeys,
  previousCardId,
  saveSitting,
  tallyText,
  walkOrder,
  withPassed,
  withShown,
} from "./walk-order";

/**
 * NEO-645 — Tidy Up, one card at a time.
 *
 * One dialog walks the checklist's cards that need a person: pink to fix,
 * blue to check, in `walk-order.ts`'s order. The cards are already written
 * (Match Cards ended); every tile saves the moment it is answered (J1), so
 * what is left for the walk is to look at each card and move on.
 *
 *   - **Save & next** writes "seen" for the card's blue items
 *     (`tidyCards.markReviewed`) and moves on. It is held while anything is
 *     pink: the card cannot be listed without that answer.
 *   - **Skip: not ready to list** moves on with no write. The card stays
 *     flagged; the end screen counts it. Pink never blocks Skip.
 *   - **Save for later** (Esc) closes the walk. Nothing rolls back.
 *   - **Back** steps to the card before, as it is now.
 *
 * The position is `?tidy=<cardId>` (`useTidyWalkUrl`), so a refresh lands on
 * the same card and the browser's Back walks back through the cards.
 *
 * ## The queue is derived, not held
 *
 * The cards on screen come from the live `cards` prop. Which card is open is
 * the URL's; which cards are done is the sitting's `passed` list
 * (`walk-order.ts`). Nothing chases the derived list, so a lookup landing or
 * a write from another tab moves the count and never the card you are on.
 *
 * ## Keys
 *
 * See `useTidyKeys`: Enter and Esc are a field's, a control's or an open
 * inline part's first.
 *
 * Chrome (portal into a nested Radix `Theme`, `inertBackground`, the Tab trap)
 * follows `ParallelTitlesDialog`; full-screen on a phone, a fixed-height panel
 * from `sm` up, so the footer never moves under a click whatever the card shows.
 */

const FOCUSABLE =
  'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), a[href], select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** The footer's words. Jason-approved; do not re-word. */
export const TIDY_BACK_LABEL = "Back";
export const TIDY_SAVE_FOR_LATER_LABEL = "Save for later (Esc)";
export const TIDY_SKIP_LABEL = "Skip: not ready to list";
export const TIDY_SAVE_LABEL = "Save & next (Enter)";
export const TIDY_DONE_LABEL = "Done (Esc)";
export const TIDY_SAVE_FAILED = "Didn't save, try again";

/** The end screen's way back to the cards it skipped: "Review the 3 skipped". */
export function reviewSkippedLabel(skipped: number): string {
  return skipped === 1 ? "Review the skipped card" : `Review the ${skipped} skipped`;
}

/** "3 to fix before this card can save. Skip it and it can't be listed until it's fixed." */
export function mustFixLine(fix: number): string {
  return `${fix} to fix before this card can save. Skip it and it can't be listed until it's fixed.`;
}

/** Nothing skipped, nothing waiting. */
export const TIDY_ALL_CLEAR = "All tidy. Nothing on this checklist needs you.";

type WalkProps = {
  /** The checklist the walk is on. */
  leafId: Id<"selectorOptions">;
  /** The sport-level row, from the ancestor chain. */
  sportId?: Id<"selectorOptions">;
  /** The set's name (the `setName` row, not the leaf), for tile copy and the face. */
  setName: string;
  /** The card face's set line: the season, and the leaf's variant (`faceHeaderFromChain`). */
  season?: string;
  variantName?: string | null;
  variantKind?: VariantKind;
  /**
   * NEO-639 (decision A): the checklist's own team default is "No Team". The Team
   * tile then offers a teamless card's teams and preselects none, and "Apply to
   * all" offers nothing, the same rule the server's fills follow.
   */
  setNoTeam?: boolean;
  /** The dialog's name: "Tidy up 2024 Topps Chrome". */
  title?: string;
  /** The checklist's live rows, ALL of them: the walk derives its own queue. */
  cards: readonly CardChecklistRow[];
  /**
   * A durable control to give focus back to. The pill that opens the walk
   * leaves the page when the count reaches zero, so the opener cannot be
   * trusted to survive the sitting.
   */
  restoreFocusRef?: RefObject<HTMLElement | null>;
  /** The walk is done with the screen (Save for later, Done). */
  onClose: () => void;
};

export default function TidyUpWalk(props: WalkProps) {
  return (
    <InlineStackProvider>
      <WalkDialog {...props} />
    </InlineStackProvider>
  );
}

/**
 * "#38b · Image Variation · Mike Trout": number, variation, who is on it. The
 * number is its own piece because the header line wraps anywhere and a printed
 * number such as "FS-3" must never split ("#FS-" over "3").
 */
export function cardHeaderParts(
  row: Pick<CardChecklistRow, "cardNumber" | "cardName" | "cardVariation" | "pendingPlayerNames">,
  playerNames: readonly string[] | undefined,
): { number: string; rest: string } {
  const who =
    playerNames && playerNames.length > 0
      ? playerNames.join(" / ")
      : (row.pendingPlayerNames ?? []).length > 0
        ? (row.pendingPlayerNames ?? []).join(" / ")
        : row.cardName;
  return {
    number: `#${row.cardNumber}`,
    rest: [row.cardVariation?.trim(), who?.trim()]
      .filter((part): part is string => !!part)
      .join(" · "),
  };
}

/** The whole line as one string: "#38b · Image Variation · Mike Trout". */
export function cardHeaderLine(
  row: Pick<CardChecklistRow, "cardNumber" | "cardName" | "cardVariation" | "pendingPlayerNames">,
  playerNames: readonly string[] | undefined,
): string {
  const { number, rest } = cardHeaderParts(row, playerNames);
  return rest ? `${number} · ${rest}` : number;
}

function WalkDialog({
  leafId,
  sportId,
  setName,
  season,
  variantName,
  variantKind,
  setNoTeam = false,
  title,
  cards,
  restoreFocusRef,
  onClose,
}: WalkProps) {
  const titleId = useId();
  const statusId = useId();
  const url = useTidyWalkUrl();
  const { location, entryKey, canStepBack, goToCard, showCard, showDone, finish, stepBack } = url;

  // Where "Add all N new players" draws its confirm: the top of the scrolling
  // area. State, not a ref, so the control re-renders once the element exists.
  const [addAllHost, setAddAllHost] = useState<HTMLDivElement | null>(null);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const saveRef = useRef<HTMLButtonElement | null>(null);
  const backRef = useRef<HTMLButtonElement | null>(null);
  const saveForLaterRef = useRef<HTMLButtonElement | null>(null);
  const headerLineId = useId();
  const doneLineId = useId();
  const doneLookupId = useId();
  const doneTallyId = useId();

  // ── the sitting ─────────────────────────────────────────────────────────
  // Both halves are read while rendering (the count, the bar, the end screen,
  // whether Back has anywhere to go), so both are state; storage only mirrors
  // them for a refresh.
  const [initial] = useState(() => loadSitting(leafId));
  const [passed, setPassed] = useState<readonly string[]>(initial.passed);
  const [trail, setTrail] = useState<readonly string[]>(initial.trail);
  // The skipped cards "Review the N skipped" offered again, and not yet left. They
  // stay in `passed` (so Back to the end screen shows the same tally and the same
  // button); while one is in here it counts as open, wherever the walk is but the
  // end screen.
  const [reviewing, setReviewing] = useState<readonly string[]>([]);

  // ── what the walk reads ─────────────────────────────────────────────────
  // Subscribed only while the walk is mounted (an index range, NEO-392).
  const pending = useQuery(api.tidyNames.lookupsPending, { scopeId: leafId });
  const pendingKeys = useMemo(() => pendingLookupKeys(pending), [pending]);
  const order = useMemo(() => walkOrder(cards, pendingKeys), [cards, pendingKeys]);
  // Everything that can change who "Add all new players" offers: the names still
  // waiting on a card, and the lookups still running.
  const newPlayersKey = useMemo(() => {
    const names = new Set<string>();
    for (const c of cards) for (const n of c.pendingPlayerNames ?? []) names.add(n);
    return `${[...names].sort().join("\u001f")}\u001e${[...pendingKeys].sort().join("\u001f")}`;
  }, [cards, pendingKeys]);
  const rowsById = useMemo(() => new Map(cards.map((c) => [c._id as string, c])), [cards]);
  const awaitingLookup = useMemo(() => cards.filter(isAwaitingTeamLookup).length, [cards]);
  // The end screen's lookup line must not say "nothing for you to do" while cards still need a person.
  const needYouCount = useMemo(() => cards.filter((c) => needsTidyUp(c)).length, [cards]);

  // What the walk counts as done: `passed`, less the skipped cards being
  // reviewed. The end screen reads `passed` whole, so Back to it restores it.
  const openPassed = useMemo(() => {
    if (reviewing.length === 0 || location.kind === "done") return passed;
    const back = new Set(reviewing);
    return passed.filter((id) => !back.has(id));
  }, [passed, reviewing, location.kind]);

  const current: CardChecklistRow | undefined =
    location.kind === "card" ? rowsById.get(location.cardId) : undefined;
  const currentId = current?._id as string | undefined;
  const attention = current ? deriveCardAttention(current) : undefined;

  // One card's names, players and teams: subscribed for the open card only.
  const context = useQuery(
    api.tidyCards.cardContext,
    current ? { cardId: current._id } : "skip",
  );
  // Names a migration left with no lookup get asked once when the card opens.
  useOpenCardLookups(context);

  // `first`, or an id that is not one of this checklist's cards (a stale or
  // pasted link): replace it with the first card still to walk. The id never
  // reaches a Convex argument unless a row of ours carries it.
  const needsResolve = location.kind === "first" || (location.kind === "card" && !current);
  const firstTarget = needsResolve
    ? nextCardId(order, { passed: openPassed, trail: [] }, null)
    : null;
  // `entryKey` is a dependency on purpose: it changes with every committed
  // navigation, so if another writer ever puts `tidy=first` (or a stale id) back
  // over the replace below, even in the same flush, the walk resolves again
  // instead of sitting on "Finding the next card." with inputs that never
  // changed. Idempotent: once the URL shows one of our cards, `needsResolve` is
  // false and nothing is written.
  useEffect(() => {
    if (!needsResolve) return;
    if (firstTarget) showCard(firstTarget);
    else showDone();
  }, [needsResolve, firstTarget, entryKey, showCard, showDone]);

  // The trail, for Back after a refresh. Grown in the render that first shows
  // a card (the render-phase update React documents for "information from
  // previous renders"), so no effect chases the URL.
  if (currentId) {
    const shown = withShown({ passed, trail }, currentId);
    if (shown.trail !== trail) setTrail(shown.trail);
  }
  useEffect(() => {
    saveSitting(leafId, { passed, trail });
  }, [leafId, passed, trail]);

  const left = cardsLeft(order, { passed: openPassed, trail: [] });
  const skipped = cardsSkipped(order, { passed, trail: [] });
  // Cards the sitting moved past that no longer need a person; the rest are the skipped ones.
  const fixed = Math.max(0, passed.length - skipped);
  const isDone = location.kind === "done";

  // ── moving ──────────────────────────────────────────────────────────────
  /** Leave `fromId` going forward: to the next card still to walk, or the end. */
  const advance = (fromId: string) => {
    const sitting = withPassed({ passed: openPassed, trail }, fromId);
    setPassed((prev) => (prev.includes(fromId) ? prev : [...prev, fromId]));
    setReviewing((prev) => (prev.includes(fromId) ? prev.filter((id) => id !== fromId) : prev));
    const next = nextCardId(order, sitting, fromId);
    if (next) goToCard(next, fromId);
    else finish(fromId);
  };

  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const markReviewed = useMutation(api.tidyCards.markReviewed);

  const pinkCount = attention?.items.filter((i) => i.level === "fix").length ?? 0;
  const checkCount = attention?.items.filter((i) => i.level === "check").length ?? 0;
  const canSave = isDone || (!!current && pinkCount === 0 && !saving);

  const save = async () => {
    if (isDone) {
      onClose();
      return;
    }
    if (!current || saving || pinkCount > 0) return;
    setSaving(true);
    setSaveFailed(false);
    const cardId = current._id;
    try {
      await markReviewed({ cardId, keys: currentReviewKeys(current) });
    } catch {
      setSaveFailed(true);
      setSaving(false);
      return;
    }
    // One transition for the state and the navigation, so the old card never
    // renders with Save pressable again for a frame (router navigation is a
    // transition; a sibling setState outside it lands first).
    startTransition(() => {
      setSaving(false);
      advance(cardId);
    });
  };

  // The skipped cards (passed, and still flagged), in walk order.
  const skippedIds = useMemo(() => {
    const passedSet = new Set(passed);
    return order.filter(({ row }) => passedSet.has(row._id)).map(({ row }) => row._id as string);
  }, [order, passed]);

  /**
   * End screen → "Review the N skipped": the skipped cards are offered again,
   * starting at the first of them. `passed` is left alone (the tally and this
   * button are derived from it, so Back to the end screen shows both as they
   * were); the cards are marked as being reviewed, which makes each count as
   * open until it is left again. The walk moves to the first: a push.
   */
  const reviewSkipped = () => {
    const first = skippedIds[0];
    if (!first) return;
    // One transition for the state and the push (router navigation is a
    // transition; a sibling setState outside it would render the old URL first).
    startTransition(() => {
      setReviewing(skippedIds);
      // From the end screen, so the footer's Back is the browser's Back: a step to it.
      goToCard(first, TIDY_DONE);
    });
  };

  const skip = () => {
    if (!current || saving) return;
    setSaveFailed(false);
    advance(current._id);
  };

  const back = () => {
    if (saving) return;
    setSaveFailed(false);
    if (canStepBack) {
      stepBack();
      return;
    }
    const prev = previousCardId({ passed, trail }, currentId ?? null);
    if (prev) showCard(prev);
  };

  const canGoBack =
    !saving && (canStepBack || previousCardId({ passed, trail }, currentId ?? null) !== null);

  // ── keys ────────────────────────────────────────────────────────────────
  const inlineOpen = useInlineStackOpen();
  const closeTopInlinePart = useCloseTopInlinePart();
  const onKeys = useTidyKeys({
    canSave,
    inlineOpen,
    closeTopInlinePart,
    onSave: () => void save(),
    onSaveForLater: onClose,
  });

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    onKeys(event);
    if (event.defaultPrevented || event.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  // ── focus ───────────────────────────────────────────────────────────────
  // On open: capture the opener BEFORE the background goes inert (inert blurs
  // it), and give focus back when the walk goes.
  useEffect(() => {
    const opener = restoreFocusRef?.current ?? (document.activeElement as HTMLElement | null);
    const release = dialogRef.current ? inertBackground(dialogRef.current) : () => {};
    return () => {
      release();
      requestAnimationFrame(() => {
        // The durable target is asked for NOW, not when the walk opened: the
        // checklist picks between its "N need you" pill (if cards still need
        // someone) and its Sync button (the pill is gone), and only the
        // moment the walk closes knows which.
        // eslint-disable-next-line react-hooks/exhaustive-deps -- read at close time on purpose
        const target = restoreFocusRef?.current ?? opener;
        if (target && document.contains(target)) target.focus?.();
      });
    };
  }, [restoreFocusRef]);

  // On every card: the header line is read (number, who, what is owed), and
  // Tab starts from there. Never a field: the walk must not start a typing
  // session nobody asked for. `reviewing` is a dependency on purpose: "Review the
  // N skipped" changes it in the same transition that moves the walk to the
  // first skipped card, so that landing is focused by this effect (the header
  // of that card), not left to the lost-focus repair below.
  useEffect(() => {
    if (!currentId && !isDone) return;
    const id = requestAnimationFrame(() => {
      // The card changed, so the field the operator was in (if any) belonged
      // to the card that just left; one still on the page is a field of this
      // card that someone is already typing in. Leave that one alone.
      const active = document.activeElement;
      if (active && panelRef.current?.contains(active) && isEditableTarget(active)) return;
      headerRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [currentId, isDone, reviewing]);

  // An ANSWER on a tile (`useAnswered`): focus goes on, never back to the
  // control that was pressed (an answered row's Change, a reopened search: one
  // more Enter there would undo the answer). With nothing pink left on the card
  // it lands on Save & next, so Enter saves and advances; otherwise on the
  // first control of the first pink tile. Decided a frame later, from the page,
  // so it sees the card as the answer left it.
  const [answerTick, setAnswerTick] = useState(0);
  const onAnswered = useCallback(() => setAnswerTick((t) => t + 1), []);
  useEffect(() => {
    if (answerTick === 0) return;
    const id = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      // Someone typing in a field of this card is left where they are.
      const active = document.activeElement;
      if (active && panel.contains(active) && isEditableTarget(active)) return;
      const pink = panel.querySelector<HTMLElement>('[data-tidy-level="fix"]');
      const first = pink?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? saveRef.current)?.focus({ preventScroll: false });
    });
    return () => cancelAnimationFrame(id);
  }, [answerTick]);

  // Back goes unavailable at the oldest card. It is `aria-disabled`, so focus is
  // not thrown out; if it was on Back, it moves to the next control along.
  const hadBack = useRef(canGoBack);
  useEffect(() => {
    if (hadBack.current && !canGoBack && document.activeElement === backRef.current) {
      saveForLaterRef.current?.focus({ preventScroll: true });
    }
    hadBack.current = canGoBack;
  }, [canGoBack]);

  // Focus that is lost inside the walk comes back to the walk. A tile answer
  // (No team on this card, Looks right, a picked chip) can unmount the very
  // button that was pressed; the browser then drops focus to <body>, outside
  // the dialog's key handler, and Enter and Esc go nowhere. Watch the panel
  // for changes and, one frame after the dust settles, put focus on the card
  // header (`tabIndex=-1`, the same place a new card starts). Only a LOST
  // focus is repaired: while focus is on any live element (a field being
  // typed in, a control that took it itself) nothing moves.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || typeof MutationObserver === "undefined") return;
    let frame = 0;
    const settle = () => {
      frame = 0;
      const active = document.activeElement;
      const lost =
        !active ||
        active === document.body ||
        active === document.documentElement ||
        (active instanceof HTMLElement && active.matches(":disabled"));
      if (!lost || !panel.isConnected) return;
      (headerRef.current ?? panel).focus({ preventScroll: true });
    };
    const observer = new MutationObserver(() => {
      if (frame === 0) frame = requestAnimationFrame(settle);
    });
    observer.observe(panel, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled"],
    });
    return () => {
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, []);

  const playerNames = context?.players.map((p) => p.nameOnCard ?? p.name);
  const header = current ? cardHeaderParts(current, playerNames) : null;
  const tally = attention ? tallyText(attention) : "";

  const tileProps: TidyTileProps | null =
    current && attention
      ? { row: current, context, attention, leafId, sportId, leafCards: cards, setName, setNoTeam }
      : null;

  const planned = openPassed.length + left;
  const subtitle = cardsLeftText(left);

  return createPortal(
    <Theme>
      <AnsweredProvider value={onAnswered}>
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="fixed inset-0 z-50 flex items-stretch justify-center bg-scrim sm:items-center sm:p-4"
          onKeyDown={onKeyDown}
        >
          <div
            ref={panelRef}
            tabIndex={-1}
            className="tidy-walk flex h-dvh w-full max-w-[45rem] flex-col bg-raised-deep outline-none sm:h-[min(52rem,calc(100dvh-2rem))] sm:rounded-lg sm:border sm:border-rule-strong sm:shadow-xl sm:shadow-offset"
          >
            <WizardChrome
              titleId={titleId}
              title={title}
              done={openPassed.length}
              planned={planned}
              subtitle={subtitle}
              aside={
                <AddAllNewPlayers
                  leafId={leafId}
                  refreshKey={newPlayersKey}
                  panelHost={addAllHost}
                />
              }
            />

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {/* The end screen's verdict, mounted for the whole sitting so the line is a
                  change to a live region already in the page (and a walk that opens on
                  the end screen announces nothing it did not just do). */}
              <p
                id={doneLineId}
                role="status"
                className={`mb-2 empty:hidden ${
                  skipped > 0 ? "text-base font-semibold text-neon-pink-text" : "text-sm text-ink-2"
                }`}
              >
                {isDone
                  ? skipped > 0
                    ? cardsSkippedText(skipped)
                    : awaitingLookup === 0
                      ? TIDY_ALL_CLEAR
                      : ""
                  : ""}
              </p>
              {/* The confirm of "Add all N new players" (its control is in the
                  chrome above) is drawn here while it is open; empty, it takes no room. */}
              <div ref={setAddAllHost} className="mb-3 empty:hidden" />
              {isDone ? (
                <div
                  ref={headerRef}
                  tabIndex={-1}
                  role="group"
                  aria-labelledby={`${doneLineId} ${doneTallyId} ${doneLookupId}`}
                  className="focus-outline grid gap-2"
                >
                  {passed.length > 0 && (
                    <p id={doneTallyId} className="text-sm text-ink">
                      {cardsTallyText(fixed, skipped)}
                    </p>
                  )}
                  {awaitingLookup > 0 && (
                    <p id={doneLookupId} className="text-sm text-ink-2">
                      {teamLookupStatusLine(awaitingLookup, needYouCount)}
                    </p>
                  )}
                </div>
              ) : tileProps ? (
                <div className="grid gap-3.5" key={tileProps.row._id}>
                  <div className="grid justify-items-center gap-3 text-center sm:grid-cols-[auto_minmax(0,1fr)] sm:justify-items-start sm:text-left">
                    <TidyCardFace
                      row={tileProps.row}
                      context={context}
                      setName={setName}
                      season={season}
                      variantName={variantName}
                      variantKind={variantKind}
                    />
                    <div
                      ref={headerRef}
                      tabIndex={-1}
                      role="group"
                      aria-labelledby={headerLineId}
                      className="focus-outline grid min-w-0 gap-1"
                    >
                      <p id={headerLineId} className="text-lg font-semibold text-ink wrap-anywhere">
                        <span className="whitespace-nowrap">{header?.number}</span>
                        {header?.rest ? ` · ${header.rest}` : ""}
                      </p>
                      {tally && (
                        <p className="text-sm">
                          {pinkCount > 0 && (
                            <span className="text-neon-pink-text">{pinkCount} to fix</span>
                          )}
                          {pinkCount > 0 && checkCount > 0 && (
                            <span className="text-ink-3">{" · "}</span>
                          )}
                          {checkCount > 0 && (
                            <span className="text-neon-blue-text">{checkCount} to check</span>
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                  <SourcesDisagreeTile {...tileProps} />
                  <PlayerTile {...tileProps} />
                  <div className="ml-[18px] empty:hidden">
                    <CareerTile {...tileProps} />
                  </div>
                  <TeamTile {...tileProps} />
                  <AutographTile {...tileProps} />
                  <TitleTile {...tileProps} />
                  <MoreAboutTile {...tileProps} />
                </div>
              ) : (
                <p className="text-sm text-ink-3">Finding the next card.</p>
              )}
            </div>

            <div className="grid shrink-0 gap-2 border-t border-rule-strong px-5 py-3.5">
              <div className="flex flex-wrap items-center justify-end gap-2">
                <NeonButton
                  type="button"
                  variant="secondary"
                  outline
                  className="mr-auto"
                  ref={backRef}
                  onClick={() => {
                    if (canGoBack) back();
                  }}
                  aria-disabled={!canGoBack || undefined}
                >
                  {TIDY_BACK_LABEL}
                </NeonButton>
                {isDone ? (
                  <>
                    {skippedIds.length > 0 && (
                      <NeonButton type="button" variant="secondary" onClick={reviewSkipped}>
                        {reviewSkippedLabel(skippedIds.length)}
                      </NeonButton>
                    )}
                    <NeonButton type="button" onClick={onClose}>
                      <HintedLabel label={TIDY_DONE_LABEL} />
                    </NeonButton>
                  </>
                ) : (
                  <>
                    <NeonButton
                      ref={saveForLaterRef}
                      type="button"
                      variant="secondary"
                      outline
                      onClick={onClose}
                    >
                      <HintedLabel label={TIDY_SAVE_FOR_LATER_LABEL} />
                    </NeonButton>
                    <NeonButton
                      type="button"
                      variant="negative"
                      outline
                      onClick={skip}
                      aria-disabled={!current || saving || undefined}
                    >
                      {TIDY_SKIP_LABEL}
                    </NeonButton>
                    <NeonButton
                      ref={saveRef}
                      type="button"
                      onClick={() => void save()}
                      aria-disabled={!canSave || undefined}
                      aria-describedby={pinkCount > 0 ? statusId : undefined}
                    >
                      <HintedLabel label={TIDY_SAVE_LABEL} />
                    </NeonButton>
                  </>
                )}
              </div>
              {/* Always mounted, so a change is announced; the line says why Save is held. */}
              <p
                id={statusId}
                role="status"
                className="min-h-4 text-right text-xs text-neon-pink-text"
              >
                {!isDone && pinkCount > 0 ? mustFixLine(pinkCount) : ""}
              </p>
              {saveFailed && (
                <p role="alert" className="text-right text-xs text-neon-pink-text">
                  {TIDY_SAVE_FAILED}
                </p>
              )}
            </div>
          </div>
        </div>
      </AnsweredProvider>
    </Theme>,
    document.body,
  );
}
