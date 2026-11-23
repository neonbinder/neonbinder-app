/**
 * NEO-645 — the URL a write should build on, not the one last rendered.
 *
 * The drill (`useDrillUrlState`) and the Tidy Up walk (`useTidyWalkUrl`) both
 * write the set builder's query string, each from the `searchParams` of its
 * latest RENDER. The router commits a navigation inside `startTransition`, so
 * for a beat after one hook writes, the other still renders the old string.
 * A write from that render rebuilds the URL from the old params and undoes the
 * first write: the walk opening (`?tidy=first`) in the same tick as a drill
 * write put the drill back where it was, and a drill write dropped `tidy`.
 *
 * This module remembers the string a write is about to commit. Either hook
 * reads it through `liveSearchParams` for as long as it has not yet rendered,
 * and forgets it when a render shows it (`settleSearchWrite`), when the
 * browser's own Back or Forward moves the URL (`popstate`), or after a few
 * seconds (a write the router never committed must not linger).
 *
 * One page holds one router, so one module-level slot is enough.
 */
const PENDING_TTL_MS = 3000;

let pending: { search: string; at: number } | null = null;

/** The params the next write should start from: the pending write's, else `rendered`. */
export function liveSearchParams(rendered: URLSearchParams): URLSearchParams {
  if (pending === null || Date.now() - pending.at > PENDING_TTL_MS) return rendered;
  return new URLSearchParams(pending.search);
}

/** Call just before handing `next` to the router. */
export function noteSearchWrite(next: URLSearchParams): void {
  pending = { search: next.toString(), at: Date.now() };
}

/** Call from a layout effect with what was just rendered. */
export function settleSearchWrite(rendered: URLSearchParams): void {
  if (pending !== null && pending.search === rendered.toString()) pending = null;
}

/** Forget any pending write (tests, and a Back or Forward). */
export function forgetSearchWrite(): void {
  pending = null;
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", forgetSearchWrite);
}
