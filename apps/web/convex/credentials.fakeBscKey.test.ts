/**
 * NEO-552 — per-deployment browser-service keys for fake BSC sessions.
 *
 *   - `credKey("buysportscards", …)` names the deployment on a fake deployment
 *     (`buysportscards-credentials-fake-<slug>-<userId>`) and is the bare
 *     per-user key everywhere else, production included. Other sites never
 *     change.
 *   - A fake deployment sends no BSC credential call to a browser service
 *     whose `/health` does not say `bscTarget: "fake"`.
 *   - `deleteFakeSessionsFromCli` deletes only this deployment's fake keys,
 *     and nothing outside fake mode (NEO-555: BSC here, eBay in
 *     `credentials.fakeEbay.test.ts`).
 *
 * The browser service is stubbed; nothing leaves the process.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { __resetContractCache, __resetFakeBscSessionCheck, credKey } from "./credentials";
import { fakeBscCredentialKeyFor, fakeBscUsernameFor } from "./testing";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const USER = "user_2fakeKeyAbc123";
const OTHER_USER = "user_2fakeKeyDef456";
const CLOUD_URL = "https://happy-otter-123.convex.cloud";
const OTHER_CLOUD_URL = "https://sad-badger-456.convex.cloud";
const FAKE_BASE = "https://neonbinder-fake-bsc-0000-uc.a.run.app";
/** services/browser/src/services/secrets-manager.ts */
const KEY_PATTERN = /^[a-z0-9]+-credentials-[a-zA-Z0-9_-]+$/;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function armFake(cloudUrl = CLOUD_URL) {
  vi.stubEnv("NEONBINDER_BSC_API_BASE", FAKE_BASE);
  vi.stubEnv("NEONBINDER_FAKE_BSC_KEY", "caller-key");
  vi.stubEnv("TESTING_RESET_SECRET", "armed");
  vi.stubEnv("CONVEX_CLOUD_URL", cloudUrl);
}

/** Like production: the fake base may be set, but the testing flag never is. */
function armProd() {
  vi.stubEnv("NEONBINDER_BSC_API_BASE", FAKE_BASE);
  vi.stubEnv("NEONBINDER_FAKE_BSC_KEY", "caller-key");
  vi.stubEnv("TESTING_RESET_SECRET", "");
  vi.stubEnv("CONVEX_CLOUD_URL", CLOUD_URL);
}

type Asked = { method: string; path: string };

/** Serves /health (with `health` as its body), metadata, token, login and delete; records the rest. */
function stubBrowser(health: Record<string, unknown>, opts: { deleteStatus?: number; username?: string } = {}) {
  const asked: Asked[] = [];
  vi.stubGlobal("fetch", (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = init?.method ?? "GET";
    if (u.pathname === "/health") return json(health);
    asked.push({ method, path: u.pathname });
    if (u.pathname.endsWith("/metadata")) {
      return json({ username: opts.username ?? fakeBscUsernameFor(USER, CLOUD_URL), hasToken: true });
    }
    if (u.pathname.endsWith("/token")) return json({ token: "tok", expiresAt: Date.now() + 60 * 60 * 1000 });
    if (u.pathname.startsWith("/login/")) return json({ success: true, message: "ok", storeName: "Store" });
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
  __resetFakeBscSessionCheck();
  errors = [];
  logs = [];
  vi.stubEnv("NEONBINDER_BROWSER_URL", "http://localhost:9999");
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

describe("credKey", () => {
  test("fake mode: the BSC key names the deployment, so two deployments get two keys", () => {
    armFake(CLOUD_URL);
    const here = credKey("buysportscards", USER);
    armFake(OTHER_CLOUD_URL);
    const there = credKey("buysportscards", USER);

    expect(here).toBe(`buysportscards-credentials-fake-happy-otter-123-${USER}`);
    expect(there).toBe(`buysportscards-credentials-fake-sad-badger-456-${USER}`);
    expect(here).not.toBe(there);
    expect(here).toBe(fakeBscCredentialKeyFor(USER, CLOUD_URL));
    expect(here).toMatch(KEY_PATTERN);
    expect(there).toMatch(KEY_PATTERN);
  });

  test("production (no testing flag, even with the fake base set): the bare key, byte for byte", () => {
    armProd();
    expect(credKey("buysportscards", USER)).toBe(`buysportscards-credentials-${USER}`);
  });

  test("a test deployment on the real BSC (no fake base): the bare key", () => {
    vi.stubEnv("TESTING_RESET_SECRET", "armed");
    vi.stubEnv("CONVEX_CLOUD_URL", CLOUD_URL);
    expect(credKey("buysportscards", USER)).toBe(`buysportscards-credentials-${USER}`);
  });

  test("fake BSC mode alone leaves SportLots, eBay and EasyPost keys unchanged (eBay has its own switch)", () => {
    armFake();
    expect(credKey("sportlots", USER)).toBe(`sportlots-credentials-${USER}`);
    expect(credKey("ebay", USER)).toBe(`ebay-credentials-${USER}`);
    expect(credKey("easypost", USER)).toBe(`easypost-credentials-${USER}`);
  });

  test("fake mode with no CONVEX_CLOUD_URL names no key at all", () => {
    armFake();
    vi.stubEnv("CONVEX_CLOUD_URL", "");
    expect(() => credKey("buysportscards", USER)).toThrow(/CONVEX_CLOUD_URL/);
  });
});

async function seeded(userIds: string[] = [USER]) {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (const userId of userIds) {
      await ctx.db.insert("userProfiles", {
        userId,
        siteCredentials: [{ site: "buysportscards", hasCredentials: true, lastUpdated: "2020-01-01T00:00:00.000Z" }],
      });
    }
  });
  return t;
}

const tokenFor = (t: ReturnType<typeof convexTest>) =>
  t.action(internal.credentials.getSiteTokenForUser, { site: "buysportscards", userId: USER });

describe("fake mode refuses a browser service that is not on the fake", () => {
  for (const [label, health] of [
    ["an older revision with no bscTarget", { status: "ok", contractVersion: 1 }],
    ["a revision on the real BSC", { status: "ok", contractVersion: 1, bscTarget: "real" }],
  ] as const) {
    test(`${label}: no token, no BSC credential call, no login, and the refusal is named`, async () => {
      armFake();
      const asked = stubBrowser(health);
      const t = await seeded();

      expect(await tokenFor(t)).toBeNull();
      expect(asked).toEqual([]);
      const line = parsed(errors).find((e) => e.msg === "fake_bsc_browser_not_fake");
      expect(line).toMatchObject({ platform: "buysportscards", reported: "bscTarget" in health ? "real" : "missing" });
      // The route is logged as a template: no key, so no user id.
      expect(JSON.stringify(parsed(errors))).not.toContain(USER);
    });
  }

  test("a password sign-in is never sent, and the copy does not blame the password", async () => {
    armFake();
    const asked = stubBrowser({ status: "ok", contractVersion: 1 });
    const t = await seeded();

    const result = await t
      .withIdentity({ subject: USER })
      .action(api.credentials.saveCredentials, { site: "buysportscards", username: "x@fake.invalid", password: "pw" });

    expect(result.success).toBe(false);
    expect(result.message).not.toMatch(/password/i);
    expect(asked.filter(({ path }) => path.startsWith("/login/"))).toEqual([]);
    expect(asked).toEqual([]);
  });

  test("SportLots on a fake deployment is not held back by it", async () => {
    armFake();
    const asked = stubBrowser({ status: "ok", contractVersion: 1 });
    const t = await seeded();
    const token = await t.action(internal.credentials.getSiteTokenForUser, { site: "sportlots", userId: USER });
    expect(token?.token).toBe("tok");
    expect(asked).toEqual([{ method: "GET", path: `/credentials/sportlots-credentials-${USER}/token` }]);
  });

  test("a fake-aware revision is let through, on this deployment's own key", async () => {
    armFake();
    const asked = stubBrowser({ status: "ok", contractVersion: 1, bscTarget: "fake" });
    const t = await seeded();
    expect((await tokenFor(t))?.token).toBe("tok");
    const key = fakeBscCredentialKeyFor(USER, CLOUD_URL);
    expect(asked).toEqual([
      { method: "GET", path: `/credentials/${key}/metadata` },
      { method: "GET", path: `/credentials/${key}/token` },
    ]);
  });

  test("outside fake mode a revision without bscTarget works as before, on the bare key", async () => {
    vi.stubEnv("CONVEX_CLOUD_URL", CLOUD_URL);
    const asked = stubBrowser({ status: "ok", contractVersion: 1 });
    const t = await seeded();
    expect((await tokenFor(t))?.token).toBe("tok");
    expect(asked).toEqual([{ method: "GET", path: `/credentials/buysportscards-credentials-${USER}/token` }]);
    expect(parsed(errors).find((e) => e.msg === "fake_bsc_browser_not_fake")).toBeUndefined();
  });
});

describe("deleteFakeSessionsFromCli (BSC)", () => {
  const FAKE_HEALTH = { status: "ok", contractVersion: 1, bscTarget: "fake" };

  test("deletes only this deployment's fake keys, one per user, and clears the flag", async () => {
    armFake();
    const asked = stubBrowser(FAKE_HEALTH);
    const t = await seeded([USER, OTHER_USER]);

    const result = await t.action(internal.credentials.deleteFakeSessionsFromCli, {});

    expect(result).toEqual({ fake: true, bsc: { users: 2, deleted: 2, failed: 0, truncated: false } });
    expect(asked.map(({ method }) => method)).toEqual(["DELETE", "DELETE"]);
    expect(asked.map(({ path }) => path).sort()).toEqual(
      [
        `/credentials/buysportscards-credentials-fake-happy-otter-123-${USER}`,
        `/credentials/buysportscards-credentials-fake-happy-otter-123-${OTHER_USER}`,
      ].sort(),
    );
    for (const { path } of asked) {
      expect(path.startsWith("/credentials/buysportscards-credentials-fake-happy-otter-123-")).toBe(true);
      expect(path).not.toContain("sad-badger-456");
    }
    const flags = await t.run(async (ctx) =>
      (await ctx.db.query("userProfiles").collect()).map((row) =>
        (row.siteCredentials ?? []).some((c) => c.site === "buysportscards" && c.hasCredentials),
      ),
    );
    expect(flags).toEqual([false, false]);
    // Counts only: no id or key in the log line.
    const line = parsed(logs).find((e) => e.msg === "fake_session_cleanup" && e.platform === "buysportscards");
    expect(line).toMatchObject({ outcome: "ok", deleted: 2, failed: 0 });
    expect(JSON.stringify(line)).not.toContain(USER);
  });

  test("a user id that would walk the path onto another key sends nothing", async () => {
    armFake();
    const asked = stubBrowser(FAKE_HEALTH);
    const t = await seeded(["a/../../credentials/x", "user_ok.dot", "user_%2e%2e", USER]);

    const result = await t.action(internal.credentials.deleteFakeSessionsFromCli, {});

    expect(result).toEqual({ fake: true, bsc: { users: 4, deleted: 1, failed: 3, truncated: false } });
    // Only the plain id's key went out, encoded, and nothing else was asked.
    expect(asked).toEqual([
      { method: "DELETE", path: `/credentials/buysportscards-credentials-fake-happy-otter-123-${USER}` },
    ]);
  });

  test("a failed delete is counted, not thrown, and keeps the flag", async () => {
    armFake();
    stubBrowser(FAKE_HEALTH, { deleteStatus: 500 });
    const t = await seeded();

    const result = await t.action(internal.credentials.deleteFakeSessionsFromCli, {});

    expect(result).toEqual({ fake: true, bsc: { users: 1, deleted: 0, failed: 1, truncated: false } });
    const flag = await t.run(async (ctx) => (await ctx.db.query("userProfiles").first())?.siteCredentials?.[0]?.hasCredentials);
    expect(flag).toBe(true);
  });

  test("an already-gone key (404) counts as deleted", async () => {
    armFake();
    stubBrowser(FAKE_HEALTH, { deleteStatus: 404 });
    const result = await (await seeded()).action(internal.credentials.deleteFakeSessionsFromCli, {});
    expect(result).toEqual({ fake: true, bsc: { users: 1, deleted: 1, failed: 0, truncated: false } });
  });

  test("refuses outside fake mode: deletes nothing, sends nothing", async () => {
    vi.stubEnv("TESTING_RESET_SECRET", "armed");
    vi.stubEnv("CONVEX_CLOUD_URL", CLOUD_URL);
    const asked = stubBrowser(FAKE_HEALTH);
    const t = await seeded();

    expect(await t.action(internal.credentials.deleteFakeSessionsFromCli, {})).toEqual({ fake: false });
    expect(asked).toEqual([]);
  });

  test("refuses in production (no testing flag), even with the fake base set", async () => {
    armProd();
    const asked = stubBrowser(FAKE_HEALTH);
    const t = await seeded();

    expect(await t.action(internal.credentials.deleteFakeSessionsFromCli, {})).toEqual({ fake: false });
    expect(asked).toEqual([]);
  });

  test("a browser service not on the fake gets no delete", async () => {
    armFake();
    const asked = stubBrowser({ status: "ok", contractVersion: 1, bscTarget: "real" });
    const result = await (await seeded()).action(internal.credentials.deleteFakeSessionsFromCli, {});
    expect(result).toEqual({ fake: true, bsc: { users: 1, deleted: 0, failed: 1, truncated: false } });
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
