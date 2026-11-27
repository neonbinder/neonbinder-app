/**
 * NEO-552 — the fake's control calls (`__fake/...`, including `__fake/health`) survive a cold
 * or still-loading fake: a 30 s timeout per attempt and ONE retry, only on a
 * network error or a 503 (including the fake's `x-nb-fake: loading`). Never
 * on a timeout, never more than once. `/api` calls go through `bscFetch` and
 * the gate instead, and are never retried here. The ID token is stubbed and
 * `fetch` is stubbed: nothing leaves the process.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { CONTROL_TIMEOUT_MS, fakeBscControlClock } from "./fakeBsc";

vi.mock("./lib/bscFakeIdToken", () => ({
  nodeBscIdToken: async () => "stub-id-token",
  idTokenExpiresAt: (_token: string, fallback: number) => fallback,
}));

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const NS = "happy-otter-123-0123456789ab";
let pauses: number[];

beforeEach(() => {
  vi.stubEnv("NEONBINDER_BSC_API_BASE", "https://neonbinder-fake-bsc-0000-uc.a.run.app");
  vi.stubEnv("NEONBINDER_FAKE_BSC_KEY", "caller-key");
  vi.stubEnv("TESTING_RESET_SECRET", "armed");
  vi.stubEnv("CONVEX_CLOUD_URL", "https://happy-otter-123.convex.cloud");
  vi.spyOn(console, "log").mockImplementation(() => {});
  pauses = [];
  vi.spyOn(fakeBscControlClock, "sleep").mockImplementation(async (ms: number) => {
    pauses.push(ms);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function answers(...replies: Array<Response | Error>) {
  const spy = vi.fn(async (_url: string, _init?: RequestInit) => {
    const next = replies.shift();
    if (!next) throw new Error("unexpected extra call");
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}
const reset = () =>
  convexTest(schema, modules).action(internal.fakeBsc.resetNamespace, { ns: NS });
const loading = () =>
  new Response("", { status: 503, headers: { "x-nb-fake": "loading", "Retry-After": "2" } });

describe("fake control calls retry once", () => {
  test("the per-attempt timeout is 30 s", () => {
    expect(CONTROL_TIMEOUT_MS).toBe(30_000);
  });

  test("a 503 loading answer is retried after its Retry-After", async () => {
    const spy = answers(loading(), new Response("{}", { status: 200 }));
    expect(await reset()).toEqual({ ok: true, skipped: false });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(pauses).toEqual([2_000]);
  });

  test("a network error is retried once", async () => {
    const spy = answers(new TypeError("fetch failed"), new Response("{}", { status: 200 }));
    expect(await reset()).toEqual({ ok: true, skipped: false });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test("two 503s: one retry only, then the failure is reported", async () => {
    const spy = answers(loading(), loading());
    expect(await reset()).toEqual({ ok: false, status: 503, error: "http" });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test("a timeout is not retried", async () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    const spy = answers(timeout);
    expect(await reset()).toEqual({ ok: false, error: "TimeoutError" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("the miss read does not retry a timeout either (only the capture check waits out a cold start)", async () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    const spy = answers(timeout);
    expect(await convexTest(schema, modules).action(internal.fakeBsc.misses, { ns: NS })).toEqual({
      ok: false,
      error: "TimeoutError",
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("an abort is not retried by the other controls", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    const spy = answers(abort);
    expect(await reset()).toEqual({ ok: false, error: "AbortError" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("any other refusal (403) is not retried", async () => {
    const spy = answers(new Response("", { status: 403 }));
    expect(await reset()).toEqual({ ok: false, status: 403, error: "http" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(pauses).toEqual([]);
  });

  test("the miss read and the capture health read retry the same way", async () => {
    answers(loading(), Response.json({ misses: [{ method: "GET", path: "api/x" }] }));
    expect(await convexTest(schema, modules).action(internal.fakeBsc.misses, { ns: NS })).toEqual({
      ok: true,
      skipped: false,
      misses: [{ method: "GET", path: "api/x" }],
    });
    answers(new TypeError("fetch failed"), Response.json({ writeCaptures: { missing: [] } }));
    expect(await convexTest(schema, modules).action(internal.fakeBsc.writeCaptureStatus, {})).toEqual({
      ok: true,
      skipped: false,
      missing: [],
    });
  });

  test("the retry sends the same body", async () => {
    const spy = answers(loading(), new Response("{}", { status: 200 }));
    await reset();
    expect(spy.mock.calls[1][1]?.body).toBe(spy.mock.calls[0][1]?.body);
    expect(String(spy.mock.calls[1][1]?.body)).toContain(NS);
  });
});
