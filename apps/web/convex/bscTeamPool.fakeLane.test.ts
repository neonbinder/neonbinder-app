/**
 * NEO-644 — the BSC team lane on the fake: no pacing pause in a fake
 * namespace, and an E2E spec can take its own queued items off the lane.
 *
 *  - `runBscTeamCheckItem` pauses `BSC_TEAM_ENRICH_DELAY_MS` after its call
 *    only when the call landed in the `"deployment"` domain: always on real
 *    BSC (an item carrying `queuedBy` included), and an item with no
 *    `queuedBy` on the fake. An item asked in a fake namespace is not paced.
 *  - On the fake every item that carries `queuedBy` is remembered by work id
 *    (`bscTeamLaneFakeItems`) and forgotten at its completion; on real BSC
 *    nothing is written.
 *  - `testing.cancelMyBscTeamChecks` cancels the CALLER's items only.
 *
 * Driven by hand through the real item and completion
 * (`lib/testing/bsc-team-lane.ts`); `bscTeamPool.cancel` is spied, as
 * convex-test cannot mount the workpool component.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { BSC_TEAM_CANCEL_FOR_USER_MAX, bscTeamPool } from "./bscTeamPool";
import { BSC_TEAM_ENRICH_DELAY_MS } from "./adapters/buysportscards";
import { FAKE_BSC_NS_HEADER } from "./lib/bscHttp";
import { fakeBscNamespaceFor, fakeBscPrefixFor } from "./testing";
import { insertTestCard } from "../lib/testing/card-row";
import { captureBscTeamLane, runBscTeamLane, settleOnFakeClock } from "../lib/testing/bsc-team-lane";

vi.mock("./lib/bscFakeIdToken", () => ({
  nodeBscIdToken: async () => "stub-id-token",
  idTokenExpiresAt: (_token: string, fallback: number) => fallback,
}));

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const NOW = 1_800_000_000_000;
const CLOUD_URL = "https://happy-otter-123.convex.cloud";
const USER_A = "user_2aaaaAAAAA";
const USER_B = "user_2bbbbBBBBB";
const NS_A = fakeBscNamespaceFor(USER_A, CLOUD_URL);
const PREFIX = fakeBscPrefixFor(CLOUD_URL);

type T = ReturnType<typeof convexTest>;

function armFake() {
  vi.stubEnv("NEONBINDER_BSC_API_BASE", "https://neonbinder-fake-bsc-0000-uc.a.run.app");
  vi.stubEnv("NEONBINDER_FAKE_BSC_KEY", "caller-key");
  vi.stubEnv("TESTING_RESET_SECRET", "armed");
  vi.stubEnv("CONVEX_CLOUD_URL", CLOUD_URL);
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function seedCards(t: T, count: number): Promise<Id<"cardChecklist">[]> {
  return t.run(async (ctx) => {
    const sportId = await ctx.db.insert("selectorOptions", {
      level: "sport", value: "Baseball", platformData: {}, children: [], lastUpdated: NOW,
    });
    const leafId = await ctx.db.insert("selectorOptions", {
      level: "setName", value: "2024 Topps", platformData: {}, parentId: sportId, children: [], lastUpdated: NOW,
    });
    await ctx.db.patch(sportId, { children: [leafId] });
    const ids: Id<"cardChecklist">[] = [];
    for (let n = 1; n <= count; n += 1) {
      ids.push(
        await insertTestCard(ctx, {
          selectorOptionId: leafId, cardNumber: String(n), cardName: `Card ${n}`,
          platformData: { bsc: { ref: `bsc-${n}`, src: "b0" } }, sortOrder: n, lastUpdated: NOW,
        }),
      );
    }
    return ids;
  });
}

/** Answers every card-listing call with a team, recording each call's ns header. */
function stubListing(): Array<string | null> {
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

/** Loads the adapter with one throwaway item (row gone: no call, no pause), then puts the clock back. */
async function warmAdapter(t: T): Promise<void> {
  const [gone] = await seedCards(t, 1);
  await t.run(async (ctx) => ctx.db.delete(gone));
  await settleOnFakeClock(
    t.action(internal.adapters.buysportscards.runBscTeamCheckItem, { cardChecklistId: gone, pass: 1, firstQueuedAt: NOW }),
  );
  vi.setSystemTime(NOW);
}

/** Runs one item on the fake clock; returns its result and the fake time it took. */
async function runItem(t: T, args: { cardChecklistId: Id<"cardChecklist">; queuedBy?: string }) {
  const startedAt = Date.now();
  const result = await settleOnFakeClock(
    t.action(internal.adapters.buysportscards.runBscTeamCheckItem, { pass: 1, firstQueuedAt: NOW, ...args }),
  );
  return { result, tookMs: Date.now() - startedAt };
}

const laneRows = (t: T) => t.run(async (ctx) => ctx.db.query("bscTeamLaneFakeItems").collect());

describe("the pacing pause follows the domain the call landed in", () => {
  test("fake, an item asked in its operator's namespace is answered with no pause", async () => {
    armFake();
    const t = convexTest(schema, modules);
    const [a] = await seedCards(t, 1);
    await warmAdapter(t);
    const seen = stubListing();

    const { result, tookMs } = await runItem(t, { cardChecklistId: a, queuedBy: USER_A });

    expect(result).toEqual({ outcome: "answered" });
    expect(seen).toEqual([NS_A]);
    expect(tookMs).toBeLessThan(BSC_TEAM_ENRICH_DELAY_MS);
  });

  test("fake, an item with no operator (the deployment prefix, the \"deployment\" key) is still paced", async () => {
    armFake();
    const t = convexTest(schema, modules);
    const [a] = await seedCards(t, 1);
    await warmAdapter(t);
    const seen = stubListing();

    const { result, tookMs } = await runItem(t, { cardChecklistId: a });

    expect(result).toEqual({ outcome: "answered" });
    expect(seen).toEqual([PREFIX]);
    expect(tookMs).toBeGreaterThanOrEqual(BSC_TEAM_ENRICH_DELAY_MS);
  });

  test("real BSC, an item that carries a queuedBy is the deployment's and is still paced", async () => {
    vi.stubEnv("CONVEX_CLOUD_URL", CLOUD_URL);
    const t = convexTest(schema, modules);
    const [a] = await seedCards(t, 1);
    await warmAdapter(t);
    const seen = stubListing();

    // Straight to the item, past the enqueue that would have dropped it.
    const { result, tookMs } = await runItem(t, { cardChecklistId: a, queuedBy: USER_A });

    expect(result).toEqual({ outcome: "answered" });
    expect(seen).toEqual([null]);
    expect(tookMs).toBeGreaterThanOrEqual(BSC_TEAM_ENRICH_DELAY_MS);
  });
});

describe("the fake lane remembers each operator's items by work id", () => {
  test("an item with queuedBy gets a row; a legacy item gets none; the completion forgets it", async () => {
    armFake();
    const t = convexTest(schema, modules);
    const [a, b, c] = await seedCards(t, 3);
    await warmAdapter(t);
    stubListing();
    const lane = captureBscTeamLane();
    await t.mutation(internal.bscTeamPool.enqueueBscTeamChecks, { cardChecklistIds: [a, b], queuedBy: USER_A });
    await t.mutation(internal.bscTeamPool.enqueueBscTeamChecks, { cardChecklistIds: [c] });

    expect((await laneRows(t)).map((r) => ({ queuedBy: r.queuedBy, workId: r.workId }))).toEqual([
      { queuedBy: USER_A, workId: "work-1" },
      { queuedBy: USER_A, workId: "work-2" },
    ]);

    await runBscTeamLane(t, lane, 1);
    expect((await laneRows(t)).map((r) => r.workId)).toEqual(["work-2"]);
    await runBscTeamLane(t, lane, 5);
    expect(await laneRows(t)).toEqual([]);
  });

  test("a re-enqueue (a push-back) is remembered under its new work id", async () => {
    armFake();
    const t = convexTest(schema, modules);
    const [a] = await seedCards(t, 1);
    await warmAdapter(t);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 429, headers: { "retry-after": "60" } })));
    const lane = captureBscTeamLane();
    await t.mutation(internal.bscTeamPool.enqueueBscTeamChecks, { cardChecklistIds: [a], queuedBy: USER_A });

    await runBscTeamLane(t, lane, 1);

    expect(lane).toHaveLength(1);
    expect((await laneRows(t)).map((r) => ({ queuedBy: r.queuedBy, workId: r.workId }))).toEqual([
      { queuedBy: USER_A, workId: "work-2" },
    ]);
  });

  test("a push-back after the target moved to real BSC writes no row, though the stored item carries queuedBy", async () => {
    armFake();
    const t = convexTest(schema, modules);
    const [a] = await seedCards(t, 1);
    await warmAdapter(t);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 429, headers: { "retry-after": "60" } })));
    const lane = captureBscTeamLane();
    await t.mutation(internal.bscTeamPool.enqueueBscTeamChecks, { cardChecklistIds: [a], queuedBy: USER_A });
    expect((await laneRows(t)).map((r) => r.workId)).toEqual(["work-1"]);
    expect(lane[0].item.queuedBy).toBe(USER_A);

    // The target moves to real BSC while the item waits.
    vi.unstubAllEnvs();
    vi.stubEnv("CONVEX_CLOUD_URL", CLOUD_URL);
    await runBscTeamLane(t, lane, 1);

    // The item was pushed back (re-enqueued, still carrying queuedBy), but nothing is remembered.
    expect(lane).toHaveLength(1);
    expect(lane[0].item.queuedBy).toBe(USER_A);
    expect(await laneRows(t)).toEqual([]);
  });

  test("on real BSC nothing is written, whatever the caller passed", async () => {
    vi.stubEnv("CONVEX_CLOUD_URL", CLOUD_URL);
    const t = convexTest(schema, modules);
    const [a] = await seedCards(t, 1);
    await warmAdapter(t);
    stubListing();
    const lane = captureBscTeamLane();
    await t.mutation(internal.bscTeamPool.enqueueBscTeamChecks, { cardChecklistIds: [a], queuedBy: USER_A });
    expect(await laneRows(t)).toEqual([]);
    await runBscTeamLane(t, lane, 5);
    expect(await laneRows(t)).toEqual([]);
  });
});

describe("testing.cancelMyBscTeamChecks", () => {
  test("cancels the caller's items only, and forgets them", async () => {
    armFake();
    const t = convexTest(schema, modules);
    const [a1, a2, b, legacy] = await seedCards(t, 4);
    captureBscTeamLane();
    const cancel = vi.spyOn(bscTeamPool, "cancel").mockResolvedValue(undefined);
    await t.mutation(internal.bscTeamPool.enqueueBscTeamChecks, { cardChecklistIds: [a1, a2], queuedBy: USER_A });
    await t.mutation(internal.bscTeamPool.enqueueBscTeamChecks, { cardChecklistIds: [b], queuedBy: USER_B });
    await t.mutation(internal.bscTeamPool.enqueueBscTeamChecks, { cardChecklistIds: [legacy] });

    expect(await t.withIdentity({ subject: USER_A }).mutation(api.testing.cancelMyBscTeamChecks, {})).toEqual({
      cancelled: 2,
    });

    expect(cancel.mock.calls.map((call) => call[1]).sort()).toEqual(["work-1", "work-2"]);
    expect((await laneRows(t)).map((r) => ({ queuedBy: r.queuedBy, workId: r.workId }))).toEqual([
      { queuedBy: USER_B, workId: "work-3" },
    ]);
    // Nothing left of A's: a second call cancels nothing.
    expect(await t.withIdentity({ subject: USER_A }).mutation(api.testing.cancelMyBscTeamChecks, {})).toEqual({
      cancelled: 0,
    });
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  test("caps one call at BSC_TEAM_CANCEL_FOR_USER_MAX items; repeat calls drain the rest", async () => {
    armFake();
    const t = convexTest(schema, modules);
    const total = BSC_TEAM_CANCEL_FOR_USER_MAX + 1;
    const cancel = vi.spyOn(bscTeamPool, "cancel").mockResolvedValue(undefined);
    await t.run(async (ctx) => {
      for (let i = 0; i < total; i++) {
        await ctx.db.insert("bscTeamLaneFakeItems", { queuedBy: USER_A, workId: `work-${i}` });
      }
    });
    const caller = t.withIdentity({ subject: USER_A });

    expect(await caller.mutation(api.testing.cancelMyBscTeamChecks, {})).toEqual({
      cancelled: BSC_TEAM_CANCEL_FOR_USER_MAX,
    });
    expect(await laneRows(t)).toHaveLength(1);
    expect(cancel).toHaveBeenCalledTimes(BSC_TEAM_CANCEL_FOR_USER_MAX);

    expect(await caller.mutation(api.testing.cancelMyBscTeamChecks, {})).toEqual({ cancelled: 1 });
    expect(await laneRows(t)).toHaveLength(0);

    expect(await caller.mutation(api.testing.cancelMyBscTeamChecks, {})).toEqual({ cancelled: 0 });
    expect(cancel).toHaveBeenCalledTimes(total);
  });

  test("a cancelled item's completion is done: no re-enqueue, no write to the card", async () => {
    armFake();
    const t = convexTest(schema, modules);
    const [a] = await seedCards(t, 1);
    const lane = captureBscTeamLane();
    vi.spyOn(bscTeamPool, "cancel").mockResolvedValue(undefined);
    await t.mutation(internal.bscTeamPool.enqueueBscTeamChecks, { cardChecklistIds: [a], queuedBy: USER_A });
    const before = await t.run(async (ctx) => ctx.db.get(a));
    await t.withIdentity({ subject: USER_A }).mutation(api.testing.cancelMyBscTeamChecks, {});
    lane.length = 0;

    await t.mutation(internal.bscTeamPool.onBscTeamCheckComplete, {
      workId: "work-1",
      context: { cardChecklistId: a, pass: 1, firstQueuedAt: NOW, queuedBy: USER_A },
      result: { kind: "canceled" },
    } as never);

    expect(lane).toHaveLength(0);
    expect(await t.run(async (ctx) => ctx.db.get(a))).toEqual(before);
    expect(await laneRows(t)).toEqual([]);
  });
});
