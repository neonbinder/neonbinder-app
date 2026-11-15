/**
 * NEO-552 — the copy a collector or operator reads when NeonBinder's own BSC
 * call gate held a call back. BSC was never asked: no status, no blame, no
 * internal word.
 */
import { describe, expect, test } from "vitest";
import { BSC_PACED_MARKER, BSC_PACED_SELLER, bscPacedCatalogueMessage, pacedRetryAfterS } from "./bscPacedCopy";

const INTERNAL = /\d{3}|error|fumbl|snooz|gate|breaker|thrott|rate.?limit|retry-after/i;

describe("bscPacedCatalogueMessage", () => {
  test.each([
    [undefined, "a minute"],
    [0, "a minute"],
    [-5, "a minute"],
    [Number.NaN, "a minute"],
    [1, "about 1 second"],
    [14.2, "about 15 seconds"],
    [90, "about 90 seconds"],
    [91, "about 2 minutes"],
    [600, "about 10 minutes"],
  ] as const)("Retry-After %s → %s", (retryAfterS, wait) => {
    expect(bscPacedCatalogueMessage(retryAfterS)).toBe(
      `NeonBinder is pacing its calls to BuySportsCards, so it didn't ask just now. No sweat: give it ${wait} and try again.`,
    );
  });

  test("every line carries the marker the classifiers read, and no internal word", () => {
    for (const s of [BSC_PACED_SELLER, bscPacedCatalogueMessage(), bscPacedCatalogueMessage(30)]) {
      expect(s).toContain(BSC_PACED_MARKER);
      expect(s.replace(/about \d+ (second|minute)s?/, "")).not.toMatch(INTERNAL);
    }
  });
});

describe("pacedRetryAfterS", () => {
  test.each([
    [null, undefined],
    ["", undefined],
    ["abc", undefined],
    ["0", undefined],
    ["-3", undefined],
    ["12", 12],
  ] as const)("%s → %s", (raw, expected) => {
    const headers = new Headers(raw === null ? {} : { "retry-after": raw });
    expect(pacedRetryAfterS(headers)).toBe(expected);
  });
});
