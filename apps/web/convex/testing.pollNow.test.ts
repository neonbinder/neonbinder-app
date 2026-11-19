/**
 * NEO-555 — `pollMySalesNow`'s two refusals, with `pollOwnerGuarded` replaced
 * (a file of its own: the mock is file-wide). The real guard and lease are in
 * `listingSales.pollLease.test.ts`; the happy path and the waiting path in
 * `testing.fakeEbay.test.ts`.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { __resetContractCache } from "./credentials";
import type { PollReport } from "./listingSales";

const guarded = vi.hoisted(() => ({ answer: vi.fn() }));
vi.mock("./listingSales", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./listingSales")>()),
  pollOwnerGuarded: guarded.answer,
}));

const modules = (import.meta as unknown as { glob: (pattern: string) => Record<string, () => Promise<unknown>> }).glob(
  "./**/*.*s",
);
const USER = "user_pollnow_aaaa";

beforeEach(() => {
  __resetContractCache();
  guarded.answer.mockReset();
  vi.stubEnv("TESTING_RESET_SECRET", "test-enabled");
  vi.stubEnv("NEONBINDER_BSC_API_BASE", "https://neonbinder-fake-bsc-abc123-uc.a.run.app");
  vi.stubEnv("NEONBINDER_FAKE_BSC_KEY", "caller-key");
  vi.stubEnv("CONVEX_CLOUD_URL", "https://happy-otter-123.convex.cloud");
  vi.stubEnv("EBAY_ENVIRONMENT", "fake");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const poll = () =>
  convexTest(schema, modules).withIdentity({ subject: USER }).action(api.testing.pollMySalesNow, { platform: "ebay" });
const report = (over: Partial<PollReport>): PollReport => ({
  ordersRead: 0,
  ordersStored: 0,
  linesApplied: 0,
  cursorAt: null,
  error: null,
  ...over,
});

describe("pollMySalesNow", () => {
  test("polls under the caller's own owner id, waiting up to 30 s for a poll already running", async () => {
    guarded.answer.mockResolvedValue(report({ ordersRead: 2, ordersStored: 1, linesApplied: 3 }));
    expect(await poll()).toEqual({ ordersRead: 2, ordersStored: 1, linesApplied: 3 });
    expect(guarded.answer).toHaveBeenCalledTimes(1);
    expect(guarded.answer.mock.calls[0][1]).toEqual({ ownerId: USER, platform: "ebay" });
    expect(guarded.answer.mock.calls[0][2]).toEqual({ waitMs: 30_000 });
  });

  test("throws 'already running' when the guard gives up (null)", async () => {
    guarded.answer.mockResolvedValue(null);
    await expect(poll()).rejects.toThrow("A sales check is already running; press again in a moment");
  });

  test("throws the poll's own error when the report carries one", async () => {
    guarded.answer.mockResolvedValue(report({ error: "eBay did not answer" }));
    await expect(poll()).rejects.toThrow("The sales check failed: eBay did not answer");
  });
});
