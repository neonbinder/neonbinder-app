// NEO-686: structural pins for the fake BSC cold-start handling in e2e.yml. Reads the workflow
// text (no YAML parser is a dependency of this runner), like workflow-e2e-inert-wiring.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const e2e = readFileSync(join(REPO_ROOT, ".github/workflows/e2e.yml"), "utf8").split("\n");

// The lines from the line matching `startRe` up to (not including) the next step (`      - name:`).
function step(startRe) {
  const start = e2e.findIndex((l) => startRe.test(l));
  assert.notEqual(start, -1, `step ${startRe} not found`);
  let end = e2e.length;
  for (let i = start + 1; i < e2e.length; i++) {
    if (/^ {6}- name:/.test(e2e[i])) { end = i; break; }
  }
  return e2e.slice(start, end);
}

test("the wake step runs in the background, never fails the job, and holds no stdin", () => {
  const lines = step(/^ {6}- name: Wake the fake BSC/).map((l) => l.trim());
  assert.ok(
    lines.some((l) => l.startsWith("( npx") && l.includes("fakeBsc:writeCaptureStatus") && l.endsWith("|| true ) \\")),
    "the convex run is wrapped in ( ... || true )",
  );
  assert.ok(lines.includes('> "${RUNNER_TEMP}/fake-bsc-wake.log" 2>&1 < /dev/null &'), "background, logged, stdin from /dev/null");
  assert.ok(lines.includes("disown"), "the background job is disowned");
});

test("a health timeout gets the cold-start message, any other error the generic one", () => {
  const text = step(/^ {6}- name: Require a stored write capture/).join("\n");
  const caseAt = text.indexOf('case "$(jq -r \'.error // ""\' "$out")" in');
  assert.notEqual(caseAt, -1, "the error text is chosen by a case on .error");
  const body = text.slice(caseAt);
  const timeoutArm = body.match(/TimeoutError\|AbortError\)\s*\n\s*echo "::error::([^\n]*)"\s*\n\s*;;/);
  assert.ok(timeoutArm, "TimeoutError|AbortError is one arm with its own message");
  assert.match(timeoutArm[1], /did not answer its health check within the 120 s cold-start budget/);
  const otherArm = body.match(/\*\)\s*\n\s*echo "::error::([^\n]*)"\s*\n\s*;;/);
  assert.ok(otherArm, "a default arm keeps the generic message");
  assert.match(otherArm[1], /^Could not read the fake BSC's write-capture status/);
  assert.ok(body.indexOf("TimeoutError|AbortError)") < body.indexOf("*)"), "the timeout arm comes before the default");
});
