/**
 * NEO-628 (NEO-629) — the background team lane asks in the namespace, and
 * behind the BSC call gate, of the operator who queued the card.
 *
 * The lane is ONE slot per deployment with no caller identity. With a gate per
 * fake namespace it only stays isolated if each queued item carries the
 * operator (`queuedBy`, passed as an argument by the enqueue callers, never
 * read in scheduled code):
 *   - the item's calls use that user's namespace (`x-nb-fake-ns`) and that
 *     user's gate key, one value for both;
 *   - a blocked per-namespace key DEFERS the item at once and never sleeps in
 *     the slot (the slot is every shard's); only the `"deployment"` key is
 *     waited out;
 *   - `queuedBy` survives every re-enqueue (retry, push-back, chunked enqueue);
 *   - an item without it (in flight across the deploy, or the old shim) keeps
 *     the deployment prefix and the `"deployment"` key.
 * Driven by hand through the real item and completion (see
 * `lib/testing/bsc-team-lane.ts`); the fake's ID token is stubbed.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { BSC_TEAM_ENQUEUE_CHUNK_SIZE } from "./bscTeamPool";
import { FAKE_BSC_NS_HEADER } from "./lib/bscHttp";
import { fakeBscNamespaceFor, fakeBscPrefixFor } from "./testing";
import { bscGateWindowRow } from "../lib/testing/bsc-gate-stub";
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
const NS_B = fakeBscNamespaceFor(USER_B, CLOUD_URL);
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

const openWindow = (t: T, scope: string, until: number) =>
  t.run(async (ctx) => ctx.db.insert("marketplaceCallGates", { ...bscGateWindowRow(until, NOW), scope }));

/** Loads the adapter with one throwaway item, then puts the clock back (see bscTeamPool.test.ts). */
async function warmAdapter(t: T): Promise<void> {
  const [gone] = await seedCards(t, 1);
  await t.run(async (ctx) => ctx.db.delete(gone));
  await settleOnFakeClock(
    t.action(internal.adapters.buysportscards.runBscTeamCheckItem, {
      cardChecklistId: gone,
      pass: 1,
      firstQueuedAt: NOW,
    }),
  );
  vi.setSystemTime(NOW);
}

/** Answers every card-listing call with `status` (200 = a team), recording each call's ns header. */
function stubListing(status = 200): Array<string | null> {
  const seen: Array<string | null> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers).get(FAKE_BSC_NS_HEADER));
      return status === 200
        ? new Response(JSON.stringify({ teamName: "Reds" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        : new Response("", { status });
    }),
  );
  return seen;
}

describe("queuedBy on the lane's items", () => {
  test("enqueueBscTeamChecks stamps every item with the operator, and the chunked rest keeps it", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedCards(t, BSC_TEAM_ENQUEUE_CHUNK_SIZE + 2);
    const lane = captureBscTeamLane();

    await t.mutation(internal.bscTeamPool.enqueueBscTeamChecks, { cardChecklistIds: ids, queuedBy: USER_A });

    expect(lane).toHaveLength(BSC_TEAM_ENQUEUE_CHUNK_SIZE);
    for (const l of lane) expect(l.item.queuedBy).toBe(USER_A);
    const scheduled = await t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].args[0]).toMatchObject({ from: BSC_TEAM_ENQUEUE_CHUNK_SIZE, queuedBy: USER_A });
  });

  test("an enqueue without one stamps nothing (no key at all, not undefined)", async () => {
    const t = convexTest(schema, modules);
    const [a] = await seedCards(t, 1);
    const lane = captureBscTeamLane();
    await t.mutation(internal.bscTeamPool.enqueueBscTeamChecks, { cardChecklistIds: [a] });
    expect(lane[0].item).toEqual({ cardChecklistId: a, pass: 1, firstQueuedAt: NOW });
    expect("queuedBy" in lane[0].item).toBe(false);
  });

  test("a failed lookup's retry and a deferred card's push-back both keep it", async () => {
    armFake();
    const t = convexTest(schema, modules);
    const [a, b] = await seedCards(t, 2);
    await warmAdapter(t);
    stubListing(503);
    const lane = captureBscTeamLane();
    await t.mutation(internal.bscTeamPool.enqueueBscTeamChecks, { cardChecklistIds: [a], queuedBy: USER_A });

    // A 503 after the lookup's own retry: the NEO-330 ladder re-enqueues pass 2.
    await runBscTeamLane(t, lane, 1);
    expect(lane).toHaveLength(1);
    expect(lane[0].item).toMatchObject({ cardChecklistId: a, pass: 2, queuedBy: USER_A });

    // Now the user's gate is open: the next run defers and pushes back.
    lane.length = 0;
    await t.run(async (ctx) => {
      for (const r of await ctx.db.query("marketplaceCallGates").collect()) await ctx.db.delete(r._id);
    });
    await openWindow(t, `ns:${NS_A}`, Date.now() + 90_000);
    await t.mutation(internal.bscTeamPool.enqueueBscTeamChecks, { cardChecklistIds: [b], queuedBy: USER_A });
    await runBscTeamLane(t, lane, 1);
    expect(lane).toHaveLength(1);
    expect(lane[0].item).toMatchObject({ cardChecklistId: b, pass: 1, queuedBy: USER_A });
  });
});

describe("the lane asks in the queuing operator's namespace, behind their gate", () => {
  test("an item with queuedBy sends THEIR namespace; one without sends the deployment prefix", async () => {
    armFake();
    const t = convexTest(schema, modules);
    const [a, b] = await seedCards(t, 2);
    await warmAdapter(t);
    const seen = stubListing();
    const lane = captureBscTeamLane();
    await t.mutation(internal.bscTeamPool.enqueueBscTeamChecks, { cardChecklistIds: [a], queuedBy: USER_A });
    await t.mutation(internal.bscTeamPool.enqueueBscTeamChecks, { cardChecklistIds: [b] });
    expect(await runBscTeamLane(t, lane, 2)).toBe(2);
    expect(seen).toEqual([NS_A, PREFIX]);
  });

  test("a 429 for one user's card opens THAT user's key; the next user's card in the same lane still goes", async () => {
    armFake();
    const t = convexTest(schema, modules);
    const [a, b] = await seedCards(t, 2);
    await warmAdapter(t);
    const seen: Array<string | null> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const ns = new Headers(init.headers).get(FAKE_BSC_NS_HEADER);
        seen.push(ns);
        return ns === NS_A
          ? new Response("", { status: 429, headers: { "retry-after": "60" } })
          : new Response(JSON.stringify({ teamName: "Reds" }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
      }),
    );
    const lane = captureBscTeamLane();
    await t.mutation(internal.bscTeamPool.enqueueBscTeamChecks, { cardChecklistIds: [a], queuedBy: USER_A });
    await t.mutation(internal.bscTeamPool.enqueueBscTeamChecks, { cardChecklistIds: [b], queuedBy: USER_B });

    await runBscTeamLane(t, lane, 2);

    expect(seen).toEqual([NS_A, NS_B]);
    const scopes = await t.run(async (ctx) => (await ctx.db.query("marketplaceCallGates").collect()).map((r) => r.scope));
    expect(scopes).toEqual([`ns:${NS_A}`]);
    // A's card is pushed back to its window; B's is answered and done.
    expect(lane).toHaveLength(1);
    expect(lane[0].item).toMatchObject({ cardChecklistId: a, queuedBy: USER_A });
    expect((await t.run(async (ctx) => ctx.db.get(b)))?.teamCheckDoneAt).toBeDefined();
  });

  test("a blocked ns: key defers at once, with no call and no wait in the slot, even for a 15 s window", async () => {
    armFake();
    const t = convexTest(schema, modules);
    const [a] = await seedCards(t, 1);
    await warmAdapter(t);
    const seen = stubListing();
    await openWindow(t, `ns:${NS_A}`, NOW + 15_000);
    const lane = captureBscTeamLane();
    await t.mutation(internal.bscTeamPool.enqueueBscTeamChecks, { cardChecklistIds: [a], queuedBy: USER_A });
    const startedAt = Date.now();

    expect(await runBscTeamLane(t, lane, 1)).toBe(1);

    expect(seen).toEqual([]);
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(lane).toHaveLength(1);
    expect(lane[0].runAt).toBe(NOW + 15_000);
    expect(lane[0].item).toMatchObject({ cardChecklistId: a, pass: 1, queuedBy: USER_A });
  });

  test("the same 15 s window on the \"deployment\" key (no queuedBy) is still waited out in the slot", async () => {
    armFake();
    const t = convexTest(schema, modules);
    const [a] = await seedCards(t, 1);
    await warmAdapter(t);
    const seen = stubListing();
    await openWindow(t, "deployment", NOW + 15_000);
    const lane = captureBscTeamLane();
    await t.mutation(internal.bscTeamPool.enqueueBscTeamChecks, { cardChecklistIds: [a] });

    expect(await runBscTeamLane(t, lane, 5)).toBe(1);

    // Waited the window out, then asked once under the prefix; nothing re-enqueued.
    expect(seen).toEqual([PREFIX]);
    expect(lane).toHaveLength(0);
    expect(Date.now()).toBeGreaterThanOrEqual(NOW + 15_000);
  });

  test("another user's window does not block a legacy item, and a deployment window blocks no namespace", async () => {
    armFake();
    const t = convexTest(schema, modules);
    const [a, b] = await seedCards(t, 2);
    await warmAdapter(t);
    const seen = stubListing();
    await openWindow(t, `ns:${NS_B}`, NOW + 300_000);
    const lane = captureBscTeamLane();
    await t.mutation(internal.bscTeamPool.enqueueBscTeamChecks, { cardChecklistIds: [a] });
    await t.mutation(internal.bscTeamPool.enqueueBscTeamChecks, { cardChecklistIds: [b], queuedBy: USER_A });
    expect(await runBscTeamLane(t, lane, 2)).toBe(2);
    expect(seen).toEqual([PREFIX, NS_A]);
    expect(lane).toHaveLength(0);
  });

  test("on real BSC an item with queuedBy is still the one deployment key: a 15 s window is waited out, and sends no namespace", async () => {
    vi.stubEnv("CONVEX_CLOUD_URL", CLOUD_URL);
    const t = convexTest(schema, modules);
    const [a] = await seedCards(t, 1);
    await warmAdapter(t);
    const seen = stubListing();
    await openWindow(t, "deployment", NOW + 15_000);
    const lane = captureBscTeamLane();
    await t.mutation(internal.bscTeamPool.enqueueBscTeamChecks, { cardChecklistIds: [a], queuedBy: USER_A });

    expect(await runBscTeamLane(t, lane, 5)).toBe(1);

    expect(seen).toEqual([null]);
    expect(lane).toHaveLength(0);
  });
});
