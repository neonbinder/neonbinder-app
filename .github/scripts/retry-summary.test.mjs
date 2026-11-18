// NEO-592: retry-summary.sh tables for retried ("flaky") specs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "retry-summary.sh");
const dir = mkdtempSync(join(tmpdir(), "retry-summary-"));

function run(args) {
  const r = spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

test("shard: one row per entry, pipes escaped, nothing when empty or missing", () => {
  const f = join(dir, "flaky.json");
  writeFileSync(f, JSON.stringify([
    { file: "a/b.spec.ts", title: "does a | b", project: "e2e", firstError: "\u001b[31mTimeout\u001b[39m of 7000ms\nsecond line" },
  ]));
  const out = run(["shard", f, "desktop shard 3"]);
  assert.match(out, /#### Retried specs \(desktop shard 3\)/);
  assert.match(out, /\| e2e \| a\/b\.spec\.ts \| does a \\\| b \| Timeout of 7000ms \|/);
  assert.doesNotMatch(out, /second line/);
  writeFileSync(f, "[]");
  assert.equal(run(["shard", f, "x"]), "");
  assert.equal(run(["shard", join(dir, "missing.json"), "x"]), "");
});

test("combined: only tests that failed then passed; double failures and clean passes are not listed", () => {
  const f = join(dir, "results.json");
  const t = (projectName, results) => ({ projectName, results });
  writeFileSync(f, JSON.stringify({
    suites: [{ file: "x.spec.ts", specs: [
      { title: "flaky one", tests: [t("e2e", [{ status: "failed", error: { message: "boom" } }, { status: "passed" }])] },
      { title: "always red", tests: [t("e2e", [{ status: "failed" }, { status: "failed" }])] },
      { title: "clean", tests: [t("e2e-mobile", [{ status: "passed" }])] },
    ], suites: [{ specs: [
      { title: "nested flaky", tests: [t("e2e-mobile", [{ status: "timedOut", error: { message: "slow" } }, { status: "passed" }])] },
    ] }] }],
  }));
  const out = run(["combined", f]);
  assert.match(out, /flaky one/);
  assert.match(out, /nested flaky/);
  assert.doesNotMatch(out, /always red|clean/);
});

test("masks private values in the first error", () => {
  const f = join(dir, "flaky2.json");
  writeFileSync(f, JSON.stringify([{ file: "f", title: "t", project: "e2e", firstError: "fetch https://abc-def-123.convex.cloud failed for a@b.io" }]));
  const out = run(["shard", f, "s"]);
  assert.doesNotMatch(out, /convex\.cloud|a@b\.io/);
});
