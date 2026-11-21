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
  vi.stubEnv("NEONBINDER_BSC_API_BASE", "https://neonbinder-fake-bsc-0000-uc.a.run.app");
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

// NEO-628 — the gate is keyed on the SAME value the call is sent as.
describe("the gate key is the namespace the call is sent as", () => {
  const gateScopes = (t: ReturnType<typeof convexTest>) =>
    t.run(async (ctx) => (await ctx.db.query("marketplaceCallGates").collect()).map((r) => r.scope));

  /** Answers 429 for namespace `bad`, a team for every other; records each call's ns. */
  function stub429For(bad: string): Array<string | null> {
    const seen: Array<string | null> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const ns = new Headers(init.headers).get(FAKE_BSC_NS_HEADER);
        seen.push(ns);
        return ns === bad
          ? new Response("", { status: 429, headers: { "retry-after": "60" } })
          : new Response(JSON.stringify({ teamName: "Reds" }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
      }),
    );
    return seen;
  }

  test("a signed-in caller's 429 opens THEIR namespace's gate, and another user's lookup still goes", async () => {
    armFake();
    const other = "user_2zzzOTHERuser";
    const mine = fakeBscNamespaceFor(SUBJECT, CLOUD_URL);
    const seen = stub429For(mine);
    const t = convexTest(schema, modules);
    const lookup = (subject: string) =>
      t
        .withIdentity({ subject })
        .action(internal.adapters.buysportscards.fetchBscCardTeamNames, { bscCardIds: ["1"] });

    const first = await lookup(SUBJECT);
    expect(first[0]).toMatchObject({ success: false });
    expect(await gateScopes(t)).toEqual([`ns:${mine}`]);

    // The same user is now refused unsent; the other user is not.
    const again = await lookup(SUBJECT);
    expect(again[0]).toMatchObject({ success: false, skipped: true });
    const theirs = await lookup(other);
    expect(theirs[0]).toMatchObject({ success: true });
    expect(seen).toEqual([mine, fakeBscNamespaceFor(other, CLOUD_URL)]);
    expect(await gateScopes(t)).toEqual([`ns:${mine}`]);
  });

  test("with no user the 429 is the deployment's gate (the prefix is not a namespace)", async () => {
    armFake();
    stub429For("happy-otter-123-");
    const t = convexTest(schema, modules);
    await t.action(internal.adapters.buysportscards.fetchBscCardTeamNames, { bscCardIds: ["1"] });
    expect(await gateScopes(t)).toEqual(["deployment"]);
  });

  test("on BuySportsCards a signed-in caller's 429 is the one deployment gate", async () => {
    vi.stubEnv("CONVEX_CLOUD_URL", CLOUD_URL);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 429, headers: { "retry-after": "60" } })));
    const t = convexTest(schema, modules);
    await t
      .withIdentity({ subject: SUBJECT })
      .action(internal.adapters.buysportscards.fetchBscCardTeamNames, { bscCardIds: ["1"] });
    expect(await gateScopes(t)).toEqual(["deployment"]);
    // Another user is refused by it.
    const theirs = await t
      .withIdentity({ subject: "user_2zzzOTHERuser" })
      .action(internal.adapters.buysportscards.fetchBscCardTeamNames, { bscCardIds: ["1"] });
    expect(theirs[0]).toMatchObject({ success: false, skipped: true });
  });
});
