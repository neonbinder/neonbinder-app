import { useEffect, useRef, useState } from "react";
import { useConvex } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { CAREER_COVERAGE_MAX_PAIRS } from "../../convex/lib/careerCoverage";
import { pairKey, type CoverageAsk } from "./career-check";

/** How many coverage chunks are read at once. */
export const CAREER_COVERAGE_PARALLEL = 2;

/**
 * How long a run of reads may take before what is still out is reported as
 * failed. A query that never answers must not hold "Checking careers…" (and
 * the held Next) for ever: the failure line and Retry take over.
 */
export const CAREER_COVERAGE_TIMEOUT_MS = 15_000;

/**
 * NEO-574 — the career check's coverage reads, asked once each.
 *
 * Render-less. The wizard mounts it while some pair has no answer yet and
 * hands it the pairs; each pair is asked at most once per mount, in chunks of
 * `CAREER_COVERAGE_MAX_PAIRS`, and the answers go back through `onAnswered`
 * keyed by `pairKey` (true = covered).
 *
 * `coverageForPreview` is called one-shot (`useConvex().query`), never
 * subscribed: the answer is about careers as they are now, and the step does
 * not want a re-run when a player is edited elsewhere (a heavy answer is read
 * once on demand).
 *
 * A read that fails is NOT answered "covered": its keys go to `onFailed`, so
 * the step can say the check could not run and offer Retry (Next still saves;
 * the check is an extra question, never a gate). The failure is logged. A
 * result the answer does not carry for a pair counts as a failure too.
 */
export function CareerCoverageFetcher({
  selectorOptionId,
  asks,
  onAnswered,
  onFailed,
}: {
  selectorOptionId: Id<"selectorOptions">;
  asks: readonly CoverageAsk[];
  onAnswered: (answers: Record<string, boolean>) => void;
  /** The read failed for these pair keys. They are NOT answered "covered". */
  onFailed: (keys: string[]) => void;
}) {
  const convex = useConvex();
  const asked = useRef(new Set<string>());
  const live = useRef(true);
  const onAnsweredRef = useRef(onAnswered);
  const onFailedRef = useRef(onFailed);
  useEffect(() => {
    onAnsweredRef.current = onAnswered;
    onFailedRef.current = onFailed;
  }, [onAnswered, onFailed]);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    live.current = true;
    const pending = timers.current;
    return () => {
      live.current = false;
      for (const t of pending) clearTimeout(t);
      pending.clear();
    };
  }, []);

  useEffect(() => {
    const fresh: Array<{ key: string; ask: CoverageAsk }> = [];
    for (const ask of asks) {
      const key = pairKey(ask);
      if (asked.current.has(key)) continue;
      asked.current.add(key);
      fresh.push({ key, ask });
    }
    // Chunks of at most CAREER_COVERAGE_MAX_PAIRS, and no more than
    // CAREER_COVERAGE_PARALLEL of them in flight: a big set is read two at a
    // time rather than all at once (each is a query over careers and teams).
    const chunks: Array<typeof fresh> = [];
    for (let at = 0; at < fresh.length; at += CAREER_COVERAGE_MAX_PAIRS) {
      chunks.push(fresh.slice(at, at + CAREER_COVERAGE_MAX_PAIRS));
    }
    // Keys of this run not yet answered or reported: what a timeout reports.
    const outstanding = new Set(fresh.map((c) => c.key));
    let timedOut = false;
    if (outstanding.size > 0) {
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        if (!live.current || outstanding.size === 0) return;
        timedOut = true;
        const keys = [...outstanding];
        outstanding.clear();
        console.warn("Career check: coverage read timed out");
        onFailedRef.current(keys);
      }, CAREER_COVERAGE_TIMEOUT_MS);
      timers.current.add(timer);
    }
    const readChunk = async (chunk: typeof fresh): Promise<void> => {
      try {
        const answer = await convex.query(api.careerCoverage.coverageForPreview, {
          selectorOptionId,
          pairs: chunk.map((c) => c.ask),
        });
        // Past the timeout the keys were already reported: a late answer is ignored.
        if (!live.current || timedOut) return;
        const out: Record<string, boolean> = {};
        const missing: string[] = [];
        chunk.forEach((c, i) => {
          const covered = answer.results[i]?.covered;
          if (covered === undefined) missing.push(c.key);
          else out[c.key] = covered;
          outstanding.delete(c.key);
        });
        if (Object.keys(out).length > 0) onAnsweredRef.current(out);
        if (missing.length > 0) onFailedRef.current(missing);
      } catch (error: unknown) {
        console.warn("Career check: coverage read failed", error);
        if (!live.current || timedOut) return;
        for (const c of chunk) outstanding.delete(c.key);
        onFailedRef.current(chunk.map((c) => c.key));
      }
    };
    let next = 0;
    const worker = async (): Promise<void> => {
      while (live.current && !timedOut && next < chunks.length) {
        const chunk = chunks[next++];
        await readChunk(chunk);
      }
    };
    for (let i = 0; i < Math.min(CAREER_COVERAGE_PARALLEL, chunks.length); i += 1) {
      void worker();
    }
  }, [asks, convex, selectorOptionId]);

  return null;
}

export type RelinkCandidates = FunctionReturnType<typeof api.careerCoverage.relinkCandidates>;

/** One-shot read of the same-name players a line could be relinked to. */
export function useRelinkCandidates(
  selectorOptionId: Id<"selectorOptions">,
  args: {
    printedName: string;
    teamId?: Id<"teams">;
    teamName?: string;
    excludePlayerId?: Id<"players">;
  } | null,
): { state: "idle" | "loading" | "ready" | "failed"; candidates: RelinkCandidates["candidates"] } {
  const convex = useConvex();
  const [answer, setAnswer] = useState<{
    key: string;
    state: "ready" | "failed";
    candidates: RelinkCandidates["candidates"];
  } | null>(null);
  const key = args ? JSON.stringify(args) : null;
  useEffect(() => {
    if (!args || !key) return;
    let live = true;
    convex
      .query(api.careerCoverage.relinkCandidates, {
        selectorOptionId,
        printedName: args.printedName,
        ...(args.teamId ? { teamId: args.teamId } : {}),
        ...(args.teamName ? { teamName: args.teamName } : {}),
        ...(args.excludePlayerId ? { excludePlayerId: args.excludePlayerId } : {}),
      })
      .then((result) => {
        if (live) setAnswer({ key, state: "ready", candidates: result.candidates });
      })
      .catch((error: unknown) => {
        console.warn("Career check: relink candidates read failed", error);
        if (live) setAnswer({ key, state: "failed", candidates: [] });
      });
    return () => {
      live = false;
    };
    // `args` is represented by `key`; a fresh object each render must not re-ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convex, selectorOptionId, key]);
  if (!key) return { state: "idle", candidates: [] };
  if (answer?.key !== key) return { state: "loading", candidates: [] };
  return { state: answer.state, candidates: answer.candidates };
}
