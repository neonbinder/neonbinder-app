/**
 * NEO-487/NEO-552 — `playwright/support/marketplace-wait.ts`: the interval
 * accounting behind "7 s of our own time plus every second the marketplace
 * status was on screen". Driven on a fake clock: the fake locator's `waitFor`
 * moves time on, and the status is a function of time. No browser.
 */
import { errors } from "@playwright/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const annotations: Array<{ type: string; description: string }> = [];
vi.mock("../../playwright/support/fixtures", () => ({
  test: { info: () => ({ annotations }) },
}));

import { expectAfterMarketplace } from "../../playwright/support/marketplace-wait";

const START = 1_800_000_000_000;
const SAMPLE = 250;

/**
 * A page whose status is visible while `statusAt(elapsedMs)` is true, and a
 * target that lands at `landAt` ms (never when null).
 */
function world(statusAt: (ms: number) => boolean, landAt: number | null, failWith?: Error) {
  const elapsed = () => Date.now() - START;
  const status = { isVisible: async () => statusAt(elapsed()) };
  const page = {
    getByRole: () => ({ filter: () => ({ first: () => status }) }),
  };
  const target = {
    waitFor: async () => {
      if (failWith) throw failWith;
      if (landAt !== null && elapsed() + SAMPLE >= landAt) {
        vi.setSystemTime(START + Math.max(landAt, elapsed()));
        return;
      }
      vi.setSystemTime(Date.now() + SAMPLE);
      throw new errors.TimeoutError("waiting");
    },
  };
  return { page: page as never, target: target as never };
}
const wait = (w: ReturnType<typeof world>, o: { cap?: number } = {}) =>
  expectAfterMarketplace(w.page, w.target, { platform: "BuySportsCards", what: "the sheet", ...o });
const note = () => annotations.at(-1)?.description;

beforeEach(() => {
  annotations.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
});
afterEach(() => vi.useRealTimers());

describe("expectAfterMarketplace", () => {
  test("a target that lands with no status is all our own time, and is reported as 0 s held", async () => {
    await wait(world(() => false, 3_000));
    expect(annotations).toHaveLength(1);
    expect(annotations[0].type).toBe("marketplace-wait");
    expect(note()).toBe("the sheet: BuySportsCards held 0.0 s of 3.0 s");
  });

  test("a wait the status covers passes far past 7 s, crediting the 1.5 s the product holds the status back", async () => {
    // Status on from 2 s to the landing at 12.1 s. Counted: 0.5 s..12.0 s.
    await wait(world((ms) => ms >= 2_000, 12_100));
    expect(note()).toBe("the sheet: BuySportsCards held 11.5 s of 12.1 s");
  });

  test("two episodes: the second one's back-credit stops where the first was counted to", async () => {
    // On at 2.0 s only; off; on again from 2.75 s. Counted 0.5..2.25 and 2.25..(landing sample).
    await wait(world((ms) => ms === 2_000 || ms >= 2_750, 2_900));
    // 1.5 s (first episode) + 0.25 s (its trailing sample) + 0.25 s credit + 0.25 s = 2.25 s
    expect(note()).toBe("the sheet: BuySportsCards held 2.3 s of 2.9 s");
  });

  test("without a status, our own time past 7 s fails and names the numbers", async () => {
    const err = await wait(world(() => false, null)).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/the sheet was not on screen: 7\.\d s passed, BuySportsCards held it 0\.0 s, so our own time is 7\.\d s against 7\.0 s/);
    expect(note()).toMatch(/held 0\.0 s of 7\.\d s/);
  });

  test("a status that never ends stops at the cap, whatever it says", async () => {
    const err = await wait(world(() => true, null), { cap: 10_000 }).catch((e: Error) => e);
    expect((err as Error).message).toBe(
      "the sheet was not on screen after the 10.0 s cap (BuySportsCards held it 10.0 s, our own time 0.0 s)",
    );
    expect(note()).toBe("the sheet: BuySportsCards held 10.0 s of 10.0 s");
  });

  test("an error that is not a timeout is rethrown at once", async () => {
    const boom = new Error("page closed");
    await expect(wait(world(() => false, null, boom))).rejects.toBe(boom);
    expect(annotations).toHaveLength(0);
  });
});
