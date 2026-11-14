/**
 * PR 451 (NEO-487), NEO-552 — when `fetchBscCardTeamNames` stops asking BSC.
 *
 * BSC's edge answers 429 and then blocks the IP, and Convex deployments share
 * egress IPs, so asking on only extends the block. The lookup therefore:
 *   - asks the deployment-wide call gate (`bscCallGate`) before EVERY wave
 *     (10 cards) and makes no call while it refuses; a half-open gate grants
 *     one probe and the rest of the wave is carried, never dropped;
 *   - stops at the first 429, never retries it; `bscFetch` reports it to the
 *     gate, which opens the breaker once;
 *   - stops after a wave in which EVERY card failed (BSC is down), and a run
 *     of five failures opens the breaker on its own;
 *   - hands every card it never asked back as `success: false, skipped: true`.
 * The healthy path changes nothing but the gate's token bucket.
 *
 * Driven through the real action with `fetch` stubbed; the gate table is the
 * real one (convex-test). Lives at the convex/ root for the glob (see
 * bscCallTelemetry.adapters.test.ts).
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { resetBscInflightForTests } from "./lib/bscCallTelemetry";
import { skipBscGateWaits } from "../lib/testing/bsc-gate-stub";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

/** One wave is this many cards (BSC_TEAM_LOOKUP_CONCURRENCY, private to the adapter). */
const WAVE = 10;
const ids = (n: number) => Array.from({ length: n }, (_, i) => `bsc-${i + 1}`);

type Reply = { team: string } | { status: number; headers?: Record<string, string> };
type Calls = string[];

function fetchStub(replyFor: (bscCardId: string, nth: number) => Reply, calls: Calls, onCall?: (id: string) => Promise<void>) {
  const seen = new Map<string, number>();
  return vi.fn(async (url: string | URL | Request) => {
    const id = String(url).match(/\/marketplace\/card\/([^/]+)\/card-listing/)?.[1] ?? "";
    calls.push(id);
    const nth = (seen.get(id) ?? 0) + 1;
    seen.set(id, nth);
    await onCall?.(id);
    const reply = replyFor(id, nth);
    if ("status" in reply) return new Response("", { status: reply.status, headers: reply.headers });
    return new Response(JSON.stringify({ teamName: reply.team }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

const run = (t: ReturnType<typeof convexTest>, bscCardIds: string[]) =>
  t.action(internal.adapters.buysportscards.fetchBscCardTeamNames, { bscCardIds });
const gateRows = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => ctx.db.query("marketplaceCallGates").collect());
/** The breaker-side fields of the one gate row (the bucket fields move on every grant). */
const breaker = async (t: ReturnType<typeof convexTest>) => {
  const rows = await gateRows(t);
  expect(rows).toHaveLength(1);
  const { openUntil, openCause, streak, consecutiveFailures } = rows[0];
  return { openUntil, openCause, streak, consecutiveFailures };
};
/**
 * Sets the gate's window to end at `until` (streak 1, a full bucket),
 * patching the row a running lookup already made rather than adding a
 * second one.
 */
const openWindow = (t: ReturnType<typeof convexTest>, until: number, streak = 1) =>
  t.run(async (ctx) => {
    const fields = {
      tokens: 10,
      refilledAt: Date.now(),
      openUntil: until,
      openCause: "429" as const,
      streak,
      lastOpenedAt: Date.now(),
      consecutiveFailures: 0,
      lastFailureAt: 0,
      updatedAt: Date.now(),
    };
    const row = await ctx.db.query("marketplaceCallGates").first();
    if (row) await ctx.db.patch(row._id, { ...fields, probeLeaseUntil: undefined });
    else await ctx.db.insert("marketplaceCallGates", { platform: "bsc", scope: "deployment", ...fields });
  });

const SKIPPED = (bscCardId: string) => ({
  bscCardId, rawTeamName: "", teamNames: [], success: false, attributeTokens: [], skipped: true,
});

let undoGateWaits: () => void;
beforeEach(() => {
  resetBscInflightForTests();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  // More cards than the bucket's burst: its waits move the clock instead.
  undoGateWaits = skipBscGateWaits();
});
afterEach(() => {
  undoGateWaits();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchBscCardTeamNames — a 429 stops the lookup at once", () => {
  test("the 429 card is asked once (never retried), is failed not skipped, and later waves are never asked", async () => {
    const t = convexTest(schema, modules);
    const calls: Calls = [];
    vi.stubGlobal(
      "fetch",
      fetchStub((id) => (id === "bsc-1" ? { status: 429 } : { team: `Team ${id}` }), calls),
    );

    const out = await run(t, ids(WAVE + 2));

    expect(calls.filter((c) => c === "bsc-1")).toHaveLength(1);
    // Wave 1 went out together; wave 2 was never asked.
    expect(calls.sort()).toEqual(ids(WAVE).sort());
    expect(out[0]).toMatchObject({ bscCardId: "bsc-1", success: false });
    expect(out[0].skipped).toBeUndefined();
    expect(out[1]).toMatchObject({ bscCardId: "bsc-2", success: true, rawTeamName: "Team bsc-2" });
    expect(out.slice(WAVE)).toEqual([SKIPPED("bsc-11"), SKIPPED("bsc-12")]);
  });

  test("it opens the breaker once, and the window follows BSC's Retry-After when that is longer", async () => {
    const t = convexTest(schema, modules);
    const calls: Calls = [];
    // Every card in the wave gets 429: still ONE window, opened once.
    vi.stubGlobal("fetch", fetchStub(() => ({ status: 429, headers: { "Retry-After": "180" } }), calls));
    const before = Date.now();

    await run(t, ids(WAVE));

    const b = await breaker(t);
    expect(b).toMatchObject({ openCause: "429", streak: 1 });
    expect(b.openUntil).toBeGreaterThanOrEqual(before + 180_000);
    expect(b.openUntil).toBeLessThan(Date.now() + 180_000 + 1);
  });

  test("a card in its retry pause does not retry once another card has been 429'd", async () => {
    const t = convexTest(schema, modules);
    const calls: Calls = [];
    vi.stubGlobal(
      "fetch",
      fetchStub((id) => (id === "bsc-1" ? { status: 503 } : id === "bsc-2" ? { status: 429 } : { team: "Reds" }), calls),
    );

    const out = await run(t, ["bsc-1", "bsc-2", "bsc-3"]);

    // bsc-1 failed its first attempt, paused 250-500 ms, saw the stop flag and did not ask again.
    expect(calls.filter((c) => c === "bsc-1")).toHaveLength(1);
    expect(out.map((o) => o.success)).toEqual([false, false, true]);
    expect(await breaker(t)).toMatchObject({ openCause: "429", streak: 1 });
  });
});

describe("fetchBscCardTeamNames — the call gate is asked before every wave", () => {
  test("an open window at the start: no BSC call, the breaker unchanged, every card skipped in request order", async () => {
    const t = convexTest(schema, modules);
    const calls: Calls = [];
    vi.stubGlobal("fetch", fetchStub(() => ({ team: "Reds" }), calls));
    await openWindow(t, Date.now() + 60_000);
    const before = await gateRows(t);

    const out = await run(t, ids(WAVE + 3));

    expect(calls).toEqual([]);
    expect(out).toEqual(ids(WAVE + 3).map(SKIPPED));
    // A refusal writes nothing at all.
    expect(await gateRows(t)).toEqual(before);
  });

  test("a window that lapsed long ago (no live streak) is open road", async () => {
    const t = convexTest(schema, modules);
    const calls: Calls = [];
    vi.stubGlobal("fetch", fetchStub(() => ({ team: "Reds" }), calls));
    await openWindow(t, Date.now() - 20 * 60_000, 0);

    const out = await run(t, ids(WAVE));

    expect(calls.sort()).toEqual(ids(WAVE).sort());
    expect(out.every((o) => o.success)).toBe(true);
  });

  test("a window another caller opens while wave 1 is out stops wave 2 before any call", async () => {
    const t = convexTest(schema, modules);
    const calls: Calls = [];
    let opened = false;
    vi.stubGlobal(
      "fetch",
      fetchStub(() => ({ team: "Reds" }), calls, async () => {
        if (opened) return;
        opened = true;
        await openWindow(t, Date.now() + 60_000);
      }),
    );

    const out = await run(t, ids(WAVE + 2));

    expect(calls.sort()).toEqual(ids(WAVE).sort());
    expect(out.slice(0, WAVE).every((o) => o.success)).toBe(true);
    expect(out.slice(WAVE)).toEqual([SKIPPED("bsc-11"), SKIPPED("bsc-12")]);
    expect(await gateRows(t)).toHaveLength(1);
  });

  test("half-open: the first wave after a window sends ONE probe, carries the rest, and its answer closes the breaker", async () => {
    const t = convexTest(schema, modules);
    const calls: Calls = [];
    vi.stubGlobal("fetch", fetchStub(() => ({ team: "Reds" }), calls));
    await openWindow(t, Date.now() - 1);

    const out = await run(t, ids(WAVE + 5));

    // The probe went alone; the carried cards were asked after it, none dropped.
    expect(calls[0]).toBe("bsc-1");
    expect(calls).toHaveLength(WAVE + 5);
    expect(out.every((o) => o.success && o.skipped === undefined)).toBe(true);
    expect(await breaker(t)).toMatchObject({ streak: 0 });
  });

  test("half-open: a 429 on the probe escalates the streak, and the carried cards are skipped", async () => {
    const t = convexTest(schema, modules);
    const calls: Calls = [];
    vi.stubGlobal(
      "fetch",
      fetchStub((id) => (id === "bsc-1" ? { status: 429 } : { team: "Reds" }), calls),
    );
    await openWindow(t, Date.now() - 1);
    const before = Date.now();

    const out = await run(t, ids(WAVE));

    expect(calls).toEqual(["bsc-1"]);
    expect(out.slice(1)).toEqual(ids(WAVE).slice(1).map(SKIPPED));
    const b = await breaker(t);
    expect(b.streak).toBe(2);
    expect(b.openUntil).toBeGreaterThanOrEqual(before + 30_000);
  });

  test("the healthy path leaves the breaker closed: no window, no streak, no failures", async () => {
    const t = convexTest(schema, modules);
    vi.stubGlobal("fetch", fetchStub(() => ({ team: "Reds" }), []));
    await run(t, ids(WAVE + 5));
    expect(await breaker(t)).toEqual({ openUntil: 0, openCause: undefined, streak: 0, consecutiveFailures: 0 });
  });
});

describe("fetchBscCardTeamNames — failures", () => {
  test("BSC down: wave 1's 503s open the breaker on the failure ladder, no retry is sent, and wave 2 is skipped", async () => {
    const t = convexTest(schema, modules);
    const calls: Calls = [];
    vi.stubGlobal("fetch", fetchStub(() => ({ status: 503 }), calls));

    const out = await run(t, ids(WAVE + 2));

    // Ten first attempts went out together; the fifth failure opened the
    // breaker, so every retry was refused unsent.
    expect(calls.sort()).toEqual(ids(WAVE).sort());
    expect(out.slice(0, WAVE).every((o) => o.success === false && o.skipped === undefined)).toBe(true);
    expect(out.slice(WAVE)).toEqual([SKIPPED("bsc-11"), SKIPPED("bsc-12")]);
    expect(await breaker(t)).toMatchObject({ openCause: "failures", streak: 1 });
    // Telemetry: the refused retries were never sent, so they are counted by
    // reason, never as a 429 or a failure.
    const summaries = vi
      .mocked(console.log)
      .mock.calls.map((c) => String(c[0]))
      .filter((line) => line.includes('"bsc_call_summary"'))
      .map((line) => JSON.parse(line) as { calls: number; byStatus: Record<string, number>; refused?: Record<string, number> });
    expect(summaries).toHaveLength(1);
    expect(summaries[0].calls).toBe(WAVE);
    expect(summaries[0].byStatus).toEqual({ "503": WAVE });
    expect(summaries[0].refused?.open).toBeGreaterThan(0);
  });

  test("a few failing cards among answers keep the lookup going: the answers end the failure run", async () => {
    const t = convexTest(schema, modules);
    const calls: Calls = [];
    const failing = new Set(["bsc-1", "bsc-2", "bsc-3"]);
    vi.stubGlobal(
      "fetch",
      fetchStub((id) => (failing.has(id) ? { status: 503 } : { team: "Reds" }), calls),
    );

    const out = await run(t, ids(WAVE + 2));

    expect(calls.some((c) => c === "bsc-11")).toBe(true);
    expect(out.some((o) => o.skipped)).toBe(false);
    expect(out.filter((o) => !o.success).map((o) => o.bscCardId)).toEqual(["bsc-1", "bsc-2", "bsc-3"]);
    expect((await breaker(t)).openUntil).toBe(0);
  });

  test("a permanent 4xx (not 429) is neither retried nor a failure to the breaker", async () => {
    const t = convexTest(schema, modules);
    const calls: Calls = [];
    vi.stubGlobal("fetch", fetchStub(() => ({ status: 404 }), calls));

    const out = await run(t, ids(WAVE + 1));

    expect(calls).toHaveLength(WAVE); // one attempt each, wave 2 skipped
    expect(out[WAVE]).toEqual(SKIPPED("bsc-11"));
    expect(await breaker(t)).toMatchObject({ openUntil: 0, consecutiveFailures: 0 });
  });
});
