/**
 * NEO-628 (NEO-629) — the calls that carry the signed-in user's own BSC token
 * (selector options, the checklist fan-out, the probe batch) are gated in the
 * token owner's domain: that user's `ns:<namespace>` on the fake, the one
 * `"deployment"` key on real BSC. The fake reads such a call's namespace from
 * its token, so the key must be the owner's namespace too, or one shard's
 * injected 429 would close another shard's gate again.
 *
 * `bscCallGateFor` is wrapped to record the key every call site binds; the
 * gate itself is the always-open stub (the real gate is pinned in
 * bscCallGate.test.ts). The fake's ID token and `./credentials` are stubbed.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { resetBscInflightForTests } from "./lib/bscCallTelemetry";
import { fakeBscNamespaceFor } from "./testing";

vi.mock("./lib/bscFakeIdToken", () => ({
  nodeBscIdToken: async () => "stub-id-token",
  idTokenExpiresAt: (_token: string, fallback: number) => fallback,
}));

const st = vi.hoisted(() => ({ keys: [] as string[] }));

vi.mock("./credentials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./credentials")>();
  return { ...actual, siteTokenForCurrentUser: async () => ({ token: "tok-neo628" }) };
});

// Load the mocked module once, up front: two importers loading it at once can
// bypass the factory and run the real `siteTokenForCurrentUser`.
await import("./credentials");

vi.mock("./bscCallGate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./bscCallGate")>();
  const { openBscCallGate } = await import("../lib/testing/bsc-open-gate");
  return {
    ...actual,
    bscCallGateFor: (_ctx: unknown, key: string) => {
      st.keys.push(key);
      return openBscCallGate();
    },
  };
});

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const CLOUD_URL = "https://happy-otter-123.convex.cloud";
const admin = (subject: string) => ({
  subject,
  issuer: "https://clerk.example.com",
  tokenIdentifier: `clerk|${subject}`,
  name: "Admin",
  role: "admin",
});
const A = admin("admin_neo628_a");
const B = admin("admin_neo628_b");
const SCOPE = { sport: ["baseball"], year: ["1996"], setName: ["score"], variant: ["insert"] };

function armFake() {
  vi.stubEnv("NEONBINDER_BSC_API_BASE", "https://neonbinder-fake-bsc-0000-uc.a.run.app");
  vi.stubEnv("NEONBINDER_FAKE_BSC_KEY", "caller-key");
  vi.stubEnv("TESTING_RESET_SECRET", "armed");
  vi.stubEnv("CONVEX_CLOUD_URL", CLOUD_URL);
}

function stubFetch() {
  const headers: Headers[] = [];
  vi.stubGlobal("fetch", (async (_url: string, init: RequestInit) => {
    headers.push(new Headers(init.headers));
    return Response.json({ aggregations: { sport: [{ label: "Baseball", slug: "baseball", count: 3 }] } });
  }) as typeof fetch);
  return headers;
}

beforeEach(() => {
  resetBscInflightForTests();
  st.keys.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const selector = (t: ReturnType<typeof convexTest>, who: typeof A) =>
  t.withIdentity(who).action(api.adapters.buysportscards.fetchBscSelectorOptions, {
    level: "sport",
    parentFilters: {},
  });
const checklist = (t: ReturnType<typeof convexTest>, who: typeof A) =>
  t.withIdentity(who).action(api.adapters.buysportscards.fetchBscChecklist, {
    parentFilters: {},
    facetFilters: { ...SCOPE, variantName: ["s-1"] },
    sourceFacet: "variantName",
  });

describe("on the fake, the gate is the token owner's namespace", () => {
  test("fetchBscSelectorOptions, fetchBscChecklist and the probe batch each bind the caller's own key", async () => {
    armFake();
    const t = convexTest(schema, modules);
    const sent = stubFetch();
    const keyA = `ns:${fakeBscNamespaceFor(A.subject, CLOUD_URL)}`;
    const keyB = `ns:${fakeBscNamespaceFor(B.subject, CLOUD_URL)}`;
    expect(keyA).not.toBe(keyB);

    await selector(t, A);
    await checklist(t, A);
    await t.withIdentity(A).action(internal.adapters.buysportscards.probeBscChecklistBatch, {
      requests: [{ id: "a", facetFilters: { ...SCOPE, variantName: ["s-1"] } }],
    });
    expect(st.keys.length).toBeGreaterThanOrEqual(3);
    expect(new Set(st.keys)).toEqual(new Set([keyA]));

    st.keys.length = 0;
    await selector(t, B);
    await checklist(t, B);
    expect(new Set(st.keys)).toEqual(new Set([keyB]));

    // A token-bearing request names no namespace header: the fake reads the token.
    for (const h of sent) expect(h.get("x-nb-fake-ns")).toBeNull();
  });
});

describe("on real BuySportsCards, every user is the one deployment key", () => {
  test("two users' token-bearing calls bind \"deployment\"", async () => {
    vi.stubEnv("CONVEX_CLOUD_URL", CLOUD_URL);
    const t = convexTest(schema, modules);
    stubFetch();
    await selector(t, A);
    await checklist(t, B);
    expect(st.keys.length).toBeGreaterThanOrEqual(2);
    expect(new Set(st.keys)).toEqual(new Set(["deployment"]));
  });
});
