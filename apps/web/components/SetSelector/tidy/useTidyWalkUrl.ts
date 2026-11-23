/**
 * NEO-645 — where the Tidy Up walk is lives in the URL.
 *
 * `?tidy=first | <cardId> | done`, next to the drill's own params. A refresh
 * or a pasted link lands on the same card. The drill hook drops `tidy` when the
 * drill itself changes (`useDrillUrlState`), because the card belongs to the
 * checklist it was opened on.
 *
 * ## Push vs replace
 *
 * Opening the walk is the one `push`: one history entry for the whole walk.
 * Every move after that (next, skip, the end screen, Back, a correction such
 * as `first` becoming the first card's id) is a `replace`. A walk of hundreds
 * of cards is therefore still one entry deep, which matters because browsers
 * keep only a bounded session history (Chromium: 50 entries) and
 * `history.go(-n)` past it does nothing, so a per-card push made Done, Esc and
 * Save for later fail silently once a walk had made about 48 moves.
 *
 * ## Leaving
 *
 * Closing the walk (Save for later, Done) goes back exactly the one entry the
 * walk pushed, so Back from the checklist goes to whatever was before the walk
 * opened and never into it. The entry carries `state.tidyOpened` (kept across
 * every replace). A walk that was not opened here (a pasted link, a new tab)
 * has no such entry, and nothing before it is ours to go back to, so it just
 * drops the param with a replace. The browser's own Back, pressed inside the
 * walk, leaves the walk the same way; the footer Back button is the walk's own
 * (below).
 *
 * ## What reaches a Convex argument
 *
 * Nothing. The param is only ever compared with the ids of the rows the walk
 * already holds (`cards`), and an id that is not one of them is replaced by
 * the first walk card. A pasted `?tidy=<anything>` therefore cannot fail
 * argument validation.
 *
 * ## Footer Back
 *
 * A move from one walk position to another carries `state.tidyFrom` (the
 * position it left: a card id, or `done` when the review of skipped cards left
 * the end screen). Footer Back replaces the URL with that position. Without it
 * (the walk was opened here by a refresh or a link) the walk steps to the card
 * before on its own trail (`previousCardId`).
 */
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { liveSearchParams, noteSearchWrite, settleSearchWrite } from "../live-search-params";

/** The query-string key. */
export const TIDY_PARAM = "tidy";

/** The reserved values; a Convex id is never either. */
export const TIDY_FIRST = "first";
export const TIDY_DONE = "done";

/** Longer than any Convex id by a wide margin. */
const MAX_PARAM_LENGTH = 128;

export type TidyWalkLocation =
  | { kind: "closed" }
  | { kind: "first" }
  | { kind: "done" }
  | { kind: "card"; cardId: string };

/** The walk position a `tidy` value stands for. Pure. */
export function parseTidyParam(value: string | null | undefined): TidyWalkLocation {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > MAX_PARAM_LENGTH) return { kind: "closed" };
  if (trimmed === TIDY_FIRST) return { kind: "first" };
  if (trimmed === TIDY_DONE) return { kind: "done" };
  return { kind: "card", cardId: trimmed };
}

/** `params` with `tidy` set to `value`, or removed when `value` is null. */
export function withTidyParam(params: URLSearchParams, value: string | null): URLSearchParams {
  const next = new URLSearchParams(params);
  if (value === null) next.delete(TIDY_PARAM);
  else next.set(TIDY_PARAM, value);
  return next;
}

/** What the walk's history entry carries. */
type TidyState = {
  /** The position a move left (a card id or `done`), so footer Back can return to it. */
  tidyFrom?: string;
  /** The walk was opened here: its one history entry is ours to go back to. */
  tidyOpened?: true;
};

export type TidyWalkUrl = {
  location: TidyWalkLocation;
  /**
   * The router entry the URL was last committed as. It changes on every
   * navigation, including one that leaves `tidy` reading the same (another
   * writer restoring `first` after the walk replaced it), which `location`
   * cannot show: it is memoized on the `tidy` value. The walk's resolve effect
   * depends on it.
   */
  entryKey: string;
  /** A move led here from a walk position that footer Back can return to. */
  canStepBack: boolean;
  /** Open the walk at its first card. The walk's one push. */
  open: () => void;
  /** Move to a card, leaving `from`. Replace. */
  goToCard: (cardId: string, from: string | null) => void;
  /** Show a card (a correction, or Back along the trail). Replace. */
  showCard: (cardId: string) => void;
  /** The end screen. Replace. */
  finish: (from: string | null) => void;
  /** The end screen as a correction (nothing to walk). Replace. */
  showDone: () => void;
  /** Return to the position the last move left. Replace. */
  stepBack: () => void;
  /**
   * Leave the walk: back the one entry it pushed when it was opened here, so
   * Back never returns to it; a replace that drops the param otherwise.
   */
  close: () => void;
};

export function useTidyWalkUrl(): TidyWalkUrl {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const routerLocation = useLocation();

  const tidyValue = searchParams.get(TIDY_PARAM);
  const location = useMemo(() => parseTidyParam(tidyValue), [tidyValue]);

  const entryState = routerLocation.state as TidyState | null | undefined;
  const fromState = entryState?.tidyFrom;
  const opened = entryState?.tidyOpened === true;
  const canStepBack = typeof fromState === "string" && fromState.length > 0;

  // The handlers read the latest params so a write made in the same tick as
  // another change (the drill's own write) never rebuilds from a stale copy.
  const latest = useRef({ searchParams, setSearchParams, navigate, opened, fromState });
  useLayoutEffect(() => {
    latest.current = { searchParams, setSearchParams, navigate, opened, fromState };
    settleSearchWrite(searchParams);
  });

  /** Every move is a replace; the walk's one entry is pushed by `open`. */
  const write = useCallback((value: string | null, from?: string | null) => {
    const { searchParams: rendered, setSearchParams: set, opened: here } = latest.current;
    // Build on the URL a drill write has just asked for, not the one last rendered.
    const params = liveSearchParams(rendered);
    const state: TidyState | undefined =
      from || here
        ? { ...(from ? { tidyFrom: from } : {}), ...(here ? { tidyOpened: true as const } : {}) }
        : undefined;
    const nextParams = withTidyParam(params, value);
    noteSearchWrite(nextParams);
    set(nextParams, { replace: true, state });
  }, []);

  const open = useCallback(() => {
    const { searchParams: rendered, setSearchParams: set } = latest.current;
    const next = withTidyParam(liveSearchParams(rendered), TIDY_FIRST);
    noteSearchWrite(next);
    set(next, { state: { tidyOpened: true } satisfies TidyState });
  }, []);
  const goToCard = useCallback((cardId: string, from: string | null) => write(cardId, from), [write]);
  const showCard = useCallback((cardId: string) => write(cardId), [write]);
  const finish = useCallback((from: string | null) => write(TIDY_DONE, from), [write]);
  const showDone = useCallback(() => write(TIDY_DONE), [write]);
  const close = useCallback(() => {
    const { navigate: go, opened: here } = latest.current;
    if (!here) {
      write(null);
      return;
    }
    go(-1);
  }, [write]);
  const stepBack = useCallback(() => {
    const { fromState: from } = latest.current;
    if (from) write(from);
  }, [write]);

  return { location, entryKey: routerLocation.key, canStepBack, open, goToCard, showCard, finish, showDone, stepBack, close };
}
