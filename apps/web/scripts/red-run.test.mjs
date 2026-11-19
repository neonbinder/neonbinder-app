// NEO-398: playwright/red-run.mjs reads a blob report's report.jsonl and keeps every
// test with a red result, one entry per red try (a retried spec has several). The
// unit tests sit here, where vitest collects .mjs (vitest.include.mjs).
import { describe, expect, it } from "vitest";
import { attemptOf, redTests } from "../playwright/red-run.mjs";

const ev = (method, params) => JSON.stringify({ method, params });
const project = ev("onProject", {
  project: {
    name: "e2e",
    suites: [
      {
        title: "binders/delete.spec.ts",
        location: { file: "binders/delete.spec.ts" },
        entries: [
          { testId: "t-retried", title: "deletes a binder" },
          { testId: "t-flaky", title: "renames a binder" },
          { testId: "t-green", title: "lists binders" },
          { title: "a describe", location: { file: "binders/delete.spec.ts" }, entries: [{ testId: "t-expected-fail", title: "known bug" }] },
          { testId: "t-skipped", title: "seller only" },
        ],
      },
    ],
  },
});
const run = (testId, id, retry, start, status, { expected = "passed", error, attachments = [] } = {}) => [
  ev("onTestBegin", { testId, result: { id, retry, startTime: start } }),
  ...attachments.map((a) => ev("onAttach", { testId, resultId: id, attachments: [a] })),
  ev("onTestEnd", {
    test: { testId, expectedStatus: expected },
    result: { id, duration: 1000, status, errors: error ? [{ message: error }] : [] },
  }),
];
const jsonl = [
  project,
  ...run("t-retried", "r1", 0, 1000, "failed", {
    error: "\u001b[2mexpect(\u001b[22mlocator).toBeVisible() failed",
    attachments: [
      { name: "screenshot", path: "resources/a.png", contentType: "image/png" },
      { name: "client-wire.log", contentType: "text/plain", base64: Buffer.from("  12ms -> Mutation #1 binders:remove").toString("base64") },
    ],
  }),
  ...run("t-retried", "r2", 1, 5000, "timedOut", { error: "Test timeout of 1200000ms exceeded." }),
  ...run("t-flaky", "r3", 0, 9000, "failed", { error: "boom" }),
  ...run("t-flaky", "r4", 1, 12000, "passed"),
  ...run("t-green", "r5", 0, 15000, "passed"),
  ...run("t-expected-fail", "r6", 0, 16000, "failed", { expected: "failed" }),
  ...run("t-skipped", "r7", 0, 17000, "skipped"),
  "",
].join("\n");

describe("redTests", () => {
  const tests = redTests(jsonl);
  const byId = Object.fromEntries(tests.map((t) => [t.testId, t]));

  it("keeps only tests with a red try (not green, expected failures or skips)", () => {
    expect(tests.map((t) => t.testId).sort()).toEqual(["t-flaky", "t-retried"]);
  });

  it("keeps every red try of a retried test, in order, with its own window and error", () => {
    const t = byId["t-retried"];
    expect(t).toMatchObject({ title: "deletes a binder", file: "binders/delete.spec.ts", project: "e2e", flaky: false, tries: 2 });
    expect(t.red.map((r) => [r.retry, r.status, r.start, r.end])).toEqual([
      [0, "failed", 1000, 2000],
      [1, "timedOut", 5000, 6000],
    ]);
    expect(t.red[0].error).toBe("expect(locator).toBeVisible() failed");
    expect(t.red[0].attachments.map((a) => a.name)).toEqual(["screenshot", "client-wire.log"]);
    expect(t.red[1].attachments).toEqual([]);
  });

  it("marks a test whose last try passed as flaky, with its red try", () => {
    const t = byId["t-flaky"];
    expect(t.flaky).toBe(true);
    expect(t.red.map((r) => r.retry)).toEqual([0]);
  });

  it("titles a test inside a describe with the describe's name", () => {
    const withDescribe = redTests(
      [project, ...run("t-expected-fail", "x1", 0, 1, "passed", { expected: "failed" })].join("\n"),
    );
    expect(withDescribe[0].title).toBe("a describe › known bug");
  });
});

describe("attemptOf", () => {
  it("reads e2e.yml's -a<attempt> suffix, 0 when there is none", () => {
    expect(attemptOf("pw-report-desktop-3-a2")).toBe(2);
    expect(attemptOf("convex-logs-seed-mobile-a11")).toBe(11);
    expect(attemptOf("pw-report-desktop-3")).toBe(0);
  });
});
