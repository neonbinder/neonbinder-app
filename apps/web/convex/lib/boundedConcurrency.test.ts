import { describe, expect, it } from "vitest";
import { STORAGE_BATCH_WIDTH, mapBounded, memoizeAsync, settleAll } from "./boundedConcurrency";

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

  // The limit check is `Number.isInteger(limit) && limit >= 1`: anything else is
  // refused up front, before any item is started. Pinned as current behaviour:
  // a fractional limit is not rounded and NaN is not "unbounded".
  it.each([
    ["a fractional limit", 1.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a negative limit", -3],
  ])("rejects %s without starting any call", async (_label, limit) => {
    let calls = 0;
    await expect(
      mapBounded(
        [1, 2, 3],
        async (n) => {
          calls++;
          return n;
        },
        limit,
      ),
    ).rejects.toThrow(/limit must be a positive integer/);
    expect(calls).toBe(0);
  });

  it("rejects a bad limit even for an empty list", async () => {
    await expect(mapBounded([], async (n) => n, Number.NaN)).rejects.toThrow(/limit/);
  });

  it("runs every item at once, and no more, when the limit exceeds the list", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapBounded(
      [10, 20, 30],
      async (n, i) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await tick();
        inFlight--;
        return `${i}:${n}`;
      },
      1000,
    );
    expect(peak).toBe(3);
    expect(out).toEqual(["0:10", "1:20", "2:30"]);
  });

  it("treats a synchronous throw inside fn like a rejection: siblings settle, then it is rethrown", async () => {
    const failure = new Error("sync boom");
    const finished: number[] = [];
    let started = 0;
    await expect(
      mapBounded(
        [0, 1, 2, 3, 4, 5],
        // Deliberately NOT async: item 1 throws before returning any promise.
        (n): Promise<void> => {
          started++;
          if (n === 1) throw failure;
          return new Promise((resolve) =>
            setTimeout(() => {
              finished.push(n);
              resolve();
            }, 10),
          );
        },
        3,
      ),
    ).rejects.toBe(failure);
    // The throw lands before the third worker takes its first item, so only
    // item 0 was in flight beside it: it ran to the end, and nothing new began.
    expect(finished).toEqual([0]);
    expect(started).toBe(2);
  });
});

describe("settleAll", () => {
  const later = <T>(ms: number, value: T) =>
    new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

  it("returns each value in its argument position, whatever order they finish in and whatever their types", async () => {
    const out = await settleAll<[string, number, { ok: boolean }, null]>([
      later(30, "slow"),
      later(1, 42),
      later(10, { ok: true }),
      Promise.resolve(null),
    ]);
    expect(out).toEqual(["slow", 42, { ok: true }, null]);
  });

  it("throws the rejection of the earliest ARGUMENT, not the earliest in time, and only after the slow sibling settled", async () => {
    let slowSettled = false;
    const slowError = new Error("promise 0 (slow)");
    const fastError = new Error("promise 2 (fast)");
    const p0 = new Promise<never>((_, reject) =>
      setTimeout(() => {
        slowSettled = true;
        reject(slowError);
      }, 30),
    );
    const p1 = later(5, "fine");
    const p2 = new Promise<never>((_, reject) => setTimeout(() => reject(fastError), 1));
    await expect(settleAll<[never, string, never]>([p0, p1, p2])).rejects.toBe(slowError);
    // `Promise.all` would have thrown fastError at 1 ms with promise 0 still running.
    expect(slowSettled).toBe(true);
  });

  it("leaves no rejection unhandled when several inputs reject", async () => {
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown) => seen.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      await expect(
        settleAll<[never, never]>([
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("a")), 1)),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("b")), 10)),
        ]),
      ).rejects.toThrow("a");
      await new Promise((resolve) => setTimeout(resolve, 30));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(seen).toEqual([]);
  });

  it("resolves an empty tuple to an empty array", async () => {
    expect(await settleAll<[]>([])).toEqual([]);
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

describe("memoizeAsync and a rejected load", () => {
  // Pinned as current behaviour, not endorsed: the PROMISE is cached, so a load
  // that rejects stays rejected for its key for the life of the memo. The next
  // caller gets the same rejection and `load` is not asked again.
  it("caches the rejection: the same key fails again without a second load, while other keys still load", async () => {
    let loads = 0;
    const failure = new Error("storage hiccup");
    const load = memoizeAsync(async (key: string) => {
      loads++;
      if (key === "bad") throw failure;
      return key.toUpperCase();
    });
    await expect(load("bad")).rejects.toBe(failure);
    await expect(load("bad")).rejects.toBe(failure);
    expect(loads).toBe(1);
    await expect(load("good")).resolves.toBe("GOOD");
    expect(loads).toBe(2);
  });
});
