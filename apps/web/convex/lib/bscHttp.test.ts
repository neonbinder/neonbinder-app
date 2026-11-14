/**
 * NEO-552 — `bscFetch`, the one way Convex calls BuySportsCards, and where it
 * sends them: the real host, the fake (test deployments only), or nowhere
 * (a test deployment whose fake settings are unusable never falls back to
 * the real host). `fetch` is stubbed in every test; nothing here leaves the
 * process.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  BSC_API_BASE_ENV,
  BSC_BREAKER_HEADER,
  BscConfigError,
  FAKE_BSC_ID_TOKEN_HEADER,
  FAKE_BSC_KEY_ENV,
  FAKE_BSC_KEY_HEADER,
  FAKE_BSC_NS_HEADER,
  __resetBscIdTokenCache,
  actionBscIdTokenSource,
  bscApiBase,
  bscFetch,
  bscGateRefusalResponse,
  bscHeaders,
  fakeBscControlFetch,
  isBscBreakerRefusal,
  normaliseBscPath,
  resolveBscTarget,
  type BscCallGate,
  type BscGrant,
} from "./bscHttp";

const FAKE_ROOT = "https://fake-bsc-0000.a.run.app";
const FAKE_ENV = {
  [BSC_API_BASE_ENV]: FAKE_ROOT,
  [FAKE_BSC_KEY_ENV]: "caller-key",
  TESTING_RESET_SECRET: "armed",
};
const REAL_ENV = {};
const CARD_LISTING = "marketplace/card/:id/card-listing";

type Sent = { url: string; init: RequestInit };

function stubFetch(answer: () => Response = () => new Response("{}", { status: 200 })) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return answer();
    }),
  );
  return sent;
}

/** A gate that grants everything and records what it is told. */
function recordingGate(overrides: Partial<BscCallGate> = {}) {
  const outcomes: Array<{ outcome: string; retryAfterMs?: number }> = [];
  const acquires: number[] = [];
  const grant: BscGrant = { grantedAt: 1, reportOutcome: false, probe: false };
  const gate: BscCallGate = {
    async acquire(count) {
      acquires.push(count);
      return { ok: true, granted: count, grant };
    },
    async record(_grant, outcome, retryAfterMs) {
      outcomes.push({ outcome, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) });
    },
    wantsSuccess: (g) => g.reportOutcome,
    async blockedUntil() {
      return null;
    },
    ...overrides,
  };
  return { gate, outcomes, acquires };
}

const idToken = vi.fn(async (_audience: string) => "id-token");
const headersOf = (s: Sent) => new Headers(s.init.headers);

beforeEach(() => {
  idToken.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __resetBscIdTokenCache();
});

describe("resolveBscTarget", () => {
  test("no override: the real host", () => {
    expect(resolveBscTarget(REAL_ENV)).toMatchObject({ mode: "real", overrideIgnored: false });
    expect(bscApiBase(REAL_ENV)).toMatch(/^https:\/\/api-prod\./);
  });

  test("an override on a deployment that is not a test deployment is ignored, never obeyed", () => {
    const env = { [BSC_API_BASE_ENV]: FAKE_ROOT, [FAKE_BSC_KEY_ENV]: "k" };
    expect(resolveBscTarget(env)).toMatchObject({ mode: "real", overrideIgnored: true });
  });

  test("a usable override on a test deployment: the fake, with the API under /api", () => {
    expect(resolveBscTarget(FAKE_ENV)).toEqual({
      mode: "fake",
      origin: FAKE_ROOT,
      apiBase: `${FAKE_ROOT}/api`,
      callerKey: "caller-key",
    });
  });

  test.each([
    ["not a URL", "nonsense"],
    ["http", "http://fake-bsc-0000.a.run.app"],
    ["credentials", "https://u:p@fake-bsc-0000.a.run.app"],
    ["a port", "https://fake-bsc-0000.a.run.app:8443"],
    ["another host", "https://fake.example.com"],
    ["a look-alike host", "https://run.app.example.com"],
    ["a path", `${FAKE_ROOT}/api`],
    ["a query", `${FAKE_ROOT}/?x=1`],
  ])("a test deployment with %s is misconfigured: nothing is sent, not even to the real host", (_what, url) => {
    const env = { ...FAKE_ENV, [BSC_API_BASE_ENV]: url };
    expect(resolveBscTarget(env).mode).toBe("misconfigured");
    expect(() => bscApiBase(env)).toThrow(BscConfigError);
  });

  test("a test deployment with no caller key is misconfigured", () => {
    const env = { ...FAKE_ENV, [FAKE_BSC_KEY_ENV]: " " };
    expect(resolveBscTarget(env).mode).toBe("misconfigured");
  });
});

describe("normaliseBscPath", () => {
  test("accepts a relative path, with or without a leading slash", () => {
    expect(normaliseBscPath("search/bulk-upload/filters")).toBe("search/bulk-upload/filters");
    expect(normaliseBscPath("/seller/order/1?x=y")).toBe("seller/order/1?x=y");
  });

  test.each([
    ["empty", ""],
    ["a scheme", "https://evil.example/x"],
    ["protocol-relative", "//evil.example/x"],
    ["a backslash", "a\\b"],
    ["a dot segment", "a/./b"],
    ["a dot-dot segment", "a/../b"],
    ["a control character", "a/b\nc"],
  ])("refuses %s", (_what, path) => {
    expect(() => normaliseBscPath(path)).toThrow(TypeError);
  });
});

describe("bscFetch", () => {
  test("real mode: the real host, init unchanged, no fake header, no ID token minted", async () => {
    const sent = stubFetch();
    const { gate, acquires } = recordingGate();
    const init = { headers: { Accept: "application/json" } };

    await bscFetch("marketplace/card/1/card-listing", init, {
      idToken, pathTemplate: CARD_LISTING, gate, env: REAL_ENV, fakeNs: "slug-abc",
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(`${bscApiBase(REAL_ENV)}/marketplace/card/1/card-listing`);
    expect(sent[0].init).toBe(init);
    expect(idToken).not.toHaveBeenCalled();
    expect(acquires).toEqual([1]);
  });

  test("fake mode: the fake's /api, the caller key, the ID token for the fake's origin, no redirects", async () => {
    const sent = stubFetch();
    const { gate } = recordingGate();

    await bscFetch("search/bulk-upload/filters", { headers: bscHeaders("bsc-token") }, {
      idToken, pathTemplate: "search/bulk-upload/filters", gate, env: FAKE_ENV,
    });

    expect(sent[0].url).toBe(`${FAKE_ROOT}/api/search/bulk-upload/filters`);
    const h = headersOf(sent[0]);
    expect(h.get(FAKE_BSC_KEY_HEADER)).toBe("caller-key");
    expect(h.get(FAKE_BSC_ID_TOKEN_HEADER)).toBe("Bearer id-token");
    expect(h.get("authorization")).toBe("Bearer bsc-token");
    expect(sent[0].init.redirect).toBe("error");
    expect(idToken).toHaveBeenCalledWith(FAKE_ROOT);
  });

  test("fake mode: a tokenless call names its run in x-nb-fake-ns", async () => {
    const sent = stubFetch();
    const { gate } = recordingGate();
    await bscFetch("marketplace/card/1/card-listing", {}, {
      idToken, pathTemplate: CARD_LISTING, gate, env: FAKE_ENV, fakeNs: "slug-0123456789ab",
    });
    expect(headersOf(sent[0]).get(FAKE_BSC_NS_HEADER)).toBe("slug-0123456789ab");
  });

  test("fake mode: a call with a BSC token, an unreadable value, or none sends no x-nb-fake-ns", async () => {
    const sent = stubFetch();
    const { gate } = recordingGate();
    const base = { idToken, pathTemplate: CARD_LISTING, gate, env: FAKE_ENV };
    await bscFetch("a", { headers: bscHeaders("bsc-token") }, { ...base, fakeNs: "slug-" });
    await bscFetch("a", {}, { ...base, fakeNs: "Slug With Spaces" });
    await bscFetch("a", {}, base);
    for (const s of sent) expect(headersOf(s).has(FAKE_BSC_NS_HEADER)).toBe(false);
  });

  test("a misconfigured test deployment throws before the gate or the network", async () => {
    const sent = stubFetch();
    const { gate, acquires } = recordingGate();
    await expect(
      bscFetch("a", {}, {
        idToken, pathTemplate: CARD_LISTING, gate, env: { ...FAKE_ENV, [BSC_API_BASE_ENV]: "http://x.run.app" },
      }),
    ).rejects.toThrow(BscConfigError);
    expect(sent).toEqual([]);
    expect(acquires).toEqual([]);
  });

  test("a gate refusal sends nothing and answers 429 with Retry-After and the breaker header", async () => {
    const sent = stubFetch();
    const { gate } = recordingGate({
      async acquire() {
        return { ok: false, reason: "open", retryAt: Date.now() + 30_000 };
      },
    });
    const res = await bscFetch("a", {}, { idToken, pathTemplate: CARD_LISTING, gate, env: REAL_ENV });
    expect(sent).toEqual([]);
    expect(res.status).toBe(429);
    expect(res.headers.get(BSC_BREAKER_HEADER)).toBe("open");
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(29);
    expect(isBscBreakerRefusal(res)).toBe(true);
  });

  test("a gate that throws on acquire fails closed: 503 gate_unavailable, nothing sent", async () => {
    const sent = stubFetch();
    const { gate } = recordingGate({
      async acquire() {
        throw new Error("down");
      },
    });
    const res = await bscFetch("a", {}, { idToken, pathTemplate: CARD_LISTING, gate, env: REAL_ENV });
    expect(sent).toEqual([]);
    expect(res.status).toBe(503);
    expect(res.headers.get(BSC_BREAKER_HEADER)).toBe("gate_unavailable");
  });

  test("a wave grant is used as given: no acquire of its own", async () => {
    stubFetch();
    const { gate, acquires } = recordingGate();
    await bscFetch("a", {}, {
      idToken, pathTemplate: CARD_LISTING, gate, env: REAL_ENV,
      grant: { grantedAt: 5, reportOutcome: false, probe: false },
    });
    expect(acquires).toEqual([]);
  });

  test("outcomes: 429 with its Retry-After, 5xx a failure, a thrown fetch a failure then rethrown", async () => {
    const { gate, outcomes } = recordingGate();
    const opts = { idToken, pathTemplate: CARD_LISTING, gate, env: REAL_ENV };

    stubFetch(() => new Response("", { status: 429, headers: { "Retry-After": "40" } }));
    await bscFetch("a", {}, opts);
    stubFetch(() => new Response("", { status: 502 }));
    await bscFetch("a", {}, opts);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network"); }));
    await expect(bscFetch("a", {}, opts)).rejects.toThrow("network");

    expect(outcomes).toEqual([
      { outcome: "rateLimited", retryAfterMs: 40_000 },
      { outcome: "failure" },
      { outcome: "failure" },
    ]);
  });

  test("a success is reported only when the gate wants it; a 404 is a success, not a failure", async () => {
    const { gate, outcomes } = recordingGate();
    stubFetch(() => new Response("", { status: 404 }));
    await bscFetch("a", {}, { idToken, pathTemplate: CARD_LISTING, gate, env: REAL_ENV });
    expect(outcomes).toEqual([]);
    await bscFetch("a", {}, {
      idToken, pathTemplate: CARD_LISTING, gate, env: REAL_ENV,
      grant: { grantedAt: 5, reportOutcome: true, probe: true },
    });
    expect(outcomes).toEqual([{ outcome: "success" }]);
  });

  test("a gate that cannot record never fails the call", async () => {
    stubFetch(() => new Response("", { status: 503 }));
    const { gate } = recordingGate({
      async record() {
        throw new Error("down");
      },
    });
    const res = await bscFetch("a", {}, { idToken, pathTemplate: CARD_LISTING, gate, env: REAL_ENV });
    expect(res.status).toBe(503);
  });

  test("the fake's 501 unrecorded answer is not a failure", async () => {
    const { gate, outcomes } = recordingGate();
    stubFetch(() => new Response("", { status: 501, headers: { "x-nb-fake": "unrecorded" } }));
    await bscFetch("a", {}, { idToken, pathTemplate: CARD_LISTING, gate, env: FAKE_ENV });
    expect(outcomes).toEqual([]);
  });
});

describe("bscGateRefusalResponse", () => {
  test("never answers a Retry-After below one second", () => {
    const res = bscGateRefusalResponse({ ok: false, reason: "probing", retryAt: 0 }, 10_000);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  });

  test("a real 429 is not a breaker refusal", () => {
    expect(isBscBreakerRefusal(new Response("", { status: 429 }))).toBe(false);
  });
});

describe("fakeBscControlFetch", () => {
  test("real mode: null, nothing sent, no token minted", async () => {
    const sent = stubFetch();
    expect(await fakeBscControlFetch("__fake/reset", { method: "POST" }, { idToken, env: REAL_ENV })).toBeNull();
    expect(sent).toEqual([]);
    expect(idToken).not.toHaveBeenCalled();
  });

  test("fake mode: the fake's origin (not /api), with caller auth", async () => {
    const sent = stubFetch();
    await fakeBscControlFetch("__fake/misses?prefix=slug-", { method: "GET" }, { idToken, env: FAKE_ENV });
    expect(sent[0].url).toBe(`${FAKE_ROOT}/__fake/misses?prefix=slug-`);
    expect(headersOf(sent[0]).get(FAKE_BSC_KEY_HEADER)).toBe("caller-key");
  });

  test("only __fake/ paths", async () => {
    const sent = stubFetch();
    await expect(
      fakeBscControlFetch("api/seller/order", { method: "GET" }, { idToken, env: FAKE_ENV }),
    ).rejects.toThrow(TypeError);
    expect(sent).toEqual([]);
  });
});

describe("actionBscIdTokenSource", () => {
  test("mints once per audience while the token is fresh", async () => {
    const mint = vi.fn(async () => ({ audience: FAKE_ROOT, token: "t1", expiresAt: Date.now() + 3_600_000 }));
    const source = actionBscIdTokenSource(mint);
    expect(await source(FAKE_ROOT)).toBe("t1");
    expect(await source(FAKE_ROOT)).toBe("t1");
    expect(mint).toHaveBeenCalledTimes(1);
  });

  test("re-mints within five minutes of expiry", async () => {
    const mint = vi.fn(async () => ({ audience: FAKE_ROOT, token: "t", expiresAt: Date.now() + 60_000 }));
    const source = actionBscIdTokenSource(mint);
    await source(FAKE_ROOT);
    await source(FAKE_ROOT);
    expect(mint).toHaveBeenCalledTimes(2);
  });

  test("refuses a token for another audience, or none", async () => {
    const other = actionBscIdTokenSource(async () => ({ audience: "https://x.a.run.app", token: "t", expiresAt: Infinity }));
    await expect(other(FAKE_ROOT)).rejects.toThrow(BscConfigError);
    const none = actionBscIdTokenSource(async () => null);
    await expect(none(FAKE_ROOT)).rejects.toThrow(BscConfigError);
  });
});
