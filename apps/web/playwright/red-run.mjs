#!/usr/bin/env node
// Line up a red E2E run's browser and server sides, per failed test (NEO-398).
//
//   node playwright/red-run.mjs <run-id> [--attempt <n>] [--out <dir>] [--window <seconds>]
//                                        [--all-logs] [--repo <owner/name>]
//
// Downloads the run's `pw-report-*` and `convex-logs-*` artifacts through
// `gh api` (the artifacts zip endpoint works where `gh run download` does
// not), then prints, for every test with a red result: its title and file, and
// for EACH red result (a retried spec has one per try, each with its own page,
// account reset and server window): the error, where its screenshot and
// error-context.md were unpacked, the tail of the browser's `client-wire.log`
// (support/wire-log.ts), and the Convex completions the preview recorded in
// that result's last seconds, slowest first. A test whose last try passed is
// shown as FLAKY with its red tries. Read-only; nothing is re-run or posted.
//
// Attempts: e2e.yml names every artifact `<base>-a<run_attempt>`. By default
// the latest attempt is read the way the report job reads it
// (scripts/pick-report-attempts.mjs): per artifact base, the newest attempt
// <= the chosen one, so a shard that passed in attempt 1 and was not rerun
// still counts. `--attempt <n>` reads the run as it stood after attempt n.
//
// Server logs: only the `convex-logs-*` of the jobs that had a red result are
// fetched (each is ~4 MB), falling back to every job's when none matches;
// `--all-logs` fetches them all. Every line printed from an artifact goes
// through support/redact.mjs (the reports' error text is not scrubbed at the
// source). Artifacts are kept under --out (default: the OS temp dir); they are
// public CI artifacts, but keep them out of the repo all the same.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { pickReportAttempts } from "../scripts/pick-report-attempts.mjs";
import { redact, stripAnsi } from "./support/redact.mjs";

const WIRE_TAIL = 40;
const SLOWEST = 15;

/** The attempt suffix e2e.yml gives each artifact; 0 for an unsuffixed (older) name. */
export function attemptOf(name) {
  const m = /-a(\d+)$/.exec(name);
  return m ? Number(m[1]) : 0;
}

/**
 * Every test in one blob report's report.jsonl that has a red result.
 * "Red" is a result whose status is neither the expected one nor skipped.
 * @param {string} jsonl
 * @returns {Array<{ testId: string, title: string, file: string, project: string, flaky: boolean,
 *   tries: number, red: Array<{ retry: number, status: string, start: number, end: number,
 *   error: string, attachments: Array<{ name: string, path?: string, body?: string, base64?: string }> }> }>}
 */
export function redTests(jsonl) {
  const titles = new Map(); // testId -> { title, file, project }
  const visit = (suite, project, chain, file) => {
    const f = suite.location?.file ?? file;
    const here = suite.title && suite.title !== suite.location?.file ? [...chain, suite.title] : chain;
    for (const e of suite.entries ?? []) {
      if (e.testId) titles.set(e.testId, { title: [...here, e.title].join(" › "), file: f ?? "", project });
      else visit(e, project, here, f);
    }
  };
  const results = new Map(); // resultId -> { retry, start, attachments }
  const tests = new Map(); // testId -> { results: [{ retry, status, ... }] }
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    const e = JSON.parse(line);
    const p = e.params ?? {};
    if (e.method === "onProject") visit({ entries: p.project.suites }, p.project.name, [], "");
    if (e.method === "onTestBegin") {
      results.set(p.result.id, { retry: p.result.retry ?? 0, start: p.result.startTime, attachments: [] });
    }
    if (e.method === "onAttach") results.get(p.resultId)?.attachments.push(...p.attachments);
    if (e.method === "onTestEnd") {
      const r = results.get(p.result.id);
      if (!r) continue;
      const t = tests.get(p.test.testId) ?? { expected: p.test.expectedStatus ?? "passed", results: [] };
      t.results.push({
        ...r,
        status: p.result.status,
        end: r.start + p.result.duration,
        error: stripAnsi(p.result.errors?.[0]?.message ?? ""),
      });
      tests.set(p.test.testId, t);
    }
  }
  const out = [];
  for (const [testId, t] of tests) {
    const isRed = (r) => r.status !== t.expected && r.status !== "skipped";
    const red = t.results.filter(isRed);
    if (red.length === 0) continue;
    const last = t.results[t.results.length - 1];
    out.push({
      testId,
      ...(titles.get(testId) ?? { title: testId, file: "", project: "" }),
      flaky: last.status === t.expected,
      tries: t.results.length,
      red,
    });
  }
  return out;
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      attempt: { type: "string" },
      out: { type: "string" },
      window: { type: "string", default: "20" },
      "all-logs": { type: "boolean", default: false },
      repo: { type: "string", default: "neonbinder/neonbinder-app" },
    },
  });
  const runId = positionals[0];
  const windowS = Number(values.window);
  if (!runId || !/^\d+$/.test(runId) || !(windowS > 0)) {
    console.error(
      "usage: node playwright/red-run.mjs <run-id> [--attempt <n>] [--out <dir>] [--window <seconds>] [--all-logs] [--repo <owner/name>]",
    );
    process.exit(2);
  }
  const repo = values.repo;
  const out = values.out ?? join(tmpdir(), `red-run-${runId}`);
  mkdirSync(out, { recursive: true });

  const gh = (path, binary = false) =>
    execFileSync("gh", ["api", path], { maxBuffer: 1 << 30, encoding: binary ? "buffer" : "utf8" });
  const ghList = (path) =>
    execFileSync("gh", ["api", "--paginate", path, "--jq", ".artifacts[] | [.id, .name, .expired] | @tsv"], {
      maxBuffer: 1 << 26,
      encoding: "utf8",
    });

  // 1. Artifacts of the run, narrowed to one attempt's view.
  const all = ghList(`repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`)
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [id, name, expired] = l.split("\t");
      return { id, name, expired: expired === "true" };
    })
    .filter((a) => /^(pw-report|convex-logs)-/.test(a.name));
  const latest = Math.max(0, ...all.map((a) => attemptOf(a.name)));
  const attempt = values.attempt === undefined ? latest : Number(values.attempt);
  if (values.attempt !== undefined && !(Number.isInteger(attempt) && attempt >= 1 && attempt <= latest)) {
    console.error(`--attempt must be a whole number from 1 to ${latest} (this run's attempts)`);
    process.exit(2);
  }
  const { keep } = pickReportAttempts(
    all.map((a) => a.name),
    attempt,
  );
  const picked = all.filter((a) => keep.includes(a.name));
  const expired = picked.filter((a) => a.expired).map((a) => a.name);
  const live = picked.filter((a) => !a.expired);
  const reports = live.filter((a) => a.name.startsWith("pw-report-"));
  if (reports.length === 0) {
    console.error(
      `run ${runId}: no pw-report-* artifacts for attempt ${attempt}` +
        (expired.length ? ` (${expired.length} expired)` : " (not an E2E run, or it never reached a shard)"),
    );
    process.exit(1);
  }
  const older = reports.filter((a) => attemptOf(a.name) !== attempt).length;

  const unzip = (zipPath, dir) => {
    mkdirSync(dir, { recursive: true });
    execFileSync("unzip", ["-oq", zipPath, "-d", dir]);
  };
  const fetch = (a) => {
    const dir = join(out, a.name);
    if (existsSync(dir) && readdirSync(dir).length > 0) return dir; // already fetched
    const zip = join(out, `${a.name}.zip`);
    writeFileSync(zip, gh(`repos/${repo}/actions/artifacts/${a.id}/zip`, true));
    unzip(zip, dir);
    return dir;
  };
  const walk = (dir, acc = []) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p, acc);
      else acc.push(p);
    }
    return acc;
  };

  // 2. Every blob report's red tests.
  const failures = [];
  for (const a of reports) {
    const dir = fetch(a);
    for (const blob of walk(dir).filter((p) => /blob\/report-.*\.zip$/.test(p))) {
      const bdir = `${blob}.d`;
      if (!existsSync(join(bdir, "report.jsonl"))) unzip(blob, bdir);
      for (const t of redTests(readFileSync(join(bdir, "report.jsonl"), "utf8"))) {
        failures.push({ ...t, artifact: a.name, bdir });
      }
    }
  }

  if (failures.length === 0) {
    console.log(
      `run ${runId}, attempt ${attempt} of ${latest}: ${reports.length} report(s)` +
        (older ? ` (${older} from an earlier attempt: jobs not rerun)` : "") +
        `; no red results, so no server logs fetched\nartifacts kept under ${out}`,
    );
    return;
  }

  // 3. Server completions from the red jobs' captures of the same preview, de-duplicated.
  const logs = live.filter((a) => a.name.startsWith("convex-logs-"));
  const base = (name) => name.replace(/-a\d+$/, "");
  const redJobs = new Set(failures.map((f) => base(f.artifact).replace(/^pw-report-/, "")));
  const matched = logs.filter((a) => redJobs.has(base(a.name).replace(/^convex-logs-/, "")));
  const logSet = values["all-logs"] || matched.length === 0 ? logs : matched;
  const completions = [];
  const seen = new Set();
  for (const a of logSet) {
    for (const f of walk(fetch(a)).filter((p) => /\.jsonl(\.gz)?$/.test(p))) {
      const raw = f.endsWith(".gz") ? gunzipSync(readFileSync(f)).toString("utf8") : readFileSync(f, "utf8");
      for (const line of raw.split("\n")) {
        if (!line.startsWith("{")) continue;
        let e;
        try {
          e = JSON.parse(line);
        } catch {
          continue;
        }
        if (e.kind !== "Completion" || !e.executionId || seen.has(e.executionId)) continue;
        seen.add(e.executionId);
        completions.push(e);
      }
    }
  }
  completions.sort((x, y) => x.timestamp - y.timestamp);

  // 4. Report. Text from an artifact is scrubbed (say); local paths are not artifact text.
  const say = (text = "") => console.log(redact(text));
  const hhmmss = (ms) => new Date(ms).toISOString().slice(11, 23);
  const text = (bdir, att) =>
    att.body ?? (att.base64 ? Buffer.from(att.base64, "base64").toString("utf8") : att.path ? readFileSync(join(bdir, att.path), "utf8") : "");
  const redResults = failures.reduce((n, f) => n + f.red.length, 0);
  say(
    `run ${runId}, attempt ${attempt} of ${latest}: ${reports.length} report(s)` +
      (older ? ` (${older} from an earlier attempt: jobs not rerun)` : "") +
      (expired.length ? `, ${expired.length} expired` : "") +
      `; ${failures.length} test(s) with ${redResults} red result(s); ` +
      `${completions.length} server completions from ${logSet.length} convex-logs artifact(s)`,
  );
  for (const f of failures) {
    say(`\n${"=".repeat(100)}`);
    say(`${f.flaky ? "FLAKY" : "FAILED"}  ${f.title}`);
    say(`  ${f.file} (${f.project}, ${f.artifact}), ${f.red.length} red of ${f.tries} tr${f.tries === 1 ? "y" : "ies"}`);
    for (const r of f.red) {
      say(`\n  -- retry ${r.retry}: ${r.status.toUpperCase()}  ${hhmmss(r.start)} → ${hhmmss(r.end)} UTC`);
      if (r.error) say(`  ${r.error.split("\n").slice(0, 6).join("\n  ")}`);
      for (const att of r.attachments.filter((x) => x.path && /^(screenshot|error-context)$/.test(x.name))) {
        console.log(`  ${att.name}: ${join(f.bdir, att.path)}`);
      }
      const wire = r.attachments.find((x) => x.name === "client-wire.log");
      say(`\n  browser (client-wire.log, last ${WIRE_TAIL} lines):`);
      if (!wire) say("    (none attached: the run predates NEO-398, or the fixture never reached its teardown)");
      else for (const l of text(f.bdir, wire).split("\n").slice(-WIRE_TAIL)) say(`    ${l}`);
      const lo = r.end / 1000 - windowS;
      const hi = r.end / 1000 + 1;
      const inWin = completions.filter((c) => c.timestamp >= lo && c.timestamp <= hi);
      const slow = [...inWin].sort((x, y) => (y.executionTime ?? 0) - (x.executionTime ?? 0)).slice(0, SLOWEST);
      say(`\n  server (last ${windowS} s of this try, ${inWin.length} completions on the preview; slowest ${SLOWEST}, all users):`);
      if (completions.length === 0) say("    (no convex-logs-* artifacts for this attempt)");
      for (const c of slow) {
        say(
          `    ${hhmmss(c.executionTimestamp * 1000)} ${String((c.executionTime ?? 0).toFixed(3)).padStart(8)}s ${String(c.udfType).padEnd(8)} ${c.identifier}` +
            `  reads=${c.readDocs ?? 0} writes=${c.writeDocs ?? 0}${c.occInfo ? " OCC" : ""}${c.willRetry ? " RETRY" : ""}${c.error ? " ERROR" : ""}`,
        );
      }
      const errs = inWin.filter((c) => c.error || c.willRetry);
      if (errs.length) say(`    errors/retries in window: ${errs.map((c) => c.identifier).join(", ")}`);
    }
  }
  console.log(`\nartifacts kept under ${out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
