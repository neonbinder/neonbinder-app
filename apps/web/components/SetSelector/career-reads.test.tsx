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

import { CareerCoverageFetcher, CAREER_COVERAGE_PARALLEL } from "./career-reads";

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
});
