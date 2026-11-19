// Specs that passed only on their retry, per shard (NEO-592).
//
// CI retries a failed spec once (playwright.config.ts, GUIDE hard rule 5). A spec
// that failed and then passed is "flaky" in Playwright's terms: the gate counts it
// as passed (its last result is), so without a list nobody would see it. This
// reporter writes that list for the job it ran in, as JSON:
//
//   [{ "file": "collection/x.spec.ts", "title": "...", "project": "e2e",
//      "firstError": "Error: expect(locator).toBeVisible() failed\n..." }, ...]
//
// to `outputFile` (the config puts it at `<PW_REPORT_DIR>/flaky.json`, beside the
// blob report). It is written on every run, `[]` when nothing was retried, so a
// reader can tell "none" from "never written". `.github/scripts/retry-summary.sh
// shard` turns it into the job summary's table; `retry-summary.sh combined` does
// the whole run from the merged JSON report. The file lands in a public artifact,
// so `firstError` is ANSI-stripped and scrubbed by the suite's one redactor
// (./redact.mjs).
//
// A Playwright reporter in plain .mjs: the config loads it by path; the pure part
// (`flakyEntries`) is tested in scripts/flaky-reporter.test.mjs.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { redact, stripAnsi } from "./redact.mjs";

/** How much of a first attempt's error the entry keeps. */
const ERROR_CHARS = 2_000;

/**
 * One entry per test whose outcome is "flaky" (failed, retried, last result passed).
 * @param {Array<{ outcome(): string, title: string, location: { file: string },
 *   results: Array<{ status: string, error?: { message?: string }, errors?: Array<{ message?: string }> }>,
 *   parent: { project(): { name: string, testDir: string } | undefined } }>} tests
 * @returns {Array<{ file: string, title: string, project: string, firstError: string }>}
 */
export function flakyEntries(tests) {
  return tests
    .filter((t) => t.outcome() === "flaky")
    .map((t) => {
      const project = t.parent.project();
      const first = t.results.find((r) => r.status !== "passed" && r.status !== "skipped") ?? t.results[0];
      const errors = first?.errors?.length ? first.errors : first?.error ? [first.error] : [];
      const message = errors.map((e) => e.message ?? "").join("\n");
      const file = project ? path.relative(project.testDir, t.location.file) : path.basename(t.location.file);
      return {
        file: file.split(path.sep).join("/"),
        title: t.title,
        project: project?.name ?? "",
        firstError:
          redact(stripAnsi(message))
            .slice(0, ERROR_CHARS)
            .trim() || `first attempt ${first?.status ?? "unknown"}, with no error message`,
      };
    })
    .sort((a, b) => a.file.localeCompare(b.file) || a.title.localeCompare(b.title) || a.project.localeCompare(b.project));
}

export default class FlakyReporter {
  /** @param {{ outputFile?: string }} [options] */
  constructor(options = {}) {
    this.outputFile = options.outputFile ?? "playwright/report/flaky.json";
    /** @type {any} */
    this.root = undefined;
  }

  printsToStdio() {
    return false;
  }

  /** @param {unknown} _config @param {any} suite */
  onBegin(_config, suite) {
    this.root = suite;
  }

  onEnd() {
    const entries = this.root ? flakyEntries(this.root.allTests()) : [];
    mkdirSync(path.dirname(this.outputFile), { recursive: true });
    writeFileSync(this.outputFile, `${JSON.stringify(entries, null, 2)}\n`);
  }
}
