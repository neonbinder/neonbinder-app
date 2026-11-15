/**
 * NEO-552 — what the non-team BSC paths do when the call gate refuses: the
 * seller-sheet read and the profile read (`adapters/bscSeller.ts`), and the
 * catalogue sync's filters and results calls (`adapters/buysportscards.ts`).
 *
 * The gate is the real one (`bscCallGate`, convex-test), put into each
 * refusing state the way production reaches it: an open 429 window, a probe
 * already in flight, a drained bucket (throttled). `gate_unavailable` (the
 * gate cannot be asked) is a ctx whose gate calls throw. For each: the
 * failure the caller sees, and that `fetch` was never called.
 *
 * BSC was never asked, so the failure is its own kind (`paced`) with NB's
 * pacing copy (`lib/bscPacedCopy.ts`), never BSC's 429/503 or "fumbled".
 *
 * Lives at the convex/ root so convex-test's module glob resolves.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import {
  BSC_SELLER_COPY,
  fetchBscSellerId,
  readBscSellerSheet,
  type BscSellerSession,
} from "./adapters/bscSeller";
import { bscGateWindowRow } from "../lib/testing/bsc-gate-stub";
import { BSC_PACED_SELLER } from "./lib/bscPacedCopy";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const NOW = 1_800_000_000_000;
type T = ReturnType<typeof convexTest>;

const ADMIN = {
  subject: "admin_neo552_refusals",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_neo552_refusals",
  name: "Admin",
  role: "admin",
};

vi.mock("./credentials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./credentials")>();
  const { internalAction } = await import("./_generated/server");
  const { v } = await import("convex/values");
  return {
    ...actual,
    getSiteToken: internalAction({
      args: { site: v.string() },
      returns: v.any(),
      handler: async () => ({ token: "test-bsc-token" }),
    }),
    authenticateBsc: internalAction({
      args: { userId: v.optional(v.string()), tokenRefused: v.optional(v.boolean()) },
      returns: v.any(),
      handler: async () => ({ success: true }),
    }),
  };
});

const OPEN_FOR_MS = 60_000;

/** Puts the stored gate into a refusing state. */
const REFUSING = {
  open: async (t: T) => {
    await t.run(async (ctx) => ctx.db.insert("marketplaceCallGates", bscGateWindowRow(NOW + OPEN_FOR_MS, NOW)));
  },
  probing: async (t: T) => {
    await REFUSING.open(t);
    vi.setSystemTime(NOW + OPEN_FOR_MS);
    // The probe lease is taken by someone else; every later ask is refused.
    const probe = await t.mutation(internal.bscCallGate.acquire, { count: 1 });
    expect(probe).toMatchObject({ ok: true, probe: true });
  },
  throttled: async (t: T) => {
    // Burst 10, then debt: -15 is the longest wait the gate will promise.
    await t.mutation(internal.bscCallGate.acquire, { count: 10 });
    await t.mutation(internal.bscCallGate.acquire, { count: 10 });
    await t.mutation(internal.bscCallGate.acquire, { count: 5 });
    const refused = await t.mutation(internal.bscCallGate.acquire, { count: 1 });
    expect(refused).toMatchObject({ ok: false, reason: "throttled" });
  },
} as const;
const STATES = Object.keys(REFUSING) as Array<keyof typeof REFUSING>;

/** A seller-session ctx whose gate calls run against convex-test. */
function boundCtx(t: T) {
  return {
    runAction: vi.fn(),
    runMutation: ((ref: unknown, args: unknown) =>
      (t.mutation as (r: unknown, a: unknown) => Promise<unknown>)(ref, args)) as never,
    runQuery: ((ref: unknown, args: unknown) =>
      (t.query as (r: unknown, a: unknown) => Promise<unknown>)(ref, args)) as never,
  } as never;
}
/** A ctx whose gate cannot be asked at all. */
const unreadableGateCtx = () =>
  ({
    runAction: vi.fn(),
    runMutation: vi.fn(async () => {
      throw new Error("gate down");
    }),
    runQuery: vi.fn(async () => {
      throw new Error("gate down");
    }),
  }) as never;

const session = (): BscSellerSession => ({ ownerId: "owner", token: "tok", reauthAttempted: false, dead: false });

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  fetchSpy = vi.fn(async () => {
    throw new Error("a refused call must not reach fetch");
  });
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("seller paths under a refusing gate", () => {
  test("the paced line is NB's pacing copy: it never blames BSC or names an internal word", () => {
    expect(BSC_SELLER_COPY.paced).toBe(BSC_PACED_SELLER);
    expect(BSC_PACED_SELLER).toMatch(/^NeonBinder is pacing its calls to BuySportsCards/);
    expect(BSC_PACED_SELLER).not.toMatch(/\d{3}|error|fumbl|snooz|gate|breaker|thrott|rate.?limit/i);
  });

  test.each(STATES)("the seller-sheet read, gate %s: a paced failure with no status, nothing sent", async (state) => {
    const t = convexTest(schema, modules);
    await REFUSING[state](t);

    const r = await readBscSellerSheet(boundCtx(t), session(), { filters: { sport: ["baseball"] }, condition: "NM" });

    expect(r).toEqual({
      ok: false,
      failure: { kind: "paced", message: BSC_SELLER_COPY.paced },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test.each(STATES)("the profile read, gate %s: a paced failure with no status, not retried, nothing sent", async (state) => {
    const t = convexTest(schema, modules);
    await REFUSING[state](t);
    const before = await t.run(async (ctx) => ctx.db.query("marketplaceCallGates").collect());

    const r = await fetchBscSellerId(boundCtx(t), session());

    expect(r).toEqual({
      ok: false,
      failure: { kind: "paced", message: BSC_SELLER_COPY.paced },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    // A refusal writes nothing, so the refused asks left the gate as it was.
    expect(await t.run(async (ctx) => ctx.db.query("marketplaceCallGates").collect())).toEqual(before);
  });

  test("gate_unavailable on the sheet read is the same paced failure, never BSC's snoozing 503, nothing sent", async () => {
    const r = await readBscSellerSheet(unreadableGateCtx(), session(), {
      filters: { sport: ["baseball"] },
      condition: "NM",
    });

    expect(r).toEqual({
      ok: false,
      failure: { kind: "paced", message: BSC_SELLER_COPY.paced },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("gate_unavailable on the profile read is a paced failure, not retried, nothing sent", async () => {
    const ctx = unreadableGateCtx() as unknown as { runMutation: ReturnType<typeof vi.fn> };

    const r = await fetchBscSellerId(ctx as never, session());

    expect(r).toEqual({
      ok: false,
      failure: { kind: "paced", message: BSC_SELLER_COPY.paced },
    });
    // Only BSC's own 5xx is retried; NB's refusal is final for this round,
    // so the gate is asked once.
    expect(ctx.runMutation).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a refused seller call does not kill the session: after the gate reopens the same session sends", async () => {
    const t = convexTest(schema, modules);
    await REFUSING.open(t);
    const s = session();
    const ctx = boundCtx(t);
    expect(await fetchBscSellerId(ctx, s)).toMatchObject({ ok: false, failure: { kind: "paced" } });
    expect(s).toMatchObject({ dead: false, reauthAttempted: false });

    vi.setSystemTime(NOW + OPEN_FOR_MS);
    fetchSpy.mockImplementation(async () => Response.json({ sellerProfile: { sellerId: "abcd1234" } }));
    expect(await fetchBscSellerId(ctx, s)).toMatchObject({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("catalogue sync under a refusing gate", () => {
  const filters = (t: T) =>
    t.withIdentity(ADMIN).action(api.adapters.buysportscards.fetchBscSelectorOptions, {
      level: "sport",
      parentFilters: {},
    });
  const results = (t: T) =>
    t.withIdentity(ADMIN).action(api.adapters.buysportscards.fetchBscChecklist, {
      parentFilters: {},
      facetFilters: { sport: ["baseball"], year: ["1996"], setName: ["score"], variant: ["insert"] },
    });

  test.each(STATES)("the filters call, gate %s: a failed fetch in NB's pacing copy (not retried), nothing sent", async (state) => {
    const t = convexTest(schema, modules);
    await REFUSING[state](t);

    const r = await filters(t);

    // A refusal is never retried: one attempt, not three.
    expect(r).toEqual({
      success: false,
      options: [],
      message: expect.stringMatching(
        /^NeonBinder is pacing its calls to BuySportsCards, so it didn't ask just now\. No sweat: give it about \d+ (seconds?|minutes?) and try again\.$/,
      ),
    });
    expect((r as { message: string }).message).not.toMatch(/429|error|gate|breaker|thrott/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test.each(STATES)("the results call, gate %s: a paced failure with no status, no cards, nothing sent", async (state) => {
    const t = convexTest(schema, modules);
    await REFUSING[state](t);

    const r = await results(t);

    expect(r).toMatchObject({
      success: false,
      cards: [],
      failure: { kind: "paced", timedOut: false },
    });
    expect((r as { failure?: { httpStatus?: number } }).failure?.httpStatus).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
