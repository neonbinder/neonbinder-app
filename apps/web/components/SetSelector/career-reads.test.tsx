/**
 * NEO-574 (N2) — the coverage fetcher sends its 32-pair chunks at most two at
 * a time, not all at once, and still reports every answer and every failure.
 */
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { CAREER_COVERAGE_MAX_PAIRS } from "../../convex/lib/careerCoverage";

type Pending = {
  pairs: Array<{ playerId: string }>;
  resolve: (value: { results: Array<{ covered: boolean }> }) => void;
  reject: (error: Error) => void;
};
let pending: Pending[];
let inFlight: number;
let peak: number;

vi.mock("convex/react", () => ({
  useConvex: () => ({
    query: (_fn: unknown, args: { pairs: Array<{ playerId: string }> }) =>
      new Promise((resolve, reject) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        pending.push({
          pairs: args.pairs,
          resolve: (v) => {
            inFlight -= 1;
            resolve(v);
          },
          reject: (e) => {
            inFlight -= 1;
            reject(e);
          },
        });
      }),
  }),
  useQuery: () => undefined,
}));

import {
  CareerCoverageFetcher,
  CAREER_COVERAGE_PARALLEL,
  CAREER_COVERAGE_TIMEOUT_MS,
} from "./career-reads";

const SET = "set-1" as unknown as Id<"selectorOptions">;
const asksOf = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    playerId: `p-${i}` as unknown as Id<"players">,
    teamId: "t-1" as unknown as Id<"teams">,
  }));
const flush = () => act(async () => {});

beforeEach(() => {
  pending = [];
  inFlight = 0;
  peak = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("CareerCoverageFetcher dispatch", () => {
  it("reads two chunks at a time, never all at once", async () => {
    const chunks = 5;
    const onAnswered = vi.fn();
    const onFailed = vi.fn();
    render(
      <CareerCoverageFetcher
        selectorOptionId={SET}
        asks={asksOf(CAREER_COVERAGE_MAX_PAIRS * chunks)}
        onAnswered={onAnswered}
        onFailed={onFailed}
      />,
    );
    await flush();
    expect(CAREER_COVERAGE_PARALLEL).toBe(2);
    // Only the first two are out.
    expect(pending).toHaveLength(2);
    expect(inFlight).toBe(2);
    // One comes back; the next goes out, so two are still in flight.
    await act(async () => {
      pending[0].resolve({ results: pending[0].pairs.map(() => ({ covered: true })) });
    });
    expect(pending).toHaveLength(3);
    // Drain the rest in order.
    for (let i = 1; i < chunks; i += 1) {
      await act(async () => {
        pending[i].resolve({ results: pending[i].pairs.map(() => ({ covered: false })) });
      });
    }
    expect(pending).toHaveLength(chunks);
    expect(peak).toBe(2);
    const answered = onAnswered.mock.calls.reduce(
      (n, [out]) => n + Object.keys(out as Record<string, boolean>).length,
      0,
    );
    expect(answered).toBe(CAREER_COVERAGE_MAX_PAIRS * chunks);
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("a failed chunk is reported, and the ones behind it still go out", async () => {
    const onAnswered = vi.fn();
    const onFailed = vi.fn();
    render(
      <CareerCoverageFetcher
        selectorOptionId={SET}
        asks={asksOf(CAREER_COVERAGE_MAX_PAIRS * 3)}
        onAnswered={onAnswered}
        onFailed={onFailed}
      />,
    );
    await flush();
    await act(async () => {
      pending[0].reject(new Error("boom"));
    });
    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(onFailed.mock.calls[0][0]).toHaveLength(CAREER_COVERAGE_MAX_PAIRS);
    expect(pending).toHaveLength(3);
    await act(async () => {
      pending[1].resolve({ results: pending[1].pairs.map(() => ({ covered: true })) });
      pending[2].resolve({ results: pending[2].pairs.map(() => ({ covered: true })) });
    });
    expect(onAnswered).toHaveBeenCalledTimes(2);
  });

  it("sends a small ask as one read", async () => {
    render(
      <CareerCoverageFetcher
        selectorOptionId={SET}
        asks={asksOf(3)}
        onAnswered={vi.fn()}
        onFailed={vi.fn()}
      />,
    );
    await flush();
    expect(pending).toHaveLength(1);
    expect(pending[0].pairs).toHaveLength(3);
  });

  it("reports what is still out after 15 s as failed, and ignores a late answer", async () => {
    vi.useFakeTimers();
    try {
      const onAnswered = vi.fn();
      const onFailed = vi.fn();
      render(
        <CareerCoverageFetcher
          selectorOptionId={SET}
          asks={asksOf(CAREER_COVERAGE_MAX_PAIRS * 2)}
          onAnswered={onAnswered}
          onFailed={onFailed}
        />,
      );
      await act(async () => {});
      expect(CAREER_COVERAGE_TIMEOUT_MS).toBe(15_000);
      expect(pending).toHaveLength(2);
      // One chunk answers in time; the other never does.
      await act(async () => {
        pending[0].resolve({ results: pending[0].pairs.map(() => ({ covered: true })) });
      });
      expect(onAnswered).toHaveBeenCalledTimes(1);
      await act(async () => {
        vi.advanceTimersByTime(14_999);
      });
      expect(onFailed).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(2);
      });
      expect(onFailed).toHaveBeenCalledTimes(1);
      const keys = onFailed.mock.calls[0][0] as string[];
      expect(keys).toHaveLength(CAREER_COVERAGE_MAX_PAIRS);
      // The late answer changes nothing.
      await act(async () => {
        pending[1].resolve({ results: pending[1].pairs.map(() => ({ covered: true })) });
      });
      expect(onAnswered).toHaveBeenCalledTimes(1);
      expect(onFailed).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fire when everything answered in time", async () => {
    vi.useFakeTimers();
    try {
      const onFailed = vi.fn();
      render(
        <CareerCoverageFetcher selectorOptionId={SET} asks={asksOf(3)} onAnswered={vi.fn()} onFailed={onFailed} />,
      );
      await act(async () => {});
      await act(async () => {
        pending[0].resolve({ results: pending[0].pairs.map(() => ({ covered: false })) });
      });
      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });
      expect(onFailed).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("is an INACTIVITY timeout: a long run that keeps settling chunks is never failed", async () => {
    vi.useFakeTimers();
    try {
      const onAnswered = vi.fn();
      const onFailed = vi.fn();
      render(
        <CareerCoverageFetcher
          selectorOptionId={SET}
          asks={asksOf(CAREER_COVERAGE_MAX_PAIRS * 4)}
          onAnswered={onAnswered}
          onFailed={onFailed}
        />,
      );
      await act(async () => {});
      const settle = async (i: number) =>
        act(async () => {
          pending[i].resolve({ results: pending[i].pairs.map(() => ({ covered: true })) });
        });
      // Each chunk takes 10 s: 40 s in all, far past the 15 s limit.
      for (let i = 0; i < 4; i += 1) {
        await act(async () => {
          vi.advanceTimersByTime(10_000);
        });
        await settle(i);
      }
      expect(pending).toHaveLength(4);
      expect(onAnswered).toHaveBeenCalledTimes(4);
      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });
      expect(onFailed).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("restarts the clock on each settle: 15 s of silence AFTER progress still fails the rest", async () => {
    vi.useFakeTimers();
    try {
      const onFailed = vi.fn();
      render(
        <CareerCoverageFetcher
          selectorOptionId={SET}
          asks={asksOf(CAREER_COVERAGE_MAX_PAIRS * 3)}
          onAnswered={vi.fn()}
          onFailed={onFailed}
        />,
      );
      await act(async () => {});
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      await act(async () => {
        pending[0].resolve({ results: pending[0].pairs.map(() => ({ covered: true })) });
      });
      // 14 s after that settle: still waiting. (The first 10 s would have counted had it not restarted.)
      await act(async () => {
        vi.advanceTimersByTime(14_000);
      });
      expect(onFailed).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(1_001);
      });
      expect(onFailed).toHaveBeenCalledTimes(1);
      // Chunk 1 (still out) and chunk 2 (running, behind it): 2 x 32 keys... chunk 2 had started when chunk 0 settled.
      expect((onFailed.mock.calls[0][0] as string[]).length).toBe(CAREER_COVERAGE_MAX_PAIRS * 2);
    } finally {
      vi.useRealTimers();
    }
  });
});
