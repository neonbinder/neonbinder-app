/**
 * NEO-552 — the BSC call gate (`bscCallGate.ts`): the token
 * bucket and the breaker in one `marketplaceCallGates` row per key (NEO-628:
 * `"deployment"` against real BSC, `ns:<namespace>` against the fake), driven through
 * the real internal functions (convex-test) on a fake clock. The pure ladder
 * maths is pinned in lib/bscCallGateLadder.test.ts; this file pins what the
 * stored gate does with it.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { bscCallDomainFor, bscCallGateFor, bscGateClock } from "./bscCallGate";
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

const bound = (t: T, key = "deployment") =>
  bscCallGateFor(
    {
      // convex-test's typed signatures are narrower than ActionCtx's.
      runMutation: ((ref: unknown, args: unknown) =>
        (t.mutation as (r: unknown, a: unknown) => Promise<unknown>)(ref, args)) as never,
      runQuery: ((ref: unknown, args: unknown) =>
        (t.query as (r: unknown, a: unknown) => Promise<unknown>)(ref, args)) as never,
    },
    key,
  );

/** Opens a 429 window (streak 1, 15 s) on `key`. */
async function open429Key(t: T, key: string): Promise<void> {
  const g = await t.mutation(internal.bscCallGate.acquire, { key, count: 1 });
  if (!g.ok) throw new Error("expected a grant");
  await t.mutation(internal.bscCallGate.recordOutcome, { key, grantedAt: g.grantedAt, outcome: "rateLimited" });
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

  const armFake = () => {
    vi.stubEnv("NEONBINDER_BSC_API_BASE", "https://neonbinder-fake-bsc-0000-uc.a.run.app");
    vi.stubEnv("NEONBINDER_FAKE_BSC_KEY", "k");
    vi.stubEnv("TESTING_RESET_SECRET", "armed");
  };

  test("a fake deployment has no bucket: 50 waves at once, none waits, none is throttled, nothing is written", async () => {
    armFake();
    const t = convexTest(schema, modules);
    const grants = await Promise.all(Array.from({ length: 50 }, () => acquire(t, 10, 0)));
    for (const g of grants) expect(g).toMatchObject({ ok: true, granted: 10, waitMs: 0, probe: false });
    // A healthy grant against the fake writes nothing (eight shards share this row).
    expect(await rows(t)).toHaveLength(0);
  });

  test("a fake deployment still has the breaker: a 429 opens it, and half-open grants one probe with no wait", async () => {
    armFake();
    const t = convexTest(schema, modules);
    const until = await open429(t);
    expect(await acquire(t, 10)).toMatchObject({ ok: false, reason: "open" });
    vi.setSystemTime(until);
    expect(await acquire(t, 10)).toMatchObject({ ok: true, granted: 1, waitMs: 0, probe: true });
    expect(await acquire(t, 10)).toMatchObject({ ok: false, reason: "probing" });
  });

  test("a fake deployment's breaker opens on a run of 5xx too", async () => {
    armFake();
    const t = convexTest(schema, modules);
    for (let i = 0; i < 5; i += 1) await record(t, NOW, "failure");
    expect(await acquire(t, 1)).toMatchObject({ ok: false, reason: "open" });
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
  const opts = (t: T) => ({
    idToken: async () => "unused",
    pathTemplate: "marketplace/card/:id/card-listing",
    gate: bound(t),
    env: {},
  });

  test("a half-open probe that has to wait for a token is not refused by its own lease", async () => {
    const t = convexTest(schema, modules);
    const until = await open429(t);
    vi.setSystemTime(until);
    // An empty bucket: the probe's one token is six seconds away.
    await t.run(async (ctx) => {
      const r = (await ctx.db.query("marketplaceCallGates").first())!;
      await ctx.db.patch(r._id, { tokens: -5, refilledAt: until });
    });
    const sleep = vi.spyOn(bscGateClock, "sleep").mockImplementation(async (ms: number) => {
      advance(ms);
    });

    const got = await bound(t).acquire(10);

    expect(sleep).toHaveBeenCalledWith(6_000);
    expect(got).toMatchObject({ ok: true, granted: 1, grant: { probe: true } });
    // Everyone else is still held off by that lease.
    expect(await acquire(t, 1)).toMatchObject({ ok: false, reason: "probing" });
  });

  test("a probe still blocked after its wait by a window opened meanwhile is refused", async () => {
    const t = convexTest(schema, modules);
    const until = await open429(t);
    vi.setSystemTime(until);
    await t.run(async (ctx) => {
      const r = (await ctx.db.query("marketplaceCallGates").first())!;
      await ctx.db.patch(r._id, { tokens: -5, refilledAt: until });
    });
    vi.spyOn(bscGateClock, "sleep").mockImplementation(async (ms: number) => {
      advance(ms);
      // Another caller's 429 (a call granted before the window) re-opens it.
      await t.run(async (ctx) => {
        const r = (await ctx.db.query("marketplaceCallGates").first())!;
        await ctx.db.patch(r._id, { openUntil: Date.now() + 30_000 });
      });
    });

    expect(await bound(t).acquire(1)).toMatchObject({ ok: false, reason: "open" });
  });

  test("a probe answered 501 unrecorded hands its lease back: the next caller probes at once", async () => {
    const t = convexTest(schema, modules);
    const until = await open429(t);
    vi.setSystemTime(until);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 501, headers: { "x-nb-fake": "unrecorded" } })),
    );

    await bscFetch("marketplace/card/1/card-listing", {}, opts(t));

    const r = await row(t);
    expect(r.probeLeaseUntil).toBeUndefined();
    expect(r.probeGrantedAt).toBeUndefined();
    expect(r).toMatchObject({ streak: 1, consecutiveFailures: 0 });
    expect(await acquire(t, 1)).toMatchObject({ ok: true, probe: true });
  });

  test("only the grant holding the lease can release it", async () => {
    const t = convexTest(schema, modules);
    const until = await open429(t);
    vi.setSystemTime(until);
    const probe = await acquire(t, 1);
    if (!probe.ok) throw new Error("grant");
    const before = await row(t);

    await t.mutation(internal.bscCallGate.releaseProbe, { grantedAt: probe.grantedAt - 1 });
    expect(await row(t)).toEqual(before);

    await t.mutation(internal.bscCallGate.releaseProbe, { grantedAt: probe.grantedAt });
    expect((await row(t)).probeLeaseUntil).toBeUndefined();
    // The bucket is not refunded.
    expect((await row(t)).tokens).toBe(before.tokens);
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
    const gate = bscCallGateFor(
      {
        runMutation: (async () => {
          throw new Error("down");
        }) as never,
        runQuery: (async () => {
          throw new Error("down");
        }) as never,
      },
      "deployment",
    );
    const res = await bscFetch("a", {}, { idToken: async () => "x", pathTemplate: "a", gate, env: {} });
    expect(res.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await gate.blockedUntil()).toBeGreaterThan(Date.now());
  });
});

describe("clearForTesting", () => {
  const KEY = "ns:happy-otter-123-aaaabbbbcccc";
  const OTHER = "ns:happy-otter-123-ddddeeeeffff";
  const armFake = () => {
    vi.stubEnv("NEONBINDER_BSC_API_BASE", "https://neonbinder-fake-bsc-0000-uc.a.run.app");
    vi.stubEnv("NEONBINDER_FAKE_BSC_KEY", "k");
    vi.stubEnv("TESTING_RESET_SECRET", "armed");
  };

  test("refuses on a deployment without TESTING_RESET_SECRET", async () => {
    armFake();
    const t = convexTest(schema, modules);
    await t.mutation(internal.bscCallGate.acquire, { key: KEY, count: 1 });
    await t.mutation(internal.bscCallGate.recordOutcome, { key: KEY, grantedAt: NOW, outcome: "failure" });
    vi.stubEnv("TESTING_RESET_SECRET", "");
    await expect(t.mutation(internal.bscCallGate.clearForTesting, { key: KEY })).rejects.toThrow(/test deployment/);
    expect(await rows(t)).toHaveLength(1);
  });

  test("deletes exactly the one row it is given, and nothing else", async () => {
    armFake();
    const t = convexTest(schema, modules);
    await open429(t); // the deployment's own row too
    await open429Key(t, KEY);
    await open429Key(t, OTHER);
    expect((await rows(t)).map((r) => r.scope).sort()).toEqual(["deployment", KEY, OTHER].sort());

    expect(await t.mutation(internal.bscCallGate.clearForTesting, { key: KEY })).toEqual({ deleted: 1 });

    expect((await rows(t)).map((r) => r.scope).sort()).toEqual(["deployment", OTHER].sort());
    // Clearing a key with no row is a no-op that deletes nothing.
    expect(await t.mutation(internal.bscCallGate.clearForTesting, { key: KEY })).toEqual({ deleted: 0 });
    expect(await rows(t)).toHaveLength(2);
  });

  test("refuses the deployment's key, and a key that is not a gate key", async () => {
    armFake();
    const t = convexTest(schema, modules);
    await open429(t);
    await expect(t.mutation(internal.bscCallGate.clearForTesting, { key: "deployment" })).rejects.toThrow(
      /not cleared one key at a time/,
    );
    await expect(t.mutation(internal.bscCallGate.clearForTesting, { key: "ns:UPPER" })).rejects.toThrow(
      /Unreadable BSC gate key/,
    );
    expect(await rows(t)).toHaveLength(1);
  });
});

describe("gate log lines carry a fixed field set (no ids, no payloads)", () => {
  /** The parsed JSON lines the console spy saw for one message name. */
  const logged = (spy: "warn" | "log", msg: string) =>
    vi
      .mocked(console[spy])
      .mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
      .filter((line) => line.msg === msg);

  test("bsc_gate_opened is exactly {msg, platform, operation, keyKind, cause, streak, ms}", async () => {
    const t = convexTest(schema, modules);
    const g = await acquire(t, 1);
    if (!g.ok) throw new Error("grant");
    await record(t, g.grantedAt, "rateLimited", 60_000);

    const lines = logged("warn", "bsc_gate_opened");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({
      msg: "bsc_gate_opened",
      platform: "bsc",
      operation: "recordOutcome",
      keyKind: "deployment",
      cause: "429",
      streak: 1,
      ms: 60_000,
    });
  });

  test("bsc_gate_closed is exactly {msg, platform, operation}", async () => {
    const t = convexTest(schema, modules);
    const until = await open429(t);
    vi.setSystemTime(until);
    const probe = await acquire(t, 1);
    if (!probe.ok) throw new Error("grant");
    await record(t, probe.grantedAt, "success");

    const lines = logged("log", "bsc_gate_closed");
    expect(lines).toEqual([{ msg: "bsc_gate_closed", platform: "bsc", operation: "recordOutcome" }]);
  });

  test("bsc_gate_unavailable carries the error name only, never its message", async () => {
    const gate = bscCallGateFor(
      {
        runMutation: (async () => {
          throw new RangeError("secret detail: row 123 for user abc");
        }) as never,
        runQuery: (async () => {
          throw new Error("down");
        }) as never,
      },
      "deployment",
    );
    await gate.acquire(1);
    await gate.blockedUntil();

    const lines = logged("warn", "bsc_gate_unavailable");
    expect(lines).toEqual([
      { msg: "bsc_gate_unavailable", platform: "bsc", operation: "acquire", error: "RangeError" },
      { msg: "bsc_gate_unavailable", platform: "bsc", operation: "state", error: "Error" },
    ]);
    expect(JSON.stringify(lines)).not.toContain("secret detail");
  });
});

// ── NEO-628: the key is the rate-limit domain ───────────────────────────────

describe("gate keys (NEO-628)", () => {
  const A = "ns:happy-otter-123-aaaabbbbcccc";
  const B = "ns:happy-otter-123-ddddeeeeffff";
  const armFake = () => {
    vi.stubEnv("NEONBINDER_BSC_API_BASE", "https://neonbinder-fake-bsc-0000-uc.a.run.app");
    vi.stubEnv("NEONBINDER_FAKE_BSC_KEY", "k");
    vi.stubEnv("TESTING_RESET_SECRET", "armed");
    vi.stubEnv("CONVEX_CLOUD_URL", "https://happy-otter-123.convex.cloud");
  };
  const acquireKey = (t: T, key: string, count = 1) =>
    t.mutation(internal.bscCallGate.acquire, { key, count });
  const stateOf = (t: T, key: string) => t.query(internal.bscCallGate.state, { key });
  const rowsOf = async (t: T, key: string) =>
    (await rows(t)).filter((r) => r.scope === key);

  test("a 429 on key A leaves key B granting, and A's own gate refuses", async () => {
    armFake();
    const t = convexTest(schema, modules);
    await open429Key(t, A);

    expect(await acquireKey(t, A)).toMatchObject({ ok: false, reason: "open" });
    expect(await acquireKey(t, B)).toMatchObject({ ok: true, granted: 1 });
    expect((await stateOf(t, A)).blockedUntil).not.toBeNull();
    expect(await stateOf(t, B)).toEqual({ blockedUntil: null });
    // And the deployment's own key is untouched.
    expect(await acquire(t, 1)).toMatchObject({ ok: true });
  });

  test("five failures on A do not count toward B", async () => {
    armFake();
    const t = convexTest(schema, modules);
    // Four on A, then four on B: eight in all, but never five on one key.
    for (let i = 0; i < 4; i += 1) {
      const g = await acquireKey(t, A);
      if (!g.ok) throw new Error("grant");
      await t.mutation(internal.bscCallGate.recordOutcome, { key: A, grantedAt: g.grantedAt, outcome: "failure" });
    }
    for (let i = 0; i < 4; i += 1) {
      const g = await acquireKey(t, B);
      if (!g.ok) throw new Error("grant");
      await t.mutation(internal.bscCallGate.recordOutcome, { key: B, grantedAt: g.grantedAt, outcome: "failure" });
    }
    expect(await stateOf(t, A)).toEqual({ blockedUntil: null });
    expect(await stateOf(t, B)).toEqual({ blockedUntil: null });
    expect((await rowsOf(t, A))[0].consecutiveFailures).toBe(4);
    expect((await rowsOf(t, B))[0].consecutiveFailures).toBe(4);

    // The fifth on A opens A and only A.
    const g = await acquireKey(t, A);
    if (!g.ok) throw new Error("grant");
    await t.mutation(internal.bscCallGate.recordOutcome, { key: A, grantedAt: g.grantedAt, outcome: "failure" });
    expect((await stateOf(t, A)).blockedUntil).not.toBeNull();
    expect(await stateOf(t, B)).toEqual({ blockedUntil: null });
  });

  test("each key keeps its own bucket, its own 429 ladder (Retry-After) and its own probe", async () => {
    armFake();
    const t = convexTest(schema, modules);
    const g = await acquireKey(t, A);
    if (!g.ok) throw new Error("grant");
    await t.mutation(internal.bscCallGate.recordOutcome, {
      key: A,
      grantedAt: g.grantedAt,
      outcome: "rateLimited",
      retryAfterMs: 90_000,
    });
    const a = (await rowsOf(t, A))[0];
    expect(a.openUntil).toBe(NOW + 90_000);
    advance(90_000);
    expect(await acquireKey(t, A, 10)).toMatchObject({ ok: true, granted: 1, probe: true });
    expect(await acquireKey(t, A)).toMatchObject({ ok: false, reason: "probing" });
    // B has never opened: no probe, no streak.
    expect(await acquireKey(t, B, 10)).toMatchObject({ ok: true, probe: false });
  });

  test("in real mode user A's 429 refuses user B: both are the one deployment key", async () => {
    const t = convexTest(schema, modules);
    const a = bscCallDomainFor("user_aaaabbbbcccc", {});
    const b = bscCallDomainFor("user_ddddeeeeffff", {});
    expect(a).toEqual({ gateKey: "deployment" });
    expect(b).toEqual({ gateKey: "deployment" });

    const gateA = bound(t, a.gateKey);
    const gateB = bound(t, b.gateKey);
    const g = await gateA.acquire(1);
    if (!g.ok) throw new Error("grant");
    await gateA.record(g.grant, "rateLimited");

    expect(await gateB.acquire(1)).toMatchObject({ ok: false, reason: "open" });
    expect((await rows(t)).map((r) => r.scope)).toEqual(["deployment"]);
  });

  test("on the fake, a user's gate is theirs: A's 429 through bscFetch leaves B's call sent", async () => {
    armFake();
    const t = convexTest(schema, modules);
    const env = {
      NEONBINDER_BSC_API_BASE: "https://neonbinder-fake-bsc-0000-uc.a.run.app",
      NEONBINDER_FAKE_BSC_KEY: "k",
      TESTING_RESET_SECRET: "armed",
      CONVEX_CLOUD_URL: "https://happy-otter-123.convex.cloud",
    };
    const da = bscCallDomainFor("user_a", env);
    const db = bscCallDomainFor("user_b", env);
    expect(da.gateKey).toMatch(/^ns:happy-otter-123-[0-9a-f]{12}$/);
    expect(da.gateKey).toBe(`ns:${da.fakeNs}`);
    expect(db.gateKey).not.toBe(da.gateKey);
    const sent: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const ns = new Headers(init.headers).get("x-nb-fake-ns") ?? "";
        sent.push(ns);
        return ns === da.fakeNs
          ? new Response("", { status: 429, headers: { "retry-after": "60" } })
          : new Response("{}", { status: 200 });
      }),
    );
    const call = (d: { gateKey: string; fakeNs?: string }) =>
      bscFetch(
        "marketplace/card/1/card-listing",
        {},
        {
          idToken: async () => "tok",
          pathTemplate: "marketplace/card/:id/card-listing",
          gate: bound(t, d.gateKey),
          ...(d.fakeNs ? { fakeNs: d.fakeNs } : {}),
          env,
        },
      );

    expect((await call(da)).status).toBe(429);
    const refused = await call(da);
    expect(refused.headers.get("x-nb-bsc-breaker")).toBe("open");
    expect((await call(db)).status).toBe(200);
    // The sent calls carry the namespace the gate was keyed on.
    expect(sent).toEqual([da.fakeNs, db.fakeNs]);
  });

  test("a per-namespace key is refused outside the fake, and a malformed key everywhere (fail closed)", async () => {
    const t = convexTest(schema, modules);
    // Real mode: an ns: key is never honoured.
    await expect(acquireKey(t, A)).rejects.toThrow(/needs the fake BSC/);
    await expect(t.query(internal.bscCallGate.state, { key: A })).rejects.toThrow(/needs the fake BSC/);
    armFake();
    for (const bad of ["", "other", "ns:", "ns:UPPER", "ns:a b", `ns:${"a".repeat(101)}`, "NS:abc", "deployment ", "ns:-abc"]) {
      await expect(acquireKey(t, bad)).rejects.toThrow(/Unreadable BSC gate key/);
    }
    expect(await rows(t)).toHaveLength(0);
  });

  test("a gate bound to an unusable key fails closed through bscFetch (503, nothing sent)", async () => {
    const t = convexTest(schema, modules);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await bscFetch(
      "a",
      {},
      { idToken: async () => "x", pathTemplate: "a", gate: bound(t, "ns:real-mode-refuses-this"), env: {} },
    );
    expect(res.status).toBe(503);
    expect(res.headers.get("x-nb-bsc-breaker")).toBe("gate_unavailable");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await rows(t)).toHaveLength(0);
  });

  test("an acquire from before the key existed (no key) is the deployment's gate", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.bscCallGate.acquire, { count: 1 });
    await t.mutation(internal.bscCallGate.recordOutcome, { grantedAt: NOW, outcome: "failure" });
    expect((await rows(t)).map((r) => r.scope)).toEqual(["deployment"]);
  });

  test("bsc_gate_opened logs the key kind and never the namespace", async () => {
    armFake();
    const t = convexTest(schema, modules);
    await open429Key(t, A);
    const warned = vi.mocked(console.warn).mock.calls.map((c) => String(c[0]));
    const opened = warned.filter((l) => l.includes("bsc_gate_opened"));
    expect(opened).toHaveLength(1);
    expect(JSON.parse(opened[0])).toMatchObject({ keyKind: "ns" });
    expect(opened[0]).not.toContain("happy-otter");
    expect(opened[0]).not.toContain("aaaabbbbcccc");
  });

  test("the global reset drains every row, whatever its scope", async () => {
    armFake();
    const t = convexTest(schema, modules);
    await open429(t);
    await open429Key(t, A);
    await open429Key(t, B);
    expect(await rows(t)).toHaveLength(3);
    vi.stubEnv("ALLOW_RESET_SET_BUILDER_DATA", "true");
    const done = await t.mutation(internal.selectorOptions.resetMarketplaceCallGatesBatch, {});
    expect(done).toEqual({ deleted: 3, hasMore: false });
    expect(await rows(t)).toHaveLength(0);
  });
});
