#!/usr/bin/env node
// Run local E2E specs on this worktree's own Convex dev deployment and print a
// short digest of the result (NEO-622). One tool replaces the hand-built
// Vite / seed / setup / bootstrap / playwright recipe in GUIDE.md "Running".
//
//   node playwright/tools/e2e-run.mjs [run] [opts] <spec-substring>...
//   node playwright/tools/e2e-run.mjs wait [--slice 170]
//   node playwright/tools/e2e-run.mjs plant (--edit f.json | --patch f.diff) [--expect <regex>] [opts] <spec>...
//   node playwright/tools/e2e-run.mjs seed
//   node playwright/tools/e2e-run.mjs status | digest [last|<runDir>] | stop | stop-vite
//
// Run `--help` for the options and exit codes. All commands run from apps/web.
//
// What it will not do: touch CI config, run with CI set, run against
// production or against a deployment named by a deploy key or token, or run
// against the main checkout's deployment (shared dev) unless
// `--allow-shared-dev` (cloud threads), and never seed there.
//
// PUBLIC REPO: nothing here names a deployment, an account or a private path.
// Everything printed or logged goes through support/redact.mjs, and the
// deployment's own name is masked as a literal on top of that.
//
// Side effects (spawn, lsof, gh, gcloud, convex, git) sit behind the small `io`
// object so a unit test can stub them; the pure functions are exported.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { redact, redactLiterals, stripAnsi } from "../support/redact.mjs";

const SELF = fileURLToPath(import.meta.url);
export const APP_DIR = resolve(dirname(SELF), "../..");
const SERVER_STRINGS = ["CONVEX_DEPLOYMENT", "CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN"];
export const DIGEST_LIMIT = 8000;
const LINE_MAX = 200;
const KEEP_RUNS = 10;
const DEFAULT_SLICE = 170;
const PROJECTS = { desktop: "e2e", mobile: "e2e-mobile" };

export const EXIT = { pass: 0, fail: 1, refused: 2, locked: 3, restoreFailed: 4, running: 75 };

const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/** Printable, scrubbed text: ANSI off, redact.mjs, the literals masked, control characters removed. */
export function cleanText(text, literals = []) {
  return redactLiterals(redact(stripAnsi(String(text))), literals).replace(CONTROL, "");
}

/** A path inside the run directory: literals masked, but not redact.mjs, which turns Playwright's long test-dir name into a token marker. */
function rawPathText(text, literals = []) {
  return redactLiterals(stripAnsi(String(text)), literals).replace(CONTROL, "");
}

const clip = (s, n = LINE_MAX) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export const HELP = `e2e-run: run local E2E specs on this worktree's own Convex dev deployment, print a digest.

  e2e-run.mjs [run] [opts] <spec-substring>...   start a run, wait up to 170 s
  e2e-run.mjs wait [--slice 170]                  wait on the current run; digest on finish
  e2e-run.mjs plant (--edit f.json | --patch f.diff) [--expect <regex>] [opts] <spec>...
                                                  break the product on purpose, prove the spec goes red, restore
  e2e-run.mjs seed                                reset + reference import + setup + bootstrap
  e2e-run.mjs status | digest [last|<runDir>] | stop | stop-vite

opts: --project desktop|mobile|both (default desktop)  --fresh  --setup  --push
      --worker N (default 8)  --grep <re>  --slice <s> (0 = wait to the end)
      --port N (override 3<ticket>)  --allow-shared-dev
--edit f.json is [{"file","find","replace"}] (file relative to apps/web; each find must match once).
A plant may touch apps/web/ only (no .env*, node_modules, playwright/tools, symlinks); --patch may not copy
files or change modes; status and digest never restore a leftover plant.

Exit: 0 pass; 1 Playwright failures; 2 guard/setup refusal; 3 lock held; 75 still running
      (call \`wait\`). plant: 0 red and restored; 1 stayed green (or red for another reason) and
      restored; 4 restore failed (loud).`;

// ---------------------------------------------------------------- arguments

/**
 * @param {string[]} argv
 * @returns {{cmd: string, specs: string[], opts: Record<string, any>, error?: string}}
 */
export function parseArgs(argv) {
  const cmds = new Set(["run", "wait", "plant", "seed", "status", "digest", "stop", "stop-vite", "help"]);
  const opts = {
    project: "desktop",
    fresh: false,
    setup: false,
    push: false,
    worker: 8,
    grep: null,
    slice: DEFAULT_SLICE,
    port: null,
    allowSharedDev: false,
    edit: null,
    patch: null,
    expect: null,
  };
  const rest = [];
  let cmd = null;
  const args = [...argv];
  const need = (flag, i) => {
    if (i + 1 >= args.length) throw new Error(`${flag} needs a value`);
    return args[i + 1];
  };
  try {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "-h" || a === "--help") cmd = cmd ?? "help";
      else if (a === "--fresh") opts.fresh = true;
      else if (a === "--setup") opts.setup = true;
      else if (a === "--push") opts.push = true;
      else if (a === "--allow-shared-dev") opts.allowSharedDev = true;
      else if (a === "--project") {
        opts.project = need(a, i++);
        if (!["desktop", "mobile", "both"].includes(opts.project)) throw new Error("--project is desktop, mobile or both");
      } else if (a === "--worker" || a === "--slice" || a === "--port") {
        const v = Number(need(a, i++));
        if (!Number.isInteger(v) || v < 0 || (a === "--port" && (v < 1 || v > 65535))) throw new Error(`${a} needs a whole number`);
        opts[a.slice(2)] = v;
      } else if (a === "--grep" || a === "--edit" || a === "--patch" || a === "--expect") {
        opts[a.slice(2)] = need(a, i++);
      } else if (a.startsWith("-")) throw new Error(`unknown option ${a} (a spec substring cannot start with "-")`);
      else if (cmd === null && cmds.has(a)) cmd = a;
      else rest.push(a);
    }
    cmd = cmd ?? "run";
    if (opts.expect) new RegExp(opts.expect);
    if (cmd === "plant") {
      if (!opts.edit === !opts.patch) throw new Error("plant needs exactly one of --edit and --patch");
    }
    if ((cmd === "run" || cmd === "plant") && rest.length === 0 && !opts.grep) throw new Error(`${cmd} needs at least one spec substring`);
    return { cmd, specs: cmd === "digest" ? [] : rest, opts, target: cmd === "digest" ? (rest[0] ?? "last") : null };
  } catch (err) {
    return { cmd: cmd ?? "run", specs: rest, opts, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------- environment

/** KEY=VALUE lines of a .env file (a trailing ` # comment` and surrounding quotes dropped). */
export function parseEnvFile(text) {
  const vars = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(raw);
    if (!m) continue;
    let v = m[2].trim();
    if (v[0] === '"' || v[0] === "'") {
      const end = v.indexOf(v[0], 1);
      v = end > 0 ? v.slice(1, end) : v.slice(1);
    } else v = v.replace(/\s+#.*$/, "");
    vars[m[1]] = v;
  }
  return vars;
}

/** The Vite port: "3" + the ticket number in the worktree directory name (neo-622 -> 3622). */
export function vitePort(dirName, override = null) {
  if (override) return override;
  const m = /^neo-(\d+)/i.exec(String(dirName));
  if (!m) return null;
  const n = Number(`3${m[1]}`);
  return n >= 1024 && n <= 65535 ? n : null;
}

/**
 * Decide whether a run may start, and with what environment. Pure: the caller
 * reads the files. Reasons never contain a deployment name or an env value.
 * @returns {{ok: false, reason: string} | {ok: true, deployment: string, port: number, env: Record<string,string>, shared: boolean}}
 */
export function resolveTarget({
  ci = false,
  processEnv = {},
  envLocalText = null,
  envText = null,
  mainEnvLocalText = null,
  dirName = "",
  allowSharedDev = false,
  destructive = false,
  portOverride = null,
  nvmBin = null,
}) {
  if (ci) return { ok: false, reason: "CI is set: this tool is for laptops and agents; CI runs the suite itself" };
  if (envLocalText == null) return { ok: false, reason: ".env.local is missing in apps/web (create the worktree's own deployment first, see the root CLAUDE.md)" };
  const vars = parseEnvFile(envLocalText);
  // The Convex CLI also loads apps/web/.env: a key or token there picks the target too.
  const dotEnv = envText == null ? {} : parseEnvFile(envText);
  for (const k of ["CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN"]) {
    if (processEnv[k]) return { ok: false, reason: `${k} is set in the environment: a key or token, not .env.local, would pick the target` };
    if (vars[k]) return { ok: false, reason: `.env.local holds ${k}: remove it (a key or token, not .env.local, would pick the target)` };
    if (dotEnv[k]) return { ok: false, reason: `.env holds ${k}: remove it (a key or token, not .env.local, would pick the target)` };
  }
  const dep = vars.CONVEX_DEPLOYMENT ?? "";
  if (!dep.startsWith("dev:")) return { ok: false, reason: ".env.local does not name a dev deployment (CONVEX_DEPLOYMENT must be dev:*)" };
  const name = dep.slice(4);
  if (!/^[a-z0-9-]+$/.test(name)) return { ok: false, reason: ".env.local's deployment name is not in the expected form" };
  // Both client URLs must be in .env.local and name exactly this deployment: Vite and Playwright
  // would otherwise talk to whatever the shell or a lookalike host says.
  const url = vars.VITE_CONVEX_URL;
  if (!url) return { ok: false, reason: "VITE_CONVEX_URL is missing from .env.local" };
  if (!new RegExp(`^https://${name}\\.convex\\.cloud/?$`).test(url)) return { ok: false, reason: "VITE_CONVEX_URL in .env.local names a different deployment than CONVEX_DEPLOYMENT" };
  const siteUrl = vars.VITE_CONVEX_SITE_URL;
  if (!siteUrl) return { ok: false, reason: "VITE_CONVEX_SITE_URL is missing from .env.local" };
  if (!new RegExp(`^https://${name}\\.convex\\.site/?$`).test(siteUrl)) return { ok: false, reason: "VITE_CONVEX_SITE_URL in .env.local names a different deployment than CONVEX_DEPLOYMENT" };
  const mainName = mainEnvLocalText == null ? null : (/^dev:([a-z0-9-]+)/.exec(parseEnvFile(mainEnvLocalText).CONVEX_DEPLOYMENT ?? "")?.[1] ?? null);
  const shared = mainName === null || mainName === name;
  if (shared && !allowSharedDev) {
    return {
      ok: false,
      reason:
        mainName === null
          ? "cannot tell whether this is the main checkout's (shared dev) deployment: the main checkout's .env.local is unreadable. Cloud threads pass --allow-shared-dev"
          : "this worktree's .env.local names the main checkout's deployment (shared dev). Create the worktree's own deployment, or pass --allow-shared-dev in a cloud thread",
    };
  }
  if (shared && destructive) return { ok: false, reason: "seed and --fresh reset the deployment, and this one is shared dev: never" };
  const port = vitePort(dirName, portOverride);
  if (!port) return { ok: false, reason: `no Vite port: worktree directory "${dirName}" has no neo-<number> prefix (pass --port)` };
  const inherited = Object.fromEntries(Object.entries(processEnv).filter(([k]) => !/^(?:VITE_)?CONVEX_/.test(k)));
  const env = { ...inherited, ...vars };
  for (const k of SERVER_STRINGS) delete env[k];
  delete env.CI;
  if (nvmBin) env.PATH = `${nvmBin}${":"}${processEnv.PATH ?? ""}`;
  return { ok: true, deployment: name, port, env, shared };
}

// ---------------------------------------------------------------- phase planning

/** Last-seed bookkeeping: did this worker pass setup / bootstrap since the seed? */
export function needsPhases(state, worker, forceSetup = false) {
  const w = state?.workers?.[String(worker)] ?? {};
  const since = (t) => Boolean(t) && (!state?.seededAt || t >= state.seededAt);
  const setup = forceSetup || !since(w.setup);
  const bootstrap = setup || !since(w.bootstrap);
  return { setup, bootstrap };
}

/**
 * The ordered phases for a run. Spec phases always run `--no-deps`: bootstrap
 * has passed (or runs just before) on the current seed.
 * @returns {{kind: "seed"|"setup"|"bootstrap"|"spec", pw?: string, label: string}[]}
 */
export function phasePlan({ state = null, worker = 8, project = "desktop", fresh = false, setup = false } = {}) {
  const phases = [];
  const block = (isFresh, forceSetup, pw, suffix) => {
    if (isFresh) phases.push({ kind: "seed", label: `seed${suffix}` });
    const need = needsPhases(isFresh ? { seededAt: "9999", workers: {} } : state, worker, forceSetup || isFresh);
    if (need.setup) phases.push({ kind: "setup", pw: "setup", label: `setup${suffix}` });
    if (need.bootstrap) phases.push({ kind: "bootstrap", pw: "bootstrap", label: `bootstrap${suffix}` });
    phases.push({ kind: "spec", pw, label: pw });
  };
  if (project === "both") {
    block(fresh, setup, PROJECTS.desktop, "");
    block(true, true, PROJECTS.mobile, "-m");
  } else block(fresh, setup, PROJECTS[project], "");
  return phases;
}

/**
 * The whole phase plan of a job, the plant's re-seed decision included. The target guard must
 * judge THIS plan: a seed anywhere in it resets the deployment, however it came to be there.
 * @returns {{fresh: boolean, note: string|null, phases: ReturnType<typeof phasePlan>, destructive: boolean}}
 */
export function planJob({ kind, opts, specs = [], state = null }) {
  if (kind === "seed") {
    const phases = [{ kind: "seed", label: "seed" }, { kind: "setup", pw: "setup", label: "setup" }, { kind: "bootstrap", pw: "bootstrap", label: "bootstrap" }];
    return { fresh: true, note: null, phases, destructive: true };
  }
  let fresh = Boolean(opts.fresh);
  let note = null;
  if (kind === "plant") {
    const pws = opts.project === "both" ? [PROJECTS.desktop, PROJECTS.mobile] : [PROJECTS[opts.project]];
    const rs = plantReseed({ prior: state?.ran ?? [], specs, pws, expect: opts.expect, fresh });
    fresh = rs.fresh;
    note = rs.note;
  }
  const phases = phasePlan({ state, worker: opts.worker, project: opts.project, fresh, setup: opts.setup });
  return { fresh, note, phases, destructive: phases.some((p) => p.kind === "seed") };
}

/** The earlier run on this seed (if any) of a spec in a project. `prior` is state.ran. */
export function ranOnSeed(prior, specs, file, pw) {
  return (
    (prior ?? []).find(
      (r) => r.project === pw && ((file && (r.files ?? []).includes(file)) || (r.args ?? []).some((a) => specs.includes(a) || (file && file.includes(a)))),
    ) ?? null
  );
}

// ---------------------------------------------------------------- digest

/** Strings worth finding in a page snapshot: names first, then roles, from a Playwright error's locator. */
export function locatorNames(errorText) {
  const text = stripAnsi(String(errorText ?? ""));
  const names = [];
  const add = (s) => {
    const v = s.replace(/\\(['"])/g, "$1").trim();
    if (v.length >= 2 && !names.includes(v)) names.push(v);
  };
  for (const m of text.matchAll(/\bname:\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) add(m[2]);
  for (const m of text.matchAll(/getBy(?:Text|Label|Placeholder|Title|AltText)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) add(m[2]);
  for (const m of text.matchAll(/getByRole\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) add(m[2]);
  return names;
}

/** A window of a snapshot around the first line that mentions a name (max lines, dedented). */
export function snapshotWindow(lines, names, max = 40) {
  const total = lines.length;
  if (!total || max <= 0) return null;
  let hit = -1;
  let matched = null;
  for (const n of names) {
    const i = lines.findIndex((l) => l.toLowerCase().includes(n.toLowerCase()));
    if (i >= 0) {
      hit = i;
      matched = n;
      break;
    }
  }
  const before = hit < 0 ? 0 : Math.floor(max / 3);
  const from = Math.max(0, Math.min(hit < 0 ? 0 : hit - before, Math.max(0, total - max)));
  const to = Math.min(total, from + max);
  const slice = lines.slice(from, to);
  const indent = Math.min(...slice.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length), 99);
  return { lines: slice.map((l) => l.slice(Number.isFinite(indent) && indent < 99 ? indent : 0)), from: from + 1, to, total, matched };
}

/** Sections of Playwright's error-context.md: page snapshot, element yaml, the `>` source line. */
export function parseErrorContext(md) {
  const sections = {};
  let cur = null;
  let fence = null;
  for (const line of String(md ?? "").split(/\r?\n/)) {
    if (fence === null) {
      const h = /^# (.+)$/.exec(line);
      if (h) {
        cur = h[1].trim();
        sections[cur] = { fences: [] };
        continue;
      }
      const f = /^```(\w*)\s*$/.exec(line);
      if (f && cur) {
        fence = { lang: f[1], lines: [] };
        sections[cur].fences.push(fence);
        continue;
      }
    } else if (/^```\s*$/.test(line)) {
      fence = null;
      continue;
    } else fence.lines.push(line);
  }
  const yamlIn = (s) => (sections[s]?.fences ?? []).filter((x) => x.lang === "yaml" || x.lang === "yml").map((x) => x.lines);
  const snap = yamlIn("Page snapshot")[0] ?? sections["Page snapshot"]?.fences?.[0]?.lines ?? null;
  const element = yamlIn("Error details")[0] ?? null;
  const source = (sections["Test source"]?.fences?.[0]?.lines ?? []).find((l) => /^>\s*\d+\s*\|/.test(l)) ?? null;
  return { pageSnapshot: snap, elementYaml: element, sourceLine: source ? source.replace(/^>\s*/, "> ") : null };
}

/** The tests of a Playwright JSON report, flattened (last result of each). */
export function collectTests(report) {
  const out = [];
  const walk = (suite, titles) => {
    const here = suite.file && suite.title === suite.file ? titles : suite.title ? [...titles, suite.title] : titles;
    for (const sp of suite.specs ?? []) {
      for (const t of sp.tests ?? []) {
        const results = t.results ?? [];
        const last = results[results.length - 1] ?? {};
        const failing = [...results].reverse().find((r) => r.error || (r.errors ?? []).length) ?? last;
        out.push({
          file: sp.file ?? suite.file ?? "",
          title: [...here, sp.title].filter(Boolean).join(" › "),
          project: t.projectName ?? "",
          status: { expected: "passed", unexpected: "failed", flaky: "flaky", skipped: "skipped" }[t.status] ?? String(t.status ?? "failed"),
          duration: results.reduce((n, r) => n + (r.duration ?? 0), 0),
          error: failing.error?.message ?? failing.errors?.[0]?.message ?? "",
          snippet: failing.error?.snippet ?? failing.errors?.[0]?.snippet ?? "",
          attachments: failing.attachments ?? [],
        });
      }
    }
    for (const s of suite.suites ?? []) walk(s, here);
  };
  for (const s of report?.suites ?? []) walk(s, []);
  return out;
}

function errorLines(message, snippet) {
  const text = stripAnsi(message).replace(/\r/g, "");
  const lines = text.split("\n");
  const first = lines.find((l) => l.trim()) ?? "Error";
  const grab = (key) => lines.find((l) => l.startsWith(`${key}:`))?.slice(key.length + 1).trim();
  const out = [];
  const extras = [grab("Expected") && `Expected ${grab("Expected")}`, grab("Received") && `Received ${grab("Received")}`, grab("Timeout") && grab("Timeout")].filter(Boolean);
  const locator = grab("Locator");
  const callAt = lines.findIndex((l) => /^Call log:/i.test(l));
  if (locator || callAt >= 0) {
    out.push(`  ${[first.trim(), ...extras].join(" · ")}`);
    if (locator) out.push(`  Locator: ${locator}`);
    if (callAt >= 0) {
      const log = [];
      for (const l of lines.slice(callAt + 1)) {
        if (!l.trim()) break;
        if (/^\s+at /.test(l)) break;
        log.push(l.trim().replace(/locator resolved to <[^>]*>?.*/, "locator resolved to <…>"));
      }
      out.push(`  call log (last ${Math.min(3, log.length)} of ${log.length}): ${log.slice(-3).join(" | ")}`);
    }
  } else {
    for (const l of lines.filter((x) => x.trim() && !/^\s+at /.test(x)).slice(0, 6)) out.push(`  ${l.trim()}`);
  }
  const arrow = String(snippet ?? "").split("\n").find((l) => /^\s*>\s*\d+\s*\|/.test(stripAnsi(l)));
  return { lines: out, arrow: arrow ? stripAnsi(arrow).trim() : null };
}

function clock(iso) {
  if (!iso) return "?";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function dur(ms) {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s`;
}

/** The "seed:" line of the digest header. */
export function seedLine(state, worker) {
  if (!state?.seededAt) return "seed: not seeded by e2e-run";
  const w = state.workers?.[String(worker)] ?? {};
  const mark = (t) => (t && t >= state.seededAt ? `✓ ${clock(t)}` : "✘ not since seed");
  return `seed: by e2e-run ${clock(state.seededAt)} · setup ${mark(w.setup)} · bootstrap ${mark(w.bootstrap)}`;
}

/** The "convex/:" part of the seed line. */
export function convexLine(stamp, fingerprint) {
  if (!stamp) return "convex/: never pushed by e2e-run";
  return stamp.fingerprint === fingerprint ? `convex/: pushed ${clock(stamp.at)}, unchanged since` : `convex/: CHANGED since the push at ${clock(stamp.at)} (rerun with --push)`;
}

/** The header verdict of a plant run, from its first result line; null for a plain run. */
export function plantVerdict(plant) {
  const first = Array.isArray(plant) ? plant[0] : null;
  if (!first) return null;
  if (first.startsWith("PLANT RED as planted")) return "PLANT RED as planted";
  if (first.startsWith("PLANT STAYED GREEN")) return "PLANT STAYED GREEN";
  if (first.startsWith("PLANT RESTORE FAILED")) return "PLANT RESTORE FAILED";
  if (first.startsWith("PLANT: RED, but --expect")) return "PLANT RED (--expect not matched)";
  if (first.startsWith("PLANT: RED")) return "PLANT RED (reason unchecked)";
  return "PLANT ERROR";
}

/**
 * Whether a plant re-seeds first, and the one-line note saying so.
 * With --expect a spec that already ran on this seed is not re-seeded: a
 * precondition red would not match the expected error anyway.
 */
export function plantReseed({ prior, specs, pws, expect, fresh }) {
  const ran = pws.some((pw) => ranOnSeed(prior, specs, null, pw));
  if (fresh || !ran) return { fresh: !!fresh, note: null };
  if (expect) return { fresh: false, note: "note: this spec already ran on this seed; not re-seeding because --expect is given (a precondition red will not match it)" };
  return { fresh: true, note: "note: this spec already ran on this seed; re-seeding first (about 3.5 min, resets the deployment). Pass --expect to skip the re-seed" };
}

/**
 * The digest text, under DIGEST_LIMIT characters.
 * @param {object} p
 * @param {object} p.meta  run meta (runId, exit, startedAt, finishedAt, project, worker, port, paused, seedLine, convexLine, prior, plant, phases)
 * @param {{label: string, pw: string, report: object|null, logTail?: string[]}[]} p.phases
 * @param {(path: string) => string|null} p.readText  reads an attachment (error-context.md)
 * @param {string[]} [p.literals] strings to mask (the deployment's name)
 * @param {string} [p.relRoot] directory paths are shown relative to
 * @param {string} p.runDir
 */
export function buildDigest({ meta, phases, readText = () => null, literals = [], relRoot = APP_DIR, runDir }) {
  const rel = (p) => relative(relRoot, p) || p;
  const inRun = (p) => String(p).startsWith(`${runDir}${sep}`);
  const tests = [];
  for (const ph of phases) for (const t of collectTests(ph.report)) tests.push({ ...t, label: ph.label });
  const failed = tests.filter((t) => t.status === "failed");
  const counts = (s) => tests.filter((t) => t.status === s).length;

  const render = ({ detailed, snapMax, passLines }) => {
    const out = [];
    const verdict = plantVerdict(meta.plant) ?? (meta.exit === 0 ? "PASS" : meta.exit === 1 ? "FAIL" : "ERROR");
    const elapsed = meta.finishedAt && meta.startedAt ? dur(new Date(meta.finishedAt) - new Date(meta.startedAt)) : "?";
    out.push(
      `E2E ${meta.runId}  ${verdict} (exit ${meta.exit})  ${elapsed}  ${meta.project} · worker ${meta.worker} · :${meta.port} · own dev deployment ✓` + (meta.paused != null ? ` · PAUSED_PLATFORMS=${meta.paused}` : ""),
    );
    out.push(`${meta.seedLine ?? ""}   ${meta.convexLine ?? ""}`.trim());
    if (meta.plant) out.push(...meta.plant);
    for (const n of meta.notes ?? []) out.push(n);
    let shown = 0;
    for (const t of tests) {
      const bad = t.status === "failed" || t.status === "flaky";
      if (!bad && shown >= passLines) continue;
      if (!bad) shown++;
      const mark = { passed: "✓", failed: "✘", flaky: "~", skipped: "-" }[t.status] ?? "?";
      out.push(`  ${mark} ${t.label.padEnd(9)} ${t.file} › ${t.title}   ${dur(t.duration)}`);
    }
    const hidden = tests.filter((t) => t.status !== "failed" && t.status !== "flaky").length - shown;
    if (hidden > 0) out.push(`  … ${hidden} more not shown`);
    out.push(`${counts("passed")} passed · ${counts("failed")} failed · ${counts("flaky")} flaky · ${counts("skipped")} skipped`);
    for (const ph of phases) {
      if (!ph.report && ph.logTail?.length && meta.exit !== 0) {
        out.push(`${ph.label}: no results JSON (the run did not get to report). Last log lines:`);
        for (const l of ph.logTail.slice(-12)) out.push(`  ${l}`);
      }
    }
    failed.forEach((t, i) => {
      const head = `FAIL ${t.file} › ${t.title} [${t.project || t.label}]`;
      if (i >= detailed) {
        out.push(head);
        return;
      }
      out.push(head);
      const att = (name) => t.attachments.find((a) => a.name === name && a.path);
      const ctxAtt = att("error-context");
      const ctx = ctxAtt ? parseErrorContext(readText(ctxAtt.path) ?? "") : { pageSnapshot: null, elementYaml: null, sourceLine: null };
      const err = errorLines(t.error, t.snippet);
      const arrow = ctx.sourceLine ?? err.arrow;
      if (arrow) out.push(`  ${arrow}`);
      out.push(...err.lines);
      const names = locatorNames(t.error);
      const snapLines = (ctx.pageSnapshot ?? ctx.elementYaml)?.map(maskSecretLine) ?? null;
      const win = snapLines && snapMax > 0 ? snapshotWindow(snapLines, names, snapMax) : null;
      if (win) {
        out.push(`  snapshot near ${win.matched ? `"${win.matched}"` : "top"} (lines ${win.from}-${win.to} of ${win.total}):`);
        for (const l of win.lines) out.push(`    ${l}`);
      }
      const prior = ranOnSeed(meta.prior, [], t.file, t.project || t.label);
      if (prior) out.push(`  note: ${prior.status === "failed" ? "failed" : "ran"} on this seed at ${clock(prior.at)}; if fresh-only, this red is expected: rerun with --fresh`);
      for (const name of ["screenshot", "trace", "error-context"]) {
        const a = att(name);
        if (a) out.push(inRun(a.path) ? { raw: `  ${name} ${rel(a.path)}` } : `  ${name} ${rel(a.path)}`);
      }
    });
    const specPhases = phases.filter((p) => p.report && (p.kind ? p.kind === "spec" : p.pw !== "setup" && p.pw !== "bootstrap"));
    const jsons = (specPhases.length ? specPhases : [{ label: "e2e" }]).map((p) => rel(join(runDir, `${p.label}.json`)));
    out.push(`full log: ${rel(join(runDir, "run.log"))} · json: ${jsons.join(" + ")}`);
    return out.map((l) => (typeof l === "string" ? clip(cleanText(l, literals)) : clip(rawPathText(l.raw, literals), 400))).join("\n");
  };

  let p = { detailed: 5, snapMax: 40, passLines: 12 };
  let text = render(p);
  const steps = [{ snapMax: 20 }, { snapMax: 10 }, { detailed: 3, passLines: 6 }, { snapMax: 0 }, { detailed: 1, passLines: 2 }, { detailed: 0, passLines: 0 }];
  for (const s of steps) {
    if (text.length <= DIGEST_LIMIT - 100) break;
    p = { ...p, ...s };
    text = render(p);
  }
  return text.length > DIGEST_LIMIT ? `${text.slice(0, DIGEST_LIMIT - 20)}\n…(truncated)` : text;
}

// ---------------------------------------------------------------- plant helpers

export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** True if any path (repo-relative or apps/web-relative) is under apps/web/convex. */
export function convexTouched(paths) {
  return paths.some((p) => /^(?:\.\/)?(?:apps\/web\/)?convex\//.test(p.replaceAll("\\", "/")));
}

/**
 * Apply [{file, find, replace}] to a {file: text} map. Each find must occur
 * exactly once in the text as it stands when that edit is reached.
 * @returns {{ok: true, files: Record<string,string>} | {ok: false, error: string}}
 */
export function applyEdits(files, edits) {
  if (!Array.isArray(edits) || edits.length === 0) return { ok: false, error: "edits must be a non-empty array" };
  const out = { ...files };
  for (const [i, e] of edits.entries()) {
    if (!e || typeof e.file !== "string" || typeof e.find !== "string" || typeof e.replace !== "string" || e.find === "") {
      return { ok: false, error: `edit ${i + 1}: needs string file, find (non-empty) and replace` };
    }
    if (!(e.file in out)) return { ok: false, error: `edit ${i + 1}: file ${e.file} was not loaded` };
    const text = out[e.file];
    const first = text.indexOf(e.find);
    if (first < 0) return { ok: false, error: `edit ${i + 1}: find text not found in ${e.file}` };
    if (text.indexOf(e.find, first + 1) >= 0) return { ok: false, error: `edit ${i + 1}: find text matches more than once in ${e.file}` };
    out[e.file] = text.slice(0, first) + e.replace + text.slice(first + e.find.length);
  }
  return { ok: true, files: out };
}

/**
 * What a patch touches, from git's own parse (`git apply --numstat -z` and
 * `--summary` on the patch copy), not from its headers: copies, renames,
 * `z/`-prefixed -p1 paths, empty-file deletes and mode-only changes all count.
 * Renames list both sides. Copies, mode changes and symlink/submodule modes are refused.
 * @returns {{files: string[], refusal: string | null}}
 */
export function patchPlan(numstatZ, summary) {
  const files = new Set();
  const tokens = String(numstatZ).split("\0");
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t) continue;
    const m = /^(?:\d+|-)\t(?:\d+|-)\t(.*)$/s.exec(t);
    if (!m) continue;
    if (m[1] === "") {
      // rename/copy in -z form: "<a>\t<d>\t\0<old>\0<new>\0"
      if (tokens[i + 1]) files.add(tokens[i + 1]);
      if (tokens[i + 2]) files.add(tokens[i + 2]);
      i += 2;
    } else files.add(m[1]);
  }
  let refusal = null;
  for (const raw of String(summary).split("\n")) {
    const l = raw.trim();
    if (!l) continue;
    if (/^copy /.test(l)) refusal = "the patch copies a file; a plant may only edit, add, delete or rename";
    else if (/^mode change /.test(l)) refusal = "the patch changes a file mode; a plant may not";
    else if (/^(?:create|delete) mode 1[26]0000 /.test(l)) refusal = "the patch creates or deletes a symlink or submodule";
    else if (/^rename /.test(l) && /"/.test(l)) refusal = "the patch names a path that git has to quote; rename it";
    const cd = /^(?:create|delete) mode \d+ (.+)$/.exec(l);
    if (cd) files.add(cd[1]);
    // `rename a/{f => f2} (100%)` (git's brace form) or `rename a => b (100%)`; numstat names only the new side.
    const br = /^(?:rename|copy) (.*)\{(.*) => (.*)\}(.*) \(\d+%\)$/.exec(l);
    const pl = /^(?:rename|copy) (.+) => (.+) \(\d+%\)$/.exec(l);
    const squash = (x) => x.replace(/\/{2,}/g, "/");
    if (br) {
      files.add(squash(br[1] + br[2] + br[4]));
      files.add(squash(br[1] + br[3] + br[4]));
    } else if (pl) {
      files.add(pl[1]);
      files.add(pl[2]);
    }
  }
  for (const f of files) if (f.startsWith('"') || f.includes("\n")) refusal ??= "the patch names a path that git has to quote; rename it";
  return { files: [...files], refusal };
}

/** Why a plant touching these files may not run on this target, or null. */
export function plantRefusal({ shared, files }) {
  if (shared && convexTouched(files)) return "this target is shared dev: a plant in convex/ would push broken functions to every session";
  return null;
}

/** Entries of `git status --porcelain=v1 -z --untracked-files=all` as {path: "XY"}. */
export function parsePorcelainZ(out) {
  const entries = Object.create(null); // a path named __proto__ or constructor is just a key
  const t = String(out).split("\0");
  for (let i = 0; i < t.length; i++) {
    const m = /^(.)(.) (.+)$/s.exec(t[i]);
    if (!m) continue;
    entries[m[3]] = m[1] + m[2];
    if (m[1] === "R" || m[1] === "C") {
      entries[t[i + 1]] = "R-";
      i++;
    }
  }
  return entries;
}

/** Paths whose status differs between two snapshots and that are not in the manifest. */
export function strayChanges(before, after, manifestPaths) {
  const ok = new Set(manifestPaths);
  const out = [];
  for (const p of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!ok.has(p) && before[p] !== after[p]) out.push(p);
  }
  return out;
}

const DENIED_UNDER_WEB = [/(^|\/)\.env/i, /(^|\/)\.e2e-local(\/|$)/i, /(^|\/)node_modules(\/|$)/i, /(^|\/)\.git(\/|$)/i, /(^|\/)\.claude(\/|$)/i, /^playwright\/tools(\/|$)/i];

/**
 * A user-supplied file path made repo-relative; throws for anything off limits.
 * An allow-list: only apps/web/ (matched case-insensitively, since APFS is), minus env files,
 * .e2e-local, node_modules and the tool itself; and no symlink on the way to the file.
 */
export function safeRepoPath(repoRoot, p, base = APP_DIR) {
  const fail = () => new Error(`refusing to plant in ${p}`);
  const stripped = p.replace(/^(\.\/)?apps\/web\//, "");
  const abs = p.startsWith("apps/") || p.startsWith("./apps/") ? resolve(repoRoot, p) : resolve(base, stripped);
  const rel = relative(repoRoot, abs).replaceAll("\\", "/");
  if (!rel || rel.startsWith("..") || rel.includes("\0")) throw fail();
  if (!rel.toLowerCase().startsWith("apps/web/")) throw fail();
  const underWeb = rel.slice("apps/web/".length);
  if (DENIED_UNDER_WEB.some((re) => re.test(underWeb))) throw fail();
  // No symlink on the path, and the deepest existing parent really is inside the repo.
  let cur = repoRoot;
  let realParent = null;
  for (const seg of rel.split("/")) {
    const next = join(cur, seg);
    let st = null;
    try {
      st = lstatSync(next);
    } catch {
      break;
    }
    if (st.isSymbolicLink()) throw fail();
    cur = next;
    realParent = cur;
  }
  try {
    const root = realpathSync(repoRoot);
    const real = realpathSync(realParent ?? repoRoot);
    if (real !== root && !real.startsWith(`${root}${sep}`)) throw fail();
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("refusing")) throw err;
    throw fail();
  }
  return rel;
}

export function buildManifest(repoRoot, relPaths, extra = {}, fsApi = { existsSync, readFileSync }) {
  return {
    ...extra,
    files: relPaths.map((rel) => {
      const abs = join(repoRoot, rel);
      const existed = fsApi.existsSync(abs);
      const buf = existed ? fsApi.readFileSync(abs) : null;
      return { path: rel, existed, sha256: buf ? sha256(buf) : null, bytes: buf ? buf.toString("base64") : null };
    }),
  };
}

/** Record what each file is right after the plant went in, so a restore can tell the plant from a later edit. */
export function recordPlanted(manifest, repoRoot, fsApi = { existsSync, readFileSync }) {
  for (const f of manifest.files ?? []) {
    const abs = join(repoRoot, f.path);
    f.planted = fsApi.existsSync(abs) ? { exists: true, sha256: sha256(fsApi.readFileSync(abs)) } : { exists: false, sha256: null };
  }
  manifest.plantedAt = new Date().toISOString();
  return manifest;
}

/**
 * Put every manifest file back byte for byte and verify by hash. A file is only
 * overwritten while it still holds exactly what the plant wrote; one already back
 * at its original is left alone; anything else was edited since and is listed, not touched.
 * @returns {{ok: boolean, problems: string[], restored: string[], edited: string[], convexTouched: boolean}}
 */
export function restoreFromManifest(manifest, repoRoot, fsApi = { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync }) {
  const problems = [];
  const restored = [];
  const edited = [];
  for (const f of manifest.files ?? []) {
    try {
      const abs = join(repoRoot, safeRepoPath(repoRoot, f.path, repoRoot));
      const exists = fsApi.existsSync(abs);
      const current = exists ? sha256(fsApi.readFileSync(abs)) : null;
      if (current === (f.existed ? f.sha256 : null)) {
        restored.push(f.path);
        continue;
      }
      if (!f.planted || current !== f.planted.sha256) {
        edited.push(f.path);
        problems.push(`${f.path}: changed since the plant (not by it); left as is`);
        continue;
      }
      if (f.existed) {
        fsApi.mkdirSync(dirname(abs), { recursive: true });
        fsApi.writeFileSync(abs, Buffer.from(f.bytes, "base64"));
        if (sha256(fsApi.readFileSync(abs)) !== f.sha256) problems.push(`${f.path}: hash differs after restore`);
        else restored.push(f.path);
      } else {
        fsApi.unlinkSync(abs);
        if (fsApi.existsSync(abs)) problems.push(`${f.path}: still exists after restore`);
        else restored.push(f.path);
      }
    } catch (err) {
      problems.push(`${f.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { ok: problems.length === 0, problems, restored, edited, convexTouched: convexTouched((manifest.files ?? []).map((f) => f.path)) };
}

/** Mask the value of a snapshot textbox whose accessible name says it holds a secret. */
export function maskSecretLine(line) {
  const m = /^(\s*-\s*textbox\s+"((?:[^"\\]|\\.)*)")(.*)$/s.exec(line);
  if (!m || !/password|secret|token|key|code/i.test(m[2])) return line;
  const i = m[3].indexOf(":");
  return i < 0 ? line : `${m[1]}${m[3].slice(0, i + 1)} [masked]`;
}

// ---------------------------------------------------------------- io (stubbable)

export const io = {
  now: () => new Date(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  capture(cmd, args, { cwd = APP_DIR, env = process.env, timeoutMs = 120_000 } = {}) {
    const r = spawnSync(cmd, args, { cwd, env, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
    return { code: r.status ?? (r.error ? 127 : 1), stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  },
  /** Run a command, appending its output (scrubbed, line by line) through `logger`. */
  runLogged(cmd, args, { cwd = APP_DIR, env = process.env, logger, timeoutMs = 45 * 60_000, onChild } = {}) {
    return new Promise((resolveCode) => {
      const child = spawn(cmd, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
      onChild?.(child);
      const timer = setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          /* gone */
        }
      }, timeoutMs);
      const feed = (stream) => {
        let buf = "";
        stream.on("data", (c) => {
          buf += c.toString();
          const parts = buf.split("\n");
          buf = parts.pop() ?? "";
          for (const l of parts) logger.line(l);
        });
        stream.on("end", () => buf && logger.line(buf));
      };
      feed(child.stdout);
      feed(child.stderr);
      child.on("error", (e) => {
        logger.line(`spawn failed: ${e.message}`);
        clearTimeout(timer);
        resolveCode(127);
      });
      child.on("close", (code, sig) => {
        clearTimeout(timer);
        resolveCode(code ?? (sig ? 143 : 1));
      });
    });
  },
  listenerPid(port) {
    const r = io.capture("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { timeoutMs: 15_000 });
    const pid = Number(r.stdout.split("\n")[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  },
  processCwd(pid) {
    const r = io.capture("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { timeoutMs: 15_000 });
    const line = r.stdout.split("\n").find((l) => l.startsWith("n"));
    return line ? line.slice(1) : null;
  },
  /** Vite, detached, its output piped through this tool's redacting filter into `logFile` (never raw). */
  startViteLogged({ port, cwd, env, logFile, literals }) {
    const child = spawn(
      "sh",
      ["-c", 'npx --no-install vite --port "$1" --strictPort 2>&1 | "$2" "$3" __logfilter "$4"', "sh", String(port), process.execPath, SELF, logFile],
      { cwd, env: { ...env, E2E_RUN_LITERALS: JSON.stringify(literals) }, detached: true, stdio: "ignore" },
    );
    child.unref();
    return child.pid;
  },
  readTarget: (opts, destructive) => readTargetInputs(opts, destructive),
  commandLine(pid) {
    const r = io.capture("ps", ["-p", String(pid), "-o", "command="], { timeoutMs: 15_000 });
    return r.code === 0 ? r.stdout.trim() : "";
  },
  isAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return err.code === "EPERM";
    }
  },
  async httpUp(port) {
    try {
      await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(3000) });
      return true;
    } catch {
      return false;
    }
  },
};

// ---------------------------------------------------------------- paths and state

const localDir = () => process.env.E2E_RUN_LOCAL_DIR || join(APP_DIR, ".e2e-local"); // the env override is a seam for tests
const runsDir = () => join(localDir(), "runs");
const stateFile = () => join(localDir(), "seed-state.json");
const lockFile = () => join(localDir(), "run.lock");
const currentFile = () => join(localDir(), "current");
const plantDir = () => join(localDir(), "plant");
const manifestFile = () => join(plantDir(), "manifest.json");
const stampFile = () => join(localDir(), "push-stamp.json");
const patchCopyFile = () => join(plantDir(), "patch.diff");

function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
const loadState = () => readJson(stateFile());
const saveState = (s) => writeJson(stateFile(), s);

function repoRoot() {
  const r = io.capture("git", ["rev-parse", "--show-toplevel"], { cwd: APP_DIR, timeoutMs: 15_000 });
  return r.code === 0 ? r.stdout.trim() : resolve(APP_DIR, "../..");
}

function readTargetInputs(opts, destructive = false) {
  const root = repoRoot();
  let mainText = null;
  const wl = io.capture("git", ["worktree", "list", "--porcelain"], { cwd: root, timeoutMs: 15_000 });
  const first = wl.stdout.split("\n").find((l) => l.startsWith("worktree "));
  if (first) {
    try {
      mainText = readFileSync(join(first.slice(9), "apps/web/.env.local"), "utf8");
    } catch {
      mainText = null;
    }
  }
  let envLocal = null;
  try {
    envLocal = readFileSync(join(APP_DIR, ".env.local"), "utf8");
  } catch {
    envLocal = null;
  }
  let dotEnv = null;
  try {
    dotEnv = readFileSync(join(APP_DIR, ".env"), "utf8");
  } catch {
    dotEnv = null;
  }
  const nvm = (() => {
    try {
      const v = readFileSync(join(APP_DIR, ".nvmrc"), "utf8").trim().replace(/^v/, "");
      const bin = join(homedir(), ".nvm/versions/node", `v${v}`, "bin");
      return existsSync(bin) ? bin : null;
    } catch {
      return null;
    }
  })();
  return resolveTarget({
    ci: Boolean(process.env.CI),
    processEnv: process.env,
    envLocalText: envLocal,
    envText: dotEnv,
    mainEnvLocalText: mainText,
    dirName: basename(root),
    allowSharedDev: Boolean(opts.allowSharedDev),
    destructive,
    portOverride: opts.port,
    nvmBin: nvm,
  });
}

function makeLogger(file, literals) {
  return {
    line(l) {
      try {
        appendFileSync(file, `${clip(cleanText(l, literals), 2000)}\n`);
      } catch {
        /* log dir gone */
      }
    },
  };
}

/** `e2e-run.mjs __logfilter <file>`: copy stdin to the file line by line through the redactor. */
async function logFilter(file) {
  let literals = [];
  try {
    literals = JSON.parse(process.env.E2E_RUN_LITERALS ?? "[]");
  } catch {
    literals = [];
  }
  const logger = makeLogger(file, literals);
  let buf = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    buf += chunk;
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const l of parts) logger.line(l);
  }
  if (buf) logger.line(buf);
}

function convexFingerprint() {
  const root = repoRoot();
  const cap = (a) => io.capture("git", a, { cwd: APP_DIR, timeoutMs: 30_000 }).stdout;
  const h = createHash("sha256");
  h.update(cap(["rev-parse", "HEAD:./convex"]));
  h.update(cap(["diff", "HEAD", "--", "convex"]));
  for (const f of cap(["ls-files", "-o", "--exclude-standard", "--", "convex"]).split("\n").filter(Boolean)) {
    h.update(f);
    try {
      h.update(readFileSync(join(root, "apps/web", f)));
    } catch {
      /* removed meanwhile */
    }
  }
  return h.digest("hex");
}

// ---------------------------------------------------------------- lock

/** The pid in the lock file; 0 when the directory or the file does not exist yet (a fresh worktree). */
function readLockPid() {
  try {
    return Number(readFileSync(lockFile(), "utf8").trim()) || 0;
  } catch {
    return 0;
  }
}

function acquireLock() {
  mkdirSync(localDir(), { recursive: true });
  const existing = readLockPid();
  if (existing && io.isAlive(existing)) return { ok: false, pid: existing };
  try {
    unlinkSync(lockFile());
  } catch {
    /* none */
  }
  writeFileSync(lockFile(), String(process.pid), { flag: "wx" });
  return { ok: true };
}
const setLockPid = (pid) => writeFileSync(lockFile(), String(pid));
function releaseLock(pid = process.pid) {
  if (readLockPid() === pid) {
    try {
      unlinkSync(lockFile());
    } catch {
      /* gone */
    }
  }
}

// ---------------------------------------------------------------- vite

export async function ensureVite(ctx) {
  const { port, env } = ctx;
  const pid = io.listenerPid(port);
  if (pid) {
    const cwd = io.processCwd(pid);
    let same = false;
    try {
      same = cwd !== null && realpathSync(cwd) === realpathSync(APP_DIR);
    } catch {
      same = false;
    }
    if (!same) throw new Error(`port ${port} is in use by a process that is not this worktree's Vite; free it or pass --port`);
    return;
  }
  mkdirSync(localDir(), { recursive: true });
  io.startViteLogged({
    port,
    cwd: APP_DIR,
    env: { ...env, VITE_DEV_DISABLE_HTTPS: "1" },
    logFile: join(localDir(), `vite-${port}.log`),
    literals: ctx.deployment ? [ctx.deployment] : [],
  });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await io.sleep(1000);
    if (io.listenerPid(port) && (await io.httpUp(port))) return;
  }
  throw new Error(`Vite did not come up on :${port} within 60 s (see .e2e-local/vite-${port}.log)`);
}

// ---------------------------------------------------------------- runner

async function resolvePaused(ctx) {
  const a = io.capture("npx", ["--no-install", "convex", "env", "get", "NEONBINDER_PAUSED_PLATFORMS"], { env: ctx.env });
  if (a.code === 0) return a.stdout.trim();
  const b = io.capture("gh", ["variable", "get", "NEONBINDER_PAUSED_PLATFORMS"], { env: ctx.env, timeoutMs: 30_000 });
  if (b.code === 0) return b.stdout.trim();
  throw new Error("could not read NEONBINDER_PAUSED_PLATFORMS (neither the deployment nor the repo variable answered)");
}

export async function doSeed(ctx) {
  // The last line of defence: whatever planned this run, never reset a shared deployment.
  const guard = io.readTarget(ctx.opts ?? {}, true);
  if (!guard.ok || guard.shared || guard.deployment !== ctx.deployment) {
    ctx.logger.line(`seed refused: ${guard.ok ? (guard.shared ? "this deployment is shared dev" : "the target changed since the run started") : guard.reason}`);
    return EXIT.refused;
  }
  const uri = io.capture("gh", ["variable", "get", "NEONBINDER_REFERENCE_SEED_URI"], { env: ctx.env, timeoutMs: 30_000 });
  const paused = io.capture("gh", ["variable", "get", "NEONBINDER_PAUSED_PLATFORMS"], { env: ctx.env, timeoutMs: 30_000 });
  if (uri.code !== 0 || paused.code !== 0 || !uri.stdout.trim()) {
    ctx.logger.line("seed: could not read the repo variables with gh (is gh logged in?)");
    return EXIT.refused;
  }
  const scratch = mkdtempSync(join(tmpdir(), "nb-e2e-seed-"));
  try {
    const bundle = join(scratch, "reference-seed.zip");
    const cp = io.capture("gcloud", ["storage", "cp", "--quiet", uri.stdout.trim(), bundle], { env: ctx.env, timeoutMs: 10 * 60_000 });
    if (cp.code !== 0) {
      ctx.logger.line("seed: could not fetch the reference seed bundle. gcloud said:");
      for (const l of `${cp.stderr}`.split("\n").filter(Boolean).slice(-8)) ctx.logger.line(`  ${l}`);
      ctx.logger.line("seed: if the login expired, re-run after `gcloud auth login`");
      return EXIT.refused;
    }
    const code = await io.runLogged("./e2e-seed-reset.sh", [], {
      env: { ...ctx.env, NB_REFERENCE_BUNDLE: bundle, CONVEX_NAME: ctx.deployment, E2E_BASELINE_CONFIRM: "1" },
      logger: ctx.logger,
      onChild: ctx.onChild,
    });
    if (code !== 0) return code;
    const set = io.capture("npx", ["--no-install", "convex", "env", "set", "--deployment", ctx.deployment, "NEONBINDER_PAUSED_PLATFORMS", paused.stdout.trim()], { env: ctx.env });
    if (set.code !== 0) {
      ctx.logger.line("seed: could not set NEONBINDER_PAUSED_PLATFORMS on the deployment");
      return EXIT.fail;
    }
    saveState({ seededAt: io.now().toISOString(), seededBy: "e2e-run", workers: {}, ran: [] });
    ctx.paused = null;
    return 0;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function pushConvex(opts, ctx) {
  const t = io.readTarget(opts, false);
  if (!t.ok) {
    ctx.logger.line(`push refused: ${t.reason}`);
    return EXIT.refused;
  }
  const code = await io.runLogged("npx", ["--no-install", "convex", "dev", "--once"], { env: t.env, logger: ctx.logger, onChild: ctx.onChild });
  if (code === 0) writeJson(stampFile(), { at: io.now().toISOString(), fingerprint: convexFingerprint() });
  return code;
}

function stateAfterPhase(phase, ctx, code, report) {
  const state = loadState() ?? { seededAt: null, seededBy: "unknown", workers: {}, ran: [] };
  const w = (state.workers[String(ctx.worker)] ??= {});
  const at = io.now().toISOString();
  if (phase.kind === "setup" && code === 0) w.setup = at;
  if (phase.kind === "bootstrap" && code === 0) w.bootstrap = at;
  // A planted red is the product broken on purpose, not a real run of the spec.
  if (phase.kind === "spec" && !(ctx.planting && code !== 0)) {
    state.ran = [...(state.ran ?? []), { project: phase.pw, args: ctx.specs, files: [...new Set(collectTests(report).map((t) => t.file))], at, status: code === 0 ? "passed" : "failed" }];
  }
  saveState(state);
}

async function runPhases(phases, ctx) {
  let exit = 0;
  const done = [];
  for (const phase of phases) {
    if (ctx.stopping()) return { exit: 130, done };
    ctx.setPhase(phase.label);
    let code;
    if (phase.kind === "seed") {
      code = await doSeed(ctx);
      done.push({ label: phase.label, pw: "seed", kind: "seed", exit: code });
    } else {
      ctx.paused ??= await resolvePaused(ctx);
      const json = join(ctx.runDir, `${phase.label}.json`);
      const args = ["--no-install", "playwright", "test", `--project=${phase.pw}`, "--retries=0", "--reporter=list,json", `--output=${join(ctx.runDir, "results", phase.label)}`];
      if (phase.kind === "spec") {
        args.push("--no-deps");
        if (ctx.opts.grep) args.push(`--grep=${ctx.opts.grep}`);
        args.push(...ctx.specs);
      }
      code = await io.runLogged("npx", args, {
        env: { ...ctx.env, APP_URL: `http://localhost:${ctx.port}`, WORKER_INDEX: String(ctx.worker), PAUSED_PLATFORMS: ctx.paused, PLAYWRIGHT_JSON_OUTPUT_FILE: json },
        logger: ctx.logger,
        onChild: ctx.onChild,
      });
      stateAfterPhase(phase, ctx, code, readJson(json));
      done.push({ label: phase.label, pw: phase.pw, kind: phase.kind, exit: code });
    }
    if (code !== 0) {
      exit = code === 1 ? 1 : code === EXIT.refused ? EXIT.refused : 1;
      break;
    }
  }
  return { exit, done };
}

function pruneRuns(keep) {
  try {
    const dirs = readdirSync(runsDir()).filter((d) => /^\d{8}-\d{6}-/.test(d)).sort();
    for (const d of dirs.slice(0, Math.max(0, dirs.length - KEEP_RUNS))) if (d !== keep) rmSync(join(runsDir(), d), { recursive: true, force: true });
  } catch {
    /* none */
  }
}

/** The detached runner: `e2e-run.mjs __runner <runDir>`. */
async function runner(runDir) {
  const job = readJson(join(runDir, "job.json"));
  const statusFile = join(runDir, "status.json");
  const status = { state: "running", phase: "starting", pid: process.pid, startedAt: io.now().toISOString(), kind: job.kind };
  const save = () => writeJson(statusFile, status);
  save();
  setLockPid(process.pid);
  let stopping = false;
  let child = null;
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => {
      stopping = true;
      try {
        if (child?.pid) process.kill(-child.pid, "SIGTERM");
      } catch {
        /* gone */
      }
    });
  }
  const plan = planJob({ kind: job.kind, opts: job.opts, specs: job.specs, state: loadState() });
  const t = io.readTarget(job.opts, plan.destructive);
  const logger = makeLogger(join(runDir, "run.log"), t.ok ? [t.deployment] : []);
  let exit = EXIT.fail;
  let metaPlant = null;
  const plantNotes = [];
  let prior = [];
  let phasesDone = [];
  let ctx = null;
  let manifest = null;
  let plantRestore = null;
  let applyEntered = false; // true once the plant may have written to disk
  try {
    if (!t.ok) {
      logger.line(`refused: ${t.reason}`);
      exit = EXIT.refused;
      return;
    }
    ctx = {
      ...t,
      opts: job.opts,
      specs: job.specs,
      worker: job.opts.worker,
      runDir,
      logger,
      paused: null,
      stopping: () => stopping,
      onChild: (c) => (child = c),
      setPhase: (p) => {
        status.phase = p;
        save();
      },
    };
    const state = loadState();
    prior = (state?.ran ?? []).slice();
    if (job.kind === "seed") {
      const r = await runPhases(plan.phases, ctx);
      exit = r.exit;
      phasesDone = r.done;
      return;
    }
    await ensureVite(ctx);
    if (job.kind === "plant") {
      if (plan.note) {
        plantNotes.push(plan.note);
        logger.line(plan.note);
      }
      ctx.planting = true;
      const root = repoRoot();
      const rels = job.plant.files.map((f) => safeRepoPath(root, f, root));
      const refusal = plantRefusal({ shared: t.shared, files: rels });
      if (refusal) throw new Error(refusal);
      manifest = buildManifest(root, rels, { startedAt: io.now().toISOString(), pid: process.pid });
      mkdirSync(plantDir(), { recursive: true });
      writeJson(manifestFile(), manifest);
      if (job.plant.edits) {
        const texts = Object.fromEntries(rels.map((r) => [r, readFileSync(join(root, r), "utf8")]));
        const res = applyEdits(
          texts,
          job.plant.edits.map((e) => ({ ...e, file: safeRepoPath(root, e.file) })),
        );
        if (!res.ok) throw new Error(res.error);
        applyEntered = true;
        for (const [r, text] of Object.entries(res.files)) writeFileSync(join(root, r), text);
      } else {
        // The copy made at start() is what was checked; apply that exact file, and watch git's own view of the tree.
        if (sha256(readFileSync(job.plant.patch)) !== job.plant.patchSha256) throw new Error("the patch copy changed since it was checked");
        // Report-only: a snapshot is only trusted when git status succeeded, and nothing here ever deletes or restores a path.
        const snapshot = () => {
          const r = io.capture("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: root, timeoutMs: 60_000 });
          return r.code === 0 ? parsePorcelainZ(r.stdout) : null;
        };
        const before = snapshot();
        if (!before) throw new Error("git status failed before the patch was applied; refusing to apply it");
        applyEntered = true;
        const ap = io.capture("git", ["apply", job.plant.patch], { cwd: root, timeoutMs: 30_000 });
        if (ap.code !== 0) throw new Error("git apply failed");
        const after = snapshot();
        if (!after) throw new Error("git status failed after the patch was applied; cannot tell what it changed, so aborting (the declared files are being restored; check git status by hand)");
        const stray = strayChanges(before, after, rels);
        if (stray.length) {
          throw new Error(`the patch changed files outside what it declared, or another session edited the tree meanwhile (${stray.length}); aborting, the declared files are being restored and these are left untouched for you to review: ${stray.join(", ")}`);
        }
      }
      recordPlanted(manifest, root);
      writeJson(manifestFile(), manifest);
      logger.line(`plant: applied to ${rels.length} file(s)`);
      if (convexTouched(rels)) {
        const pc = await pushConvex(job.opts, ctx);
        if (pc !== 0) throw new Error("push of the planted convex/ code failed");
      }
    } else if (job.opts.push) {
      const pc = await pushConvex(job.opts, ctx);
      if (pc !== 0) {
        exit = pc === EXIT.refused ? EXIT.refused : EXIT.fail;
        return;
      }
    }
    const r = await runPhases(plan.phases, ctx);
    exit = r.exit;
    phasesDone = r.done;
    // A seed phase in this run emptied the record of what ran on the seed.
    if (phasesDone.some((d) => d.kind === "seed" && d.exit === 0)) prior = [];
    if (job.kind === "plant") {
      const failedTests = phasesDone.flatMap((d) => (d.kind === "spec" ? collectTests(readJson(join(runDir, `${d.label}.json`))) : [])).filter((x) => x.status === "failed");
      const setupBroke = phasesDone.some((d) => d.kind !== "spec" && d.exit !== 0);
      const errText = failedTests.map((x) => stripAnsi(x.error)).join("\n");
      if (failedTests.length && !setupBroke) {
        if (!job.plant.expect) metaPlant = ["PLANT: RED, reason unchecked (no --expect given)", ...(errText ? [`  ${clip(cleanText(errText.split("\n").find((l) => l.trim()) ?? "", [ctx.deployment]))}`] : [])];
        else if (new RegExp(job.plant.expect).test(errText)) metaPlant = ["PLANT RED as planted (matched --expect)"];
        else metaPlant = ["PLANT: RED, but --expect did not match: the spec failed for another reason", `  ${clip(cleanText(errText.split("\n").find((l) => l.trim()) ?? "", [ctx.deployment]))}`];
        exit = metaPlant[0].startsWith("PLANT RED") || !job.plant.expect ? 0 : 1;
      } else if (setupBroke) {
        metaPlant = ["PLANT: a setup/bootstrap phase failed before the spec could prove anything"];
        exit = 1;
      } else {
        metaPlant = ["PLANT STAYED GREEN: the spec does not prove this"];
        exit = 1;
      }
    }
  } catch (err) {
    logger.line(`error: ${err instanceof Error ? err.message : String(err)}`);
    exit = exit === EXIT.fail || exit === 0 ? EXIT.refused : exit;
  } finally {
    if (manifest) {
      // An apply that died half way never got its planted hashes: they are whatever is on disk right now.
      // Only when the apply step was entered; before that a changed file is someone else's edit and is left alone.
      if (!manifest.plantedAt && applyEntered) recordPlanted(manifest, repoRoot());
      plantRestore = restoreFromManifest(manifest, repoRoot());
      if (plantRestore.ok) {
        if (plantRestore.convexTouched && ctx) {
          const pc = await pushConvex(job.opts, ctx).catch(() => 1);
          if (pc !== 0) logger.line("plant: restored the files but the follow-up push of convex/ failed: run `e2e-run run --push` before trusting the deployment");
        }
        for (const f of [manifestFile(), patchCopyFile()]) {
          try {
            unlinkSync(f);
          } catch {
            /* gone */
          }
        }
        logger.line("plant: restored and verified");
      } else {
        exit = EXIT.restoreFailed;
        metaPlant = [`PLANT RESTORE FAILED: ${plantRestore.problems.join("; ")}`, "  fix by hand from .e2e-local/plant/manifest.json before anything else (a file listed as changed since the plant was left as you edited it); do NOT commit"];
        logger.line(metaPlant[0]);
      }
    }
    const state = loadState();
    const finishedAt = io.now().toISOString();
    const meta = {
      runId: basename(runDir),
      kind: job.kind,
      project: job.kind === "seed" ? "seed" : job.opts.project,
      worker: job.opts.worker,
      port: t.ok ? t.port : null,
      paused: ctx?.paused ?? null,
      startedAt: status.startedAt,
      finishedAt,
      exit,
      phases: phasesDone,
      prior,
      seedLine: seedLine(state, job.opts.worker),
      convexLine: t.ok ? convexLine(readJson(stampFile()), convexFingerprint()) : "",
      plant: metaPlant,
      notes: plantNotes,
      literals: t.ok ? [t.deployment] : [],
      refused: !t.ok ? t.reason : null,
    };
    writeJson(join(runDir, "meta.json"), meta);
    status.state = "done";
    status.exit = exit;
    status.finishedAt = finishedAt;
    save();
    pruneRuns(basename(runDir));
    releaseLock();
  }
}

// ---------------------------------------------------------------- commands

function stamp() {
  const d = io.now();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function digestFor(runDir) {
  const meta = readJson(join(runDir, "meta.json"));
  if (!meta) return null;
  if (meta.refused) return `E2E ${meta.runId}  REFUSED (exit ${meta.exit}): ${cleanText(meta.refused)}`;
  const log = (() => {
    try {
      return readFileSync(join(runDir, "run.log"), "utf8").split("\n").filter(Boolean).slice(-25);
    } catch {
      return [];
    }
  })();
  const phases = (meta.phases ?? [])
    .filter((p) => p.kind !== "seed")
    .map((p) => ({ label: p.label, pw: p.pw, kind: p.kind, report: readJson(join(runDir, `${p.label}.json`)), logTail: log }));
  const seeds = (meta.phases ?? []).filter((p) => p.kind === "seed" && p.exit !== 0);
  const text = buildDigest({ meta, phases, runDir, literals: meta.literals ?? [], relRoot: resolve(APP_DIR, "../.."), readText: (p) => (existsSync(p) ? readFileSync(p, "utf8") : null) });
  return seeds.length ? `${text}\nseed failed: see run.log` : text;
}

function latestRun() {
  const cur = (() => {
    try {
      return readFileSync(currentFile(), "utf8").trim();
    } catch {
      return null;
    }
  })();
  return cur && existsSync(join(runsDir(), cur)) ? join(runsDir(), cur) : null;
}

async function waitFor(runDir, sliceS) {
  const started = Date.now();
  for (;;) {
    const st = readJson(join(runDir, "status.json"));
    if (st?.state === "done") {
      const text = digestFor(runDir);
      console.log(text ?? "run finished without a digest; see run.log");
      return st.exit ?? EXIT.fail;
    }
    if (st && st.pid && !io.isAlive(st.pid)) {
      console.log("the runner died without finishing (killed?). Last log lines:");
      try {
        console.log(readFileSync(join(runDir, "run.log"), "utf8").split("\n").slice(-15).join("\n"));
      } catch {
        /* none */
      }
      return EXIT.fail;
    }
    if (sliceS > 0 && Date.now() - started >= sliceS * 1000) {
      console.log(`still running: phase ${st?.phase ?? "?"}, ${Math.round((Date.now() - new Date(st?.startedAt ?? Date.now())) / 1000)} s in. Call: node playwright/tools/e2e-run.mjs wait`);
      return EXIT.running;
    }
    await io.sleep(1000);
  }
}

/** Put a leftover plant back (a killed run). Returns an exit code to stop with, or null to carry on. */
async function recoverPlant(opts) {
  const manifest = readJson(manifestFile());
  if (!manifest) return null;
  if (manifest.pid && io.isAlive(manifest.pid)) return null;
  console.log("restoring a leftover plant from a killed run...");
  const r = restoreFromManifest(manifest, repoRoot());
  if (!r.ok) {
    console.log(`PLANT RESTORE FAILED: ${r.problems.join("; ")}\nfix by hand from .e2e-local/plant/manifest.json (files listed as changed since the plant were left as you edited them); do NOT commit`);
    return EXIT.restoreFailed;
  }
  unlinkSync(manifestFile());
  try {
    unlinkSync(patchCopyFile());
  } catch {
    /* none */
  }
  console.log(`restored ${r.restored.length} file(s), verified by hash.${r.convexTouched ? " convex/ was touched: run with --push to re-push." : ""}`);
  return null;
}

async function start(kind, parsed) {
  const { opts, specs } = parsed;
  // Judge the whole plan, the plant's re-seed and the mobile pass of --project both included.
  const plan = planJob({ kind, opts, specs, state: loadState() });
  const t = io.readTarget(opts, plan.destructive);
  if (!t.ok) {
    console.log(`refused: ${t.reason}`);
    return EXIT.refused;
  }
  let plant = null;
  if (kind === "plant") {
    const root = repoRoot();
    try {
      if (opts.edit) {
        const edits = JSON.parse(readFileSync(resolve(opts.edit), "utf8"));
        const rels = [...new Set(edits.map((e) => safeRepoPath(root, e.file)))];
        const texts = Object.fromEntries(rels.map((r) => [r, readFileSync(join(root, r), "utf8")]));
        const dry = applyEdits(texts, edits.map((e) => ({ ...e, file: safeRepoPath(root, e.file) })));
        if (!dry.ok) throw new Error(dry.error);
        plant = { files: rels, edits, expect: opts.expect };
      } else {
        // One private copy of the patch: checked, listed and applied from the same bytes.
        const bytes = readFileSync(resolve(opts.patch));
        mkdirSync(plantDir(), { recursive: true });
        writeFileSync(patchCopyFile(), bytes, { mode: 0o600 });
        const copy = patchCopyFile();
        const num = io.capture("git", ["apply", "--numstat", "-z", copy], { cwd: root, timeoutMs: 30_000 });
        const sum = io.capture("git", ["apply", "--summary", copy], { cwd: root, timeoutMs: 30_000 });
        if (num.code !== 0 || sum.code !== 0) throw new Error("git could not read the patch");
        const pp = patchPlan(num.stdout, sum.stdout);
        if (pp.refusal) throw new Error(pp.refusal);
        const rels = [...new Set(pp.files.map((p) => safeRepoPath(root, p, root)))];
        if (rels.length === 0) throw new Error("the patch touches no files");
        const chk = io.capture("git", ["apply", "--check", copy], { cwd: root, timeoutMs: 30_000 });
        if (chk.code !== 0) throw new Error("git apply --check failed");
        plant = { files: rels, patch: copy, patchSha256: sha256(bytes), expect: opts.expect };
      }
    } catch (err) {
      console.log(`refused: ${cleanText(err instanceof Error ? err.message : String(err))}`);
      return EXIT.refused;
    }
    const refusal = plantRefusal({ shared: t.shared, files: plant.files });
    if (refusal) {
      console.log(`refused: ${refusal}`);
      return EXIT.refused;
    }
    if (existsSync(manifestFile())) {
      console.log("refused: a plant manifest is still present (a plant is running, or its restore failed); status shows which");
      return EXIT.refused;
    }
  }
  if (kind === "plant" && plan.note) console.log(plan.note);
  const lock = acquireLock();
  if (!lock.ok) {
    console.log("lock held: another e2e-run is in progress in this worktree. Use `wait` or `stop`.");
    return EXIT.locked;
  }
  const runId = `${stamp()}-${kind === "plant" ? "plant-" : ""}${kind === "seed" ? "seed" : opts.project}`;
  const runDir = join(runsDir(), runId);
  mkdirSync(runDir, { recursive: true });
  writeJson(join(runDir, "job.json"), { kind, opts, specs, plant });
  writeFileSync(currentFile(), runId);
  const child = spawn(process.execPath, [SELF, "__runner", runDir], { cwd: APP_DIR, env: process.env, detached: true, stdio: "ignore" });
  child.unref();
  setLockPid(child.pid);
  return waitFor(runDir, opts.slice);
}

async function status() {
  const lines = [];
  const pid = readLockPid();
  lines.push(pid && io.isAlive(pid) ? `lock: held by a live runner (pid ${pid})` : "lock: free");
  const run = latestRun();
  const st = run && readJson(join(run, "status.json"));
  if (st) lines.push(`current run: ${basename(run)} ${st.state}${st.state === "done" ? ` (exit ${st.exit})` : `, phase ${st.phase}`}`);
  const state = loadState();
  lines.push(state ? seedLine(state, 8) : "seed: not seeded by e2e-run");
  const stampJ = readJson(stampFile());
  lines.push(convexLine(stampJ, stampJ ? convexFingerprint() : ""));
  const m = readJson(manifestFile());
  lines.push(m ? `PLANT PENDING: ${m.files?.length ?? 0} file(s) broken on purpose${m.pid && io.isAlive(m.pid) ? " (plant running)" : " (leftover from a killed run: any run, plant or seed restores it; status never touches files)"}` : "plant: none pending");
  const t = io.readTarget({}, false);
  if (t.ok) lines.push(`vite :${t.port}: ${io.listenerPid(t.port) ? "listening" : "not running"}; target: own dev deployment ✓${t.shared ? " (shared dev, allowed)" : ""}`);
  else lines.push(`target: refused (${t.reason})`);
  console.log(lines.join("\n"));
  return 0;
}

async function stop() {
  const pid = readLockPid();
  if (!pid || !io.isAlive(pid)) {
    console.log("nothing running");
    return 0;
  }
  // Only ever signal our own runner: the lock file is plain text and a pid is reused.
  const run = latestRun();
  const st = run && readJson(join(run, "status.json"));
  const cmd = io.commandLine(pid);
  if (!st || st.pid !== pid || !cmd.includes("e2e-run.mjs") || !cmd.includes("__runner")) {
    console.log("refused: the lock names a process that is not this tool's runner; not signalling it (remove .e2e-local/run.lock if it is stale)");
    return EXIT.refused;
  }
  process.kill(pid, "SIGTERM");
  for (let i = 0; i < 60 && io.isAlive(pid); i++) await io.sleep(500);
  console.log(io.isAlive(pid) ? "runner is still shutting down (restoring files, if a plant); run `status`" : "stopped");
  return 0;
}

async function stopVite(opts) {
  const t = io.readTarget(opts, false);
  if (!t.ok) {
    console.log(`refused: ${t.reason}`);
    return EXIT.refused;
  }
  const pid = io.listenerPid(t.port);
  if (!pid) {
    console.log(`nothing listening on :${t.port}`);
    return 0;
  }
  const cwd = io.processCwd(pid);
  if (!cwd || realpathSync(cwd) !== realpathSync(APP_DIR)) {
    console.log(`:${t.port} is not this worktree's Vite; leaving it`);
    return EXIT.refused;
  }
  process.kill(pid, "SIGTERM");
  console.log(`stopped Vite on :${t.port}`);
  return 0;
}

export async function main(argv = process.argv.slice(2)) {
  if (argv[0] === "__runner") return runner(argv[1]).then(() => 0);
  if (argv[0] === "__logfilter") return logFilter(argv[1]).then(() => 0);
  const parsed = parseArgs(argv);
  if (parsed.error) {
    console.log(`${cleanText(parsed.error)}\n\n${HELP}`);
    return EXIT.refused;
  }
  if (parsed.cmd === "help") {
    console.log(HELP);
    return 0;
  }
  if (process.env.CI) {
    console.log("refused: CI is set");
    return EXIT.refused;
  }
  // Only a command that is about to run something restores a leftover plant; status, digest, wait, stop never touch files.
  if (["run", "plant", "seed"].includes(parsed.cmd)) {
    const rec = await recoverPlant(parsed.opts);
    if (rec !== null) return rec;
  }
  switch (parsed.cmd) {
    case "run":
    case "plant":
    case "seed":
      if (parsed.cmd === "plant" && existsSync(manifestFile())) {
        console.log("a plant manifest was present: restored if it was a leftover; rerun the plant");
      }
      return start(parsed.cmd, parsed);
    case "wait": {
      const run = latestRun();
      if (!run) {
        console.log("no run yet");
        return EXIT.refused;
      }
      return waitFor(run, parsed.opts.slice);
    }
    case "status":
      return status();
    case "digest": {
      const target = parsed.target === "last" ? latestRun() : existsSync(parsed.target) ? resolve(parsed.target) : join(runsDir(), parsed.target);
      const text = target && digestFor(target);
      console.log(text ?? "no finished run to digest (still running, or none yet)");
      return text ? 0 : EXIT.refused;
    }
    case "stop":
      return stop();
    case "stop-vite":
      return stopVite(parsed.opts);
    default:
      return EXIT.refused;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(cleanText(err instanceof Error ? err.message : String(err)));
      process.exit(EXIT.refused);
    },
  );
}
