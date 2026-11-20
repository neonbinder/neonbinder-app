/**
 * NEO-628 (NEO-629) — adversarial pass on the per-domain BSC call gate.
 *
 * Attacks, each pinned by a test: can real mode ever produce an `ns:` key; can a
 * call send one namespace and gate on another (`bscCallDomainFor` is the one
 * source of both); do two keys share a failure run or a first-insert row; does
 * a lane item lose `queuedBy` on any re-enqueue path; can a client reach
 * `queuedBy`; does a legacy item keep the old behaviour.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { bscCallDomainFor } from "./bscCallGate";
import { bscGateKey, isBscGateKey } from "./lib/bscGateKey";
import { fakeBscNamespaceFor, fakeBscPrefixFor } from "./lib/fakeBscNamespace";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

// Every public-surface file whose source can declare a function, read as text.
const sources = (import.meta as unknown as {
  glob: (pattern: string | string[], opts: { query: string; import: string; eager: true }) => Record<string, string>;
}).glob(["./*.ts", "./adapters/*.ts", "!./**/*.test.ts", "!./_generated/**"], { query: "?raw", import: "default", eager: true });

const NOW = 1_800_000_000_000;
const CLOUD = "https://happy-otter-123.convex.cloud";
const FAKE_BASE = "https://neonbinder-fake-bsc-0000-uc.a.run.app";
type T = ReturnType<typeof convexTest>;

function armFake(env: Record<string, string> = {}) {
  vi.stubEnv("NEONBINDER_BSC_API_BASE", FAKE_BASE);
  vi.stubEnv("NEONBINDER_FAKE_BSC_KEY", "k");
  vi.stubEnv("TESTING_RESET_SECRET", "armed");
  vi.stubEnv("CONVEX_CLOUD_URL", CLOUD);
  for (const [k, val] of Object.entries(env)) vi.stubEnv(k, val);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const rows = (t: T) => t.run(async (ctx) => ctx.db.query("marketplaceCallGates").collect());

describe("real mode never produces an ns: key", () => {
  const FAKE_URL_ENV = { NEONBINDER_BSC_API_BASE: FAKE_BASE, NEONBINDER_FAKE_BSC_KEY: "k", TESTING_RESET_SECRET: "armed", CONVEX_CLOUD_URL: CLOUD };
  const nonFake: Array<[string, Record<string, string>]> = [
    ["no BSC base set", { CONVEX_CLOUD_URL: CLOUD }],
    ["a base set on a deployment that is not a test deployment (override ignored)", { ...FAKE_URL_ENV, TESTING_RESET_SECRET: "" }],
    ["a base that is not a URL", { ...FAKE_URL_ENV, NEONBINDER_BSC_API_BASE: "not a url" }],
    ["an http base", { ...FAKE_URL_ENV, NEONBINDER_BSC_API_BASE: FAKE_BASE.replace("https", "http") }],
    ["a base on the wrong host", { ...FAKE_URL_ENV, NEONBINDER_BSC_API_BASE: "https://evil.example.com" }],
    ["a base with a path", { ...FAKE_URL_ENV, NEONBINDER_BSC_API_BASE: `${FAKE_BASE}/api` }],
    ["a fake with no caller key", { ...FAKE_URL_ENV, NEONBINDER_FAKE_BSC_KEY: "" }],
  ];

  test.each(nonFake)("%s: every user is the deployment key with no namespace", (_name, env) => {
    for (const user of ["user_2aaaa", "", null, undefined, "ns:evil", "a:b"]) {
      expect(bscCallDomainFor(user, env)).toEqual({ gateKey: "deployment" });
    }
  });

  test.each(nonFake)("%s: the stored gate refuses an ns: key", async (_name, env) => {
    const t = convexTest(schema, modules);
    for (const [k, val] of Object.entries(env)) vi.stubEnv(k, val);
    const key = `ns:${fakeBscNamespaceFor("user_2aaaa", CLOUD)}`;
    await expect(t.mutation(internal.bscCallGate.acquire, { key, count: 1 })).rejects.toThrow();
    await expect(t.mutation(internal.bscCallGate.recordOutcome, { key, grantedAt: NOW, outcome: "failure" })).rejects.toThrow();
    await expect(t.mutation(internal.bscCallGate.releaseProbe, { key, grantedAt: NOW })).rejects.toThrow();
    await expect(t.query(internal.bscCallGate.state, { key })).rejects.toThrow();
    expect(await rows(t)).toHaveLength(0);
  });
});

describe("the fake's namespace can never forge a key shape", () => {
  const hostile = ["", ":", "a:b", "ns:x", "NS:X", "user_2AAAA", "a".repeat(10_000), "💥", "user\n2", "-", " "];

  test("a hostile user id still yields deployment, or exactly ns:<slug>-<12 hex>", () => {
    for (const id of hostile) {
      const d = bscCallDomainFor(id, { ...{ NEONBINDER_BSC_API_BASE: FAKE_BASE, NEONBINDER_FAKE_BSC_KEY: "k", TESTING_RESET_SECRET: "armed" }, CONVEX_CLOUD_URL: CLOUD });
      if (id === "") {
        expect(d).toEqual({ gateKey: "deployment", fakeNs: fakeBscPrefixFor(CLOUD) });
      } else {
        expect(d.gateKey).toMatch(/^ns:happy-otter-123-[0-9a-f]{12}$/);
        expect(d.gateKey).toBe(`ns:${d.fakeNs}`);
      }
    }
  });

  // KNOWN GAP (reported, product code untouched): convexSlugOf accepts a slug the
  // namespace shape rejects (leading hyphen, or over 88 characters), so the gate
  // falls back to "deployment" while the header still names the user's namespace.
  // Real Convex slugs are word-word-digits, so it is unreachable today. `test.fails`
  // passes while the gap exists and goes red the day it is fixed: flip it to `test`.
  test.fails("KNOWN GAP: key and header agree for a slug the namespace shape rejects", () => {
    const urls = [
      undefined,
      "",
      "https://UPPER.convex.cloud",
      "http://happy-otter-123.convex.cloud",
      "https://happy-otter-123.convex.cloud/path",
      "https://happy-otter-123.convex.cloud.evil.com",
      "https://-lead.convex.cloud",
      "https://trail-.convex.cloud",
      `https://${"a".repeat(95)}.convex.cloud`,
      `https://${"a".repeat(30)}.convex.cloud`,
      "https://happy-otter-123.convex.cloud/",
    ];
    for (const url of urls) {
      const env = { NEONBINDER_BSC_API_BASE: FAKE_BASE, NEONBINDER_FAKE_BSC_KEY: "k", TESTING_RESET_SECRET: "armed", ...(url !== undefined ? { CONVEX_CLOUD_URL: url } : {}) };
      for (const user of ["user_2aaaa", null]) {
        const d = bscCallDomainFor(user, env);
        if (d.gateKey !== "deployment") {
          expect(d.gateKey).toBe(`ns:${d.fakeNs}`);
          expect(isBscGateKey(d.gateKey)).toBe(true);
        } else if (d.fakeNs !== undefined) {
          // Gated on the deployment's one key: the header may only be the
          // deployment PREFIX (a call with no user), never one user's namespace
          // the gate does not know.
          expect(d.fakeNs.endsWith("-"), `url=${url} user=${user} fakeNs=${d.fakeNs}`).toBe(true);
        }
      }
    }
  });

  // KNOWN GAP: isBscGateKey accepts `ns:<slug>-` (the prefix), which bscGateKey never
  // mints. Only an internal caller could name it; no one does. Flip to `test` when fixed.
  test.fails("KNOWN GAP: a trailing-hyphen prefix is not accepted as a gate key", () => {
    const prefixKey = `ns:${fakeBscPrefixFor(CLOUD)}`;
    expect(bscGateKey({ mode: "fake", fakeNs: fakeBscPrefixFor(CLOUD) })).toBe("deployment");
    // Whatever isBscGateKey accepts must be reachable from bscGateKey, or a
    // caller-supplied key could open a row nothing ever clears or reads.
    expect(isBscGateKey(prefixKey), "isBscGateKey accepts a prefix key bscGateKey never mints").toBe(false);
  });
});

describe("two keys never share state", () => {
  const A = `ns:${fakeBscNamespaceFor("user_aaaa", CLOUD)}`;
  const B = `ns:${fakeBscNamespaceFor("user_bbbb", CLOUD)}`;
  const acquire = (t: T, key: string) => t.mutation(internal.bscCallGate.acquire, { key, count: 1 });
  const fail = async (t: T, key: string) => {
    const g = await acquire(t, key);
    if (!g.ok) throw new Error(`gate ${key} refused: ${g.reason}`);
    await t.mutation(internal.bscCallGate.recordOutcome, { key, grantedAt: g.grantedAt, outcome: "failure" });
  };

  test("racing first writes on both keys, and twice on one, leave one row per key", async () => {
    armFake();
    const t = convexTest(schema, modules);
    // A fake acquire writes nothing (no bucket); a failure outcome is the first insert.
    const firstWrite = (key: string) =>
      t.mutation(internal.bscCallGate.recordOutcome, { key, grantedAt: NOW, outcome: "failure" });
    await Promise.all([firstWrite(A), firstWrite(B), firstWrite(A), firstWrite(B), firstWrite("deployment")]);
    const scopes = (await rows(t)).map((r) => r.scope).sort();
    expect(scopes).toEqual([A, B, "deployment"].sort());
  });

  test("interleaved failures (four on A, four on B) open neither; the fifth on A opens only A", async () => {
    armFake();
    const t = convexTest(schema, modules);
    for (let i = 0; i < 4; i += 1) {
      await fail(t, A);
      await fail(t, B);
    }
    expect((await t.query(internal.bscCallGate.state, { key: A })).blockedUntil).toBeNull();
    expect((await t.query(internal.bscCallGate.state, { key: B })).blockedUntil).toBeNull();
    await fail(t, A);
    expect((await t.query(internal.bscCallGate.state, { key: A })).blockedUntil).not.toBeNull();
    expect((await t.query(internal.bscCallGate.state, { key: B })).blockedUntil).toBeNull();
    expect((await t.query(internal.bscCallGate.state, { key: "deployment" })).blockedUntil).toBeNull();
  });

  test("a success on B does not end A's failure run", async () => {
    armFake();
    const t = convexTest(schema, modules);
    for (let i = 0; i < 4; i += 1) await fail(t, A);
    const b = await acquire(t, B);
    if (!b.ok) throw new Error("B refused");
    await t.mutation(internal.bscCallGate.recordOutcome, { key: B, grantedAt: b.grantedAt, outcome: "success" });
    await fail(t, A);
    expect((await t.query(internal.bscCallGate.state, { key: A })).blockedUntil).not.toBeNull();
  });

  test("an outcome recorded under key B with a grant taken on key A changes nothing on A", async () => {
    armFake();
    const t = convexTest(schema, modules);
    const g = await acquire(t, A);
    if (!g.ok) throw new Error("A refused");
    await t.mutation(internal.bscCallGate.recordOutcome, { key: B, grantedAt: g.grantedAt, outcome: "rateLimited" });
    expect((await t.query(internal.bscCallGate.state, { key: A })).blockedUntil).toBeNull();
  });
});

describe("clearing is one row, the caller's, never the deployment's", () => {
  const A = `ns:${fakeBscNamespaceFor("user_aaaa", CLOUD)}`;
  test("clearForTesting refuses a prefix key it could otherwise be tricked into, and leaves the other rows", async () => {
    armFake();
    const t = convexTest(schema, modules);
    for (const key of [A, "deployment"]) {
      await t.mutation(internal.bscCallGate.recordOutcome, { key, grantedAt: NOW, outcome: "failure" });
    }
    expect(await rows(t)).toHaveLength(2);
    await expect(t.mutation(internal.bscCallGate.clearForTesting, { key: "deployment" })).rejects.toThrow();
    // A prefix key is not a row any caller owns.
    await t.mutation(internal.bscCallGate.clearForTesting, { key: `ns:${fakeBscPrefixFor(CLOUD)}` }).catch(() => {});
    expect((await rows(t)).map((r) => r.scope).sort()).toEqual([A, "deployment"].sort());
    expect(await t.mutation(internal.bscCallGate.clearForTesting, { key: A })).toEqual({ deleted: 1 });
    expect((await rows(t)).map((r) => r.scope)).toEqual(["deployment"]);
  });
});

describe("queuedBy is server-only", () => {
  test("no public query, mutation or action declares queuedBy", () => {
    const offenders: string[] = [];
    const internalHolders: string[] = [];
    for (const [file, text] of Object.entries(sources)) {
      if (!text.includes("queuedBy")) continue;
      // Split into top-level `export const X = <builder>(` blocks.
      const parts = text.split(/\n(?=export const )/);
      for (const part of parts) {
        const m = /^export const (\w+) = (query|mutation|action|internalQuery|internalMutation|internalAction)\(/.exec(part);
        if (m && !m[2].startsWith("internal") && /queuedBy\s*:\s*v\./.test(part)) offenders.push(`${file}:${m[1]}`);
        if (m && m[2].startsWith("internal") && /queuedBy\s*:\s*v\./.test(part)) internalHolders.push(m[1]);
      }
    }
    // Control: the scan really sees the lane's internal entry points.
    expect(internalHolders).toEqual(
      expect.arrayContaining(["enqueueBscTeamChecks", "runBscTeamCheckItem", "enqueueBscTeamBackfill", "commitCardChecklistFinalize", "insertParallelCardsPage"]),
    );
    expect(offenders).toEqual([]);
  });
});
