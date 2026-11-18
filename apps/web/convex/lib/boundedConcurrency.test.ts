import { describe, expect, it } from "vitest";
import { STORAGE_BATCH_WIDTH, mapBounded, memoizeAsync } from "./boundedConcurrency";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("mapBounded", () => {
  it("keeps the input order whatever order the calls finish in", async () => {
    const out = await mapBounded([30, 1, 20, 2, 10], async (ms, i) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return `${i}:${ms}`;
    });
    expect(out).toEqual(["0:30", "1:1", "2:20", "3:2", "4:10"]);
  });

  it("answers an empty list without calling fn", async () => {
    let calls = 0;
    const out = await mapBounded([], async () => {
      calls++;
      return 1;
    });
    expect(out).toEqual([]);
    expect(calls).toBe(0);
  });

  it("never has more than `limit` calls in flight, and uses the whole pool", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapBounded(
      Array.from({ length: 50 }, (_, i) => i),
      async (n) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await tick();
        inFlight--;
        return n * 2;
      },
      5,
    );
    expect(peak).toBe(5);
    expect(out).toEqual(Array.from({ length: 50 }, (_, i) => i * 2));
  });

  it("defaults to the storage batch width", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapBounded(
      Array.from({ length: 100 }, (_, i) => i),
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await tick();
        inFlight--;
      },
    );
    expect(STORAGE_BATCH_WIDTH).toBe(16);
    expect(peak).toBe(STORAGE_BATCH_WIDTH);
  });

  it("settles every in-flight call before it rethrows the first error", async () => {
    const finished: number[] = [];
    let started = 0;
    const failure = new Error("first");
    await expect(
      mapBounded(
        Array.from({ length: 10 }, (_, i) => i),
        async (n) => {
          started++;
          if (n === 1) {
            await tick();
            throw failure;
          }
          // Still running when item 1 rejects; one of them rejects LATER too.
          await new Promise((resolve) => setTimeout(resolve, 20));
          finished.push(n);
          if (n === 2) throw new Error("late");
        },
        3,
      ),
    ).rejects.toBe(failure);
    // The two calls that were in flight beside the failing one ran to the end
    // before the throw reached the caller...
    expect(finished.sort()).toEqual([0, 2]);
    // ...and nothing new was started once one had failed.
    expect(started).toBe(3);
  });

  it("rejects a limit below one", async () => {
    await expect(mapBounded([1], async (n) => n, 0)).rejects.toThrow(/limit/);
  });
});

describe("memoizeAsync", () => {
  it("loads each key once, even when the second caller arrives before the first answers", async () => {
    let loads = 0;
    const load = memoizeAsync(async (key: string) => {
      loads++;
      await tick();
      return key.toUpperCase();
    });
    const [a, b, c] = await Promise.all([load("x"), load("x"), load("y")]);
    expect([a, b, c]).toEqual(["X", "X", "Y"]);
    expect(loads).toBe(2);
  });
});
