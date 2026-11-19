/**
 * NEO-555 — one poll per owner at a time. The cron's `pollOwner` and the
 * testing "poll now" both run under the owner's poll lease
 * (`claimPoll` / `releasePoll` / `pollOwnerGuarded`), so their cursor and
 * `finishPoll` writes never interleave.
 */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { POLL_LEASE_MS, pollOwnerGuarded, type PollCtx } from "./listingSales";

const modules = (import.meta as unknown as { glob: (pattern: string) => Record<string, () => Promise<unknown>> }).glob(
  "./**/*.*s",
);
const OWNER = "user_pollllease_aaaa";
const NOW = 1_700_000_000_000;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function seed(t: ReturnType<typeof convexTest>, lease?: { token: string; expiresAt: number }) {
  await t.run(async (ctx) => {
    await ctx.db.insert("marketplaceListingStates", {
      ownerId: OWNER,
      platform: "ebay",
      listingStartedAt: NOW,
      lastUpdated: NOW,
      ...(lease ? { pollLeaseToken: lease.token, pollLeaseExpiresAt: lease.expiresAt } : {}),
    });
  });
}
const lease = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const r = await ctx.db.query("marketplaceListingStates").first();
    return { token: r?.pollLeaseToken ?? null, expiresAt: r?.pollLeaseExpiresAt ?? null };
  });
const claim = (t: ReturnType<typeof convexTest>, token: string) =>
  t.mutation(internal.listingSales.claimPoll, { ownerId: OWNER, platform: "ebay", token });
const release = (t: ReturnType<typeof convexTest>, token: string) =>
  t.mutation(internal.listingSales.releasePoll, { ownerId: OWNER, platform: "ebay", token });

/** A poll ctx whose mutations run on `t`, and whose poll input says "nothing to poll". */
function ctxFor(t: ReturnType<typeof convexTest>, during?: () => Promise<void>): PollCtx {
  return {
    runQuery: (async () => {
      await during?.();
      return null;
    }) as never,
    runMutation: ((fn: never, args: never) => t.mutation(fn, args)) as never,
    runAction: (async () => null) as never,
  };
}

describe("claimPoll / releasePoll", () => {
  test("the first claim takes the lease; a second is refused while it is held", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    expect(await claim(t, "a")).toBe(true);
    expect((await lease(t)).token).toBe("a");
    expect(await claim(t, "b")).toBe(false);
    expect((await lease(t)).token).toBe("a");
  });

  test("a lease that ran out is replaced", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { token: "dead", expiresAt: Date.now() - 1 });
    expect(await claim(t, "b")).toBe(true);
    expect((await lease(t)).token).toBe("b");
    expect((await lease(t)).expiresAt).toBeGreaterThan(Date.now() + POLL_LEASE_MS - 5_000);
  });

  test("a lease that expires at exactly now is replaceable (the held test is strictly later than now)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    await seed(t, { token: "edge", expiresAt: NOW });
    expect(await claim(t, "b")).toBe(true);
    expect((await lease(t)).token).toBe("b");
  });

  test("a lease one millisecond from running out is still held", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    await seed(t, { token: "held", expiresAt: NOW + 1 });
    expect(await claim(t, "b")).toBe(false);
    expect((await lease(t)).token).toBe("held");
  });

  test("release frees it for the holder only", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await claim(t, "a");
    await release(t, "someone-else");
    expect((await lease(t)).token).toBe("a");
    await release(t, "a");
    expect(await lease(t)).toEqual({ token: null, expiresAt: null });
    expect(await claim(t, "b")).toBe(true);
  });

  test("an owner with no listing-state row has nothing to poll: the claim is true and release is a no-op", async () => {
    const t = convexTest(schema, modules);
    expect(await claim(t, "a")).toBe(true);
    await release(t, "a");
  });

  test("the lease is per platform", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("marketplaceListingStates", { ownerId: OWNER, platform: "bsc", listingStartedAt: NOW, lastUpdated: NOW });
    });
    await claim(t, "a");
    expect(await t.mutation(internal.listingSales.claimPoll, { ownerId: OWNER, platform: "bsc", token: "b" })).toBe(true);
  });
});

describe("pollOwnerGuarded", () => {
  test("holds the lease while the poll runs and releases it after", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    let during: string | null = null;
    const report = await pollOwnerGuarded(
      ctxFor(t, async () => {
        during = (await lease(t)).token;
      }),
      { ownerId: OWNER, platform: "ebay" },
    );
    expect(report).toMatchObject({ ordersRead: 0, error: null });
    expect(during).not.toBeNull();
    expect((await lease(t)).token).toBeNull();
  });

  test("releases the lease when the poll throws", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const ctx = { ...ctxFor(t), runQuery: (async () => { throw new Error("boom"); }) as never };
    await expect(pollOwnerGuarded(ctx, { ownerId: OWNER, platform: "ebay" })).rejects.toThrow("boom");
    expect((await lease(t)).token).toBeNull();
  });

  test("another poll is running: with no wait it returns null and polls nothing", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { token: "cron", expiresAt: Date.now() + 60_000 });
    const runQuery = vi.fn(async () => null);
    const report = await pollOwnerGuarded({ ...ctxFor(t), runQuery: runQuery as never }, { ownerId: OWNER, platform: "ebay" });
    expect(report).toBeNull();
    expect(runQuery).not.toHaveBeenCalled();
    expect((await lease(t)).token).toBe("cron");
  });

  test("with a wait it polls once the other poll lets go", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { token: "cron", expiresAt: Date.now() + 60_000 });
    const pauses: number[] = [];
    const report = await pollOwnerGuarded(
      ctxFor(t),
      { ownerId: OWNER, platform: "ebay" },
      {
        waitMs: 5_000,
        stepMs: 500,
        pause: async (ms) => {
          pauses.push(ms);
          if (pauses.length === 3) await release(t, "cron");
        },
      },
    );
    expect(report).not.toBeNull();
    expect(pauses).toEqual([500, 500, 500]);
    expect((await lease(t)).token).toBeNull();
  });

  test("with a wait that runs out it gives up, leaving the other poll's lease alone", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { token: "cron", expiresAt: Date.now() + 60_000 });
    const pauses: number[] = [];
    const report = await pollOwnerGuarded(ctxFor(t), { ownerId: OWNER, platform: "ebay" }, {
      waitMs: 1_000,
      stepMs: 500,
      pause: async (ms) => void pauses.push(ms),
    });
    expect(report).toBeNull();
    expect(pauses).toEqual([500, 500]);
    expect((await lease(t)).token).toBe("cron");
  });
});

describe("the cron's pollOwner", () => {
  test("skips an owner whose poll is already running, and logs it", async () => {
    const t = convexTest(schema, modules);
    await seed(t, { token: "now", expiresAt: Date.now() + 60_000 });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await t.action(internal.listingSales.pollOwner, { ownerId: OWNER, platform: "ebay" });
    expect(log.mock.calls.some((c) => String(c[0]).includes("already_running"))).toBe(true);
    expect((await lease(t)).token).toBe("now");
  });

  test("runs and releases when nothing else is polling", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await t.action(internal.listingSales.pollOwner, { ownerId: OWNER, platform: "ebay" });
    expect((await lease(t)).token).toBeNull();
  });
});
