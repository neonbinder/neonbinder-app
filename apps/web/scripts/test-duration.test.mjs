/**
 * NEO-591 — the slow-test guard has to fail when it should; a guard that
 * passes vacuously is worse than none.
 */
import { describe, expect, it } from "vitest";

import { MAX_TEST_MS, collectDurations, confirmSlow, findSlow } from "./test-duration.mjs";

const report = (...tests) => ({
  testResults: [{ name: "/w/a.test.ts", assertionResults: tests }],
});
const t = (fullName, duration, status = "passed") => ({ fullName, title: fullName, duration, status });

describe("collectDurations", () => {
  it("reads passed and failed tests, and skips skipped ones and ones with no duration", () => {
    const got = collectDurations(report(t("a", 5), t("b", 9, "failed"), t("c", 1, "skipped"), { fullName: "d", status: "passed" }));
    expect(got.map((d) => d.title)).toEqual(["a", "b"]);
  });

  it("names a test from its ancestors when fullName is absent", () => {
    const got = collectDurations(report({ ancestorTitles: ["suite"], title: "case", duration: 1, status: "passed" }));
    expect(got[0].title).toBe("suite > case");
  });

  it("returns nothing for an empty or malformed report", () => {
    expect(collectDurations({})).toEqual([]);
    expect(collectDurations(null)).toEqual([]);
  });
});

describe("findSlow", () => {
  it("flags a test over the limit, slowest first, and never one at the limit", () => {
    const slow = findSlow(collectDurations(report(t("ok", MAX_TEST_MS), t("slow", MAX_TEST_MS + 1), t("slower", 9000))));
    expect(slow.map((s) => s.title)).toEqual(["slower", "slow"]);
  });

  it("catches the planted two-and-a-half-second wait", () => {
    expect(findSlow(collectDurations(report(t("await new Promise(r => setTimeout(r, 2500))", 2503)))).length).toBe(1);
  });
});

describe("confirmSlow", () => {
  const flagged = [{ file: "/w/a.test.ts", title: "x", ms: 4000 }];
  it("clears a test that is fast when its file runs alone (load, not the test)", () => {
    expect(confirmSlow(flagged, [{ file: "/w/a.test.ts", title: "x", ms: 300 }])).toEqual([]);
  });
  it("keeps a test that is still over the limit alone, with its alone time", () => {
    expect(confirmSlow(flagged, [{ file: "/w/a.test.ts", title: "x", ms: 2600 }])).toMatchObject([{ title: "x", aloneMs: 2600 }]);
  });
  it("keeps a test the rerun never reported: fail closed", () => {
    expect(confirmSlow(flagged, []).length).toBe(1);
  });
});
