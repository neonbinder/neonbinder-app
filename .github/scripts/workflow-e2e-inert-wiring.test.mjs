// NEO-627: structural pins for the inert-path skip (pr-pipeline.yml) and the
// fail-fast mobile skip (e2e.yml). These read the workflow text (no YAML parser
// is a dependency of this runner), like workflow-path-filters.test.mjs, so a
// reformat that defeats a helper fails loudly instead of passing vacuously.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const readText = (rel) => readFileSync(join(REPO_ROOT, rel), "utf8");
const pipeline = readText(".github/workflows/pr-pipeline.yml").split("\n");
const e2e = readText(".github/workflows/e2e.yml").split("\n");

const indentOf = (l) => l.length - l.trimStart().length;
const blank = (l) => l.trim() === "" || l.trim().startsWith("#");

// The lines of top-level job `name` (comments inside included).
function jobLines(lines, name) {
  const start = lines.findIndex((l) => l === `  ${name}:`);
  assert.notEqual(start, -1, `job ${name} not found`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (!blank(lines[i]) && indentOf(lines[i]) <= 2) { end = i; break; }
  }
  return lines.slice(start, end);
}

// The job's own `if:` (4-space indent), as one string, comments dropped.
function jobIf(lines, name) {
  const job = jobLines(lines, name);
  for (let i = 0; i < job.length; i++) {
    const m = job[i].match(/^ {4}if:\s*(.*)$/);
    if (!m) continue;
    if (!["|", ">-", ">", "|-"].includes(m[1].trim())) return m[1];
    const out = [];
    for (let j = i + 1; j < job.length && (blank(job[j]) || indentOf(job[j]) > 4); j++) if (!blank(job[j])) out.push(job[j]);
    return out.join("\n");
  }
  assert.fail(`job ${name} has no if:`);
}

// The job's own `needs:` list, flattened to names.
function jobNeeds(lines, name) {
  const job = jobLines(lines, name);
  const i = job.findIndex((l) => /^ {4}needs:/.test(l));
  assert.notEqual(i, -1, `job ${name} has no needs:`);
  const first = job[i].replace(/^ {4}needs:\s*/, "");
  if (first.trim()) return first.replace(/[\[\]]/g, "").split(",").map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (let j = i + 1; j < job.length && (blank(job[j]) || indentOf(job[j]) > 4); j++) {
    const m = job[j].match(/^\s*-\s+(\S+)/);
    if (m) out.push(m[1]);
  }
  return out;
}

// A step (6-space "- " item) of a job whose `name:` contains `needle`, as text.
function stepText(lines, job, needle) {
  const j = jobLines(lines, job);
  const idx = j.findIndex((l) => /^ {6}-\s/.test(l) && l.includes(needle));
  const named = idx !== -1 ? idx : j.findIndex((l, k) => /^ {8}name:/.test(l) && l.includes(needle) && /^ {6}-\s/.test(j[k - 1] ?? ""));
  let start = named;
  if (start === -1) start = j.findIndex((l) => /^ {6,8}(- )?name:/.test(l) && l.includes(needle));
  assert.notEqual(start, -1, `step "${needle}" not found in ${job}`);
  while (!/^ {6}-\s/.test(j[start])) start--;
  let end = j.length;
  for (let k = start + 1; k < j.length; k++) if (/^ {6}-\s/.test(j[k])) { end = k; break; }
  return j.slice(start, end).join("\n");
}

const has = (text, re, msg) => assert.match(text, re, msg);

// --- pr-pipeline.yml -------------------------------------------------------------

const PAIRED = ["web-preview", "wire-browser-url", "wire-preprocess-url", "wire-preprocess-capacity", "e2e", "preprocess-crop-matrix"];

test("preview, wiring, e2e and the crop matrix skip together: each `if` has deps_only AND e2e_inert", () => {
  for (const job of PAIRED) {
    const cond = jobIf(pipeline, job);
    has(cond, /needs\.changes\.outputs\.deps_only\s*!=\s*'true'/, `${job}: deps_only`);
    has(cond, /needs\.changes\.outputs\.e2e_inert\s*!=\s*'true'/, `${job}: e2e_inert`);
  }
});

test("preprocess-crop-matrix gets the condition for symmetry (it needs wire-preprocess-url, so it would skip anyway)", () => {
  assert.ok(jobNeeds(pipeline, "preprocess-crop-matrix").includes("wire-preprocess-url"));
});

test("mask parity is NOT gated on e2e_inert: preprocess is outside the inert list, and a skip there is judged by the preprocess rule", () => {
  assert.doesNotMatch(jobIf(pipeline, "preprocess-mask-parity"), /e2e_inert/);
});

test("the changes output e2e_inert is the COMBINED check, not the scope step", () => {
  const changes = jobLines(pipeline, "changes").join("\n");
  has(changes, /e2e_inert:\s*\$\{\{\s*steps\.inert\.outputs\.e2e_inert\s*\}\}/);
  assert.doesNotMatch(changes, /e2e_inert:\s*\$\{\{\s*steps\.scope\./);
});

test("the scope step runs e2e-scope.sh and the inert step runs e2e-inert-final.sh, in order after mode and the filter", () => {
  const changes = jobLines(pipeline, "changes");
  const text = changes.join("\n");
  const scope = stepText(pipeline, "changes", "Decide whether the change is inert");
  has(scope, /id:\s*scope/);
  has(scope, /bash \.github\/scripts\/e2e-scope\.sh >> "\$GITHUB_OUTPUT"/);
  has(scope, /PR_NUMBER:\s*\$\{\{\s*steps\.mode\.outputs\.pr\s*\}\}/);
  has(scope, /BASE_REF:\s*\$\{\{\s*github\.event\.merge_group\.base_ref\s*\}\}/);
  const inert = stepText(pipeline, "changes", "Combine the inert verdict");
  has(inert, /id:\s*inert/);
  has(inert, /bash \.github\/scripts\/e2e-inert-final\.sh >> "\$GITHUB_OUTPUT"/);
  has(inert, /SCOPE:\s*\$\{\{\s*steps\.scope\.outputs\.e2e_inert\s*\}\}/);
  for (const [v, f] of [["F_WEB", "web"], ["F_BROWSER", "browser"], ["F_BROWSER_PREVIEW", "browser_preview"], ["F_PREPROCESS", "preprocess"], ["F_SCANNER", "scanner"], ["F_SCRIPTS", "scripts"]]) {
    has(inert, new RegExp(`${v}:\\s*\\$\\{\\{\\s*steps\\.filter\\.outputs\\.${f}\\s*\\}\\}`), v);
  }
  assert.doesNotMatch(inert, /fake_bsc/);
  const at = (s) => text.indexOf(s);
  assert.ok(at("id: mode") < at("id: scope") && at("id: filter") < at("id: inert") && at("id: scope") < at("id: inert"), "step order");
});

test("ci-gate maps R_E2E_INERT and the area filter vars", () => {
  const gate = stepText(pipeline, "ci-gate", "Aggregate required-check verdict");
  has(gate, /R_E2E_INERT:\s*\$\{\{\s*needs\.changes\.outputs\.e2e_inert\s*\}\}/);
  for (const [v, o] of [["R_CHANGED_WEB", "web"], ["R_CHANGED_BROWSER", "browser"], ["R_CHANGED_BROWSER_PREVIEW", "browser_preview"], ["R_CHANGED_SCANNER", "scanner"], ["R_CHANGED_SCRIPTS", "scripts"], ["R_PREPROCESS_CHANGED", "preprocess"]]) {
    has(gate, new RegExp(`${v}:\\s*\\$\\{\\{\\s*needs\\.changes\\.outputs\\.${o}\\s*\\}\\}`), v);
  }
});

test("every R_* variable ci-gate-verdict.sh reads is set by the ci-gate step", () => {
  const script = readText(".github/scripts/ci-gate-verdict.sh");
  const read = [...new Set([...script.matchAll(/^(R_[A-Z_]+)="\$\{\1:-\}"/gm)].map((m) => m[1]))];
  assert.ok(read.length > 20, `only ${read.length} R_* vars extracted`);
  const gate = stepText(pipeline, "ci-gate", "Aggregate required-check verdict");
  const unset = read.filter((v) => !new RegExp(`^\\s+${v}:\\s*\\$\\{\\{`, "m").test(gate));
  assert.deepEqual(unset, []);
});

test("every e2e-scope.sh input is wired in the scope step", () => {
  const script = readText(".github/scripts/e2e-scope.sh");
  const scope = stepText(pipeline, "changes", "Decide whether the change is inert");
  for (const v of ["EVENT_NAME", "GH_TOKEN", "PR_NUMBER", "BASE_SHA", "HEAD_SHA", "BASE_REF"]) {
    assert.ok(script.includes(v), `${v} not in e2e-scope.sh`);
    assert.match(scope, new RegExp(`^\\s+${v}:`, "m"), `${v} not set by the scope step`);
  }
});

// --- e2e.yml -----------------------------------------------------------------------

test("seed-mobile still needs both desktop jobs and runs only if both SUCCEEDED (fail fast)", () => {
  const needs = jobNeeds(e2e, "seed-mobile");
  for (const n of ["setup", "seed", "shard-desktop", "breaker-desktop"]) assert.ok(needs.includes(n), n);
  const cond = jobIf(e2e, "seed-mobile");
  has(cond, /needs\.shard-desktop\.result\s*==\s*'success'/);
  has(cond, /needs\.breaker-desktop\.result\s*==\s*'success'/);
  has(cond, /needs\.setup\.result\s*==\s*'success'/);
  has(cond, /needs\.seed\.result\s*==\s*'success'/);
  has(cond, /!cancelled\(\)/);
});

test("the mobile shards and breaker hang off seed-mobile and need it to have succeeded", () => {
  for (const job of ["shard-mobile", "breaker-mobile"]) {
    assert.ok(jobNeeds(e2e, job).includes("seed-mobile"), `${job} needs`);
    has(jobIf(e2e, job), /needs\.seed-mobile\.result\s*==\s*'success'/, job);
  }
});

test("the e2e gate and report stay always() and see every upstream job", () => {
  assert.equal(jobIf(e2e, "e2e").trim(), "always()");
  assert.equal(jobIf(e2e, "report").trim(), "always()");
  const gateNeeds = jobNeeds(e2e, "e2e");
  for (const n of ["setup", "seed", "shard-desktop", "breaker-desktop", "seed-mobile", "shard-mobile", "breaker-mobile"]) assert.ok(gateNeeds.includes(n), `gate needs ${n}`);
});

test("report needs seed (the desktop coverage read uses its output) and reads it only when seed-mobile was skipped", () => {
  assert.ok(jobNeeds(e2e, "report").includes("seed"));
  const desktop = stepText(e2e, "report", "desktop shards drained, mobile skipped");
  has(desktop, /needs\.seed-mobile\.result\s*==\s*'skipped'/);
  has(desktop, /needs\.seed\.result\s*==\s*'success'/);
  has(desktop, /COVERAGE_SINCE_MS:\s*"\$\{\{\s*needs\.seed\.outputs\.seed_since_ms\s*\}\}"/);
  has(desktop, /continue-on-error:\s*true/);
  const mobile = stepText(e2e, "report", "mobile shards drained)");
  has(mobile, /needs\.seed-mobile\.result\s*!=\s*'skipped'/);
});

test("the gate runs the tested upstream script into GITHUB_ENV, and fails on FAIL_FAST", () => {
  const upstream = stepText(e2e, "e2e", "Upstream jobs");
  has(upstream, /bash \.github\/scripts\/e2e-upstream-verdict\.sh >> "\$GITHUB_ENV"/);
  for (const v of ["R_SETUP", "R_SEED", "R_SEED_MOBILE", "R_SHARD_DESKTOP", "R_BREAKER_DESKTOP"]) has(upstream, new RegExp(`^\\s+${v}:`, "m"), v);
  const text = readText(".github/workflows/e2e.yml");
  assert.ok(text.indexOf("uses: actions/checkout", text.indexOf("\n  e2e:")) < text.indexOf("name: Upstream jobs"), "checkout must precede the script");
  const shard = stepText(e2e, "e2e", "name: Shard jobs");
  assert.match(shard, /if \[ "\$\{FAIL_FAST:-0\}" = "1" \]; then[\s\S]*?exit 1\s*\n\s*fi/);
  assert.ok(shard.indexOf("FAIL_FAST") < shard.indexOf("a shard job did not succeed"), "fail-fast branch comes before the generic shard check");
});

test("desktop shard artifact uploads still run on a red shard", () => {
  const shard = jobLines(e2e, "shard-desktop").join("\n");
  for (const name of ["Upload shard report", "Upload Convex log capture (desktop shard"]) {
    const step = stepText(e2e, "shard-desktop", name);
    has(step, /if:\s*always\(\)/, name);
  }
  assert.ok(shard.includes("upload-artifact"));
});

// --- the gate's Verify results Python, with FAIL_FAST ------------------------------

function verifyPython() {
  const text = e2e.join("\n");
  const i = text.indexOf("python3 - pw-merged/results.json projects.txt <<'PY'");
  assert.notEqual(i, -1, "Verify results python not found");
  const from = text.indexOf("\n", i) + 1;
  const to = text.indexOf("\n          PY\n", i);
  assert.notEqual(to, -1);
  return text.slice(from, to).split("\n").map((l) => l.replace(/^ {10}/, "")).join("\n");
}

const HAVE_PY = spawnSync("python3", ["--version"]).status === 0;
test("Verify results: with FAIL_FAST only the desktop pass is judged; without it a missing mobile pass is reported", { skip: HAVE_PY ? false : "python3 not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "nb-verify-"));
  const w = (n, c) => writeFileSync(join(dir, n), c);
  const result = (proj, file, status) => ({ projectName: proj, status: status === "passed" ? "expected" : "unexpected", results: [{ status }] });
  w("results.json", JSON.stringify({
    suites: [
      { file: "a.spec.ts", specs: [{ title: "t", tests: [result("e2e", "a", "failed")] }] },
      { file: "b.spec.ts", specs: [{ title: "t", tests: [result("e2e", "b", "passed")] }] },
      { file: "s.spec.ts", specs: [{ title: "seed", tests: [result("setup", "s", "passed")] }] },
    ],
  }));
  w("projects.txt", "e2e\ne2e-mobile\n");
  w("planned-e2e.txt", "a.spec.ts\nb.spec.ts\n");
  w("planned-e2e-mobile.txt", "a.spec.ts\nb.spec.ts\n");
  w("verify.py", verifyPython());
  const py = (env) => spawnSync("python3", ["-I", "verify.py", "results.json", "projects.txt"], { cwd: dir, env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });
  const ff = py({ FAIL_FAST: "1" });
  assert.equal(ff.status, 1);
  assert.match(ff.stdout, /checking the desktop pass only/);
  assert.match(ff.stdout, /\[e2e\] a\.spec\.ts :: t -> failed/);
  assert.doesNotMatch(ff.stdout, /e2e-mobile\]/, "mobile specs must not be listed as missing");
  assert.doesNotMatch(ff.stdout, /EACH pass that ran \(2\)/);
  const normal = py({});
  assert.equal(normal.status, 1);
  assert.match(normal.stdout, /planned spec produced no result on \[e2e-mobile\]/);
  assert.match(normal.stdout, /EACH pass that ran \(2\)/);
});
