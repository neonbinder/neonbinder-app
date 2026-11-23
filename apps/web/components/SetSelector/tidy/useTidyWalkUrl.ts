/**
 * NEO-645 — where the Tidy Up walk is lives in the URL.
 *
 * `?tidy=first | <cardId> | done`, next to the drill's own params. A refresh
 * or a pasted link lands on the same card, and Back steps back through the
 * walk one card at a time. The drill hook drops `tidy` when the drill itself
 * changes (`useDrillUrlState`), because the card belongs to the checklist it
 * was opened on.
 *
 * ## Push vs replace
 *
 * Opening the walk and every move to another card is a `push` (up to the cap,
 * below), so Back steps through the cards. The clean-ups (`first` becoming the first card's id, an
 * unknown id becoming the first card) are `replace`: a correction the operator
 * did not ask for must never be a Back stop.
 *
 * ## The history cap
 *
 * Chromium keeps at most 50 session-history entries, and `history.go(-n)` past
 * what is kept does nothing, so leaving by `go(-(depth + 1))` would silently
 * fail once a long walk had pushed about 48 entries. A move therefore pushes
 * only while the walk is shallower than `TIDY_MAX_DEPTH`; from there on it
 * replaces and the depth stays put. The depth never passes the cap, so leaving
 * always lands on the page the walk opened from. Past the cap the browser's
 * Back steps to the entry at the cap rather than the previous card (the
 * footer Back keeps its trail, see "Back").
 *
 * ## Leaving
 *
 * Closing the walk (Save for later, Done) takes every entry the walk added out
 * of history, so Back from the checklist goes to whatever was before the walk
 * opened and never into it (a Back that lands on `?tidy=<last card>` reopens a
 * walk nobody asked to reopen). Each entry the walk pushes carries its depth in
 * `state.tidyDepth` (the first is 0, kept across the replace that turns `first`
 * into a card), so leaving is one `navigate(-(depth + 1))`. A walk that was not
 * opened here (a pasted link, a new tab) has no depth, and nothing before it is
 * ours to go back to, so it just drops the param with a replace.
 *
 * ## What reaches a Convex argument
 *
 * Nothing. The param is only ever compared with the ids of the rows the walk
 * already holds (`cards`), and an id that is not one of them is replaced by
 * the first walk card. A pasted `?tidy=<anything>` therefore cannot fail
 * argument validation.
 *
 * ## Back
 *
 * A push from one walk card to another carries `state.tidyFrom` (the card it
 * left). Footer Back uses the browser's history when that is present, so the
 * browser's Back and the footer's Back are the same move. Without it (the
 * walk was opened here by a refresh or a link) the walk steps to the card
 * before on its own trail (`previousCardId`). At the cap the entry behind this
 * one is no longer the card before, so footer Back replaces the URL with the
 * position the move left instead.
 */
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { liveSearchParams, noteSearchWrite, settleSearchWrite } from "../live-search-params";

/** The query-string key. */
export const TIDY_PARAM = "tidy";

/**
 * How many entries deep a walk may push before its moves replace. Chromium
 * keeps 50 session-history entries; the walk's own are at most this + 1, with
 * the page it opened from, well inside the cap.
 */
export const TIDY_MAX_DEPTH = 40;

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

/** What a walk history entry carries. */
type TidyState = {
  /** The card a push left, so footer Back can use the browser's history. */
  tidyFrom?: string;
  /** How many walk entries came before this one since the walk opened here (the first is 0). */
  tidyDepth?: number;
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
  /** A walk card was on screen before this entry (so the browser can step back to it). */
  canStepBack: boolean;
  /** Open the walk at its first card. Push. */
  open: () => void;
  /** Move to a card, leaving `from`. Push. */
  goToCard: (cardId: string, from: string | null) => void;
  /** Show a card without adding a history entry (a correction). Replace. */
  showCard: (cardId: string) => void;
  /** The end screen. Push. */
  finish: (from: string | null) => void;
  /** The end screen as a correction (nothing to walk). Replace. */
  showDone: () => void;
  /** Step back one history entry (the previous walk card). */
  stepBack: () => void;
  /**
   * Leave the walk: out of history entirely when it was opened here, so Back
   * never returns to it; a replace that drops the param otherwise.
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
  const depth = typeof entryState?.tidyDepth === "number" ? entryState.tidyDepth : undefined;
  const canStepBack = typeof fromState === "string" && fromState.length > 0;

  // The handlers read the latest params so a write made in the same tick as
  // another change (the drill's own write) never rebuilds from a stale copy.
  const latest = useRef({ searchParams, setSearchParams, navigate, depth, fromState });
  useLayoutEffect(() => {
    latest.current = { searchParams, setSearchParams, navigate, depth, fromState };
    settleSearchWrite(searchParams);
  });

  const write = useCallback(
    (value: string | null, mode: "push" | "replace", from?: string | null) => {
      const { searchParams: rendered, setSearchParams: set, depth: here } = latest.current;
      // Build on the URL a drill write has just asked for, not the one last rendered.
      const params = liveSearchParams(rendered);
      // A push is one entry deeper than this one, until the cap: from there a
      // move replaces and the depth stays put (see "The history cap").
      const push = mode === "push" && (here === undefined || here < TIDY_MAX_DEPTH);
      const next = here === undefined ? undefined : push ? here + 1 : here;
      const state: TidyState | undefined =
        from || next !== undefined
          ? { ...(from ? { tidyFrom: from } : {}), ...(next !== undefined ? { tidyDepth: next } : {}) }
          : undefined;
      const nextParams = withTidyParam(params, value);
      noteSearchWrite(nextParams);
      set(nextParams, { replace: !push, state });
    },
    [],
  );

  const open = useCallback(() => {
    const { searchParams: rendered, setSearchParams: set } = latest.current;
    const next = withTidyParam(liveSearchParams(rendered), TIDY_FIRST);
    noteSearchWrite(next);
    set(next, { state: { tidyDepth: 0 } satisfies TidyState });
  }, []);
  const goToCard = useCallback(
    (cardId: string, from: string | null) => write(cardId, "push", from),
    [write],
  );
  const showCard = useCallback((cardId: string) => write(cardId, "replace"), [write]);
  const finish = useCallback((from: string | null) => write(TIDY_DONE, "push", from), [write]);
  const showDone = useCallback(() => write(TIDY_DONE, "replace"), [write]);
  const close = useCallback(() => {
    const { navigate: go, depth: here } = latest.current;
    if (here === undefined) {
      write(null, "replace");
      return;
    }
    go(-(here + 1));
  }, [write]);
  const stepBack = useCallback(() => {
    const { navigate: go, depth: here, fromState: from } = latest.current;
    // At the cap the entry behind this one may be many cards back: go to the
    // position the move left instead of stepping the browser's history.
    if (here !== undefined && here >= TIDY_MAX_DEPTH && from) write(from, "replace");
    else go(-1);
  }, [write]);

  return { location, entryKey: routerLocation.key, canStepBack, open, goToCard, showCard, finish, showDone, stepBack, close };
}
