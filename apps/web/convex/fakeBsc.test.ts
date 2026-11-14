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
import { isOwnNamespace, isOwnPrefix, narrowMisses, narrowMissingCaptures } from "./fakeBsc";

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
  test("keeps endpoint names; drops anything else", () => {
    expect(
      narrowMissingCaptures({
        writeCaptures: { missing: ["PUT seller/bulk-upload", 5, "not an endpoint", "POST common/card/undefined/product/undefined/attachment"] },
      }),
    ).toEqual(["PUT seller/bulk-upload", "POST common/card/undefined/product/undefined/attachment"]);
  });

  test("a health body without the field is unreadable (null), never 'none missing'", () => {
    expect(narrowMissingCaptures({ ok: true })).toBeNull();
    expect(narrowMissingCaptures({ writeCaptures: {} })).toBeNull();
    expect(narrowMissingCaptures({ writeCaptures: { missing: "x" } })).toBeNull();
    expect(narrowMissingCaptures(null)).toBeNull();
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
