#!/usr/bin/env node
/**
 * NEO-591 — fail the run when any single unit test takes over 2 seconds.
 *
 * A test that takes seconds waits on the wall clock (a real 1.5s retry delay,
 * a findBy with a 3s budget) or renders a whole screen to prove one unit. It
 * passes alone and fails as a random timeout when a full run saturates the
 * CPU. Fix it by faking the timer or shrinking what is rendered; do not raise
 * a timeout, and do not widen this limit.
 *
 * Usage: node scripts/verify-test-duration.mjs [resultsFile]
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { MAX_TEST_MS, collectDurations, confirmSlow, findSlow } from "./test-duration.mjs";

const WEB_ROOT = path.resolve(import.meta.dirname, "..");
const resultsFile = path.resolve(WEB_ROOT, process.argv[2] ?? ".vitest-results.json");

let report;
try {
  report = JSON.parse(readFileSync(resultsFile, "utf8"));
} catch (err) {
  console.error(`\n✖ test duration check FAILED: could not read ${resultsFile}\n    ${err.message ?? err}`);
  process.exit(1);
}

const all = collectDurations(report);
if (all.length === 0) {
  console.error("\n✖ test duration check FAILED: the report holds no test durations (a vacuous pass is no pass).");
  process.exit(1);
}

const flagged = findSlow(all);

/** Re-run one file by itself and return its durations ([] if the rerun died). */
function runAlone(file) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "nb-duration-"));
  const out = path.join(dir, "r.json");
  try {
    spawnSync("npx", ["vitest", "run", path.relative(WEB_ROOT, file), "--reporter=json", `--outputFile=${out}`], {
      cwd: WEB_ROOT,
      stdio: "ignore",
    });
    return collectDurations(JSON.parse(readFileSync(out, "utf8")));
  } catch {
    return [];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let slow = [];
if (flagged.length > 0) {
  // A slow reading in a full run may be machine load, not the test: only a
  // test still over the limit when its file runs alone fails the run.
  const files = [...new Set(flagged.map((f) => f.file))];
  console.log(`test duration: ${flagged.length} test(s) over ${MAX_TEST_MS} ms in the full run; re-running ${files.length} file(s) alone to rule out load...`);
  const alone = files.flatMap(runAlone);
  slow = confirmSlow(flagged, alone);
}
if (slow.length > 0) {
  console.error(`\n✖ test duration check FAILED: ${slow.length} test(s) took over ${MAX_TEST_MS} ms\n`);
  for (const s of slow) {
    console.error(`    ${Math.round(s.ms)} ms in the run, ${s.aloneMs === undefined ? "no result alone" : Math.round(s.aloneMs) + " ms alone"}  ${path.relative(WEB_ROOT, s.file)}\n             ${s.title}`);
  }
  console.error(
    "\nNEO-591: a unit test never depends on the wall clock. Fake the timer (vi.useFakeTimers)\n" +
      "or render only the unit under test. Do not raise a timeout or this limit.\n",
  );
  process.exit(1);
}
console.log(`✓ test duration: ${all.length} tests, none over ${MAX_TEST_MS} ms${flagged.length ? ` alone (${flagged.length} slow only under load)` : ""}`);
