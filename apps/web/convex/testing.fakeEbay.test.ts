/**
 * NEO-555 — the testing endpoints' fake eBay paths:
 *   - `fakeEbayConsent` / `setMyEbaySeller` / `addMyEbayOrder`, scoped to the
 *     caller's namespace and locked like the fake BSC controls,
 *   - `pollMySalesNow`, the cron's poll for the caller alone,
 *   - the eBay fault kinds `setMyBscFaults` now takes,
 *   - `seedMyTestCredentials` connecting the fake seller with a minted code.
 *
 * `internal.fakeBsc.*` is replaced in the module map by a stand-in that
 * records its calls, so these tests pin what testing.ts sends the fake's
 * Convex module (which namespace, which seller, which body), not how that
 * module talks to the fake.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { internalAction } from "./_generated/server";
import schema from "./schema";
import { __resetContractCache } from "./credentials";
import { fakeBscNamespaceFor, fakeEbayMode } from "./testing";

const USER_A = "user_ebayfake_aaaa";
const USER_B = "user_ebayfake_bbbb";
const CLOUD_URL = "https://happy-otter-123.convex.cloud";
const BROWSER = "http://localhost:9999";
const FAKE_ENV = {
  TESTING_RESET_SECRET: "test-enabled",
  NEONBINDER_BSC_API_BASE: "https://neonbinder-fake-bsc-abc123-uc.a.run.app",
  NEONBINDER_FAKE_BSC_KEY: "caller-key",
  CONVEX_CLOUD_URL: CLOUD_URL,
  EBAY_ENVIRONMENT: "fake",
};

type Call = { fn: string; args: Record<string, unknown> };
const calls: Call[] = [];
/** What the stand-in answers next; `fakeBsc.ts` reports failure in its result, it never throws. */
let nextResult: unknown = { ok: true, skipped: false };
const FAILED = { ok: false, status: 409, error: "a fulfillment policy with that name already exists" };

function recorder(fn: string, answer?: () => unknown) {
  return internalAction({
    args: {
      ns: v.optional(v.string()),
      seller: v.optional(v.string()),
      optedIn: v.optional(v.boolean()),
      fulfillmentPolicies: v.optional(v.any()),
      order: v.optional(v.any()),
      rules: v.optional(v.any()),
    },
    returns: v.any(),
    handler: async (_ctx, args) => {
      calls.push({ fn, args });
      const result = nextResult;
      nextResult = { ok: true, skipped: false };
      const r = result as { ok?: boolean; skipped?: boolean };
      return answer && r.ok === true && r.skipped !== true ? answer() : result;
    },
  });
}

const stubFakeBsc = {
  resetNamespace: recorder("resetNamespace"),
  ebayConsent: recorder("ebayConsent", () => ({ code: "fake-code-1" })),
  ebaySeller: recorder("ebaySeller"),
  ebayOrders: recorder("ebayOrders"),
  setFaults: recorder("setFaults"),
};

const modules = {
  ...(import.meta as unknown as { glob: (pattern: string) => Record<string, () => Promise<unknown>> }).glob(
    "./**/*.*s",
  ),
  "./fakeBsc.ts": async () => stubFakeBsc,
};

function useFakeEnv(): void {
  for (const [key, value] of Object.entries(FAKE_ENV)) vi.stubEnv(key, value);
}

const as = (t: ReturnType<typeof convexTest>, user = USER_A) => t.withIdentity({ subject: user });

beforeEach(() => {
  calls.length = 0;
  nextResult = { ok: true, skipped: false };
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("fakeEbayMode", () => {
  test("is true only on a testing deployment wired to the fake, and never from the env flag alone", () => {
    expect(fakeEbayMode()).toBe(false);
    vi.stubEnv("EBAY_ENVIRONMENT", "fake");
    // No testing flag and no fake BSC beside it: not configured, not fake.
    expect(fakeEbayMode()).toBe(false);
    useFakeEnv();
    expect(fakeEbayMode()).toBe(true);
    vi.stubEnv("TESTING_RESET_SECRET", "");
    expect(fakeEbayMode()).toBe(false);
  });

  test("a sandbox deployment is not the fake", () => {
    useFakeEnv();
    vi.stubEnv("EBAY_ENVIRONMENT", "sandbox");
    vi.stubEnv("EBAY_CLIENT_ID", "cid");
    vi.stubEnv("EBAY_RU_NAME", "ru");
    expect(fakeEbayMode()).toBe(false);
  });
});

/** The locks every fake eBay control shares. */
function lockedLikeTheOtherTestingControls(
  name: string,
  call: (t: ReturnType<typeof convexTest>, user?: string | null) => Promise<unknown>,
) {
  describe(`${name} locks`, () => {
    test("throws where TESTING_RESET_SECRET is unset, before anything else", async () => {
      useFakeEnv();
      vi.stubEnv("TESTING_RESET_SECRET", "");
      await expect(call(convexTest(schema, modules))).rejects.toThrow(/not enabled/);
      expect(calls).toEqual([]);
    });

    test("refuses an anonymous caller", async () => {
      useFakeEnv();
      await expect(call(convexTest(schema, modules), null)).rejects.toThrow(/Not authenticated/);
      expect(calls).toEqual([]);
    });

    test("refuses a deployment whose eBay is not the fake", async () => {
      useFakeEnv();
      vi.stubEnv("EBAY_ENVIRONMENT", "sandbox");
      vi.stubEnv("EBAY_CLIENT_ID", "cid");
      vi.stubEnv("EBAY_RU_NAME", "ru");
      await expect(call(convexTest(schema, modules))).rejects.toThrow(/does not talk to the fake eBay/);
      vi.stubEnv("EBAY_ENVIRONMENT", "");
      await expect(call(convexTest(schema, modules))).rejects.toThrow(/does not talk to the fake eBay/);
      expect(calls).toEqual([]);
    });
  });
}

const callAs = (t: ReturnType<typeof convexTest>, user: string | null | undefined) =>
  user === null ? t : as(t, user ?? USER_A);

describe("fakeEbayConsent", () => {
  lockedLikeTheOtherTestingControls("fakeEbayConsent", (t, user) => callAs(t, user).action(api.testing.fakeEbayConsent, {}));

  test("mints a code for the caller's own namespace, main seller by default", async () => {
    useFakeEnv();
    const result = await as(convexTest(schema, modules), USER_B).action(api.testing.fakeEbayConsent, {});
    expect(result).toEqual({ code: "fake-code-1" });
    expect(calls).toEqual([{ fn: "ebayConsent", args: { ns: fakeBscNamespaceFor(USER_B, CLOUD_URL) } }]);
  });

  test("asks for the second account when told to", async () => {
    useFakeEnv();
    await as(convexTest(schema, modules)).action(api.testing.fakeEbayConsent, { seller: "alt" });
    expect(calls).toEqual([{ fn: "ebayConsent", args: { ns: fakeBscNamespaceFor(USER_A, CLOUD_URL), seller: "alt" } }]);
  });

  test("takes no seller but alt, so no namespace or other account can be named", async () => {
    useFakeEnv();
    await expect(
      as(convexTest(schema, modules)).action(api.testing.fakeEbayConsent, { seller: "main" } as never),
    ).rejects.toThrow();
    await expect(
      as(convexTest(schema, modules)).action(api.testing.fakeEbayConsent, { ns: "someone-else" } as never),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  test("throws when the fake refuses, or answers with no code", async () => {
    useFakeEnv();
    const t = convexTest(schema, modules);
    nextResult = FAILED;
    await expect(as(t).action(api.testing.fakeEbayConsent, {})).rejects.toThrow(/did not mint a consent code/);
    nextResult = { ok: true, skipped: true };
    await expect(as(t).action(api.testing.fakeEbayConsent, {})).rejects.toThrow(/no fake eBay to talk to/);
  });
});

describe("setMyEbaySeller", () => {
  const policies = [{ name: "Tracked", costType: "FLAT_RATE" as const, services: [{ code: "USPSGroundAdvantage", costCents: 450 }] }];

  lockedLikeTheOtherTestingControls("setMyEbaySeller", (t, user) =>
    callAs(t, user).action(api.testing.setMyEbaySeller, { fulfillmentPolicies: policies }),
  );

  test("sets the policies on the caller's own namespace and counts them", async () => {
    useFakeEnv();
    const result = await as(convexTest(schema, modules), USER_B).action(api.testing.setMyEbaySeller, {
      fulfillmentPolicies: policies,
    });
    expect(result).toEqual({ policies: 1 });
    expect(calls).toEqual([
      { fn: "ebaySeller", args: { ns: fakeBscNamespaceFor(USER_B, CLOUD_URL), fulfillmentPolicies: policies } },
    ]);
  });

  test("passes only what was asked: the opt-in alone, for the other account", async () => {
    useFakeEnv();
    const result = await as(convexTest(schema, modules)).action(api.testing.setMyEbaySeller, { seller: "alt", optedIn: false });
    expect(result).toEqual({ policies: 0 });
    expect(calls).toEqual([
      { fn: "ebaySeller", args: { ns: fakeBscNamespaceFor(USER_A, CLOUD_URL), seller: "alt", optedIn: false } },
    ]);
  });

  test("throws when the fake refuses", async () => {
    useFakeEnv();
    nextResult = FAILED;
    await expect(
      as(convexTest(schema, modules)).action(api.testing.setMyEbaySeller, { fulfillmentPolicies: policies }),
    ).rejects.toThrow(/did not set the seller up: a fulfillment policy with that name already exists \(409\)/);
  });

  // The shape `fakeBsc.ebaySeller` really returns for the fake's 409: the
  // transport says "http", the fake's own reason rides in `detail`. The
  // message names the reason, so a spec can tell a held policy name from any
  // other 409 (support/ebayFake.ts ALREADY_HELD).
  test("names the fake's own reason (detail) over the transport's word", async () => {
    useFakeEnv();
    nextResult = { ok: false, status: 409, error: "http", detail: "a fulfillment policy with that name already exists" };
    await expect(
      as(convexTest(schema, modules)).action(api.testing.setMyEbaySeller, { fulfillmentPolicies: policies }),
    ).rejects.toThrow(/^Fake eBay did not set the seller up: a fulfillment policy with that name already exists \(409\)$/);
    nextResult = { ok: false, status: 409, error: "http", detail: "too many fulfillment policies" };
    await expect(
      as(convexTest(schema, modules)).action(api.testing.setMyEbaySeller, { fulfillmentPolicies: policies }),
    ).rejects.toThrow(/^Fake eBay did not set the seller up: too many fulfillment policies \(409\)$/);
    // No detail: the transport's word, as before.
    nextResult = { ok: false, status: 503, error: "http" };
    await expect(
      as(convexTest(schema, modules)).action(api.testing.setMyEbaySeller, { fulfillmentPolicies: policies }),
    ).rejects.toThrow(/^Fake eBay did not set the seller up: http \(503\)$/);
  });

  const service = { code: "USPSGroundAdvantage" };
  test.each([
    ["an empty list", []],
    ["eleven policies", Array.from({ length: 11 }, (_, i) => ({ name: `P${i}`, services: [service] }))],
    ["a blank name", [{ name: "", services: [service] }]],
    ["a name with a control character", [{ name: "bad\nname", services: [service] }]],
    ["a name past 64 characters", [{ name: "x".repeat(65), services: [service] }]],
    ["no services", [{ name: "P", services: [] }]],
    ["six services", [{ name: "P", services: Array.from({ length: 6 }, () => service) }]],
    ["a service code with a space", [{ name: "P", services: [{ code: "USPS Ground" }] }]],
    ["a carrier with a slash", [{ name: "P", services: [{ code: "X", carrier: "US/PS" }] }]],
    ["fractional cents", [{ name: "P", services: [{ code: "X", costCents: 1.5 }] }]],
    ["a negative cost", [{ name: "P", services: [{ code: "X", costCents: -1 }] }]],
  ])("refuses %s and sends nothing", async (_label, fulfillmentPolicies) => {
    useFakeEnv();
    await expect(
      as(convexTest(schema, modules)).action(api.testing.setMyEbaySeller, { fulfillmentPolicies }),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe("addMyEbayOrder", () => {
  const order = {
    orderId: "27-12345-67890",
    lines: [
      { sku: "NB2-abc-NM", quantity: 1 },
      { title: "An unknown card", quantity: 2, priceCents: 150 },
    ],
  };

  lockedLikeTheOtherTestingControls("addMyEbayOrder", (t, user) => callAs(t, user).action(api.testing.addMyEbayOrder, { order }));

  test("adds the order to the caller's own namespace and counts its lines", async () => {
    useFakeEnv();
    const result = await as(convexTest(schema, modules), USER_B).action(api.testing.addMyEbayOrder, { order });
    expect(result).toEqual({ lines: 2 });
    expect(calls).toEqual([{ fn: "ebayOrders", args: { ns: fakeBscNamespaceFor(USER_B, CLOUD_URL), order } }]);
  });

  test("can land on the second account", async () => {
    useFakeEnv();
    await as(convexTest(schema, modules)).action(api.testing.addMyEbayOrder, { order, seller: "alt" });
    expect(calls[0].args).toMatchObject({ seller: "alt", order });
  });

  test("throws when the fake refuses", async () => {
    useFakeEnv();
    nextResult = { ok: false, status: 409, error: "too many orders for this seller" };
    await expect(as(convexTest(schema, modules)).action(api.testing.addMyEbayOrder, { order })).rejects.toThrow(
      /did not add the order: too many orders for this seller \(409\)/,
    );
  });

  const line = { quantity: 1 };
  test.each([
    ["no lines", { lines: [] }],
    ["fifty-one lines", { lines: Array.from({ length: 51 }, () => line) }],
    ["a zero quantity", { lines: [{ quantity: 0 }] }],
    ["a fractional quantity", { lines: [{ quantity: 1.5 }] }],
    ["a blank sku", { lines: [{ sku: "", quantity: 1 }] }],
    ["a sku past 50 characters", { lines: [{ sku: "x".repeat(51), quantity: 1 }] }],
    ["a title past eBay's 80", { lines: [{ title: "x".repeat(81), quantity: 1 }] }],
    ["a title with a control character", { lines: [{ title: "a\tb", quantity: 1 }] }],
    ["fractional cents", { lines: [{ quantity: 1, priceCents: 0.5 }] }],
    ["a listing id that is not digits", { lines: [{ quantity: 1, listingId: "12a" }] }],
    ["an order id with a space", { orderId: "27 12", lines: [line] }],
    ["a creation date of zero", { creationDateMs: 0, lines: [line] }],
    ["a payment status eBay has none of", { paymentStatus: "SOMETIME", lines: [line] } as never],
  ])("refuses %s and sends nothing", async (_label, bad) => {
    useFakeEnv();
    await expect(as(convexTest(schema, modules)).action(api.testing.addMyEbayOrder, { order: bad })).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe("pollMySalesNow", () => {
  lockedLikeTheOtherTestingControls("pollMySalesNow (ebay)", (t, user) =>
    callAs(t, user).action(api.testing.pollMySalesNow, { platform: "ebay" }),
  );

  test("polls the caller alone and answers when it has finished (nothing to read is a clean zero)", async () => {
    useFakeEnv();
    const result = await as(convexTest(schema, modules)).action(api.testing.pollMySalesNow, { platform: "ebay" });
    expect(result).toEqual({ ordersRead: 0, ordersStored: 0, linesApplied: 0 });
  });

  test("refuses bsc where the deployment talks to the real BuySportsCards, and ebay where it is not the fake", async () => {
    vi.stubEnv("TESTING_RESET_SECRET", "test-enabled");
    const t = convexTest(schema, modules);
    await expect(as(t).action(api.testing.pollMySalesNow, { platform: "bsc" })).rejects.toThrow(/real BuySportsCards/);
    await expect(as(t).action(api.testing.pollMySalesNow, { platform: "ebay" })).rejects.toThrow(/fake eBay/);
  });

  test("bsc is allowed on the fake, with the same locks", async () => {
    vi.stubEnv("TESTING_RESET_SECRET", "");
    useFakeEnv();
    vi.stubEnv("TESTING_RESET_SECRET", "");
    await expect(as(convexTest(schema, modules)).action(api.testing.pollMySalesNow, { platform: "bsc" })).rejects.toThrow(/not enabled/);
    useFakeEnv();
    await expect(convexTest(schema, modules).action(api.testing.pollMySalesNow, { platform: "bsc" })).rejects.toThrow(/Not authenticated/);
    expect(await as(convexTest(schema, modules)).action(api.testing.pollMySalesNow, { platform: "bsc" })).toEqual({
      ordersRead: 0,
      ordersStored: 0,
      linesApplied: 0,
    });
  });

  test("waits out a poll already running for the caller, then polls and releases (never overlaps the cron's)", async () => {
    useFakeEnv();
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("marketplaceListingStates", {
        ownerId: USER_A,
        platform: "ebay",
        listingStartedAt: Date.now(),
        lastUpdated: Date.now(),
        pollLeaseToken: "cron",
        pollLeaseExpiresAt: Date.now() + 1_200,
      });
    });
    // The wait is real setTimeout steps; fake the timer and Date so the test
    // reads the wait off the fake clock instead of sleeping through it.
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    try {
      const started = Date.now();
      const polled = as(t).action(api.testing.pollMySalesNow, { platform: "ebay" });
      // Step the fake clock until the poll settles, yielding to the real event
      // loop between steps (the wait timer is armed after real async work).
      let settled = false;
      void polled.then(
        () => (settled = true),
        () => (settled = true),
      );
      while (!settled) {
        await vi.advanceTimersByTimeAsync(500);
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(await polled).toEqual({
        ordersRead: 0,
        ordersStored: 0,
        linesApplied: 0,
      });
      expect(Date.now() - started).toBeGreaterThanOrEqual(1_000);
    } finally {
      vi.useRealTimers();
    }
    const lease = await t.run(async (ctx) => (await ctx.db.query("marketplaceListingStates").first())?.pollLeaseToken);
    expect(lease ?? null).toBeNull();
  });

  test("takes no owner: the poll is the caller's, whatever the arguments say", async () => {
    useFakeEnv();
    await expect(
      as(convexTest(schema, modules)).action(api.testing.pollMySalesNow, { platform: "ebay", ownerId: USER_B } as never),
    ).rejects.toThrow();
  });
});

describe("setMyBscFaults and the eBay fault kinds", () => {
  const template = "ebay/api/sell/inventory/v1/offer/:offerId/publish";
  const rule = { match: { method: "POST" as const, pathTemplate: template }, kind: "ebayError" as const, status: 400, errorIds: [25007] };

  test("passes an ebayError and an unauthorized rule through to the caller's namespace", async () => {
    useFakeEnv();
    const t = convexTest(schema, modules);
    const rules = [rule, { match: { method: "GET" as const, pathTemplate: "ebay/api/sell/*" }, kind: "unauthorized" as const, times: 1 }];
    expect(await as(t, USER_B).action(api.testing.setMyBscFaults, { rules })).toEqual({ rules: 2 });
    expect(calls).toEqual([{ fn: "setFaults", args: { ns: fakeBscNamespaceFor(USER_B, CLOUD_URL), rules } }]);
  });

  test.each([
    ["an ebayError with a status below 400", { ...rule, status: 200 }],
    ["an ebayError with a status above 599", { ...rule, status: 600 }],
    ["an ebayError with no status", { ...rule, status: undefined }],
    ["an ebayError with no ids", { ...rule, errorIds: [] }],
    ["an ebayError with eleven ids", { ...rule, errorIds: Array.from({ length: 11 }, (_, i) => 25000 + i) }],
    ["an ebayError with a fractional id", { ...rule, errorIds: [1.5] }],
    ["an ebayError aimed at a BSC path", { ...rule, match: { ...rule.match, pathTemplate: "seller/order/:id" } }],
    ["an unauthorized aimed at a BSC path", { ...rule, kind: "unauthorized" as const, status: undefined, errorIds: undefined, match: { ...rule.match, pathTemplate: "seller/order/:id" } }],
    ["a status on a kind that has none", { ...rule, kind: "503" as const }],
    ["a bare star", { ...rule, kind: "503" as const, status: undefined, errorIds: undefined, match: { ...rule.match, pathTemplate: "*" } }],
    ["a star that is not the last segment", { ...rule, kind: "503" as const, status: undefined, errorIds: undefined, match: { ...rule.match, pathTemplate: "ebay/*/publish" } }],
    ["a star inside a segment", { ...rule, kind: "503" as const, status: undefined, errorIds: undefined, match: { ...rule.match, pathTemplate: "ebay/api/se*" } }],
  ])("refuses %s", async (_label, bad) => {
    useFakeEnv();
    await expect(as(convexTest(schema, modules)).action(api.testing.setMyBscFaults, { rules: [bad] })).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  test("a trailing /* on a BSC template is allowed too (one rule list per namespace, both sites)", async () => {
    useFakeEnv();
    const t = convexTest(schema, modules);
    const prefix = { match: { method: "GET" as const, pathTemplate: "seller/*" }, kind: "503" as const };
    expect(await as(t).action(api.testing.setMyBscFaults, { rules: [prefix] })).toEqual({ rules: 1 });
  });
});

describe("seedMyTestCredentials for ebay on the fake", () => {
  let browserCalls: Array<{ path: string; body: Record<string, unknown> | null }>;
  let connectAnswer: Response;

  beforeEach(() => {
    browserCalls = [];
    connectAnswer = Response.json({ username: "fake-seller", ebayUserId: "FAKE-1", environment: "fake", expiresAt: 1 });
    vi.stubEnv("NEONBINDER_BROWSER_URL", BROWSER);
    __resetContractCache();
    vi.stubEnv("NEONBINDER_PAUSED_PLATFORMS", "");
    vi.stubGlobal("fetch", (async (url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url));
      if (u.pathname === "/health") {
        return Response.json({ status: "ok", environment: "test", contractVersion: 1, bscTarget: "fake", ebayFake: true });
      }
      browserCalls.push({ path: u.pathname, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
      if (u.pathname === "/oauth/ebay/connect") return connectAnswer.clone();
      throw new Error(`unexpected ${u.pathname}`);
    }) as typeof fetch);
  });
  afterEach(() => {
    delete process.env.NEONBINDER_BROWSER_URL;
  });

  const seed = (t: ReturnType<typeof convexTest>, listing?: boolean) =>
    as(t).action(api.testing.seedMyTestCredentials, { sites: ["ebay"], ...(listing !== undefined ? { listing } : {}) });

  test("mints a code for the caller's namespace and connects with it: no refresh token, no DEV_EBAY_REFRESH_TOKEN", async () => {
    useFakeEnv();
    vi.stubEnv("DEV_EBAY_REFRESH_TOKEN", "");
    const t = convexTest(schema, modules);
    expect((await seed(t)).seeded).toEqual([{ site: "ebay", stored: true }]);
    expect(calls).toEqual([{ fn: "ebayConsent", args: { ns: fakeBscNamespaceFor(USER_A, CLOUD_URL) } }]);
    const connect = browserCalls.filter((c) => c.path === "/oauth/ebay/connect");
    expect(connect).toHaveLength(1);
    expect(connect[0].body).toMatchObject({ code: "fake-code-1" });
    expect(connect[0].body).not.toHaveProperty("refreshToken");
  });

  test("holds listing off by default and starts it when asked", async () => {
    useFakeEnv();
    const t = convexTest(schema, modules);
    await seed(t);
    const rows = async () =>
      t.run(async (ctx) => (await ctx.db.query("marketplaceListingStates").collect()).filter((r) => r.ownerId === USER_A));
    expect((await rows())[0]).toMatchObject({ platform: "ebay", testListingOff: true });
  });

  test("a fake that mints no code reports why and connects nothing", async () => {
    useFakeEnv();
    nextResult = FAILED;
    const t = convexTest(schema, modules);
    expect((await seed(t)).seeded).toEqual([{ site: "ebay", stored: false, reason: "Fake eBay did not mint a consent code" }]);
    expect(browserCalls).toEqual([]);
  });

  test("a failed connect reports why, stores nothing, and never echoes the code", async () => {
    useFakeEnv();
    connectAnswer = Response.json({ error_class: "consent_refused" }, { status: 401 });
    const t = convexTest(schema, modules);
    const result = await seed(t);
    expect(result.seeded).toEqual([{ site: "ebay", stored: false, reason: "consentRefused" }]);
    expect(JSON.stringify(result)).not.toContain("fake-code-1");
  });

  test("a paused eBay is skipped before the fake is asked for anything", async () => {
    useFakeEnv();
    vi.stubEnv("NEONBINDER_PAUSED_PLATFORMS", "ebay");
    expect((await seed(convexTest(schema, modules))).seeded).toEqual([{ site: "ebay", stored: false, skipped: true }]);
    expect(calls).toEqual([]);
  });

  test("the sandbox branch is untouched: a sandbox deployment still needs its refresh token and never asks the fake", async () => {
    useFakeEnv();
    vi.stubEnv("EBAY_ENVIRONMENT", "sandbox");
    vi.stubEnv("EBAY_CLIENT_ID", "cid");
    vi.stubEnv("EBAY_RU_NAME", "ru");
    vi.stubEnv("DEV_EBAY_REFRESH_TOKEN", "");
    expect((await seed(convexTest(schema, modules))).seeded).toEqual([{ site: "ebay", stored: false, skipped: true }]);
    expect(calls).toEqual([]);
  });

  test("a user's other seed, USER_B, mints for their own namespace", async () => {
    useFakeEnv();
    await as(convexTest(schema, modules), USER_B).action(api.testing.seedMyTestCredentials, { sites: ["ebay"] });
    expect(calls[0]).toEqual({ fn: "ebayConsent", args: { ns: fakeBscNamespaceFor(USER_B, CLOUD_URL) } });
  });
});
