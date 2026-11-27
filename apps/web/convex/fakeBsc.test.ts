/**
 * NEO-552 — this deployment's controls on the fake BSC (`fakeBsc.ts`): a
 * deployment reaches only namespaces under its own prefix, the fake's miss
 * list is narrowed before it is trusted, and outside fake mode every control
 * is a no-op that sends nothing.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import {
  CONTROL_TIMEOUT_MS,
  HEALTH_COLD_START_BUDGET_MS,
  HEALTH_LOADING_PAUSES_MS,
  fakeBscControlClock,
  healthIsLoading,
  isOwnNamespace,
  isOwnPrefix,
  narrowMisses,
  narrowMissingCaptures,
} from "./fakeBsc";

// Every write the fake's /__fake/health can list as missing (BSC's two, then the eBay
// writes). The fake's test (services/fake-bsc/tests/ebay-server.test.mjs) reads this
// array from source and fails when it differs from the fake's own list, and runs each
// name through the pattern in narrowMissingCaptures. Keep it plain double-quoted strings.
const REQUIRED_CAPTURE_NAMES = [
  "PUT seller/bulk-upload",
  "POST common/card/undefined/product/undefined/attachment",
  "POST ebay/api/sell/inventory/v1/bulk_create_or_replace_inventory_item",
  "POST ebay/api/sell/inventory/v1/bulk_create_offer",
  "DELETE ebay/api/sell/inventory/v1/inventory_item/:sku",
  "POST ebay/api/sell/inventory/v1/location/:merchantLocationKey",
  "POST ebay/api/sell/inventory/v1/location/:merchantLocationKey/update_location_details",
  "POST ebay/api/sell/inventory/v1/location/:merchantLocationKey/enable",
  "PUT ebay/api/sell/inventory/v1/offer/:offerId",
  "POST ebay/api/sell/inventory/v1/offer/:offerId/publish #refused",
  "POST ebay/apim/commerce/media/v1_beta/image/create_image_from_file",
  "GET ebay/apim/commerce/media/v1_beta/image/:imageId",
  "POST ebay/api/sell/inventory/v1/offer/:offerId/publish",
  "POST ebay/api/sell/inventory/v1/bulk_update_price_quantity",
  "POST ebay/api/sell/inventory/v1/offer/:offerId/withdraw",
];


vi.mock("./lib/bscFakeIdToken", () => ({
  nodeBscIdToken: async () => "stub-id-token",
  idTokenExpiresAt: (_token: string, fallback: number) => fallback,
}));

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const PREFIX = "happy-otter-123-";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("own namespaces only", () => {
  test("a namespace under the prefix, and longer than it", () => {
    expect(isOwnNamespace(`${PREFIX}0123456789ab`, PREFIX)).toBe(true);
    expect(isOwnNamespace(PREFIX, PREFIX)).toBe(false);
    expect(isOwnNamespace("happy-otter-1234-0123456789ab", PREFIX)).toBe(false);
    expect(isOwnNamespace("other-slug-0123456789ab", PREFIX)).toBe(false);
    expect(isOwnNamespace(`${PREFIX}ABC`, PREFIX)).toBe(false);
    expect(isOwnNamespace(`${PREFIX}0123456789ab`, null)).toBe(false);
  });

  test("a prefix at or under our own", () => {
    expect(isOwnPrefix(PREFIX, PREFIX)).toBe(true);
    expect(isOwnPrefix(`${PREFIX}01`, PREFIX)).toBe(true);
    expect(isOwnPrefix("happy-", PREFIX)).toBe(false);
    expect(isOwnPrefix("", PREFIX)).toBe(false);
    expect(isOwnPrefix(PREFIX, null)).toBe(false);
  });
});

describe("narrowMisses", () => {
  test("keeps method and path; drops anything unreadable", () => {
    expect(
      narrowMisses({
        misses: [
          { method: "GET", path: "api/x", request: { secret: "dropped" } },
          { method: "get", path: "api/y" },
          { method: "GET", path: 5 },
          null,
          { method: "POST", path: "a".repeat(513) },
          { method: "POST", path: "api/z" },
        ],
      }),
    ).toEqual([
      { method: "GET", path: "api/x" },
      { method: "POST", path: "api/z" },
    ]);
  });

  test("a body that is not a miss list is no misses", () => {
    expect(narrowMisses(null)).toEqual([]);
    expect(narrowMisses({ misses: "x" })).toEqual([]);
  });

  test("at most 500", () => {
    const misses = Array.from({ length: 600 }, (_, i) => ({ method: "GET", path: `api/${i}` }));
    expect(narrowMisses({ misses })).toHaveLength(500);
  });
});

describe("outside fake mode", () => {
  test("every control is skipped, sends nothing and mints no token", async () => {
    vi.stubEnv("CONVEX_CLOUD_URL", "https://happy-otter-123.convex.cloud");
    vi.stubEnv("NEONBINDER_BSC_API_BASE", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const t = convexTest(schema, modules);
    const ns = `${PREFIX}0123456789ab`;

    expect(await t.action(internal.fakeBsc.idToken, {})).toBeNull();
    expect(await t.action(internal.fakeBsc.resetNamespace, { ns })).toEqual({ ok: true, skipped: true });
    expect(await t.action(internal.fakeBsc.resetPrefix, { prefix: PREFIX })).toEqual({ ok: true, skipped: true });
    expect(await t.action(internal.fakeBsc.setFaults, { ns, rules: [] })).toEqual({ ok: true, skipped: true });
    expect(await t.action(internal.fakeBsc.misses, { ns })).toEqual({ ok: true, skipped: true, misses: [] });
    expect(await t.action(internal.fakeBsc.reportMisses, {})).toEqual({ ok: true, skipped: true, misses: [] });
    expect(await t.action(internal.fakeBsc.writeCaptureStatus, {})).toEqual({ ok: true, skipped: true, missing: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("another deployment's namespace is refused before anything else", async () => {
    vi.stubEnv("CONVEX_CLOUD_URL", "https://happy-otter-123.convex.cloud");
    const t = convexTest(schema, modules);
    expect(await t.action(internal.fakeBsc.resetNamespace, { ns: "other-slug-0123456789ab" })).toMatchObject({
      ok: false,
    });
    expect(await t.action(internal.fakeBsc.resetPrefix, { prefix: "other-" })).toMatchObject({ ok: false });
  });
});

describe("narrowMissingCaptures", () => {
  test("keeps endpoint names", () => {
    expect(
      narrowMissingCaptures({
        writeCaptures: { missing: ["PUT seller/bulk-upload", "POST common/card/undefined/product/undefined/attachment"] },
      }),
    ).toEqual(["PUT seller/bulk-upload", "POST common/card/undefined/product/undefined/attachment"]);
  });

  test("any entry that is not an endpoint name makes the list unreadable (null), never shorter", () => {
    expect(
      narrowMissingCaptures({
        writeCaptures: { missing: ["PUT seller/bulk-upload", 5, "not an endpoint", "POST common/card/undefined/product/undefined/attachment"] },
      }),
    ).toBeNull();
    // A future endpoint the regex cannot name would otherwise filter to [] and pass as "none missing".
    expect(narrowMissingCaptures({ writeCaptures: { missing: ["PUT a{b}"] } })).toBeNull();
  });

  test("keeps the eBay capture names, variant suffix included (the fake's full required list is fifteen names)", () => {
    const all = REQUIRED_CAPTURE_NAMES;
    expect(all).toHaveLength(15);
    expect(narrowMissingCaptures({ writeCaptures: { missing: all } })).toEqual(all);
    // Only a lower-case word after ` #` is a variant; anything else stays unreadable.
    expect(narrowMissingCaptures({ writeCaptures: { missing: ["POST ebay/api/x #Re fused"] } })).toBeNull();
    expect(narrowMissingCaptures({ writeCaptures: { missing: ["POST ebay/api/x # "] } })).toBeNull();
  });

  test("a list past the cap is unreadable (null), never cut short", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `PUT seller/e${i}`);
    expect(narrowMissingCaptures({ writeCaptures: { missing: twenty } })).toEqual(twenty);
    expect(narrowMissingCaptures({ writeCaptures: { missing: [...twenty, "PUT seller/e20"] } })).toBeNull();
  });

  test("a health body without the field is unreadable (null), never 'none missing'", () => {
    expect(narrowMissingCaptures({ ok: true })).toBeNull();
    expect(narrowMissingCaptures({ writeCaptures: {} })).toBeNull();
    expect(narrowMissingCaptures({ writeCaptures: { missing: "x" } })).toBeNull();
    expect(narrowMissingCaptures(null)).toBeNull();
  });

  test("a loading answer is never a list, empty or full", () => {
    const both = ["PUT seller/bulk-upload", "POST common/card/undefined/product/undefined/attachment"];
    // Today's fake while loading: every endpoint listed because nothing is read yet.
    expect(narrowMissingCaptures({ loading: true, writeCaptures: { missing: both } })).toBeNull();
    // The fixed fake while loading: no list at all.
    expect(narrowMissingCaptures({ loading: true, writeCaptures: { loading: true } })).toBeNull();
    // Even an empty list is not "none missing" while loading.
    expect(narrowMissingCaptures({ loading: true, writeCaptures: { missing: [] } })).toBeNull();
    expect(narrowMissingCaptures({ writeCaptures: { loading: true, missing: [] } })).toBeNull();
  });
});

describe("healthIsLoading", () => {
  test("only a boolean true says loading", () => {
    expect(healthIsLoading({ loading: true })).toBe(true);
    expect(healthIsLoading({ writeCaptures: { loading: true } })).toBe(true);
    expect(healthIsLoading({ loading: false, writeCaptures: { missing: [] } })).toBe(false);
    expect(healthIsLoading({ loading: "true" })).toBe(false);
    expect(healthIsLoading({ writeCaptures: { missing: [] } })).toBe(false);
    expect(healthIsLoading(null)).toBe(false);
    expect(healthIsLoading("loading")).toBe(false);
  });
});

describe("writeCaptureStatus in fake mode", () => {
  const arm = () => {
    vi.stubEnv("NEONBINDER_BSC_API_BASE", "https://neonbinder-fake-bsc-0000-uc.a.run.app");
    vi.stubEnv("NEONBINDER_FAKE_BSC_KEY", "caller-key");
    vi.stubEnv("TESTING_RESET_SECRET", "armed");
    vi.stubEnv("CONVEX_CLOUD_URL", "https://happy-otter-123.convex.cloud");
  };
  const run = (answer: () => Response | Promise<Response>) => {
    arm();
    const spy = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => answer());
    vi.stubGlobal("fetch", spy);
    return { spy, result: convexTest(schema, modules).action(internal.fakeBsc.writeCaptureStatus, {}) };
  };

  test("asks the fake's /__fake/health with the caller key and reports the missing endpoints", async () => {
    const { spy, result } = run(() =>
      Response.json({ ok: true, writeCaptures: { missing: ["PUT seller/bulk-upload"] } }),
    );
    expect(await result).toEqual({ ok: true, skipped: false, missing: ["PUT seller/bulk-upload"] });
    expect(String(spy.mock.calls[0][0])).toBe("https://neonbinder-fake-bsc-0000-uc.a.run.app/__fake/health");
    expect(new Headers(spy.mock.calls[0][1]?.headers).get("x-nb-fake-bsc-key")).toBe("caller-key");
  });

  test("reports none missing as an empty list", async () => {
    const { result } = run(() => Response.json({ ok: true, writeCaptures: { missing: [] } }));
    expect(await result).toEqual({ ok: true, skipped: false, missing: [] });
  });

  test("an older fake with no field is an error, not 'none missing'", async () => {
    const { result } = run(() => Response.json({ ok: true }));
    expect(await result).toEqual({ ok: false, error: "health answer has no writeCaptures" });
  });

  test("a refused health call is an error with its status", async () => {
    const { result } = run(() => new Response("", { status: 403 }));
    expect(await result).toEqual({ ok: false, status: 403, error: "http" });
  });
});

describe("writeCaptureStatus while the fake is still loading", () => {
  const BOTH = ["PUT seller/bulk-upload", "POST common/card/undefined/product/undefined/attachment"];
  // Today's fake: a cold start lists every endpoint until its captures are read.
  const coldToday = () => Response.json({ ok: true, loading: true, writeCaptures: { missing: BOTH } });
  // The fixed fake: no list while loading.
  const coldFixed = () => Response.json({ ok: true, loading: true, writeCaptures: { loading: true } });
  const warm = (missing: string[]) => Response.json({ ok: true, loading: false, writeCaptures: { missing } });

  let pauses: number[];
  const run = (...replies: Response[]) => {
    vi.stubEnv("NEONBINDER_BSC_API_BASE", "https://neonbinder-fake-bsc-0000-uc.a.run.app");
    vi.stubEnv("NEONBINDER_FAKE_BSC_KEY", "caller-key");
    vi.stubEnv("TESTING_RESET_SECRET", "armed");
    vi.stubEnv("CONVEX_CLOUD_URL", "https://happy-otter-123.convex.cloud");
    pauses = [];
    vi.spyOn(fakeBscControlClock, "sleep").mockImplementation(async (ms: number) => {
      pauses.push(ms);
    });
    const spy = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      const next = replies.shift();
      if (!next) throw new Error("unexpected extra call");
      return next;
    });
    vi.stubGlobal("fetch", spy);
    return { spy, result: convexTest(schema, modules).action(internal.fakeBsc.writeCaptureStatus, {}) };
  };

  test("the pauses add up to about 45 s", () => {
    expect(HEALTH_LOADING_PAUSES_MS.reduce((a, b) => a + b, 0)).toBe(45_000);
  });

  test("loading, then loaded: waits and reports the real list", async () => {
    const { spy, result } = run(coldToday(), coldFixed(), warm(["PUT seller/bulk-upload"]));
    expect(await result).toEqual({ ok: true, skipped: false, missing: ["PUT seller/bulk-upload"] });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(pauses).toEqual(HEALTH_LOADING_PAUSES_MS.slice(0, 2));
  });

  test("loading, then loaded with none missing: an empty list", async () => {
    const { result } = run(coldToday(), warm([]));
    expect(await result).toEqual({ ok: true, skipped: false, missing: [] });
    expect(pauses).toEqual([HEALTH_LOADING_PAUSES_MS[0]]);
  });

  test("loading throughout: 'fake still loading', never a missing list", async () => {
    const reads = HEALTH_LOADING_PAUSES_MS.length + 1;
    const { spy, result } = run(...Array.from({ length: reads }, (_, i) => (i % 2 === 0 ? coldToday() : coldFixed())));
    expect(await result).toEqual({ ok: false, error: "fake still loading" });
    expect(spy).toHaveBeenCalledTimes(reads);
    expect(pauses).toEqual([...HEALTH_LOADING_PAUSES_MS]);
  });

  test("not loading: one read, no wait", async () => {
    const { spy, result } = run(warm(BOTH));
    expect(await result).toEqual({ ok: true, skipped: false, missing: BOTH });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(pauses).toEqual([]);
  });

  test("a body with no boolean loading keeps today's reading", async () => {
    const { spy, result } = run(Response.json({ ok: true, loading: "yes", writeCaptures: { missing: BOTH } }));
    expect(await result).toEqual({ ok: true, skipped: false, missing: BOTH });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(pauses).toEqual([]);
  });

  test("the wall-clock budget stops the wait even when reads are slow", async () => {
    const t0 = Date.now();
    const now = vi.spyOn(Date, "now");
    let clock = t0;
    now.mockImplementation(() => clock);
    const { spy, result } = run(coldToday(), coldToday(), warm([]));
    // Each read "takes" 40 s: after the first pause the budget is spent.
    spy.mockImplementation(async () => {
      clock += 40_000;
      return coldToday();
    });
    expect(await result).toEqual({ ok: false, error: "fake still loading" });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(pauses).toEqual([HEALTH_LOADING_PAUSES_MS[0]]);
  });
});

// NEO-686: a cold fake has not started listening when the first read goes out, so the read
// times out (30 s) while Cloud Run boots it (about 52 s in all). The check reads again.
describe("writeCaptureStatus waits out a cold start", () => {
  const warm = (missing: string[]) => Response.json({ ok: true, loading: false, writeCaptures: { missing } });
  const loadingNow = () => Response.json({ ok: true, loading: true, writeCaptures: { loading: true } });
  const named = (name: string) => {
    const e = new Error("timed out");
    e.name = name;
    return e;
  };

  let pauses: number[];
  let clock: number;
  /** Each reply is one read; an Error is a read that hangs CONTROL_TIMEOUT_MS and then throws it. */
  const run = (...replies: Array<Response | Error>) => {
    vi.stubEnv("NEONBINDER_BSC_API_BASE", "https://neonbinder-fake-bsc-0000-uc.a.run.app");
    vi.stubEnv("NEONBINDER_FAKE_BSC_KEY", "caller-key");
    vi.stubEnv("TESTING_RESET_SECRET", "armed");
    vi.stubEnv("CONVEX_CLOUD_URL", "https://happy-otter-123.convex.cloud");
    pauses = [];
    clock = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    vi.spyOn(fakeBscControlClock, "sleep").mockImplementation(async (ms: number) => {
      pauses.push(ms);
      clock += ms;
    });
    const spy = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      const next = replies.shift();
      if (!next) throw new Error("unexpected extra call");
      if (next instanceof Error) {
        clock += CONTROL_TIMEOUT_MS;
        throw next;
      }
      return next;
    });
    vi.stubGlobal("fetch", spy);
    return { spy, result: convexTest(schema, modules).action(internal.fakeBsc.writeCaptureStatus, {}) };
  };

  test("the budget covers the measured cold start (about 52 s) with margin, in whole reads", () => {
    expect(HEALTH_COLD_START_BUDGET_MS).toBe(120_000);
    expect(HEALTH_COLD_START_BUDGET_MS).toBeGreaterThanOrEqual(2 * 52_000);
    expect(HEALTH_COLD_START_BUDGET_MS % CONTROL_TIMEOUT_MS).toBe(0);
  });

  test("a timeout, then the fake answers: reads again and reports the real list", async () => {
    const { spy, result } = run(named("TimeoutError"), warm(["PUT seller/bulk-upload"]));
    expect(await result).toEqual({ ok: true, skipped: false, missing: ["PUT seller/bulk-upload"] });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(pauses).toEqual([]);
  });

  test("an AbortError is waited out the same way", async () => {
    const { spy, result } = run(named("AbortError"), named("TimeoutError"), warm([]));
    expect(await result).toEqual({ ok: true, skipped: false, missing: [] });
    expect(spy).toHaveBeenCalledTimes(3);
  });

  test("timeouts past the budget: TimeoutError, after exactly the budget's worth of reads", async () => {
    const { spy, result } = run(...Array.from({ length: 6 }, () => named("TimeoutError")));
    expect(await result).toEqual({ ok: false, error: "TimeoutError" });
    expect(spy).toHaveBeenCalledTimes(HEALTH_COLD_START_BUDGET_MS / CONTROL_TIMEOUT_MS);
    expect(clock - 1_000_000).toBe(HEALTH_COLD_START_BUDGET_MS);
  });

  test("timeouts past the budget, ending in an AbortError: AbortError", async () => {
    const { result } = run(named("TimeoutError"), named("TimeoutError"), named("TimeoutError"), named("AbortError"));
    expect(await result).toEqual({ ok: false, error: "AbortError" });
  });

  test("loading, then a timeout, then loaded: the loading wait starts over after the timeout", async () => {
    const { spy, result } = run(loadingNow(), named("TimeoutError"), loadingNow(), warm(["PUT seller/bulk-upload"]));
    expect(await result).toEqual({ ok: true, skipped: false, missing: ["PUT seller/bulk-upload"] });
    expect(spy).toHaveBeenCalledTimes(4);
    expect(pauses).toEqual([HEALTH_LOADING_PAUSES_MS[0], HEALTH_LOADING_PAUSES_MS[0]]);
  });

  test("timeouts do not spend the loading budget: loading after two timeouts still waits", async () => {
    const { result } = run(named("TimeoutError"), named("TimeoutError"), loadingNow(), warm([]));
    expect(await result).toEqual({ ok: true, skipped: false, missing: [] });
    expect(pauses).toEqual([HEALTH_LOADING_PAUSES_MS[0]]);
  });

  test("a network error is not a timeout: the control retry, then the failure", async () => {
    const { spy, result } = run(new TypeError("fetch failed"), new TypeError("fetch failed"));
    expect(await result).toEqual({ ok: false, error: "TypeError" });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test("a refusal after a timeout is reported with its status", async () => {
    const { result } = run(named("TimeoutError"), new Response("", { status: 403 }));
    expect(await result).toEqual({ ok: false, status: 403, error: "http" });
  });
});
