/**
 * NEO-552 — the testing endpoints' fake BuySportsCards paths:
 *   - the per-user fake account (`fakeBscUsernameFor`, its tag and prefix),
 *   - `seedMyTestCredentials` seeding that account instead of DEV_BSC_*,
 *   - `resetMyTestState` clearing the caller's namespace on the fake,
 *   - `setMyBscFaults` / `addMyBscOrder`, scoped to the caller's namespace,
 *   - `resetFakeBscForDeploymentFromCli`, the scripted reset's step.
 *
 * `internal.fakeBsc.*` is replaced in the module map by a stand-in that
 * records its calls, so these tests pin what testing.ts sends the fake's
 * Convex module (which namespace, which prefix, which rules), not how that
 * module talks to the fake.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import schema from "./schema";
import { __resetContractCache } from "./credentials";
import { resolveBscTarget } from "./lib/bscHttp";
import {
  FAKE_BSC_PASSWORD,
  MAX_FAKE_BSC_FAULT_RULES,
  convexSlugOf,
  fakeBscCredentialKeyFor,
  fakeBscMode,
  fakeBscNamespaceFor,
  fakeBscPrefixFor,
  fakeBscUserTag,
  fakeBscUsernameFor,
} from "./testing";

const USER_A = "user_aaaabbbbcccc";
const USER_B = "user_ddddeeeeffff";
const CLOUD_URL = "https://happy-otter-123.convex.cloud";
const PREFIX = "happy-otter-123-";
const FAKE_ENV = {
  TESTING_RESET_SECRET: "test-enabled",
  // The fake's pinned host shape (`lib/bscHttp.ts`): first label `neonbinder-fake-bsc-…`, ending `.run.app`.
  NEONBINDER_BSC_API_BASE: "https://neonbinder-fake-bsc-abc123-uc.a.run.app",
  NEONBINDER_FAKE_BSC_KEY: "caller-key",
  CONVEX_CLOUD_URL: CLOUD_URL,
};

type Call = { fn: string; args: Record<string, unknown> };
const calls: Call[] = [];
type ControlResult = { ok: true; skipped: boolean } | { ok: false; status?: number; error: string };
/** What the stand-in answers next; `fakeBsc.ts` reports failure in its result, it never throws. */
let nextResult: ControlResult = { ok: true, skipped: false };
const FAILED: ControlResult = { ok: false, status: 503, error: "fake did not answer" };

function recorder(fn: string) {
  return internalAction({
    args: { ns: v.optional(v.string()), prefix: v.optional(v.string()), rules: v.optional(v.any()), order: v.optional(v.any()) },
    returns: v.any(),
    handler: async (_ctx, args) => {
      calls.push({ fn, args });
      const result = nextResult;
      nextResult = { ok: true, skipped: false };
      return result;
    },
  });
}

const stubFakeBsc = {
  resetNamespace: recorder("resetNamespace"),
  resetPrefix: recorder("resetPrefix"),
  setFaults: recorder("setFaults"),
  addOrder: recorder("addOrder"),
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

beforeEach(() => {
  calls.length = 0;
  nextResult = { ok: true, skipped: false };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the fake account of a test user", () => {
  test("the slug comes from a Convex cloud URL and nothing else", () => {
    expect(convexSlugOf(CLOUD_URL)).toBe("happy-otter-123");
    expect(convexSlugOf(`${CLOUD_URL}/`)).toBe("happy-otter-123");
    expect(convexSlugOf(undefined)).toBeNull();
    expect(convexSlugOf("http://happy-otter-123.convex.cloud")).toBeNull();
    expect(convexSlugOf("https://happy-otter-123.convex.site")).toBeNull();
    expect(convexSlugOf("https://Evil+x.convex.cloud")).toBeNull();
  });

  test("the user tag is 12 hex digits, stable, and differs per user", () => {
    const a = fakeBscUserTag(USER_A);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(fakeBscUserTag(USER_A)).toBe(a);
    expect(fakeBscUserTag(USER_B)).not.toBe(a);
    // The Clerk id itself never reaches the fake.
    expect(fakeBscUsernameFor(USER_A, CLOUD_URL)).not.toContain("aaaabbbbcccc");
  });

  test("the username is nb+<namespace>@fake.invalid; the namespace is <slug>-<tag> under the deployment's prefix", () => {
    const ns = fakeBscNamespaceFor(USER_A, CLOUD_URL);
    expect(ns).toBe(`happy-otter-123-${fakeBscUserTag(USER_A)}`);
    expect(fakeBscUsernameFor(USER_A, CLOUD_URL)).toBe(`nb+${ns}@fake.invalid`);
    expect(fakeBscPrefixFor(CLOUD_URL)).toBe(PREFIX);
    expect(ns.startsWith(PREFIX)).toBe(true);
    // The fake's own namespace rule (services/fake-bsc/src/namespace.ts).
    expect(ns).toMatch(/^[a-z0-9][a-z0-9-]{0,99}$/);
    // Another deployment's accounts never fall under this prefix.
    expect(fakeBscNamespaceFor(USER_A, "https://happy-otter-1234.convex.cloud").startsWith(PREFIX)).toBe(false);
  });

  test("no deployment URL is refused, never an empty prefix", () => {
    expect(() => fakeBscPrefixFor(undefined)).toThrow(/CONVEX_CLOUD_URL/);
    expect(() => fakeBscUsernameFor(USER_A, "not a url")).toThrow(/CONVEX_CLOUD_URL/);
  });

  test("fake mode needs the fake's URL and the testing flag; a broken fake setting still counts as fake", () => {
    expect(fakeBscMode({})).toBe(false);
    // The fixture is a well-formed fake, not a misconfigured one passing as fake.
    expect(resolveBscTarget(FAKE_ENV).mode).toBe("fake");
    expect(fakeBscMode(FAKE_ENV)).toBe(true);
    // Production: no testing flag, so the URL is ignored.
    expect(fakeBscMode({ ...FAKE_ENV, TESTING_RESET_SECRET: undefined })).toBe(false);
    // A test deployment asking for the fake with a bad URL must not fall back to a real account.
    expect(fakeBscMode({ ...FAKE_ENV, NEONBINDER_BSC_API_BASE: "https://example.com" })).toBe(true);
  });
});

describe("resetMyTestState and the fake", () => {
  test("clears the caller's own namespace before it returns", async () => {
    useFakeEnv();
    const t = convexTest(schema, modules);
    const result = await t.withIdentity({ subject: USER_A }).action(api.testing.resetMyTestState, {});
    expect(result.fakeBscNamespaceReset).toBe(true);
    expect(calls).toEqual([{ fn: "resetNamespace", args: { ns: fakeBscNamespaceFor(USER_A, CLOUD_URL) } }]);
  });

  test("sends nothing on a deployment that talks to the real BSC", async () => {
    vi.stubEnv("TESTING_RESET_SECRET", "test-enabled");
    const t = convexTest(schema, modules);
    const result = await t.withIdentity({ subject: USER_A }).action(api.testing.resetMyTestState, {});
    expect(result.fakeBscNamespaceReset).toBe(false);
    expect(calls).toEqual([]);
  });

  test("fails loudly when the fake does not answer", async () => {
    useFakeEnv();
    nextResult = FAILED;
    const t = convexTest(schema, modules);
    await expect(t.withIdentity({ subject: USER_A }).action(api.testing.resetMyTestState, {})).rejects.toThrow(
      /did not clear your test account: fake did not answer \(503\)/,
    );
  });

  test("fails when the fake module finds no fake to reach", async () => {
    useFakeEnv();
    nextResult = { ok: true, skipped: true };
    const t = convexTest(schema, modules);
    await expect(t.withIdentity({ subject: USER_A }).action(api.testing.resetMyTestState, {})).rejects.toThrow(
      /no fake to reach/,
    );
  });

  test("refuses an anonymous caller and a production deployment without touching the fake", async () => {
    useFakeEnv();
    const t = convexTest(schema, modules);
    await expect(t.action(api.testing.resetMyTestState, {})).rejects.toThrow(/Not authenticated/);
    vi.stubEnv("TESTING_RESET_SECRET", "");
    await expect(t.withIdentity({ subject: USER_A }).action(api.testing.resetMyTestState, {})).rejects.toThrow(
      /not enabled/,
    );
    expect(calls).toEqual([]);
  });
});

describe("seedMyTestCredentials on the fake", () => {
  type Login = { url: string; body: { key?: string; username?: string; password?: string } };

  function stubBrowser(logins: Login[]) {
    vi.stubGlobal("fetch", (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      // A fake-aware browser revision (NEO-552): a fake deployment refuses any other.
      if (u.endsWith("/health")) return json({ status: "ok", environment: "test", contractVersion: 1, bscTarget: "fake" });
      if (u.includes("/metadata")) return json({ error: "Credentials not found" }, 404);
      if ((init?.method ?? "GET") === "POST" && u.includes("/login/")) {
        logins.push({ url: u, body: JSON.parse(String(init?.body)) });
        return json({ success: true, message: "ok" });
      }
      throw new Error(`unexpected fetch: ${u}`);
    }) as typeof fetch);
  }

  beforeEach(() => {
    __resetContractCache();
    vi.stubEnv("NEONBINDER_BROWSER_URL", "http://localhost:9999");
  });

  test("signs in with the caller's fake account, never the DEV_BSC_* account", async () => {
    useFakeEnv();
    vi.stubEnv("DEV_BSC_USERNAME", "real-account@example.com");
    vi.stubEnv("DEV_BSC_PASSWORD", "real-password");
    const logins: Login[] = [];
    stubBrowser(logins);
    const t = convexTest(schema, modules);

    const result = await t
      .withIdentity({ subject: USER_A })
      .action(api.testing.seedMyTestCredentials, { sites: ["buysportscards"] });

    expect(result.seeded).toEqual([{ site: "buysportscards", stored: true }]);
    expect(logins).toHaveLength(1);
    expect(logins[0].url).toContain("/login/bsc");
    expect(logins[0].body.username).toBe(fakeBscUsernameFor(USER_A, CLOUD_URL));
    expect(logins[0].body.password).toBe(FAKE_BSC_PASSWORD);
    // Stored under this deployment's own key, not the bare per-user one.
    expect(logins[0].body.key).toBe(fakeBscCredentialKeyFor(USER_A, CLOUD_URL));
    expect(logins[0].body.key).toBe(`buysportscards-credentials-fake-${PREFIX}${USER_A}`);
    expect(JSON.stringify(logins)).not.toContain("real-");
  });

  test("seeds the fake account even where no DEV_BSC_* account is configured", async () => {
    useFakeEnv();
    const logins: Login[] = [];
    stubBrowser(logins);
    const t = convexTest(schema, modules);

    const result = await t
      .withIdentity({ subject: USER_B })
      .action(api.testing.seedMyTestCredentials, { sites: ["buysportscards"] });

    expect(result.seeded).toEqual([{ site: "buysportscards", stored: true }]);
    expect(logins[0].body.username).toBe(fakeBscUsernameFor(USER_B, CLOUD_URL));
  });

  test("a misconfigured fake target still never seeds the real DEV_BSC_* account", async () => {
    useFakeEnv();
    // Not the pinned neonbinder-fake-bsc-* host: the target is misconfigured, not real.
    vi.stubEnv("NEONBINDER_BSC_API_BASE", "https://fake-bsc-abc123-uc.a.run.app");
    vi.stubEnv("DEV_BSC_USERNAME", "real-account@example.com");
    vi.stubEnv("DEV_BSC_PASSWORD", "real-password");
    expect(resolveBscTarget(process.env).mode).toBe("misconfigured");
    const logins: Login[] = [];
    stubBrowser(logins);
    const t = convexTest(schema, modules);

    await t
      .withIdentity({ subject: USER_A })
      .action(api.testing.seedMyTestCredentials, { sites: ["buysportscards"] })
      .catch(() => undefined);

    // The seed does sign in (through the browser service), and only as the fake account.
    expect(logins).toHaveLength(1);
    expect(JSON.stringify(logins)).not.toContain("real-");
    for (const login of logins) {
      expect(login.body.username).toBe(fakeBscUsernameFor(USER_A, CLOUD_URL));
      expect(login.body.password).toBe(FAKE_BSC_PASSWORD);
    }
  });

  test("off the fake, the BSC seed is exactly as before: DEV_BSC_* or skipped", async () => {
    vi.stubEnv("TESTING_RESET_SECRET", "test-enabled");
    const logins: Login[] = [];
    stubBrowser(logins);
    const t = convexTest(schema, modules);

    const skipped = await t
      .withIdentity({ subject: USER_A })
      .action(api.testing.seedMyTestCredentials, { sites: ["buysportscards"] });
    expect(skipped.seeded).toEqual([{ site: "buysportscards", stored: false, skipped: true }]);

    vi.stubEnv("DEV_BSC_USERNAME", "dev-bsc@example.com");
    vi.stubEnv("DEV_BSC_PASSWORD", "bsc-pass");
    await t.withIdentity({ subject: USER_A }).action(api.testing.seedMyTestCredentials, { sites: ["buysportscards"] });
    expect(logins.map(({ body }) => [body.username, body.password])).toEqual([["dev-bsc@example.com", "bsc-pass"]]);
  });
});

describe("setMyBscFaults", () => {
  const rule = { match: { method: "POST" as const, pathTemplate: "seller/order/history" }, kind: "429" as const };

  test("sets the rules on the caller's own namespace", async () => {
    useFakeEnv();
    const t = convexTest(schema, modules);
    const result = await t.withIdentity({ subject: USER_B }).action(api.testing.setMyBscFaults, { rules: [rule] });
    expect(result).toEqual({ rules: 1 });
    expect(calls).toEqual([
      { fn: "setFaults", args: { ns: fakeBscNamespaceFor(USER_B, CLOUD_URL), rules: [rule] } },
    ]);
  });

  test("throws when the fake refuses the rules", async () => {
    useFakeEnv();
    nextResult = FAILED;
    const t = convexTest(schema, modules);
    await expect(t.withIdentity({ subject: USER_A }).action(api.testing.setMyBscFaults, { rules: [rule] })).rejects.toThrow(
      /did not set the fault rules/,
    );
  });

  test("refuses off a testing deployment, an anonymous caller, and a deployment on the real BSC", async () => {
    const t = convexTest(schema, modules);
    await expect(t.withIdentity({ subject: USER_A }).action(api.testing.setMyBscFaults, { rules: [rule] })).rejects.toThrow(
      /not enabled/,
    );
    vi.stubEnv("TESTING_RESET_SECRET", "test-enabled");
    await expect(t.action(api.testing.setMyBscFaults, { rules: [rule] })).rejects.toThrow(/Not authenticated/);
    await expect(t.withIdentity({ subject: USER_A }).action(api.testing.setMyBscFaults, { rules: [rule] })).rejects.toThrow(
      /real BuySportsCards/,
    );
    expect(calls).toEqual([]);
  });

  test.each([
    ["no rules", []],
    ["too many rules", Array.from({ length: MAX_FAKE_BSC_FAULT_RULES + 1 }, () => rule)],
    ["a delay with no delayMs", [{ ...rule, kind: "delay" as const }]],
    ["a path that climbs out", [{ ...rule, match: { ...rule.match, pathTemplate: "seller/../__fake/reset-all" } }]],
    ["a full URL", [{ ...rule, match: { ...rule.match, pathTemplate: "https://example.com/x" } }]],
    ["a scheme-relative path", [{ ...rule, match: { ...rule.match, pathTemplate: "seller//example.com" } }]],
    ["a TTL past an hour", [{ ...rule, ttlS: 3_601 }]],
    ["a fractional delay", [{ ...rule, kind: "delay" as const, delayMs: 1.5 }]],
    ["a card id that is not one", [{ ...rule, match: { ...rule.match, cardId: "a b" } }]],
  ])("refuses %s and sends nothing", async (_label, rules) => {
    useFakeEnv();
    const t = convexTest(schema, modules);
    await expect(t.withIdentity({ subject: USER_A }).action(api.testing.setMyBscFaults, { rules })).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe("addMyBscOrder", () => {
  const order = {
    orderNo: "T-1",
    status: "READY_TO_SHIP",
    items: [{ cardId: "96f9a87adeb7d02c", condition: "nm", quantity: 1, priceCents: 150 }],
  };

  test("adds the order to the caller's own namespace", async () => {
    useFakeEnv();
    const t = convexTest(schema, modules);
    const result = await t.withIdentity({ subject: USER_A }).action(api.testing.addMyBscOrder, { order });
    expect(result).toEqual({ items: 1 });
    expect(calls).toEqual([{ fn: "addOrder", args: { ns: fakeBscNamespaceFor(USER_A, CLOUD_URL), order } }]);
  });

  test("throws when the fake refuses the order", async () => {
    useFakeEnv();
    nextResult = FAILED;
    const t = convexTest(schema, modules);
    await expect(t.withIdentity({ subject: USER_A }).action(api.testing.addMyBscOrder, { order })).rejects.toThrow(
      /did not add the order/,
    );
  });

  test("refuses off a testing deployment, an anonymous caller, and a deployment on the real BSC", async () => {
    const t = convexTest(schema, modules);
    await expect(t.withIdentity({ subject: USER_A }).action(api.testing.addMyBscOrder, { order })).rejects.toThrow(
      /not enabled/,
    );
    vi.stubEnv("TESTING_RESET_SECRET", "test-enabled");
    await expect(t.action(api.testing.addMyBscOrder, { order })).rejects.toThrow(/Not authenticated/);
    await expect(t.withIdentity({ subject: USER_A }).action(api.testing.addMyBscOrder, { order })).rejects.toThrow(
      /real BuySportsCards/,
    );
    expect(calls).toEqual([]);
  });

  test.each([
    ["no items", { ...order, items: [] }],
    ["a zero quantity", { ...order, items: [{ ...order.items[0], quantity: 0 }] }],
    ["a blank condition", { ...order, items: [{ ...order.items[0], condition: " " }] }],
    ["an order number past BSC's bound", { ...order, orderNo: "x".repeat(65) }],
    ["fractional cents", { ...order, items: [{ ...order.items[0], priceCents: 1.5 }] }],
  ])("refuses %s and sends nothing", async (_label, bad) => {
    useFakeEnv();
    const t = convexTest(schema, modules);
    await expect(t.withIdentity({ subject: USER_A }).action(api.testing.addMyBscOrder, { order: bad })).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe("clearMyBscFaults", () => {
  test("sends the caller's own namespace an empty rule list, and nothing else", async () => {
    useFakeEnv();
    const t = convexTest(schema, modules);
    expect(await t.withIdentity({ subject: USER_B }).action(api.testing.clearMyBscFaults, {})).toEqual({ cleared: true });
    expect(calls).toEqual([{ fn: "setFaults", args: { ns: fakeBscNamespaceFor(USER_B, CLOUD_URL), rules: [] } }]);
  });

  test("throws when the fake does not answer, so a spec's teardown goes red", async () => {
    useFakeEnv();
    nextResult = FAILED;
    const t = convexTest(schema, modules);
    await expect(t.withIdentity({ subject: USER_A }).action(api.testing.clearMyBscFaults, {})).rejects.toThrow(
      /did not clear the fault rules/,
    );
  });

  test("refuses off a testing deployment, an anonymous caller, and a deployment on the real BSC", async () => {
    const t = convexTest(schema, modules);
    await expect(t.withIdentity({ subject: USER_A }).action(api.testing.clearMyBscFaults, {})).rejects.toThrow(/not enabled/);
    vi.stubEnv("TESTING_RESET_SECRET", "test-enabled");
    await expect(t.action(api.testing.clearMyBscFaults, {})).rejects.toThrow(/Not authenticated/);
    await expect(t.withIdentity({ subject: USER_A }).action(api.testing.clearMyBscFaults, {})).rejects.toThrow(
      /real BuySportsCards/,
    );
    expect(calls).toEqual([]);
  });
});

describe("clearBscCallGate", () => {
  const gateRows = (t: ReturnType<typeof convexTest>) =>
    t.run(async (ctx) => ctx.db.query("marketplaceCallGates").collect());
  const openGate = (t: ReturnType<typeof convexTest>, scope: string) =>
    t.run(async (ctx) => {
      await ctx.db.insert("marketplaceCallGates", {
        platform: "bsc",
        scope,
        tokens: 0,
        refilledAt: Date.now(),
        openUntil: Date.now() + 60_000,
        openCause: "429",
        streak: 1,
        lastOpenedAt: Date.now(),
        consecutiveFailures: 0,
        lastFailureAt: 0,
        updatedAt: Date.now(),
      });
    });
  const gateKeyOf = (userId: string) => `ns:${fakeBscNamespaceFor(userId, CLOUD_URL)}`;

  test("clears the CALLER's own gate on the fake, and only that one", async () => {
    useFakeEnv();
    const t = convexTest(schema, modules);
    await openGate(t, gateKeyOf(USER_A));
    await openGate(t, gateKeyOf(USER_B));
    await openGate(t, "deployment");
    expect(await gateRows(t)).toHaveLength(3);
    expect(await t.withIdentity({ subject: USER_A }).action(api.testing.clearBscCallGate, {})).toEqual({ deleted: 1 });
    expect((await gateRows(t)).map((r) => r.scope).sort()).toEqual([gateKeyOf(USER_B), "deployment"].sort());
    // Again: nothing of the caller's left.
    expect(await t.withIdentity({ subject: USER_A }).action(api.testing.clearBscCallGate, {})).toEqual({ deleted: 0 });
    expect(await gateRows(t)).toHaveLength(2);
    // The gate is not the fake's: nothing is sent to it.
    expect(calls).toEqual([]);
  });

  test("refuses off a testing deployment, an anonymous caller, and a deployment on the real BSC, and leaves the gate", async () => {
    const t = convexTest(schema, modules);
    await openGate(t, "deployment");
    await expect(t.withIdentity({ subject: USER_A }).action(api.testing.clearBscCallGate, {})).rejects.toThrow(/not enabled/);
    vi.stubEnv("TESTING_RESET_SECRET", "test-enabled");
    await expect(t.action(api.testing.clearBscCallGate, {})).rejects.toThrow(/Not authenticated/);
    await expect(t.withIdentity({ subject: USER_A }).action(api.testing.clearBscCallGate, {})).rejects.toThrow(
      /real BuySportsCards/,
    );
    expect(await gateRows(t)).toHaveLength(1);
  });

  test("resetMyTestState clears the caller's gate row with their namespace, not another user's", async () => {
    useFakeEnv();
    const t = convexTest(schema, modules);
    await openGate(t, gateKeyOf(USER_A));
    await openGate(t, gateKeyOf(USER_B));
    await openGate(t, "deployment");

    await t.withIdentity({ subject: USER_A }).action(api.testing.resetMyTestState, {});

    expect((await gateRows(t)).map((r) => r.scope).sort()).toEqual([gateKeyOf(USER_B), "deployment"].sort());
    expect(calls).toEqual([{ fn: "resetNamespace", args: { ns: fakeBscNamespaceFor(USER_A, CLOUD_URL) } }]);
  });

  test("resetMyTestState on a misconfigured fake does not throw over the gate row, and leaves every row alone", async () => {
    vi.stubEnv("TESTING_RESET_SECRET", "test-enabled");
    vi.stubEnv("CONVEX_CLOUD_URL", CLOUD_URL);
    vi.stubEnv("NEONBINDER_FAKE_BSC_KEY", "caller-key");
    // Not the pinned neonbinder-fake-bsc-* host: misconfigured, not fake.
    vi.stubEnv("NEONBINDER_BSC_API_BASE", "https://evil.example.com");
    expect(resolveBscTarget(process.env).mode).toBe("misconfigured");
    const t = convexTest(schema, modules);
    await openGate(t, gateKeyOf(USER_A));
    await openGate(t, "deployment");

    await expect(t.withIdentity({ subject: USER_A }).action(api.testing.resetMyTestState, {})).resolves.toBeDefined();

    expect(await gateRows(t)).toHaveLength(2);
  });

  test("resetMyTestState on the real BSC touches no gate row", async () => {
    vi.stubEnv("TESTING_RESET_SECRET", "test-enabled");
    const t = convexTest(schema, modules);
    await openGate(t, "deployment");
    await t.withIdentity({ subject: USER_A }).action(api.testing.resetMyTestState, {});
    expect(await gateRows(t)).toHaveLength(1);
  });
});

describe("resetFakeBscForDeploymentFromCli", () => {
  test("clears every account under this deployment's prefix", async () => {
    useFakeEnv();
    const t = convexTest(schema, modules);
    const result = await t.action(internal.testing.resetFakeBscForDeploymentFromCli, {});
    expect(result).toEqual({ fake: true, prefix: PREFIX });
    expect(calls).toEqual([{ fn: "resetPrefix", args: { prefix: PREFIX } }]);
  });

  test("sends nothing on a deployment on the real BSC, or one without the testing flag", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("TESTING_RESET_SECRET", "test-enabled");
    expect(await t.action(internal.testing.resetFakeBscForDeploymentFromCli, {})).toEqual({ fake: false });
    useFakeEnv();
    vi.stubEnv("TESTING_RESET_SECRET", "");
    expect(await t.action(internal.testing.resetFakeBscForDeploymentFromCli, {})).toEqual({ fake: false });
    expect(calls).toEqual([]);
  });

  test("fails when the fake does not answer, so the scripted reset fails", async () => {
    useFakeEnv();
    nextResult = FAILED;
    const t = convexTest(schema, modules);
    await expect(t.action(internal.testing.resetFakeBscForDeploymentFromCli, {})).rejects.toThrow(/fake did not answer/);
  });
});
