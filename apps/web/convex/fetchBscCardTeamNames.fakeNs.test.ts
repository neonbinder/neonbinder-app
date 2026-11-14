/**
 * NEO-552 — a card-listing call carries no BSC token, so on the fake it names
 * its run in `x-nb-fake-ns` (CONTRACT.md, "Module seams"): the signed-in
 * caller's namespace, derived as `testing.ts` derives it, else this
 * deployment's prefix. Never in real mode. The fake's ID token is stubbed:
 * nothing here mints a real one or leaves the process.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { resetBscInflightForTests } from "./lib/bscCallTelemetry";
import { FAKE_BSC_NS_HEADER } from "./lib/bscHttp";
import { fakeBscNamespaceFor } from "./testing";

vi.mock("./lib/bscFakeIdToken", () => ({
  nodeBscIdToken: async () => "stub-id-token",
  idTokenExpiresAt: (_token: string, fallback: number) => fallback,
}));

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const CLOUD_URL = "https://happy-otter-123.convex.cloud";
const SUBJECT = "user_2abcDEFghi";

function armFake() {
  vi.stubEnv("NEONBINDER_BSC_API_BASE", "https://fake-bsc-0000.a.run.app");
  vi.stubEnv("NEONBINDER_FAKE_BSC_KEY", "caller-key");
  vi.stubEnv("TESTING_RESET_SECRET", "armed");
  vi.stubEnv("CONVEX_CLOUD_URL", CLOUD_URL);
}

/** Answers every card-listing call with a team; records each call's ns header. */
function stubCardListing(): Array<string | null> {
  const seen: Array<string | null> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers).get(FAKE_BSC_NS_HEADER));
      return new Response(JSON.stringify({ teamName: "Reds" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return seen;
}

beforeEach(() => {
  resetBscInflightForTests();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("fetchBscCardTeamNames on the fake", () => {
  test("a signed-in caller's calls carry their own namespace", async () => {
    armFake();
    const seen = stubCardListing();
    const t = convexTest(schema, modules);

    await t
      .withIdentity({ subject: SUBJECT })
      .action(internal.adapters.buysportscards.fetchBscCardTeamNames, { bscCardIds: ["1", "2"] });

    const ns = fakeBscNamespaceFor(SUBJECT, CLOUD_URL);
    expect(ns.startsWith("happy-otter-123-")).toBe(true);
    expect(seen).toEqual([ns, ns]);
  });

  test("with no user (the background lane's case) the calls carry the deployment prefix", async () => {
    armFake();
    const seen = stubCardListing();
    const t = convexTest(schema, modules);

    await t.action(internal.adapters.buysportscards.fetchBscCardTeamNames, { bscCardIds: ["1"] });

    expect(seen).toEqual(["happy-otter-123-"]);
  });

  test("on BuySportsCards (real mode) no namespace header is ever sent", async () => {
    vi.stubEnv("CONVEX_CLOUD_URL", CLOUD_URL);
    const seen = stubCardListing();
    const t = convexTest(schema, modules);

    await t
      .withIdentity({ subject: SUBJECT })
      .action(internal.adapters.buysportscards.fetchBscCardTeamNames, { bscCardIds: ["1"] });

    expect(seen).toEqual([null]);
  });
});
