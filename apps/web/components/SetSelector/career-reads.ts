import { useEffect, useRef, useState } from "react";
import { useConvex } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { CAREER_COVERAGE_MAX_PAIRS } from "../../convex/lib/careerCoverage";
import { pairKey, type CoverageAsk } from "./career-check";

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
 * A read that fails is answered "covered" for the pairs in it: the check is
 * an extra question, never a gate on saving, and the commit's own link rule
 * still holds. The failure is logged.
 */
export function CareerCoverageFetcher({
  selectorOptionId,
  asks,
  onAnswered,
}: {
  selectorOptionId: Id<"selectorOptions">;
  asks: readonly CoverageAsk[];
  onAnswered: (answers: Record<string, boolean>) => void;
}) {
  const convex = useConvex();
  const asked = useRef(new Set<string>());
  const live = useRef(true);
  const onAnsweredRef = useRef(onAnswered);
  useEffect(() => {
    onAnsweredRef.current = onAnswered;
  }, [onAnswered]);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
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
    for (let at = 0; at < fresh.length; at += CAREER_COVERAGE_MAX_PAIRS) {
      const chunk = fresh.slice(at, at + CAREER_COVERAGE_MAX_PAIRS);
      convex
        .query(api.careerCoverage.coverageForPreview, {
          selectorOptionId,
          pairs: chunk.map((c) => c.ask),
        })
        .then((answer) => {
          if (!live.current) return;
          const out: Record<string, boolean> = {};
          chunk.forEach((c, i) => {
            out[c.key] = answer.results[i]?.covered ?? true;
          });
          onAnsweredRef.current(out);
        })
        .catch((error: unknown) => {
          console.warn("Career check: coverage read failed", error);
          if (!live.current) return;
          const out: Record<string, boolean> = {};
          for (const c of chunk) out[c.key] = true;
          onAnsweredRef.current(out);
        });
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
