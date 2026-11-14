/**
 * NEO-552 — the deployment-wide BSC call gate (`bscCallGate.ts`): the token
 * bucket and the breaker in one `marketplaceCallGates` row, driven through
 * the real internal functions (convex-test) on a fake clock. The pure ladder
 * maths is pinned in lib/bscCallGateLadder.test.ts; this file pins what the
 * stored gate does with it.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { bscCallGateFor } from "./bscCallGate";
import {
  FAILURE_BASE_MS,
  FAILURE_RUN_IDLE_RESET_MS,
  MAX_WAIT_MS,
  PROBE_LEASE_MS,
} from "./lib/bscCallGatePolicy";
import { bscFetch } from "./lib/bscHttp";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const NOW = 1_800_000_000_000;
type T = ReturnType<typeof convexTest>;

const acquire = (t: T, count: number, maxWaitMs?: number) =>
  t.mutation(internal.bscCallGate.acquire, { count, ...(maxWaitMs !== undefined ? { maxWaitMs } : {}) });
const record = (
  t: T,
  grantedAt: number,
  outcome: "success" | "rateLimited" | "failure",
  retryAfterMs?: number,
) =>
  t.mutation(internal.bscCallGate.recordOutcome, {
    grantedAt,
    outcome,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
  });
const rows = (t: T) => t.run(async (ctx) => ctx.db.query("marketplaceCallGates").collect());
const row = async (t: T) => {
  const all = await rows(t);
  expect(all).toHaveLength(1);
  return all[0];
};
const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

/** Opens a 429 window (streak 1, 15 s) and returns its end. */
async function open429(t: T): Promise<number> {
  const g = await acquire(t, 1);
  if (!g.ok) throw new Error("expected a grant");
  await record(t, g.grantedAt, "rateLimited");
  return (await row(t)).openUntil;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the bucket (real BSC: 60 a minute, burst 10)", () => {
  test("a full burst goes at once; the next wave waits its debt at one token a second", async () => {
    const t = convexTest(schema, modules);

    expect(await acquire(t, 10)).toMatchObject({ ok: true, granted: 10, waitMs: 0, probe: false });
    expect(await acquire(t, 5)).toMatchObject({ ok: true, granted: 5, waitMs: 5_000 });
    expect((await row(t)).tokens).toBe(-5);

    advance(3_000);
    // -5 + 3 refilled - 1 = -3: three seconds.
    expect(await acquire(t, 1)).toMatchObject({ ok: true, waitMs: 3_000 });
  });

  test("refill stops at the burst", async () => {
    const t = convexTest(schema, modules);
    await acquire(t, 1);
    advance(10 * 60_000);
    expect(await acquire(t, 10)).toMatchObject({ ok: true, granted: 10, waitMs: 0 });
    expect(await acquire(t, 1)).toMatchObject({ ok: true, waitMs: 1_000 });
  });

  test("a wait past the caller's limit (or MAX_WAIT_MS) is throttled, and writes nothing", async () => {
    const t = convexTest(schema, modules);
    await acquire(t, 10);
    await acquire(t, 10); // -10: a 10 s wait
    const before = await row(t);

    const shortLimit = await acquire(t, 1, 5_000);
    expect(shortLimit).toMatchObject({ ok: false, reason: "throttled", retryAt: NOW + 11_000 });
    await acquire(t, 5); // -15: exactly MAX_WAIT_MS
    const afterFive = await row(t);
    expect(afterFive.tokens).toBe(-15);
    const over = await acquire(t, 1, 10 * MAX_WAIT_MS);
    expect(over).toMatchObject({ ok: false, reason: "throttled" });

    expect(await row(t)).toEqual(afterFive);
    expect(before.tokens).toBe(-10);
  });

  test("count is clamped to 1..10", async () => {
    const t = convexTest(schema, modules);
    expect(await acquire(t, 50)).toMatchObject({ ok: true, granted: 10 });
    advance(60_000);
    expect(await acquire(t, 0)).toMatchObject({ ok: true, granted: 1 });
    expect(await acquire(t, -3)).toMatchObject({ ok: true, granted: 1 });
  });

  test("a fake deployment gets the faster bucket", async () => {
    vi.stubEnv("NEONBINDER_BSC_API_BASE", "https://neonbinder-fake-bsc-0000-uc.a.run.app");
    vi.stubEnv("NEONBINDER_FAKE_BSC_KEY", "k");
    vi.stubEnv("TESTING_RESET_SECRET", "armed");
    const t = convexTest(schema, modules);
    await acquire(t, 10);
    await acquire(t, 10);
    // Burst 20, then ten a second.
    expect(await acquire(t, 10)).toMatchObject({ ok: true, waitMs: 1_000 });
  });

  test("two racing first acquires leave one row", async () => {
    const t = convexTest(schema, modules);
    const both = await Promise.all([acquire(t, 3), acquire(t, 4)]);
    expect(both.every((g) => g.ok)).toBe(true);
    expect(await rows(t)).toHaveLength(1);
    expect((await row(t)).tokens).toBe(3);
  });
});

describe("the breaker", () => {
  test("a 429 opens it; a Retry-After above the base window sets the window", async () => {
    const t = convexTest(schema, modules);
    const g = await acquire(t, 1);
    if (!g.ok) throw new Error("grant");
    await record(t, g.grantedAt, "rateLimited", 60_000);

    expect(await row(t)).toMatchObject({ openUntil: NOW + 60_000, openCause: "429", streak: 1 });
    const before = await row(t);
    expect(await acquire(t, 1)).toEqual({ ok: false, reason: "open", retryAt: NOW + 60_000 });
    // A refusal writes nothing.
    expect(await row(t)).toEqual(before);
    expect(await t.query(internal.bscCallGate.state, {})).toEqual({ blockedUntil: NOW + 60_000 });
  });

  test("five failures in a run open it on the failure ladder", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 4; i += 1) await record(t, NOW, "failure");
    expect(await row(t)).toMatchObject({ openUntil: 0, consecutiveFailures: 4 });
    await record(t, NOW, "failure");
    expect(await row(t)).toMatchObject({
      openUntil: NOW + FAILURE_BASE_MS,
      openCause: "failures",
      streak: 1,
      consecutiveFailures: 0,
    });
  });

  test("four failures and then a success do not open it, and the success ends the run", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 4; i += 1) await record(t, NOW, "failure");
    const g = await acquire(t, 1);
    if (!g.ok) throw new Error("grant");
    // The run is live, so the grant asks for the success.
    expect(g.reportOutcome).toBe(true);
    await record(t, g.grantedAt, "success");
    await record(t, NOW, "failure");
    expect(await row(t)).toMatchObject({ openUntil: 0, consecutiveFailures: 1 });
  });

  test("a run idle for five minutes starts again", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 4; i += 1) await record(t, NOW, "failure");
    advance(FAILURE_RUN_IDLE_RESET_MS + 1);
    await record(t, Date.now(), "failure");
    expect(await row(t)).toMatchObject({ openUntil: 0, consecutiveFailures: 1 });
  });

  test("half-open: one probe is granted however many are asked; the rest are refused as probing", async () => {
    const t = convexTest(schema, modules);
    const until = await open429(t);
    vi.setSystemTime(until);

    const probe = await acquire(t, 10);
    expect(probe).toMatchObject({ ok: true, granted: 1, probe: true, reportOutcome: true });
    const second = await acquire(t, 10);
    expect(second).toMatchObject({ ok: false, reason: "probing" });
    expect(await t.query(internal.bscCallGate.state, {})).toEqual({
      blockedUntil: (await row(t)).probeLeaseUntil,
    });
  });

  test("the probe's success closes the breaker and the bucket serves waves again", async () => {
    const t = convexTest(schema, modules);
    const until = await open429(t);
    vi.setSystemTime(until);
    const probe = await acquire(t, 10);
    if (!probe.ok) throw new Error("grant");

    await record(t, probe.grantedAt, "success");

    const r = await row(t);
    expect(r.streak).toBe(0);
    expect(r.probeLeaseUntil).toBeUndefined();
    advance(10_000);
    expect(await acquire(t, 10)).toMatchObject({ ok: true, granted: 10, probe: false });
  });

  test("the probe's failure re-opens it, escalated", async () => {
    const t = convexTest(schema, modules);
    const until = await open429(t);
    vi.setSystemTime(until);
    const probe = await acquire(t, 1);
    if (!probe.ok) throw new Error("grant");

    await record(t, probe.grantedAt, "failure");

    const r = await row(t);
    expect(r).toMatchObject({ openCause: "failures", streak: 2 });
    expect(r.openUntil).toBe(until + 2 * FAILURE_BASE_MS);
    expect(r.probeLeaseUntil).toBeUndefined();
  });

  test("a probe that never reports frees the lease when it expires", async () => {
    const t = convexTest(schema, modules);
    const until = await open429(t);
    vi.setSystemTime(until);
    expect(await acquire(t, 1)).toMatchObject({ ok: true, probe: true });

    advance(PROBE_LEASE_MS - 1);
    expect(await acquire(t, 1)).toMatchObject({ ok: false, reason: "probing" });
    advance(1);
    expect(await acquire(t, 1)).toMatchObject({ ok: true, probe: true });
  });

  test("a success under a grant made before the window opened is ignored", async () => {
    const t = convexTest(schema, modules);
    const early = await acquire(t, 1);
    if (!early.ok) throw new Error("grant");
    advance(1_000);
    const until = await open429(t);
    vi.setSystemTime(until + 1);

    await record(t, early.grantedAt, "success");

    expect(await row(t)).toMatchObject({ streak: 1 });
  });

  test("a failure while the window is open (a call already in flight) does not escalate it", async () => {
    const t = convexTest(schema, modules);
    const until = await open429(t);
    const before = await row(t);
    await record(t, NOW, "failure");
    expect(await row(t)).toEqual(before);
    expect(until).toBe(before.openUntil);
  });
});

describe("bscCallGateFor + bscFetch", () => {
  const bound = (t: T) =>
    bscCallGateFor({
      // convex-test's typed signatures are narrower than ActionCtx's.
      runMutation: ((ref: unknown, args: unknown) =>
        (t.mutation as (r: unknown, a: unknown) => Promise<unknown>)(ref, args)) as never,
      runQuery: ((ref: unknown, args: unknown) =>
        (t.query as (r: unknown, a: unknown) => Promise<unknown>)(ref, args)) as never,
    });
  const opts = (t: T) => ({
    idToken: async () => "unused",
    pathTemplate: "marketplace/card/:id/card-listing",
    gate: bound(t),
    env: {},
  });

  test("the fake's 501 unrecorded is not counted as a failure", async () => {
    const t = convexTest(schema, modules);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 501, headers: { "x-nb-fake": "unrecorded" } })),
    );
    for (let i = 0; i < 6; i += 1) await bscFetch("marketplace/card/1/card-listing", {}, opts(t));
    expect(await row(t)).toMatchObject({ openUntil: 0, consecutiveFailures: 0 });
  });

  test("five 503s through bscFetch open the breaker, and the sixth call is refused unsent", async () => {
    const t = convexTest(schema, modules);
    const fetchSpy = vi.fn(async () => new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetchSpy);
    for (let i = 0; i < 5; i += 1) await bscFetch("marketplace/card/1/card-listing", {}, opts(t));
    const refused = await bscFetch("marketplace/card/1/card-listing", {}, opts(t));
    expect(fetchSpy).toHaveBeenCalledTimes(5);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("x-nb-bsc-breaker")).toBe("open");
  });

  test("a binding whose gate cannot be asked fails closed", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const gate = bscCallGateFor({
      runMutation: (async () => {
        throw new Error("down");
      }) as never,
      runQuery: (async () => {
        throw new Error("down");
      }) as never,
    });
    const res = await bscFetch("a", {}, { idToken: async () => "x", pathTemplate: "a", gate, env: {} });
    expect(res.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await gate.blockedUntil()).toBeGreaterThan(Date.now());
  });
});

describe("clearForTesting", () => {
  test("refuses on a deployment without TESTING_RESET_SECRET", async () => {
    vi.stubEnv("TESTING_RESET_SECRET", "");
    const t = convexTest(schema, modules);
    await acquire(t, 1);
    await expect(t.mutation(internal.bscCallGate.clearForTesting, {})).rejects.toThrow(/test deployment/);
    expect(await rows(t)).toHaveLength(1);
  });

  test("clears the gate on a test deployment", async () => {
    vi.stubEnv("TESTING_RESET_SECRET", "armed");
    const t = convexTest(schema, modules);
    await open429(t);
    expect(await t.mutation(internal.bscCallGate.clearForTesting, {})).toEqual({ deleted: 1 });
    expect(await rows(t)).toHaveLength(0);
  });
});
