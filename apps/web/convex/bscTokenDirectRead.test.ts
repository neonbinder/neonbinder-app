/**
 * NEO-605 — the BSC adapter reads its token with a plain call
 * (`readBscToken` -> `credentials.siteTokenForCurrentUser`) inside the action
 * that needs it, not with `ctx.runAction(getBscToken)` ->
 * `runAction(credentials.getSiteToken)`.
 *
 * In CI `fetchBscChecklist` sat idle for 27 s on a `getBscToken` child that
 * had finished in 0.4 s; every action hop is a wait of that kind. Pinned here:
 *
 *   - each of the four call sites (selector options, checklist, the checklist's
 *     post-401 re-auth read, the probe batch) reaches the token with NEITHER
 *     `getBscToken` NOR `getSiteToken` run as a Convex function (their
 *     `_handler`s are spied; the control below proves the spy counts a real
 *     invocation);
 *   - `getBscToken` stays a wrapper over the same helper, with the same
 *     success / no-credentials / error answers and the same
 *     `adapter_sync_call` line, and no token in any log line;
 *   - a caller with no identity gets the answer `runAction(getSiteToken)`
 *     gave it: "Not authenticated", as a `success: false` result.
 *
 * `./credentials` is stubbed at the module boundary like the other adapter
 * tests; the stub's `siteTokenForCurrentUser` runs the REAL function for a
 * caller with no identity (so the identity rule is the product's), and the
 * token stub otherwise.
 *
 * Lives at the convex/ root: convex-test's `import.meta.glob` registry breaks
 * when invoked from inside adapters/.
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import * as bsc from "./adapters/buysportscards";
import * as credentials from "./credentials";
import { resetBscInflightForTests } from "./lib/bscCallTelemetry";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const TOKEN = "secret-token-neo605-0123456789";

const st = vi.hoisted(() => ({
  mode: "token" as "token" | "none" | "throw",
  /** `siteTokenForCurrentUser` calls: the direct, in-action read. */
  direct: [] as string[],
}));

vi.mock("./credentials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./credentials")>();
  const { internalAction } = await import("./_generated/server");
  const { getCurrentUserId } = await import("./auth");
  const { v } = await import("convex/values");
  const read = async () => {
    if (st.mode === "throw") throw new Error("sign-in failed");
    return st.mode === "token" ? { token: TOKEN } : null;
  };
  return {
    ...actual,
    getSiteToken: internalAction({
      args: { site: v.string() },
      returns: v.any(),
      handler: read,
    }),
    siteTokenForCurrentUser: async (ctx: Parameters<typeof actual.siteTokenForCurrentUser>[0], site: string) => {
      st.direct.push(site);
      // No identity: the product's own "Not authenticated".
      if (!(await getCurrentUserId(ctx))) return await actual.siteTokenForCurrentUser(ctx, site);
      return await read();
    },
    authenticateBsc: internalAction({
      args: { userId: v.optional(v.string()), tokenRefused: v.optional(v.boolean()) },
      returns: v.any(),
      handler: async () => ({ success: true }),
    }),
  };
});

// Warm the mocked module once, before any test runs. The adapters import
// "./credentials" and convex-test's function loader imports it too, and when
// those two first imports overlap (a BSC and a SportLots side fetched together)
// vitest builds the async factory twice, and one importer can fall through to
// the REAL module, so the adapter reads a real token and the sync ends in
// "error". Vitest's own mocker says this does not work for concurrent imports.
// Awaiting it here caches the mocked module before anything can race.
await import("./credentials");

vi.mock("./bscCallGate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./bscCallGate")>();
  const { openBscCallGate } = await import("../lib/testing/bsc-open-gate");
  return { ...actual, bscCallGateFor: () => openBscCallGate() };
});

const ADMIN = {
  subject: "admin_neo605",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_neo605",
  name: "Admin",
  role: "admin",
};

type Handler = { _handler: (...a: unknown[]) => unknown };
let bscTokenAction: ReturnType<typeof vi.spyOn>;
let siteTokenAction: ReturnType<typeof vi.spyOn>;
let logs: string[];

/** Stub fetch with one response per call, in order. */
function stubSteps(steps: Array<{ json: unknown } | { status: number; body: string }>): void {
  vi.stubGlobal("fetch", (async (url: string | URL | Request) => {
    const step = steps.shift();
    if (step === undefined) throw new Error(`unexpected fetch ${String(url)}`);
    if ("json" in step) return Response.json(step.json);
    return new Response(step.body, { status: step.status });
  }) as typeof fetch);
}

beforeEach(() => {
  resetBscInflightForTests();
  st.mode = "token";
  st.direct.length = 0;
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
  vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
  vi.spyOn(console, "info").mockImplementation(() => {});
  bscTokenAction = vi.spyOn(bsc.getBscToken as unknown as Handler, "_handler");
  siteTokenAction = vi.spyOn(credentials.getSiteToken as unknown as Handler, "_handler");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The `adapter_sync_call` lines the token read wrote. */
function tokenCalls(): Array<Record<string, unknown>> {
  return logs
    .filter((l) => l.startsWith("{") && l.includes('"adapter_sync_call"') && l.includes('"getBscToken"'))
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** No path of a token read may put the token on a log line. */
function expectNoTokenInLogs(): void {
  expect(logs.filter((l) => l.includes(TOKEN))).toEqual([]);
}

/** Neither the wrapper action nor the credentials action ran. */
function expectNoActionHops(): void {
  expect(bscTokenAction).not.toHaveBeenCalled();
  expect(siteTokenAction).not.toHaveBeenCalled();
}

const SCOPE = { sport: ["baseball"], year: ["1996"], setName: ["score"], variant: ["insert"] };
const card = (n: number) => ({ id: `bsc-${n}`, cardNo: String(n), players: `Player ${n}`, setName: "score" });

describe("the four token read sites make no action hop", () => {
  test("fetchBscSelectorOptions", async () => {
    const t = convexTest(schema, modules);
    stubSteps([{ json: { aggregations: { sport: [{ label: "Baseball", slug: "baseball", count: 3 }] } } }]);
    const r = await t.withIdentity(ADMIN).action(api.adapters.buysportscards.fetchBscSelectorOptions, {
      level: "sport",
      parentFilters: {},
      requestId: "req-sel",
    });
    expect(r.success).toBe(true);
    expectNoActionHops();
    expect(st.direct).toEqual(["buysportscards"]);
    // The caller's correlation id still rides the token read's line.
    expect(tokenCalls()).toMatchObject([{ requestId: "req-sel", platform: "bsc", success: true }]);
    expectNoTokenInLogs();
  });

  test("fetchBscChecklist", async () => {
    const t = convexTest(schema, modules);
    stubSteps([{ json: [card(1)] }]);
    const r = await t.withIdentity(ADMIN).action(api.adapters.buysportscards.fetchBscChecklist, {
      parentFilters: {},
      facetFilters: { ...SCOPE, variantName: ["s-1"] },
      sourceFacet: "variantName",
    });
    expect(r.success).toBe(true);
    expectNoActionHops();
    expect(st.direct).toEqual(["buysportscards"]);
    expectNoTokenInLogs();
  });

  test("fetchBscChecklist after a 401: the re-auth's token read is direct too", async () => {
    const t = convexTest(schema, modules);
    stubSteps([{ status: 401, body: "expired" }, { json: [card(1)] }]);
    const r = await t.withIdentity(ADMIN).action(api.adapters.buysportscards.fetchBscChecklist, {
      parentFilters: {},
      facetFilters: { ...SCOPE, variantName: ["s-1"] },
      sourceFacet: "variantName",
    });
    expect(r.success).toBe(true);
    expectNoActionHops();
    // The first read and the one after the re-auth.
    expect(st.direct).toEqual(["buysportscards", "buysportscards"]);
    expectNoTokenInLogs();
  });

  test("probeBscChecklistBatch", async () => {
    const t = convexTest(schema, modules);
    stubSteps([{ json: [card(1)] }, { json: [card(2)] }]);
    const r = await t.withIdentity(ADMIN).action(internal.adapters.buysportscards.probeBscChecklistBatch, {
      requests: [
        { id: "a", facetFilters: { ...SCOPE, variantName: ["s-1"] } },
        { id: "b", facetFilters: { ...SCOPE, variantName: ["s-2"] } },
      ],
    });
    expect(r.map((x) => x.status)).toEqual(["ok", "ok"]);
    expectNoActionHops();
    // One read for the whole batch.
    expect(st.direct).toEqual(["buysportscards"]);
    expectNoTokenInLogs();
  });
});

describe("getBscToken stays a wrapper over the same helper", () => {
  const call = (t: ReturnType<typeof convexTest>, requestId?: string, identity: typeof ADMIN | null = ADMIN) =>
    (identity ? t.withIdentity(identity) : t).action(internal.adapters.buysportscards.getBscToken, { requestId });

  test("control: the wrapper runs as a Convex function (the spy counts a real invocation) and reads directly", async () => {
    const t = convexTest(schema, modules);
    const r = await call(t, "req-ctl");
    expect(r).toEqual({ success: true, token: TOKEN });
    expect(bscTokenAction).toHaveBeenCalledTimes(1);
    // The wrapper no longer fans out to getSiteToken either.
    expect(siteTokenAction).not.toHaveBeenCalled();
    expect(st.direct).toEqual(["buysportscards"]);
    expect(tokenCalls()).toMatchObject([{ requestId: "req-ctl", platform: "bsc", success: true }]);
    expect(Number(tokenCalls()[0].duration_ms)).toBeGreaterThanOrEqual(0);
    expectNoTokenInLogs();
  });

  test("control: getSiteToken run as a Convex function is counted by its spy", async () => {
    const t = convexTest(schema, modules);
    const r = await t.withIdentity(ADMIN).action(internal.credentials.getSiteToken, { site: "buysportscards" });
    expect(r).toEqual({ token: TOKEN });
    expect(siteTokenAction).toHaveBeenCalledTimes(1);
    // The credentials action is not the direct read: that stays untouched.
    expect(st.direct).toEqual([]);
  });

  test("success without a requestId mints one", async () => {
    const t = convexTest(schema, modules);
    await call(t);
    const [line] = tokenCalls();
    expect(typeof line.requestId).toBe("string");
    expect((line.requestId as string).length).toBeGreaterThan(0);
  });

  test("no credentials: success false, the connect message, error_class no_credentials", async () => {
    st.mode = "none";
    const t = convexTest(schema, modules);
    const r = await call(t, "req-none");
    expect(r).toEqual({
      success: false,
      error: "No BSC token available. Connect your BSC account first.",
    });
    expect(tokenCalls()).toMatchObject([
      { requestId: "req-none", success: false, error_class: "no_credentials" },
    ]);
  });

  test("a read that throws: success false with the message, classified, never thrown", async () => {
    st.mode = "throw";
    const t = convexTest(schema, modules);
    const r = await call(t, "req-throw");
    expect(r).toEqual({ success: false, error: "Failed to get BSC token: sign-in failed" });
    expect(tokenCalls()).toMatchObject([{ requestId: "req-throw", success: false }]);
    expect(tokenCalls()[0].error_class).toBeTruthy();
    expect(logs.some((l) => l.includes("[getBscToken] Error:"))).toBe(true);
  });

  test("no identity (scheduled work): the same 'Not authenticated' answer runAction(getSiteToken) gave", async () => {
    const t = convexTest(schema, modules);
    const r = await call(t, "req-anon", null);
    expect(r).toEqual({ success: false, error: "Failed to get BSC token: Not authenticated" });
    expect(tokenCalls()).toMatchObject([{ requestId: "req-anon", success: false }]);
    expectNoTokenInLogs();
  });
});
