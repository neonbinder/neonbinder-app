/**
 * NEO-552 — an always-open BSC call gate for unit tests that drive a BSC
 * adapter with a stub action ctx (`{ runAction }`) rather than convex-test.
 *
 * Every BSC call now passes `bscCallGate.acquire` (a `runMutation`) and, on a
 * failure or a 429, `recordOutcome`; a ctx without `runMutation` fails closed
 * (a `gate_unavailable` 503, nothing sent), which is right in production and
 * would turn every such test into a refusal. Spread this into the stub ctx:
 *
 *   const gate = openBscGate();
 *   const ctx = { runAction, ...gate.ctx } as never;
 *
 * `gate.acquires` counts grants and `gate.outcomes` lists what was reported,
 * for a test that wants to pin the gate traffic itself.
 */
import { vi } from "vitest";
import { bscGateClock } from "../../convex/bscCallGate";

export type RecordedGateOutcome = {
  grantedAt: number;
  outcome: "success" | "rateLimited" | "failure";
  retryAfterMs?: number;
};

export function openBscGate() {
  const acquires: number[] = [];
  const outcomes: RecordedGateOutcome[] = [];
  const runMutation = vi.fn(async (_ref: unknown, args: unknown) => {
    const a = (args ?? {}) as Record<string, unknown>;
    if (typeof a.count === "number") {
      acquires.push(a.count);
      return {
        ok: true as const,
        granted: Math.min(Math.max(Math.floor(a.count), 1), 10),
        waitMs: 0,
        grantedAt: Date.now(),
        reportOutcome: false,
        probe: false,
      };
    }
    outcomes.push(a as RecordedGateOutcome);
    return null;
  });
  const runQuery = vi.fn(async () => ({ blockedUntil: null }));
  return { ctx: { runMutation, runQuery }, acquires, outcomes };
}

/**
 * For a convex-test run that makes more BSC calls than the real bucket's
 * burst (10): a grant's wait moves `Date.now` forward instead of sleeping, so
 * the bucket refills as it would have. Returns the undo; call it in the test
 * (or an afterEach) before restoring other mocks.
 */
export function skipBscGateWaits(): () => void {
  let skewMs = 0;
  const realNow = Date.now.bind(Date);
  const spy = vi.spyOn(Date, "now").mockImplementation(() => realNow() + skewMs);
  const original = bscGateClock.sleep;
  bscGateClock.sleep = async (ms: number) => {
    skewMs += ms;
  };
  return () => {
    bscGateClock.sleep = original;
    spy.mockRestore();
  };
}

/** The fields of a `marketplaceCallGates` row with an open 429 window. */
export function bscGateWindowRow(until: number, now: number, streak = 1) {
  return {
    platform: "bsc" as const,
    scope: "deployment" as const,
    tokens: 10,
    refilledAt: now,
    openUntil: until,
    openCause: "429" as const,
    streak,
    lastOpenedAt: now,
    consecutiveFailures: 0,
    lastFailureAt: 0,
    updatedAt: now,
  };
}
