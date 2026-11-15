/**
 * NEO-552 — on a deployment wired to the fake BSC, a stored BSC session is
 * used only when it is this deployment's own fake account
 * (`nb+<convexSlug>-<userTag>@fake.invalid`). The browser service keeps one
 * session per Clerk user, so two deployments sharing a test user would
 * otherwise send one run's BSC calls into the other run's namespace. A clash
 * refuses the token, fast and with a named log line; outside fake mode
 * nothing changes. The browser service is stubbed; nothing leaves the process.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { __resetContractCache, __resetFakeBscSessionCheck } from "./credentials";
import { fakeBscUsernameFor } from "./testing";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const USER = "user_fakens_aaaa1111";
const SITE = "buysportscards";
const CLOUD_URL = "https://happy-otter-123.convex.cloud";
const OTHER_CLOUD_URL = "https://sad-badger-456.convex.cloud";
const REQUIRED_CONTRACT_VERSION_FOR_TESTS = 1;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Serves /health, the stored username, and a fresh token; records what was asked. */
function stubBrowser(storedUsername: string | null) {
  const asked: string[] = [];
  vi.stubGlobal("fetch", (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.endsWith("/health")) {
      return json({ status: "ok", environment: "test", contractVersion: REQUIRED_CONTRACT_VERSION_FOR_TESTS, bscTarget: "fake" });
    }
    if (u.endsWith("/metadata")) {
      asked.push("metadata");
      return storedUsername === null ? new Response("", { status: 404 }) : json({ username: storedUsername, hasToken: true });
    }
    if (u.endsWith("/token")) {
      asked.push("token");
      return json({ token: "tok-fresh", expiresAt: Date.now() + 60 * 60 * 1000 });
    }
    throw new Error(`unexpected fetch: ${u}`);
  }) as typeof fetch);
  return asked;
}

async function seeded() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("userProfiles", {
      userId: USER,
      siteCredentials: [{ site: SITE, hasCredentials: true, lastUpdated: "2020-01-01T00:00:00.000Z" }],
    });
  });
  return t;
}
const tokenFor = (t: ReturnType<typeof convexTest>) =>
  t.action(internal.credentials.getSiteTokenForUser, { site: SITE, userId: USER });

function armFake() {
  vi.stubEnv("NEONBINDER_BSC_API_BASE", "https://neonbinder-fake-bsc-0000-uc.a.run.app");
  vi.stubEnv("NEONBINDER_FAKE_BSC_KEY", "caller-key");
  vi.stubEnv("TESTING_RESET_SECRET", "armed");
  vi.stubEnv("CONVEX_CLOUD_URL", CLOUD_URL);
}

let errors: string[];
beforeEach(() => {
  __resetContractCache();
  __resetFakeBscSessionCheck();
  errors = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
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

describe("fake mode: a BSC session from another deployment is refused", () => {
  test("this deployment's own account: the token is used, and the match is remembered", async () => {
    armFake();
    const asked = stubBrowser(fakeBscUsernameFor(USER, CLOUD_URL).toUpperCase());
    const t = await seeded();

    expect((await tokenFor(t))?.token).toBe("tok-fresh");
    expect((await tokenFor(t))?.token).toBe("tok-fresh");
    // One username check for both reads.
    expect(asked).toEqual(["metadata", "token", "token"]);
  });

  test("another deployment's account: no token, no token read, and the clash is named", async () => {
    armFake();
    const asked = stubBrowser(fakeBscUsernameFor(USER, OTHER_CLOUD_URL));
    const t = await seeded();

    expect(await tokenFor(t)).toBeNull();
    expect(asked).toEqual(["metadata"]);
    const line = errors.map((e) => JSON.parse(e) as Record<string, string>).find((e) => e.msg === "fake_bsc_namespace_clash");
    expect(line?.reason).toContain("sad-badger-456-");
    expect(line?.reason).toContain("happy-otter-123-");
    // A clash is never cached: a re-seed here repairs it on the next read.
    expect(await tokenFor(t)).toBeNull();
    expect(asked).toEqual(["metadata", "metadata"]);
  });

  test("a real BSC username stored on a fake deployment is refused too", async () => {
    armFake();
    stubBrowser("someone@example.com");
    expect(await tokenFor(await seeded())).toBeNull();
  });

  test("no stored metadata is not a clash: the token read decides", async () => {
    armFake();
    const asked = stubBrowser(null);
    expect((await tokenFor(await seeded()))?.token).toBe("tok-fresh");
    expect(asked).toEqual(["metadata", "token"]);
  });

  test("a fake deployment that cannot name its namespace fails closed", async () => {
    armFake();
    vi.stubEnv("CONVEX_CLOUD_URL", "");
    const asked = stubBrowser(fakeBscUsernameFor(USER, CLOUD_URL));
    expect(await tokenFor(await seeded())).toBeNull();
    expect(asked).toEqual([]);
  });
});

describe("outside fake mode nothing changes", () => {
  test("no username check, the token is used as before", async () => {
    vi.stubEnv("CONVEX_CLOUD_URL", CLOUD_URL);
    const asked = stubBrowser("someone@example.com");
    expect((await tokenFor(await seeded()))?.token).toBe("tok-fresh");
    expect(asked).toEqual(["token"]);
  });
});
