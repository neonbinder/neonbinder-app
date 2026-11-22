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
 * Opening the walk and every move to another card is a `push`, so Back steps
 * through the cards. The clean-ups (`first` becoming the first card's id, an
 * unknown id becoming the first card) are `replace`: a correction the operator
 * did not ask for must never be a Back stop.
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
 * before on its own trail (`previousCardId`).
 */
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

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

/** What a walk history entry carries. */
type TidyState = {
  /** The card a push left, so footer Back can use the browser's history. */
  tidyFrom?: string;
  /** How many walk entries came before this one since the walk opened here (the first is 0). */
  tidyDepth?: number;
};

export type TidyWalkUrl = {
  location: TidyWalkLocation;
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
  const latest = useRef({ searchParams, setSearchParams, navigate, depth });
  useLayoutEffect(() => {
    latest.current = { searchParams, setSearchParams, navigate, depth };
  });

  const write = useCallback(
    (value: string | null, mode: "push" | "replace", from?: string | null) => {
      const { searchParams: params, setSearchParams: set, depth: here } = latest.current;
      // A push is one entry deeper than this one; a replace stays where it is.
      const next = here === undefined ? undefined : mode === "push" ? here + 1 : here;
      const state: TidyState | undefined =
        from || next !== undefined
          ? { ...(from ? { tidyFrom: from } : {}), ...(next !== undefined ? { tidyDepth: next } : {}) }
          : undefined;
      set(withTidyParam(params, value), { replace: mode === "replace", state });
    },
    [],
  );

  const open = useCallback(() => {
    const { searchParams: params, setSearchParams: set } = latest.current;
    set(withTidyParam(params, TIDY_FIRST), { state: { tidyDepth: 0 } satisfies TidyState });
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
  const stepBack = useCallback(() => latest.current.navigate(-1), []);

  return { location, canStepBack, open, goToCard, showCard, finish, showDone, stepBack, close };
}
