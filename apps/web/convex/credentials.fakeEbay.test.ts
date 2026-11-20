/**
 * NEO-555 — the fake eBay in credentials.ts:
 *
 *   - `credKey("ebay", …)` names the deployment on a deployment that asked for
 *     the fake eBay (`ebay-credentials-fake-<slug>-<userId>`) and is the bare
 *     key everywhere else, production included.
 *   - a fake-eBay deployment sends no eBay credential call to a browser
 *     service whose `/health` does not say `ebayFake: true`.
 *   - HARD CONDITION (B1 security audit): connect keeps a session only when
 *     the service's `environment` echo is this deployment's own. `"fake"` is
 *     expected in fake mode and ONLY there; a sandbox or production deployment
 *     (a bare key) discards a `"fake"` echo, and a fake deployment discards
 *     anything but `"fake"`.
 *   - `deleteFakeSessionsFromCli` deletes eBay fake keys too, with per-site
 *     counts, and nothing outside fake mode.
 *
 * The browser service is stubbed; nothing leaves the process.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import {
  __resetContractCache,
  credKey,
  expectedConnectEnvironment,
  fakeEbayCredentialKeyFor,
} from "./credentials";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const USER = "user_2fakeEbayAbc123";
const OTHER_USER = "user_2fakeEbayDef456";
const CLOUD_URL = "https://happy-otter-123.convex.cloud";
const OTHER_CLOUD_URL = "https://sad-badger-456.convex.cloud";
const FAKE_BASE = "https://neonbinder-fake-bsc-0000-uc.a.run.app";
/** services/browser/src/services/secrets-manager.ts */
const KEY_PATTERN = /^[a-z0-9]+-credentials-[a-zA-Z0-9_-]+$/;
const FAKE_HEALTH = { status: "ok", contractVersion: 1, bscTarget: "fake", ebayFake: true };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A fully wired fake deployment: fake BSC, fake eBay, testing flag. */
function armFake(cloudUrl = CLOUD_URL) {
  vi.stubEnv("NEONBINDER_BSC_API_BASE", FAKE_BASE);
  vi.stubEnv("NEONBINDER_FAKE_BSC_KEY", "caller-key");
  vi.stubEnv("TESTING_RESET_SECRET", "armed");
  vi.stubEnv("CONVEX_CLOUD_URL", cloudUrl);
  vi.stubEnv("EBAY_ENVIRONMENT", "fake");
  vi.stubEnv("EBAY_CLIENT_ID", "");
  vi.stubEnv("EBAY_RU_NAME", "");
}

/** A sandbox deployment: a bare key, no fake anywhere. */
function armSandbox() {
  vi.stubEnv("EBAY_ENVIRONMENT", "sandbox");
  vi.stubEnv("EBAY_CLIENT_ID", "cid");
  vi.stubEnv("EBAY_RU_NAME", "ru");
  vi.stubEnv("TESTING_RESET_SECRET", "armed");
  vi.stubEnv("CONVEX_CLOUD_URL", CLOUD_URL);
}

type Asked = { method: string; path: string; body: unknown };

/**
 * Serves /health with `health`, the connect route with `connectAnswer`, token
 * and delete; records the rest.
 */
function stubBrowser(
  health: Record<string, unknown>,
  opts: { connectAnswer?: Record<string, unknown>; deleteStatus?: number } = {},
) {
  const asked: Asked[] = [];
  vi.stubGlobal("fetch", (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = init?.method ?? "GET";
    if (u.pathname === "/health") return json(health);
    asked.push({ method, path: u.pathname, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (u.pathname === "/oauth/ebay/connect") {
      return json(opts.connectAnswer ?? { username: "slabking", ebayUserId: "EB-9", environment: "fake", expiresAt: 1 });
    }
    if (u.pathname === "/oauth/ebay/refresh") return json({ token: "tok", expiresAt: Date.now() + 3_600_000 });
    if (u.pathname.endsWith("/token")) return json({ token: "tok", expiresAt: Date.now() + 3_600_000 });
    if (method === "DELETE") {
      const status = opts.deleteStatus ?? 200;
      return status === 200 ? json({ success: true }) : json({ error: "nope" }, status);
    }
    throw new Error(`unexpected fetch: ${method} ${u.pathname}`);
  }) as typeof fetch);
  return asked;
}

let errors: string[];
let logs: string[];
beforeEach(() => {
  __resetContractCache();
  errors = [];
  logs = [];
  vi.stubEnv("NEONBINDER_BROWSER_URL", "http://localhost:9999");
  vi.stubEnv("NEONBINDER_PAUSED_PLATFORMS", "");
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logs.push(String(line));
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    errors.push(String(line));
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const parsed = (lines: string[]) =>
  lines.flatMap((line) => {
    try {
      return [JSON.parse(line) as Record<string, unknown>];
    } catch {
      return [];
    }
  });

describe("credKey for eBay", () => {
  test("fake mode: the eBay key names the deployment, so two deployments get two keys", () => {
    armFake(CLOUD_URL);
    const here = credKey("ebay", USER);
    armFake(OTHER_CLOUD_URL);
    const there = credKey("ebay", USER);

    expect(here).toBe(`ebay-credentials-fake-happy-otter-123-${USER}`);
    expect(there).toBe(`ebay-credentials-fake-sad-badger-456-${USER}`);
    expect(here).toBe(fakeEbayCredentialKeyFor(USER, CLOUD_URL));
    expect(here).toMatch(KEY_PATTERN);
    expect(there).toMatch(KEY_PATTERN);
  });

  test("an unusable fake setup still names the fake key, never a bare one", () => {
    armFake();
    vi.stubEnv("NEONBINDER_FAKE_BSC_KEY", "");
    expect(credKey("ebay", USER)).toBe(`ebay-credentials-fake-happy-otter-123-${USER}`);
    vi.stubEnv("TESTING_RESET_SECRET", "");
    expect(credKey("ebay", USER)).toBe(`ebay-credentials-fake-happy-otter-123-${USER}`);
  });

  test.each([
    ["sandbox", "sandbox"],
    ["production", "production"],
    ["unset", ""],
  ])("eBay on %s: the bare key, byte for byte", (_name, environment) => {
    armSandbox();
    vi.stubEnv("EBAY_ENVIRONMENT", environment);
    expect(credKey("ebay", USER)).toBe(`ebay-credentials-${USER}`);
  });

  test("fake mode leaves the other sites alone (BSC keeps its own fake form)", () => {
    armFake();
    expect(credKey("sportlots", USER)).toBe(`sportlots-credentials-${USER}`);
    expect(credKey("easypost", USER)).toBe(`easypost-credentials-${USER}`);
    expect(credKey("buysportscards", USER)).toBe(`buysportscards-credentials-fake-happy-otter-123-${USER}`);
  });

  test("fake mode with no CONVEX_CLOUD_URL names no eBay key at all", () => {
    armFake();
    vi.stubEnv("CONVEX_CLOUD_URL", "");
    expect(() => credKey("ebay", USER)).toThrow(/CONVEX_CLOUD_URL/);
  });
});

describe("fake mode refuses a browser service that does not say ebayFake", () => {
  const connect = (t: ReturnType<typeof convexTest>) =>
    t.action(internal.credentials.connectEbay, { userId: USER, listing: "testOff", code: "c1" });

  for (const [label, health, reported] of [
    ["an older revision with no ebayFake", { status: "ok", contractVersion: 1, bscTarget: "fake" }, "missing"],
    ["a revision that says ebayFake false", { status: "ok", contractVersion: 1, bscTarget: "fake", ebayFake: false }, "false"],
    ["a revision that says something else", { status: "ok", contractVersion: 1, bscTarget: "fake", ebayFake: "yes" }, "missing"],
  ] as const) {
    test(`${label}: nothing is sent to the eBay routes and the refusal is named`, async () => {
      armFake();
      const asked = stubBrowser(health);
      const t = convexTest(schema, modules);

      expect(await connect(t)).toEqual({ ok: false, error: "unavailable" });
      expect(asked).toEqual([]);
      const line = parsed(errors).find((e) => e.msg === "fake_ebay_browser_not_fake");
      expect(line).toMatchObject({ platform: "ebay", reported });
      // The route is logged as a template: no key, so no user id.
      expect(JSON.stringify(parsed(errors))).not.toContain(USER);
    });
  }

  test("the refresh route and the stored-session routes are held back too", async () => {
    armFake();
    const asked = stubBrowser({ status: "ok", contractVersion: 1, bscTarget: "fake" });
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("userProfiles", {
        userId: USER,
        siteCredentials: [{ site: "ebay", hasCredentials: true, lastUpdated: "2020-01-01T00:00:00.000Z" }],
      } as never);
    });

    expect(await t.action(internal.credentials.refreshSiteTokenForUser, { site: "ebay", userId: USER })).toEqual({
      refreshed: false,
    });
    expect(await t.action(internal.credentials.getSiteTokenForUser, { site: "ebay", userId: USER })).toBeNull();
    expect(asked).toEqual([]);
  });

  test("a fake-aware revision is let through, on this deployment's own key", async () => {
    armFake();
    const asked = stubBrowser(FAKE_HEALTH);
    const t = convexTest(schema, modules);
    expect(await connect(t)).toMatchObject({ ok: true, ebayUserId: "EB-9" });
    expect(asked[0]).toMatchObject({
      method: "POST",
      path: "/oauth/ebay/connect",
      body: { key: fakeEbayCredentialKeyFor(USER, CLOUD_URL), code: "c1" },
    });
    expect(parsed(errors).find((e) => e.msg === "fake_ebay_browser_not_fake")).toBeUndefined();
  });

  test("outside fake mode a revision without ebayFake works as before, on the bare key", async () => {
    armSandbox();
    const asked = stubBrowser(
      { status: "ok", contractVersion: 1 },
      { connectAnswer: { username: "slabking", ebayUserId: "EB-9", environment: "sandbox", expiresAt: 1 } },
    );
    const t = convexTest(schema, modules);
    expect(await connect(t)).toMatchObject({ ok: true });
    expect(asked[0]).toMatchObject({ path: "/oauth/ebay/connect", body: { key: `ebay-credentials-${USER}` } });
    expect(parsed(errors).find((e) => e.msg === "fake_ebay_browser_not_fake")).toBeUndefined();
  });
});

// The B1 security audit's condition: the connect answer's `environment` is
// compared strictly. "fake" is expected in fake mode only.
describe("connect environment echo (hard condition)", () => {
  const connect = (t: ReturnType<typeof convexTest>) =>
    t.action(internal.credentials.connectEbay, { userId: USER, listing: "testOff", code: "c1" });

  const connectCalls = (asked: Asked[]) => asked.filter((a) => a.path === "/oauth/ebay/connect");
  const deletes = (asked: Asked[]) => asked.filter((a) => a.method === "DELETE");

  async function noTrace(t: ReturnType<typeof convexTest>) {
    expect(await t.run(async (ctx) => (await ctx.db.query("userProfiles").first())?.marketplaceAccountIds?.ebayUserId ?? null)).toBeNull();
    expect(await t.run(async (ctx) => await ctx.db.query("ebaySellerSettings").collect())).toEqual([]);
    expect(
      await t.run(async (ctx) =>
        (await ctx.db.query("userProfiles").first())?.siteCredentials?.find((c: { site: string }) => c.site === "ebay")?.hasCredentials ?? false,
      ),
    ).toBeFalsy();
  }

  test("fake mode expects \"fake\": the echo is accepted and the connection recorded", async () => {
    armFake();
    const asked = stubBrowser(FAKE_HEALTH, {
      connectAnswer: { username: "slabking", ebayUserId: "EB-9", environment: "fake", expiresAt: 1 },
    });
    const t = convexTest(schema, modules);
    expect(await connect(t)).toEqual({ ok: true, username: "slabking", ebayUserId: "EB-9" });
    expect(deletes(asked)).toEqual([]);
    expect(await t.run(async (ctx) => await ctx.db.query("ebaySellerSettings").collect())).toHaveLength(1);
  });

  test.each([
    ["production", { environment: "production" }],
    ["sandbox", { environment: "sandbox" }],
    ["no environment", {}],
    ["a non-string", { environment: true }],
    ["a different case", { environment: "FAKE" }],
  ])("fake mode refuses %s: the stored session is discarded and nothing is recorded", async (_name, extra) => {
    armFake();
    const asked = stubBrowser(FAKE_HEALTH, { connectAnswer: { username: "slabking", ebayUserId: "EB-9", expiresAt: 1, ...extra } });
    const t = convexTest(schema, modules);
    expect(await connect(t)).toEqual({ ok: false, error: "environmentMismatch" });
    expect(connectCalls(asked)).toHaveLength(1);
    expect(deletes(asked)).toHaveLength(1);
    expect(deletes(asked)[0].path).toBe(`/credentials/${fakeEbayCredentialKeyFor(USER, CLOUD_URL)}`);
    await noTrace(t);
  });

  for (const environment of ["sandbox", "production"] as const) {
    test(`a ${environment} deployment (bare key) refuses a "fake" echo: discarded, nothing recorded`, async () => {
      armSandbox();
      vi.stubEnv("EBAY_ENVIRONMENT", environment);
      const asked = stubBrowser(
        { status: "ok", contractVersion: 1 },
        { connectAnswer: { username: "slabking", ebayUserId: "EB-9", environment: "fake", expiresAt: 1 } },
      );
      const t = convexTest(schema, modules);
      expect(await connect(t)).toEqual({ ok: false, error: "environmentMismatch" });
      // The bare key went out, and the same bare key is what is discarded.
      expect(connectCalls(asked)[0].body).toMatchObject({ key: `ebay-credentials-${USER}` });
      expect(deletes(asked)).toHaveLength(1);
      expect(deletes(asked)[0].path).toBe(`/credentials/ebay-credentials-${USER}`);
      await noTrace(t);
    });

    test(`a ${environment} deployment still accepts its own environment`, async () => {
      armSandbox();
      vi.stubEnv("EBAY_ENVIRONMENT", environment);
      stubBrowser(
        { status: "ok", contractVersion: 1 },
        { connectAnswer: { username: "slabking", ebayUserId: "EB-9", environment, expiresAt: 1 } },
      );
      const t = convexTest(schema, modules);
      expect(await connect(t)).toMatchObject({ ok: true });
    });
  }

  test("a deployment that asked for the fake but cannot have it is not configured, and never accepts a \"fake\" echo as sandbox", async () => {
    armFake();
    // Sandbox wiring beside an unusable fake request must not be picked up.
    vi.stubEnv("EBAY_CLIENT_ID", "cid");
    vi.stubEnv("EBAY_RU_NAME", "ru");
    vi.stubEnv("TESTING_RESET_SECRET", "");
    const asked = stubBrowser(FAKE_HEALTH);
    const t = convexTest(schema, modules);
    expect(await connect(t)).toEqual({ ok: false, error: "notConfigured" });
    expect(asked).toEqual([]);
  });

  test("expectedConnectEnvironment is the config's own environment, nothing looser", () => {
    expect(expectedConnectEnvironment({ environment: "fake" })).toBe("fake");
    expect(expectedConnectEnvironment({ environment: "sandbox" })).toBe("sandbox");
    expect(expectedConnectEnvironment({ environment: "production" })).toBe("production");
  });
});

describe("deleteFakeSessionsFromCli (eBay)", () => {
  async function seeded(userIds: string[] = [USER]) {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (const userId of userIds) {
        await ctx.db.insert("userProfiles", {
          userId,
          siteCredentials: [
            { site: "buysportscards", hasCredentials: true, lastUpdated: "2020-01-01T00:00:00.000Z" },
            { site: "ebay", hasCredentials: true, lastUpdated: "2020-01-01T00:00:00.000Z" },
          ],
        } as never);
      }
    });
    return t;
  }

  test("deletes this deployment's fake keys for BOTH sites, one per user, and reports counts per site", async () => {
    armFake();
    const asked = stubBrowser(FAKE_HEALTH);
    const t = await seeded([USER, OTHER_USER]);

    const result = await t.action(internal.credentials.deleteFakeSessionsFromCli, {});

    expect(result).toEqual({
      fake: true,
      bsc: { users: 2, deleted: 2, failed: 0, truncated: false },
      ebay: { users: 2, deleted: 2, failed: 0, truncated: false },
    });
    expect(asked.map(({ method }) => method)).toEqual(["DELETE", "DELETE", "DELETE", "DELETE"]);
    const ebayPaths = asked.map(({ path }) => path).filter((p) => p.includes("/ebay-credentials-"));
    expect(ebayPaths.sort()).toEqual(
      [
        `/credentials/ebay-credentials-fake-happy-otter-123-${USER}`,
        `/credentials/ebay-credentials-fake-happy-otter-123-${OTHER_USER}`,
      ].sort(),
    );
    for (const { path } of asked) {
      expect(path).toMatch(/^\/credentials\/(buysportscards|ebay)-credentials-fake-happy-otter-123-/);
      expect(path).not.toContain("sad-badger-456");
    }
    const flags = await t.run(async (ctx) =>
      (await ctx.db.query("userProfiles").collect()).flatMap((row) => (row.siteCredentials ?? []).map((c) => c.hasCredentials)),
    );
    expect(flags.every((f) => f === false)).toBe(true);
    // Counts only: no id or key in the log lines.
    const lines = parsed(logs).filter((e) => e.msg === "fake_session_cleanup");
    expect(lines.map((l) => l.platform).sort()).toEqual(["buysportscards", "ebay"]);
    expect(JSON.stringify(lines)).not.toContain(USER);
  });

  test("eBay in fake mode but BSC on the real site: only the eBay key is deleted, no bsc object", async () => {
    armFake();
    vi.stubEnv("NEONBINDER_BSC_API_BASE", "");
    // The eBay fake needs the fake BSC target; without it eBay is "not configured"
    // but the session keys are still the fake form, and still this deployment's.
    const asked = stubBrowser(FAKE_HEALTH);
    const t = await seeded();

    const result = await t.action(internal.credentials.deleteFakeSessionsFromCli, {});

    expect(result).toEqual({ fake: true, ebay: { users: 1, deleted: 1, failed: 0, truncated: false } });
    expect(asked.map(({ path }) => path)).toEqual([`/credentials/ebay-credentials-fake-happy-otter-123-${USER}`]);
  });

  test("BSC fake but eBay on the sandbox: no ebay object, and no bare eBay key is ever deleted", async () => {
    armFake();
    vi.stubEnv("EBAY_ENVIRONMENT", "sandbox");
    vi.stubEnv("EBAY_CLIENT_ID", "cid");
    vi.stubEnv("EBAY_RU_NAME", "ru");
    const asked = stubBrowser(FAKE_HEALTH);
    const t = await seeded();

    const result = await t.action(internal.credentials.deleteFakeSessionsFromCli, {});

    expect(result).toEqual({ fake: true, bsc: { users: 1, deleted: 1, failed: 0, truncated: false } });
    expect(asked.some(({ path }) => path.includes("ebay-credentials"))).toBe(false);
  });

  test("a user id that would walk the path onto another key sends nothing for eBay either", async () => {
    armFake();
    const asked = stubBrowser(FAKE_HEALTH);
    const t = await seeded(["a/../../credentials/x", "user_ok.dot", USER]);

    const result = await t.action(internal.credentials.deleteFakeSessionsFromCli, {});

    expect(result).toMatchObject({
      fake: true,
      bsc: { users: 3, deleted: 1, failed: 2 },
      ebay: { users: 3, deleted: 1, failed: 2 },
    });
    expect(asked.map(({ path }) => path).sort()).toEqual(
      [
        `/credentials/buysportscards-credentials-fake-happy-otter-123-${USER}`,
        `/credentials/ebay-credentials-fake-happy-otter-123-${USER}`,
      ].sort(),
    );
  });

  test("a failed eBay delete is counted, not thrown, and keeps the eBay flag", async () => {
    armFake();
    stubBrowser(FAKE_HEALTH, { deleteStatus: 500 });
    const t = await seeded();

    const result = await t.action(internal.credentials.deleteFakeSessionsFromCli, {});

    expect(result).toMatchObject({ fake: true, ebay: { users: 1, deleted: 0, failed: 1, truncated: false } });
    const flag = await t.run(async (ctx) =>
      (await ctx.db.query("userProfiles").first())?.siteCredentials?.find((c) => c.site === "ebay")?.hasCredentials,
    );
    expect(flag).toBe(true);
  });

  test("an already-gone eBay key (404) counts as deleted", async () => {
    armFake();
    stubBrowser(FAKE_HEALTH, { deleteStatus: 404 });
    const result = await (await seeded()).action(internal.credentials.deleteFakeSessionsFromCli, {});
    expect(result).toMatchObject({ fake: true, ebay: { users: 1, deleted: 1, failed: 0 } });
  });

  test("a browser service that does not say ebayFake gets no eBay delete", async () => {
    armFake();
    const asked = stubBrowser({ status: "ok", contractVersion: 1, bscTarget: "fake" });
    const result = await (await seeded()).action(internal.credentials.deleteFakeSessionsFromCli, {});
    expect(result).toMatchObject({
      fake: true,
      bsc: { deleted: 1, failed: 0 },
      ebay: { users: 1, deleted: 0, failed: 1 },
    });
    expect(asked.some(({ path }) => path.includes("ebay-credentials"))).toBe(false);
  });

  test("outside fake mode (sandbox eBay, real BSC): deletes nothing, sends nothing", async () => {
    armSandbox();
    const asked = stubBrowser(FAKE_HEALTH);
    const t = await seeded();
    expect(await t.action(internal.credentials.deleteFakeSessionsFromCli, {})).toEqual({ fake: false });
    expect(asked).toEqual([]);
  });

  test("in production (no testing flag), even with every fake variable set", async () => {
    armFake();
    vi.stubEnv("TESTING_RESET_SECRET", "");
    const asked = stubBrowser(FAKE_HEALTH);
    const t = await seeded();
    expect(await t.action(internal.credentials.deleteFakeSessionsFromCli, {})).toEqual({ fake: false });
    expect(asked).toEqual([]);
  });

  test("a fake deployment with no CONVEX_CLOUD_URL deletes nothing", async () => {
    armFake();
    vi.stubEnv("CONVEX_CLOUD_URL", "");
    const asked = stubBrowser(FAKE_HEALTH);
    await expect((await seeded()).action(internal.credentials.deleteFakeSessionsFromCli, {})).rejects.toThrow(
      /CONVEX_CLOUD_URL/,
    );
    expect(asked).toEqual([]);
  });
});
