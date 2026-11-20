// Coverage for wait-for-jobs.sh (NEO-628). Stubs `gh` on PATH; node built-ins
// only, same house style as wait-preprocess-revision.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(REPO_ROOT, ".github", "scripts", "wait-for-jobs.sh");

const shard = (i, status, conclusion = null, prefix = "E2E / ") => ({
  name: `${prefix}shard-desktop (${i}, ${i - 1})`, status, conclusion,
});
const extra = (status, conclusion = null) => ({
  name: "E2E / Extra job (desktop)", status, conclusion,
});
const eight = (doneCount, conclusions = [], prefix) =>
  Array.from({ length: 8 }, (_, k) =>
    k < doneCount ? shard(k + 1, "completed", conclusions[k] ?? "success", prefix) : shard(k + 1, "in_progress", null, prefix));

// responses: { "<attempt>": [ jobs[] | "ERR", ... ] }; the last entry repeats.
function makeGh(responses) {
  const dir = mkdtempSync(join(tmpdir(), "nb-gh-stub-"));
  for (const [att, list] of Object.entries(responses)) {
    list.forEach((r, k) => {
      writeFileSync(join(dir, `resp-${att}-${k + 1}`), r === "ERR" ? "ERR" : JSON.stringify({ jobs: r }));
    });
  }
  writeFileSync(join(dir, "gh"), `#!/usr/bin/env bash
DIR="${dir}"
echo "$*" >> "$DIR/calls.log"
url=""; for a in "$@"; do case "$a" in repos/*) url="$a";; esac; done
att=$(echo "$url" | sed -E 's#.*/attempts/([0-9]+)/jobs.*#\\1#')
n=$(cat "$DIR/count-$att" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$DIR/count-$att"
f="$DIR/resp-$att-$n"
if [ ! -f "$f" ]; then f=$(ls "$DIR"/resp-$att-* 2>/dev/null | sort -V | tail -1); fi
if [ -z "$f" ]; then echo "gh: HTTP 404" >&2; exit 1; fi
if grep -q '^ERR' "$f"; then echo "gh: HTTP 502 Bad Gateway" >&2; exit 1; fi
cat "$f"
`);
  chmodSync(join(dir, "gh"), 0o755);
  return dir;
}

function run(responses, extra = [], { attempt = "2" } = {}) {
  const dir = makeGh(responses);
  const r = spawnSync(
    "bash",
    [SCRIPT, "--repo", "o/r", "--run-id", "99", "--attempt", attempt, "--interval", "0.05",
      "--pattern", "^shard-desktop \\(", "--count", "8",
      "--pattern", "^Extra job \\(desktop\\)$", "--count", "1", ...extra],
    { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: "utf8" },
  );
  const calls = existsSync(join(dir, "calls.log")) ? readFileSync(join(dir, "calls.log"), "utf8").trim().split("\n") : [];
  return { ...r, calls };
}

test("7 of 8 shards done keeps waiting, then passes once the 8th completes", () => {
  const r = run({ 2: [[...eight(7), extra("completed", "success")], [...eight(8), extra("completed", "success")]] },
    ["--timeout-min", "1"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.calls.length, 2, "polled exactly twice");
  assert.match(r.stdout, /poll 1: .*7\/8 done/);
});

test("all done with mixed conclusions passes and prints each conclusion", () => {
  const r = run({ 2: [[...eight(8, ["success", "failure", "cancelled", "skipped", "success", "failure", "success", "success"]),
    extra("completed", "failure")]] }, ["--timeout-min", "1"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /shard-desktop \(2, 1\): failure/);
  assert.match(r.stdout, /shard-desktop \(3, 2\): cancelled/);
  assert.match(r.stdout, /Extra job \(desktop\): failure/);
});

test("the E2E / prefix is optional (standalone workflow_dispatch run)", () => {
  const jobs = [...eight(8, [], ""), { name: "Extra job (desktop)", status: "completed", conclusion: "success" }];
  const r = run({ 2: [jobs] }, ["--timeout-min", "1"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("an API error followed by success is retried", () => {
  const ok = [...eight(8), extra("completed", "success")];
  const r = run({ 2: ["ERR", "ERR", ok] }, ["--timeout-min", "1"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.calls.length, 3);
  assert.match(r.stdout, /API error/);
});

test("an API error alone is never treated as done", () => {
  const r = run({ 2: ["ERR"] }, ["--timeout-min", "0.02"]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /::error::Timed out/);
});

test("jobs from another attempt are ignored", () => {
  const allDone = [...eight(8), extra("completed", "success")];
  const r = run({ 1: [allDone], 2: [[...eight(7), extra("completed", "success")]] }, ["--timeout-min", "0.02"]);
  assert.equal(r.status, 1, "attempt 2 is incomplete, attempt 1's finished jobs must not count");
  assert.ok(r.calls.every((c) => c.includes("/attempts/2/jobs")), r.calls.join("\n"));
});

test("a second awaited job (not created yet) keeps waiting", () => {
  const r = run({ 2: [eight(8)] }, ["--timeout-min", "0.02"]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Extra job.* 0\/1 done \(0 created\)/);
});

test("timeout exits non-zero and says Re-run failed jobs is not supported", () => {
  const r = run({ 2: [[...eight(7), extra("in_progress")]] }, ["--timeout-min", "0.02"]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /::error::Timed out after 0\.02 min/);
  assert.match(r.stdout, /Re-run failed jobs.* not supported for E2E/);
});

test("more matches than the count is an error", () => {
  const r = run({ 2: [[...eight(8), shard(9, "completed", "success"), extra("completed", "success")]] }, ["--timeout-min", "1"]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /matched 9 jobs.*expected exactly 8/);
});

test("usage errors exit 2", () => {
  assert.equal(spawnSync("bash", [SCRIPT, "--repo", "o/r"], { encoding: "utf8" }).status, 2);
  assert.equal(spawnSync("bash", [SCRIPT, "--repo", "o/r", "--run-id", "1", "--attempt", "1", "--pattern", "x"], { encoding: "utf8" }).status, 2);
  assert.equal(spawnSync("bash", [SCRIPT, "--bogus"], { encoding: "utf8" }).status, 2);
});
