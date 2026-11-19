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
});

test("shard: `[]` says no retried specs; a missing file says it was not written", () => {
  const f = join(dir, "empty.json");
  writeFileSync(f, "[]");
  const none = run(["shard", f, "x"]);
  assert.match(none, /No retried specs\./);
  const missing = run(["shard", join(dir, "missing.json"), "x"]);
  assert.match(missing, /did not write flaky\.json/);
  assert.doesNotMatch(missing, /No retried specs/);
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
  assert.doesNotMatch(out, /abc-def-123|a@b\.io/);
});

const report = (tests) => ({ suites: [{ file: "x.spec.ts", specs: tests }] });
const spec = (title, projectName, results, annotations = []) => ({ title, tests: [{ projectName, results, annotations }] });

test("combined: redacts the whole message before cutting it (an email and a host straddling column 160)", () => {
  const f = join(dir, "straddle.json");
  const pad = "x".repeat(150);
  writeFileSync(f, JSON.stringify(report([
    spec("emailed", "e2e", [{ status: "failed", error: { message: `${pad} sometest@neonbinder.example tail` } }, { status: "passed" }]),
    spec("hosted", "e2e", [{ status: "failed", error: { message: `${pad.slice(0, 140)} https://abc-def-123.convex.cloud/api` } }, { status: "passed" }]),
  ])));
  const out = run(["combined", f]);
  assert.doesNotMatch(out, /sometest|@neo|abc-def|convex\.clo/);
  assert.match(out, /emailed/);
  assert.match(out, /hosted/);
});

test("combined: a URL carrying a Clerk testing token, a JWT, a Bearer value and token= pair never reaches the summary", () => {
  const f = join(dir, "crafted.json");
  const message = [
    "GET https://clerk.example.test/v1/client?__clerk_testing_token=FAKETOKEN123",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl Bearer FAKEBEARER9 token=FAKEPAIR7",
  ].join(" ");
  writeFileSync(f, JSON.stringify(report([spec("crafted", "e2e", [{ status: "failed", error: { message } }, { status: "passed" }])])));
  const out = run(["combined", f]);
  assert.doesNotMatch(out, /FAKETOKEN123|__clerk_testing_token|eyJ|FAKEBEARER9|FAKEPAIR7/);
  assert.match(out, /crafted/);
});

test("combined: failure resets that failed get their own table, from result or test annotations", () => {
  const f = join(dir, "resets.json");
  const failed = { type: "failure-reset", description: "FAILED after 12.3s: the worker's next test may inherit this one's state" };
  const ok = { type: "failure-reset", description: "worker 2's account reset and re-seeded after the red result, in 4.1s" };
  writeFileSync(f, JSON.stringify(report([
    // The first attempt's reset failed; the retry passed, so the test-level list lost it.
    spec("retried reset failed", "e2e", [{ status: "failed", annotations: [failed] }, { status: "passed", annotations: [] }]),
    spec("red reset failed", "e2e-mobile", [{ status: "failed", annotations: [] }], [failed]),
    spec("reset worked", "e2e", [{ status: "failed", annotations: [ok] }], [ok]),
  ])));
  const out = run(["combined", f]);
  const section = out.split("### Failure resets that failed")[1] ?? "";
  assert.match(section, /retried reset failed/);
  assert.match(section, /red reset failed/);
  assert.match(section, /FAILED after 12\.3s/);
  assert.doesNotMatch(section, /reset worked/);
  assert.equal((section.match(/red reset failed/g) ?? []).length, 1);
});

test("combined: nothing printed when no test retried and no reset failed", () => {
  const f = join(dir, "clean.json");
  writeFileSync(f, JSON.stringify(report([spec("fine", "e2e", [{ status: "passed" }])])));
  assert.equal(run(["combined", f]), "");
});
