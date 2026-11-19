import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// A read-only import of the Playwright suite's env module: vitest transforms it.
import { makeEnv, projectMarker } from "../playwright/support/env.ts";

/**
 * NEO-592 — the attempt in ATTEMPT_ID is `retry + 1` (1 on the first run, 2 on
 * CI's one retry) and the project marker is `m` on the mobile project, so a
 * retry or the mobile run never mints the names of the run before it.
 */
beforeEach(() => {
  vi.stubEnv("WORKER_INDEX", "3");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("makeEnv", () => {
  it("names the retry of the mobile project a2, with the m marker", () => {
    const env = makeEnv("e2e-mobile", 1);
    expect(env.ATTEMPT_ID).toMatch(/^pw3m-a2-\d+$/);
    expect(env.WORKER_KEY).toBe("3m");
    expect(env.ATTEMPT_TOKEN).toMatch(/^pw3ma2\d+$/);
  });

  it("names the first run a1 (attempt 0 is retry 0)", () => {
    expect(makeEnv("e2e-mobile", 0).ATTEMPT_ID).toMatch(/^pw3m-a1-\d+$/);
    expect(makeEnv("e2e", 0).ATTEMPT_ID).toMatch(/^pw3d-a1-\d+$/);
    expect(makeEnv("e2e").ATTEMPT_ID).toMatch(/^pw3d-a1-\d+$/);
  });

  it("a retry and a first run never share a token, nor do desktop and mobile", () => {
    const tokens = [makeEnv("e2e", 0), makeEnv("e2e", 1), makeEnv("e2e-mobile", 0), makeEnv("e2e-mobile", 1)].map((e) =>
      e.ATTEMPT_ID.split("-").slice(0, 2).join("-"), // the part before the random half
    );
    expect(new Set(tokens).size).toBe(4);
  });

  it("marks only a -mobile project m", () => {
    expect(projectMarker("e2e-mobile")).toBe("m");
    expect(projectMarker("e2e")).toBe("d");
    expect(projectMarker("setup")).toBe("d");
  });
});
