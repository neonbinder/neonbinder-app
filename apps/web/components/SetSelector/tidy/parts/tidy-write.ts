import { useCallback, useEffect, useRef, useState } from "react";

/**
 * NEO-645 — a convex error's message, or a written-for-the-operator fallback.
 *
 * `data` first: a `ConvexError`'s `data` is the string the server wrote for the
 * operator to read, while a plain `Error` arrives redacted ("Server Error") in
 * production. Read structurally rather than with `instanceof ConvexError`, so a
 * rethrown or mocked error and a client version skew still surface what the
 * server said. Ported from the retired review wizard's `errorMessage`.
 */
export function errorMessage(e: unknown, fallback: string): string {
  if (typeof e === "object" && e !== null) {
    const data = (e as { data?: unknown }).data;
    if (typeof data === "string" && data.length > 0) return data;
  }
  return e instanceof Error && e.message && e.message !== "Server Error" ? e.message : fallback;
}

/**
 * One write at a time per tile, with its inline error.
 *
 * Tiles save as they are answered (J1) and never navigate, so the only
 * feedback a write needs is "in flight" (every button of the tile reads as
 * `aria-disabled`, never native `disabled`, so a keyboard operator parked on
 * the button that just fired is not thrown to `<body>`) and, on a refusal, a
 * line under the tile that says what happened.
 *
 * `run` resolves to whether the write went through, so a caller can close its
 * inline part only on success. A second press while one is in flight is
 * swallowed.
 */
export function useTidyWrite() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = useCallback(async (fn: () => Promise<unknown>, fallback: string): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      if (alive.current) setError(errorMessage(e, fallback));
      return false;
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);
  return { busy, error, run, clearError };
}

export type TidyWrite = ReturnType<typeof useTidyWrite>;
