// NEO-627: the e2e gate's three-way upstream decision (e2e-upstream-verdict.sh).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "e2e-upstream-verdict.sh");
const OK = { R_SETUP: "success", R_SEED: "success", R_SEED_MOBILE: "success", R_SHARD_DESKTOP: "success", R_BREAKER_DESKTOP: "success" };

function run(over) {
  const dir = mkdtempSync(join(tmpdir(), "nb-upstream-"));
  const summary = join(dir, "summary.md");
  const r = spawnSync("bash", [SCRIPT], {
    env: { PATH: process.env.PATH, GITHUB_STEP_SUMMARY: summary, ...OK, ...over },
    encoding: "utf8",
  });
  const env = {};
  for (const l of r.stdout.split("\n").filter(Boolean)) env[l.slice(0, l.indexOf("="))] = l.slice(l.indexOf("=") + 1);
  return { status: r.status, env, stderr: r.stderr, summary: existsSync(summary) ? readFileSync(summary, "utf8") : "" };
}

test("all green: ok, no flags", () => {
  const r = run({});
  assert.equal(r.status, 0);
  assert.deepEqual(r.env, { UPSTREAM_VERDICT: "ok" });
});

test("desktop red + mobile skipped: fail fast with one plain message and a summary", () => {
  for (const over of [{ R_SHARD_DESKTOP: "failure" }, { R_BREAKER_DESKTOP: "failure" }, { R_SHARD_DESKTOP: "cancelled", R_BREAKER_DESKTOP: "skipped" }]) {
    const r = run({ R_SEED_MOBILE: "skipped", ...over });
    assert.equal(r.status, 0);
    assert.equal(r.env.UPSTREAM_VERDICT, "fail_fast");
    assert.equal(r.env.FAIL_FAST, "1");
    assert.equal(r.env.UPSTREAM_FAILED, undefined);
    assert.match(r.stderr, /mobile pass was skipped because the desktop pass was red \(fail fast/);
    assert.match(r.summary, /Mobile pass skipped \(fail fast\)/);
  }
});

test("setup or the desktop seed failing is upstream_failed, never fail fast", () => {
  for (const over of [{ R_SETUP: "failure" }, { R_SEED: "failure" }, { R_SEED: "skipped" }, { R_SETUP: "" }]) {
    const r = run({ R_SEED_MOBILE: "skipped", R_SHARD_DESKTOP: "skipped", R_BREAKER_DESKTOP: "skipped", ...over });
    assert.equal(r.env.UPSTREAM_VERDICT, "upstream_failed", JSON.stringify(over));
    assert.equal(r.env.UPSTREAM_FAILED, "1");
    assert.equal(r.env.FAIL_FAST, undefined);
  }
});

test("seed-mobile failing or cancelled is upstream_failed", () => {
  for (const v of ["failure", "cancelled", ""]) {
    const r = run({ R_SEED_MOBILE: v });
    assert.equal(r.env.UPSTREAM_VERDICT, "upstream_failed", JSON.stringify(v));
  }
});

test("a skipped seed-mobile after a GREEN desktop pass is a fault, not fail fast", () => {
  const r = run({ R_SEED_MOBILE: "skipped" });
  assert.equal(r.env.UPSTREAM_VERDICT, "upstream_failed");
  assert.equal(r.env.FAIL_FAST, undefined);
});

test("desktop red but seed-mobile somehow ran and passed is ok here (the shard step judges the shards)", () => {
  const r = run({ R_SHARD_DESKTOP: "failure" });
  assert.equal(r.env.UPSTREAM_VERDICT, "ok");
});
