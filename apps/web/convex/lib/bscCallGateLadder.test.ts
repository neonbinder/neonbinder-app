/**
 * PR 451 (NEO-487), moved by NEO-552 — the 429 ladder's arithmetic, now in
 * `lib/bscCallGatePolicy.ts` (it was `marketplaceCooldowns.ts`). The stored
 * gate built on it is pinned in `bscCallGate.test.ts`.
 */
import { describe, expect, test } from "vitest";
import {
  COOLDOWN_BASE_MS,
  COOLDOWN_MAX_MS,
  COOLDOWN_STREAK_RESET_MS,
  RETRY_AFTER_MAX_MS,
  nextCooldown,
  parseRetryAfterMs,
  successResetsStreak,
} from "./bscCallGatePolicy";

const NOW = 1_800_000_000_000;

describe("nextCooldown", () => {
  test("the constants match BSC's measured 15-45 s lockout (NEO-482)", () => {
    expect(COOLDOWN_BASE_MS).toBe(15_000);
    expect(COOLDOWN_MAX_MS).toBe(120_000);
    expect(RETRY_AFTER_MAX_MS).toBe(600_000);
  });

  test("the first 429 opens a 15 second window with streak 1", () => {
    expect(nextCooldown(null, NOW)).toEqual({ until: NOW + 15_000, streak: 1, escalated: true });
  });

  test("consecutive windows with no success between escalate 15 s, 30 s, 60 s, then the 120 s cap", () => {
    let row: { until: number; last429At: number; streak: number } | null = null;
    let at = NOW;
    const windows: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const next = nextCooldown(row, at);
      windows.push(next.until - at);
      row = { until: next.until, last429At: at, streak: next.streak };
      at = next.until + 1; // the window has lapsed, well inside the 15 min reset
    }
    expect(windows).toEqual([15_000, 30_000, 60_000, 120_000, 120_000, 120_000]);
  });

  test("a 429 inside an open window leaves the window and the streak alone", () => {
    const row = { until: NOW + 30_000, last429At: NOW - 30_000, streak: 3 };
    expect(nextCooldown(row, NOW)).toEqual({ until: NOW + 30_000, streak: 3, escalated: false });
    // Even a huge Retry-After does not extend a live window.
    expect(nextCooldown(row, NOW, 9_999_999)).toEqual({ until: NOW + 30_000, streak: 3, escalated: false });
  });

  test("a window that lapsed more than 15 minutes ago starts the streak over", () => {
    const row = { until: NOW - COOLDOWN_STREAK_RESET_MS, last429At: NOW - COOLDOWN_STREAK_RESET_MS - 1, streak: 5 };
    expect(nextCooldown(row, NOW)).toMatchObject({ streak: 1, until: NOW + COOLDOWN_BASE_MS });
  });

  test("a 429 exactly 15 minutes after the last still continues the streak", () => {
    const row = { until: NOW - 1, last429At: NOW - COOLDOWN_STREAK_RESET_MS, streak: 2 };
    expect(nextCooldown(row, NOW)).toMatchObject({ streak: 3, until: NOW + 60_000 });
  });

  test("a row whose streak a success reset to 0 opens the base window again", () => {
    const row = { until: NOW - 1_000, last429At: NOW - 16_000, streak: 0 };
    expect(nextCooldown(row, NOW)).toEqual({ until: NOW + COOLDOWN_BASE_MS, streak: 1, escalated: true });
  });

  test("the longer of the doubled window and Retry-After wins", () => {
    expect(nextCooldown(null, NOW, 150_000).until).toBe(NOW + 150_000);
    // Retry-After shorter than the base window does not shorten it.
    expect(nextCooldown(null, NOW, 5_000).until).toBe(NOW + COOLDOWN_BASE_MS);
  });

  test("Retry-After is honoured past the 120 s cap, up to 10 minutes", () => {
    expect(nextCooldown(null, NOW, 300_000).until).toBe(NOW + 300_000);
    expect(nextCooldown(null, NOW, 3_600_000).until).toBe(NOW + RETRY_AFTER_MAX_MS);
  });

  test.each([[0], [-5], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    "a Retry-After of %s is ignored",
    (retryAfter) => {
      expect(nextCooldown(null, NOW, retryAfter).until).toBe(NOW + COOLDOWN_BASE_MS);
    },
  );

  test("a very long streak cannot overflow the cap", () => {
    const row = { until: NOW - 1, last429At: NOW - 1, streak: 5_000 };
    expect(nextCooldown(row, NOW).until).toBe(NOW + COOLDOWN_MAX_MS);
  });
});

describe("successResetsStreak", () => {
  const closed = { until: NOW - 1_000, last429At: NOW - 16_000, streak: 2 };

  test("a call asked after the window closed resets a live streak", () => {
    expect(successResetsStreak(closed, NOW, NOW - 500)).toBe(true);
    expect(successResetsStreak(closed, NOW, closed.until)).toBe(true);
  });

  test("a call already in flight when the window opened does not", () => {
    expect(successResetsStreak(closed, NOW, closed.until - 1)).toBe(false);
  });

  test("nothing resets while a window is open", () => {
    expect(successResetsStreak({ ...closed, until: NOW + 5_000 }, NOW, NOW)).toBe(false);
  });

  test("no row, or a streak already at 0, has nothing to reset", () => {
    expect(successResetsStreak(null, NOW, NOW)).toBe(false);
    expect(successResetsStreak({ ...closed, streak: 0 }, NOW, NOW)).toBe(false);
  });
});

describe("parseRetryAfterMs", () => {
  test("delta-seconds become milliseconds", () => {
    expect(parseRetryAfterMs("120", NOW)).toBe(120_000);
    expect(parseRetryAfterMs("  7 ", NOW)).toBe(7_000);
  });

  test("an HTTP date is the distance from now", () => {
    const at = new Date(NOW + 90_000).toUTCString();
    expect(parseRetryAfterMs(at, NOW)).toBe(90_000);
  });

  test("an HTTP date in the past is zero, not negative", () => {
    expect(parseRetryAfterMs(new Date(NOW - 5_000).toUTCString(), NOW)).toBe(0);
  });

  test.each([[undefined], [null], [""], ["soon"], ["x".repeat(80)]])(
    "%s is not a Retry-After",
    (value) => {
      expect(parseRetryAfterMs(value as string | null | undefined, NOW)).toBeUndefined();
    },
  );

  // "-5" and "1.5" are not delta-seconds; V8's Date.parse reads them as dates
  // far in the past, so they come back as a zero wait. `nextCooldown` ignores
  // a zero, so either answer ends in the same window.
  test.each([["-5"], ["1.5"]])("%s never yields a positive wait", (value) => {
    expect(parseRetryAfterMs(value, NOW) ?? 0).toBe(0);
  });
});
