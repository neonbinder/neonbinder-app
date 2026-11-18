// NEO-592: the per-shard list of specs that passed only on their retry, and the
// suite's one redactor it (and the console attachment) scrub with. Both live
// under playwright/support/; the unit tests sit here, where vitest collects .mjs.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import FlakyReporter, { flakyEntries } from "../playwright/support/flaky-reporter.mjs";
import { redact, stripAnsi } from "../playwright/support/redact.mjs";

const TEST_DIR = "/repo/apps/web/playwright/tests";

/** A stand-in for Playwright's TestCase, with just what the reporter reads. */
function testCase({ outcome, title = "a spec", file = "collection/copy-photo-upload-retry.spec.ts", project = "e2e", results }) {
  return {
    outcome: () => outcome,
    title,
    location: { file: `${TEST_DIR}/${file}` },
    results,
    parent: { project: () => ({ name: project, testDir: TEST_DIR }) },
  };
}

const failedThenPassed = testCase({
  outcome: "flaky",
  results: [
    { status: "failed", errors: [{ message: "\u001b[31mError: expect(locator).toBeVisible() failed\u001b[39m\n\nLocator: getByRole('status')" }] },
    { status: "passed", errors: [] },
  ],
});

describe("flakyEntries", () => {
  it("lists a retried-then-passed test with its first attempt's error, colour codes gone", () => {
    expect(flakyEntries([failedThenPassed])).toEqual([
      {
        file: "collection/copy-photo-upload-retry.spec.ts",
        title: "a spec",
        project: "e2e",
        firstError: "Error: expect(locator).toBeVisible() failed\n\nLocator: getByRole('status')",
      },
    ]);
  });

  it("leaves out passes, real failures and skips: the gate already reports those", () => {
    const tests = [
      testCase({ outcome: "expected", results: [{ status: "passed" }] }),
      testCase({ outcome: "unexpected", results: [{ status: "failed" }, { status: "failed" }] }),
      testCase({ outcome: "skipped", results: [{ status: "skipped" }] }),
    ];
    expect(flakyEntries(tests)).toEqual([]);
  });

  it("reads a timed-out first attempt's single error, and sorts by file, title, project", () => {
    const timedOut = testCase({
      outcome: "flaky",
      file: "dashboard/a.spec.ts",
      project: "e2e-mobile",
      results: [{ status: "timedOut", error: { message: "Test timeout of 60000ms exceeded." } }, { status: "passed" }],
    });
    const found = flakyEntries([failedThenPassed, timedOut]);
    expect(found.map((e) => `${e.file}|${e.project}|${e.firstError}`)).toEqual([
      "collection/copy-photo-upload-retry.spec.ts|e2e|Error: expect(locator).toBeVisible() failed\n\nLocator: getByRole('status')",
      "dashboard/a.spec.ts|e2e-mobile|Test timeout of 60000ms exceeded.",
    ]);
  });

  it("says so when the first attempt left no message", () => {
    const bare = testCase({ outcome: "flaky", results: [{ status: "interrupted" }, { status: "passed" }] });
    expect(flakyEntries([bare])[0].firstError).toBe("first attempt interrupted, with no error message");
  });

  it("scrubs a secret out of the first error", () => {
    const leaky = testCase({
      outcome: "flaky",
      results: [
        { status: "failed", errors: [{ message: "net::ERR at https://x.clerk.accounts.dev/v1/client?__clerk_testing_token=abc123SECRETvalue&v=5" }] },
        { status: "passed" },
      ],
    });
    const [entry] = flakyEntries([leaky]);
    expect(entry.firstError).not.toContain("abc123SECRETvalue");
    expect(entry.firstError).toContain("https://x.clerk.accounts.dev/v1/client?[query removed]");
  });
});

describe("FlakyReporter", () => {
  const dirs = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("writes the list on every run, [] when nothing was retried", () => {
    const dir = mkdtempSync(join(tmpdir(), "flaky-"));
    dirs.push(dir);
    const outputFile = join(dir, "report", "flaky.json");
    const reporter = new FlakyReporter({ outputFile });
    expect(reporter.printsToStdio()).toBe(false);
    reporter.onBegin({}, { allTests: () => [] });
    reporter.onEnd();
    expect(JSON.parse(readFileSync(outputFile, "utf8"))).toEqual([]);

    reporter.onBegin({}, { allTests: () => [failedThenPassed] });
    reporter.onEnd();
    expect(JSON.parse(readFileSync(outputFile, "utf8"))).toHaveLength(1);
  });
});

describe("redact", () => {
  it.each([
    ["a URL's query and fragment", "GET https://store.example.com/copy-photos/a/image.jpg?X-Amz-Signature=deadbeef#frag", "deadbeef"],
    ["a Clerk testing token", "fetch https://clerk.example.com/v1/x?__clerk_testing_token=tok_9f8e7d", "tok_9f8e7d"],
    ["a JWT", "session eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl here", "eyJhbGciOiJIUzI1NiJ9"],
    ["a Bearer header", "Authorization: Bearer abc.def-ghi", "abc.def-ghi"],
    ["a secret-named pair", 'x-testing-auth: "s3cr3t-value"', "s3cr3t-value"],
    ["a long opaque key", "key 0123456789abcdef0123456789abcdef in a line", "0123456789abcdef0123456789abcdef"],
    ["a Convex deployment's host", "WebSocket wss://happy-otter-123.convex.cloud/api/sync closed", "happy-otter-123"],
    ["an email address", "signed in as nb+abc123@fake.invalid", "nb+abc123@fake.invalid"],
  ])("removes %s", (_what, line, secret) => {
    expect(redact(line)).not.toContain(secret);
  });

  it("keeps what a reader needs: a spec's file name, a path and plain words", () => {
    const line = "at playwright/tests/collection/inventory-bsc-listing-2024-topps-chrome-future-stars.spec.ts:119 Expected: visible";
    expect(redact(line)).toBe(line);
  });

  it("keeps the shape of a masked Convex host", () => {
    expect(redact("fetch https://happy-otter-123.convex.site/x?y=1")).toBe("fetch https://<deployment>.convex.site/x?[query removed]");
  });

  it("strips terminal colour codes", () => {
    expect(stripAnsi("\u001b[31mred\u001b[39m")).toBe("red");
  });
});
