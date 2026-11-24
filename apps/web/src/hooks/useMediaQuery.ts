import { useCallback, useSyncExternalStore } from "react";

/**
 * Does this CSS media query match right now, and does the answer follow the
 * window as it changes? `matchMedia` is the browser's own, so a rotated phone
 * or a resized window re-renders the reader.
 *
 * Server-safe and test-safe: with no `window` or no `matchMedia` (a server
 * render, an environment that never defined it) the answer is `false`, the
 * same on the server and for the first client render, so nothing mismatches.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return () => {};
      }
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia(query).matches,
    [query],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
