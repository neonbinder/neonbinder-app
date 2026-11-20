// NEO-622: playwright/tools/e2e-run.mjs, the local E2E runner. Importing it has no side
// effects; its spawn/lsof/git seams sit behind `io`. These tests cover the pure parts:
// argument parsing, the target guard (what it refuses), the port rule, phase planning,
// the digest (size cap, no deployment name), exactly-once edits, and byte-exact restore.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APP_DIR,
  DIGEST_LIMIT,
  EXIT,
  HELP,
  applyEdits,
  buildDigest,
  buildManifest,
  doSeed,
  ensureVite,
  cleanText,
  collectTests,
  convexLine,
  convexTouched,
  io,
  locatorNames,
  main,
  maskSecretLine,
  needsPhases,
  parseArgs,
  parseEnvFile,
  parseErrorContext,
  parsePorcelainZ,
  patchPlan,
  phasePlan,
  planJob,
  plantReseed,
  plantRefusal,
  plantVerdict,
  ranOnSeed,
  recordPlanted,
  resolveTarget,
  restoreFromManifest,
  safeRepoPath,
  seedLine,
  sha256,
  snapshotWindow,
  strayChanges,
  vitePort,
} from "../playwright/tools/e2e-run.mjs";

// Only `spawn` is wrapped (still the real one by default) so a command-flow test can refuse to start a runner.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

// A deployment name that must never appear in output. Built so the literal is not a
// plausible real one.
const DEP = "happy-otter-123";
const OTHER = "shared-dev-456";
const envLocal = (over = {}) =>
  Object.entries({ CONVEX_DEPLOYMENT: `dev:${DEP}`, VITE_CONVEX_URL: `https://${DEP}.convex.cloud`, VITE_CONVEX_SITE_URL: `https://${DEP}.convex.site`, ...over })
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
const mainEnv = (name = OTHER) => `CONVEX_DEPLOYMENT=dev:${name}\n`;
const target = (over = {}) =>
  resolveTarget({ processEnv: { PATH: "/usr/bin" }, envLocalText: envLocal(), mainEnvLocalText: mainEnv(), dirName: "neo-622", ...over });

describe("parseArgs", () => {
  it("defaults to run on desktop with worker 8", () => {
    const r = parseArgs(["home/landing"]);
    expect(r.error).toBeUndefined();
    expect(r.cmd).toBe("run");
    expect(r.specs).toEqual(["home/landing"]);
    expect(r.opts).toMatchObject({ project: "desktop", worker: 8, fresh: false, setup: false, push: false, allowSharedDev: false });
  });

  it("reads the options and keeps the spec substrings", () => {
    const r = parseArgs(["run", "--project", "both", "--fresh", "--setup", "--push", "--worker", "3", "--port", "4000", "--grep", "a|b", "x", "y"]);
    expect(r.error).toBeUndefined();
    expect(r.specs).toEqual(["x", "y"]);
    expect(r.opts).toMatchObject({ project: "both", fresh: true, setup: true, push: true, worker: 3, port: 4000, grep: "a|b" });
  });

  it("refuses run with no spec and no grep", () => {
    expect(parseArgs(["run"]).error).toMatch(/at least one spec/);
  });

  it("accepts a grep in place of a spec", () => {
    expect(parseArgs(["run", "--grep", "x"]).error).toBeUndefined();
  });

  it("refuses an unknown option, a bad project and a non-number worker", () => {
    expect(parseArgs(["--bogus", "s"]).error).toMatch(/unknown option/);
    expect(parseArgs(["--project", "tablet", "s"]).error).toMatch(/desktop, mobile or both/);
    expect(parseArgs(["--worker", "x", "s"]).error).toMatch(/whole number/);
    expect(parseArgs(["--port", "70000", "s"]).error).toMatch(/whole number/);
  });

  it("refuses a value flag with no value", () => {
    expect(parseArgs(["s", "--grep"]).error).toMatch(/needs a value/);
  });

  it("refuses an invalid --expect regex", () => {
    expect(parseArgs(["plant", "--edit", "f.json", "--expect", "(", "s"]).error).toBeTruthy();
  });

  it("plant needs exactly one of --edit and --patch", () => {
    expect(parseArgs(["plant", "s"]).error).toMatch(/exactly one/);
    expect(parseArgs(["plant", "--edit", "a", "--patch", "b", "s"]).error).toMatch(/exactly one/);
    expect(parseArgs(["plant", "--edit", "a", "s"]).error).toBeUndefined();
  });

  it("--help becomes the help command", () => {
    expect(parseArgs(["--help"]).cmd).toBe("help");
    expect(HELP).toMatch(/Exit: 0 pass/);
  });

  it("digest takes a target, defaulting to last", () => {
    expect(parseArgs(["digest"]).target).toBe("last");
    expect(parseArgs(["digest", "some/dir"]).target).toBe("some/dir");
  });

  it("exit codes match the documented table", () => {
    expect(EXIT).toEqual({ pass: 0, fail: 1, refused: 2, locked: 3, restoreFailed: 4, running: 75 });
  });
});

describe("parseEnvFile", () => {
  it("reads KEY=VALUE, export, quotes and trailing comments", () => {
    const v = parseEnvFile(`# c\nA=1\nexport B="two words" # note\nC='x'\nD=plain # tail\n\nnot a line\n`);
    expect(v).toEqual({ A: "1", B: "two words", C: "x", D: "plain" });
  });
});

describe("vitePort", () => {
  it("is 3 followed by the ticket number", () => {
    expect(vitePort("neo-622")).toBe(3622);
    expect(vitePort("neo-5")).toBeNull();
  });
  it("returns null for a directory with no ticket", () => {
    expect(vitePort("main")).toBeNull();
  });
  it("returns null when 3<ticket> is out of range", () => {
    expect(vitePort("neo-99999")).toBeNull();
  });
  it("an override wins, even without a ticket", () => {
    expect(vitePort("main", 4100)).toBe(4100);
  });
});

describe("resolveTarget refusals", () => {
  it("accepts the worktree's own dev deployment and builds the env", () => {
    const r = target();
    expect(r).toMatchObject({ ok: true, deployment: DEP, port: 3622, shared: false });
    expect(r.env.CONVEX_DEPLOYMENT).toBeUndefined();
    expect(r.env.VITE_CONVEX_URL).toContain(DEP);
    expect(r.env.CI).toBeUndefined();
  });

  it("prepends the Node bin dir to PATH when given", () => {
    const r = target({ nvmBin: "/nvm/bin" });
    expect(r.env.PATH).toBe("/nvm/bin:/usr/bin");
  });

  it("refuses when CI is set", () => {
    const r = target({ ci: true });
    expect(r).toMatchObject({ ok: false });
    expect(r.reason).toMatch(/CI is set/);
  });

  it("refuses when .env.local is missing", () => {
    expect(target({ envLocalText: null }).reason).toMatch(/\.env\.local is missing/);
  });

  it("refuses a prod or non-dev: deployment", () => {
    for (const dep of ["prod:some-prod-name", "some-prod-name", ""]) {
      const r = target({ envLocalText: envLocal({ CONVEX_DEPLOYMENT: dep }) });
      expect(r.ok, dep).toBe(false);
      expect(r.reason).toMatch(/dev deployment/);
    }
  });

  it("refuses a deployment name outside the expected form", () => {
    const r = target({ envLocalText: envLocal({ CONVEX_DEPLOYMENT: "dev:Bad Name!" }) });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/expected form/);
  });

  it("refuses a deploy key or token in the process environment", () => {
    for (const k of ["CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN"]) {
      const r = target({ processEnv: { [k]: "secret-value-xyz" } });
      expect(r.ok, k).toBe(false);
      expect(r.reason).toContain(k);
      expect(r.reason).not.toContain("secret-value-xyz");
    }
  });

  it("refuses a deploy key or token in .env.local", () => {
    for (const k of ["CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN"]) {
      const r = target({ envLocalText: `${envLocal()}\n${k}=secret-value-xyz` });
      expect(r.ok, k).toBe(false);
      expect(r.reason).toContain(k);
      expect(r.reason).not.toContain("secret-value-xyz");
    }
  });

  it("refuses a deployment equal to the main checkout's (shared dev)", () => {
    const r = target({ mainEnvLocalText: mainEnv(DEP) });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/shared dev/);
  });

  it("refuses a VITE_CONVEX_URL that names another deployment", () => {
    const r = target({ envLocalText: envLocal({ VITE_CONVEX_URL: `https://${OTHER}.convex.cloud` }) });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/VITE_CONVEX_URL/);
  });

  it("refuses when the main checkout's .env.local is unreadable, without --allow-shared-dev", () => {
    const r = target({ mainEnvLocalText: null });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/unreadable/);
  });

  it("--allow-shared-dev lets an unreadable main or the shared deployment through, marked shared", () => {
    expect(target({ mainEnvLocalText: null, allowSharedDev: true })).toMatchObject({ ok: true, shared: true });
    expect(target({ mainEnvLocalText: mainEnv(DEP), allowSharedDev: true })).toMatchObject({ ok: true, shared: true });
  });

  it("refuses a destructive run on shared dev, even with --allow-shared-dev", () => {
    const r = target({ mainEnvLocalText: mainEnv(DEP), allowSharedDev: true, destructive: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/never/);
    expect(target({ mainEnvLocalText: null, allowSharedDev: true, destructive: true }).ok).toBe(false);
  });

  it("allows a destructive run on the worktree's own deployment", () => {
    expect(target({ destructive: true }).ok).toBe(true);
  });

  it("refuses a directory with no ticket number unless --port is given", () => {
    const r = target({ dirName: "scratch" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/--port/);
    expect(target({ dirName: "scratch", portOverride: 4200 })).toMatchObject({ ok: true, port: 4200 });
  });

  it("no refusal reason names the deployment", () => {
    const reasons = [
      target({ mainEnvLocalText: mainEnv(DEP) }),
      target({ envLocalText: envLocal({ VITE_CONVEX_URL: `https://${OTHER}.convex.cloud` }) }),
      target({ mainEnvLocalText: null }),
    ].map((r) => r.reason);
    for (const reason of reasons) {
      expect(reason).not.toContain(DEP);
      expect(reason).not.toContain(OTHER);
    }
  });
});

describe("phase planning", () => {
  const labels = (p) => p.map((x) => x.label);
  const fresh = { seededAt: "2026-01-01T10:00:00Z", workers: { 8: { setup: "2026-01-01T10:05:00Z", bootstrap: "2026-01-01T10:06:00Z" } } };

  it("runs setup, bootstrap, then the spec when nothing has passed", () => {
    expect(labels(phasePlan({ state: null }))).toEqual(["setup", "bootstrap", "e2e"]);
  });

  it("runs only the spec when setup and bootstrap passed since the seed", () => {
    expect(labels(phasePlan({ state: fresh }))).toEqual(["e2e"]);
  });

  it("re-runs setup and bootstrap when they predate the seed", () => {
    const stale = { seededAt: "2026-01-02T00:00:00Z", workers: fresh.workers };
    expect(labels(phasePlan({ state: stale }))).toEqual(["setup", "bootstrap", "e2e"]);
  });

  it("runs only bootstrap when setup passed but bootstrap did not", () => {
    const s = { seededAt: fresh.seededAt, workers: { 8: { setup: "2026-01-01T10:05:00Z" } } };
    expect(labels(phasePlan({ state: s }))).toEqual(["bootstrap", "e2e"]);
  });

  it("is per worker", () => {
    expect(labels(phasePlan({ state: fresh, worker: 9 }))).toEqual(["setup", "bootstrap", "e2e"]);
  });

  it("--setup forces setup and bootstrap even when current", () => {
    expect(labels(phasePlan({ state: fresh, setup: true }))).toEqual(["setup", "bootstrap", "e2e"]);
  });

  it("--fresh seeds first and then setup and bootstrap", () => {
    expect(labels(phasePlan({ state: fresh, fresh: true }))).toEqual(["seed", "setup", "bootstrap", "e2e"]);
  });

  it("mobile runs the mobile project", () => {
    const p = phasePlan({ state: fresh, project: "mobile" });
    expect(p.at(-1)).toMatchObject({ kind: "spec", pw: "e2e-mobile" });
  });

  it("both runs desktop, then re-seeds and re-bootstraps for mobile", () => {
    const p = phasePlan({ state: fresh, project: "both" });
    expect(labels(p)).toEqual(["e2e", "seed-m", "setup-m", "bootstrap-m", "e2e-mobile"]);
    expect(p.map((x) => x.pw)).toEqual(["e2e", undefined, "setup", "bootstrap", "e2e-mobile"]);
  });

  it("both with --fresh seeds before desktop too", () => {
    const p = phasePlan({ state: null, project: "both", fresh: true });
    expect(labels(p)).toEqual(["seed", "setup", "bootstrap", "e2e", "seed-m", "setup-m", "bootstrap-m", "e2e-mobile"]);
  });

  it("needsPhases: no seed record means any recorded pass counts", () => {
    expect(needsPhases({ workers: { 8: { setup: "t", bootstrap: "t" } } }, 8)).toEqual({ setup: false, bootstrap: false });
    expect(needsPhases(null, 8)).toEqual({ setup: true, bootstrap: true });
  });

  describe("the fresh-only note", () => {
    const prior = [{ project: "e2e", files: ["home/landing.spec.ts"], args: ["landing"], status: "passed", at: "2026-01-01T10:10:00Z" }];

    it("finds an earlier run of the same spec in the same project", () => {
      expect(ranOnSeed(prior, ["landing"], "home/landing.spec.ts", "e2e")).toBe(prior[0]);
    });

    it("matches by argument substring of the file", () => {
      expect(ranOnSeed(prior, ["landing"], "other.spec.ts", "e2e")).toBe(prior[0]);
    });

    it("ignores a different project or an unrelated spec", () => {
      expect(ranOnSeed(prior, ["landing"], "home/landing.spec.ts", "e2e-mobile")).toBeNull();
      expect(ranOnSeed(prior, ["billing"], "billing.spec.ts", "e2e")).toBeNull();
      expect(ranOnSeed(undefined, ["x"], "x", "e2e")).toBeNull();
    });
  });

  it("seedLine and convexLine describe the state", () => {
    expect(seedLine(null, 8)).toBe("seed: not seeded by e2e-run");
    expect(seedLine({ seededAt: "2026-01-01T10:00:00", workers: {} }, 8)).toMatch(/setup ✘ not since seed · bootstrap ✘/);
    expect(convexLine(null, "f")).toMatch(/never pushed/);
    expect(convexLine({ fingerprint: "f", at: "2026-01-01T10:00:00" }, "f")).toMatch(/unchanged since/);
    expect(convexLine({ fingerprint: "f", at: "2026-01-01T10:00:00" }, "g")).toMatch(/CHANGED since .* --push/);
  });
});

describe("error-context.md shapes", () => {
  const snap = ["- main:", "  - heading \"Welcome\" [level=1]", "  - button \"Sign in\""];

  it("reads a Playwright error-context with Page snapshot, Error details and Test source", () => {
    const md = [
      "# Instructions",
      "",
      "- Following Playwright test failed.",
      "",
      "# Test info",
      "",
      "- Name: home > landing",
      "",
      "# Error details",
      "",
      "```",
      "Error: expect(locator).toBeVisible() failed",
      "```",
      "",
      "# Page snapshot",
      "",
      "```yaml",
      ...snap,
      "```",
      "",
      "# Test source",
      "",
      "```ts",
      "   9 |   await foo();",
      ">  10 |   await expect(page.getByRole(\"heading\")).toBeVisible();",
      "     |                                              ^",
      "```",
    ].join("\n");
    const r = parseErrorContext(md);
    expect(r.pageSnapshot).toEqual(snap);
    expect(r.sourceLine).toBe('> 10 |   await expect(page.getByRole("heading")).toBeVisible();');
    expect(r.elementYaml).toBeNull();
  });

  it("reads the element-yaml shape: yaml in Error details and a bare-fenced Page snapshot", () => {
    const md = [
      "# Error details",
      "",
      "```yaml",
      "- button \"Save\" [disabled]",
      "```",
      "",
      "# Page snapshot",
      "",
      "```",
      ...snap,
      "```",
    ].join("\n");
    const r = parseErrorContext(md);
    expect(r.elementYaml).toEqual(['- button "Save" [disabled]']);
    expect(r.pageSnapshot).toEqual(snap);
    expect(r.sourceLine).toBeNull();
  });

  it("returns nulls for empty or missing input", () => {
    expect(parseErrorContext("")).toEqual({ pageSnapshot: null, elementYaml: null, sourceLine: null });
    expect(parseErrorContext(null)).toEqual({ pageSnapshot: null, elementYaml: null, sourceLine: null });
  });

  it("locatorNames finds names, text and roles from an error, unescaping quotes", () => {
    const names = locatorNames("locator: getByRole('button', { name: 'Save it' }) and getByText(\"Hello\")");
    expect(names).toEqual(expect.arrayContaining(["Save it", "Hello", "button"]));
    expect(names.indexOf("Save it")).toBeLessThan(names.indexOf("button"));
  });

  it("snapshotWindow centres on the first matching name and caps the length", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `    - line ${i}`);
    lines[60] = '    - button "Needle"';
    const w = snapshotWindow(lines, ["needle"], 20);
    expect(w.lines).toHaveLength(20);
    expect(w.matched).toBe("needle");
    expect(w.lines.join("\n")).toContain('button "Needle"');
    expect(w.total).toBe(100);
  });

  it("snapshotWindow starts at the top when nothing matches", () => {
    const w = snapshotWindow(["- a", "- b"], ["zzz"], 10);
    expect(w).toMatchObject({ from: 1, to: 2, matched: null });
  });
});

describe("digest", () => {
  const ctxFor = (n) =>
    [
      "# Page snapshot",
      "",
      "```yaml",
      ...Array.from({ length: 200 }, (_, i) => (i === 120 ? `- button "Save ${n}" [ref=e${i}]` : `- generic [ref=e${i}]: row ${i} of failure ${n} on ${DEP}`)),
      "```",
      "",
      "# Test source",
      "```ts",
      `>  12 |   await expect(page.getByRole("button", { name: "Save ${n}" })).toBeVisible();`,
      "```",
    ].join("\n");

  const failing = (n) => ({
    title: `failure number ${n}`,
    file: `area/spec-${n}.spec.ts`,
    projectName: "e2e",
    status: "unexpected",
    results: [
      {
        duration: 7000,
        error: {
          message: `Error: expect(locator).toBeVisible() failed\n\nLocator: getByRole('button', { name: 'Save ${n}' })\nExpected: visible\nReceived: <element(s) not found>\nTimeout: 7000ms\n\nCall log:\n  - waiting for getByRole('button', { name: 'Save ${n}' }) on https://${DEP}.convex.cloud\n`,
          snippet: `  11 |\n> 12 | await expect(x).toBeVisible();`,
        },
        attachments: [
          { name: "error-context", path: `/runs/r1/results/${n}/error-context.md` },
          { name: "screenshot", path: `/runs/r1/results/${n}/test-failed-1.png` },
        ],
      },
    ],
  });
  const report = (tests) => ({ suites: [{ title: "x.spec.ts", file: "x.spec.ts", specs: tests.map((t) => ({ title: t.title, file: t.file, tests: [{ projectName: t.projectName, status: t.status, results: t.results }] })) }] });
  const meta = { runId: "20260101-e2e", exit: 1, startedAt: "2026-01-01T10:00:00Z", finishedAt: "2026-01-01T10:05:00Z", project: "desktop", worker: 8, port: 3622, paused: "", seedLine: "seed: x", convexLine: "convex/: y" };
  const build = (tests, over = {}) =>
    buildDigest({
      meta,
      phases: [{ label: "e2e", pw: "e2e", report: report(tests) }],
      readText: (p) => ctxFor(p.split("/").at(-2)),
      literals: [DEP],
      relRoot: "/",
      runDir: "/runs/r1",
      ...over,
    });

  it("stays under the limit with six failures carrying big snapshots", () => {
    const text = build([1, 2, 3, 4, 5, 6].map(failing));
    expect(text.length).toBeLessThan(DIGEST_LIMIT);
    expect(text).toContain("FAIL");
    for (let n = 1; n <= 6; n++) expect(text).toContain(`spec-${n}.spec.ts`);
  });

  it("never prints the deployment's name", () => {
    const text = build([1, 2, 3, 4, 5, 6].map(failing));
    expect(text).not.toContain(DEP);
  });

  it("masks a literal even where the text redactor would not", () => {
    expect(cleanText(`hello ${DEP} bye`, [DEP])).not.toContain(DEP);
  });

  it("keeps the first failure's detail: arrow line, locator and snapshot window", () => {
    const text = build([failing(1)]);
    expect(text).toMatch(/> 12 \|/);
    expect(text).toContain("Locator:");
    expect(text).toMatch(/snapshot near "Save 1"/);
  });

  it("says PASS for exit 0 and counts the tests", () => {
    const ok = { ...failing(1), status: "expected", results: [{ duration: 1000 }] };
    const text = build([ok], { meta: { ...meta, exit: 0 } });
    expect(text).toMatch(/PASS \(exit 0\)/);
    expect(text).toMatch(/1 passed · 0 failed/);
  });

  it("adds the fresh-only note when the spec already ran on this seed", () => {
    const text = build([failing(1)], { meta: { ...meta, prior: [{ project: "e2e", files: ["area/spec-1.spec.ts"], status: "passed", at: "2026-01-01T10:01:00Z" }] } });
    expect(text).toMatch(/if fresh-only, this red is expected: rerun with --fresh/);
  });

  it("shows the last log lines of a phase that never produced a report", () => {
    const text = buildDigest({
      meta: { ...meta, exit: 2 },
      phases: [{ label: "setup", pw: "setup", report: null, logTail: ["boom line one", "boom line two"] }],
      literals: [DEP],
      relRoot: "/",
      runDir: "/runs/r1",
    });
    expect(text).toMatch(/setup: no results JSON/);
    expect(text).toContain("boom line two");
  });

  it("collectTests flattens nested suites and takes the last result's error", () => {
    const rep = { suites: [{ title: "a.spec.ts", file: "a.spec.ts", suites: [{ title: "group", specs: [{ title: "t", file: "a.spec.ts", tests: [{ projectName: "e2e", status: "flaky", results: [{ duration: 1, error: { message: "first" } }, { duration: 2 }] }] }] }] }] };
    const [t] = collectTests(rep);
    expect(t).toMatchObject({ status: "flaky", title: "group › t", duration: 3, error: "first" });
  });
});

describe("plant: exactly-once edits", () => {
  const files = { "a.ts": "one two one", "b.ts": "alpha beta" };

  it("replaces a find that matches once", () => {
    const r = applyEdits(files, [{ file: "b.ts", find: "beta", replace: "gamma" }]);
    expect(r).toEqual({ ok: true, files: { "a.ts": "one two one", "b.ts": "alpha gamma" } });
  });

  it("does not mutate the input map", () => {
    applyEdits(files, [{ file: "b.ts", find: "beta", replace: "gamma" }]);
    expect(files["b.ts"]).toBe("alpha beta");
  });

  it("refuses a find that matches nowhere", () => {
    const r = applyEdits(files, [{ file: "b.ts", find: "zeta", replace: "x" }]);
    expect(r).toMatchObject({ ok: false });
    expect(r.error).toMatch(/not found/);
  });

  it("refuses a find that matches twice", () => {
    const r = applyEdits(files, [{ file: "a.ts", find: "one", replace: "x" }]);
    expect(r).toMatchObject({ ok: false });
    expect(r.error).toMatch(/more than once/);
  });

  it("checks each edit against the text as it stands after the earlier ones", () => {
    const r = applyEdits({ "a.ts": "x y" }, [
      { file: "a.ts", find: "x", replace: "y" },
      { file: "a.ts", find: "y", replace: "z" },
    ]);
    expect(r).toMatchObject({ ok: false });
    expect(r.error).toMatch(/edit 2/);
  });

  it("refuses an empty find, a missing file, and an empty edit list", () => {
    expect(applyEdits(files, [{ file: "a.ts", find: "", replace: "x" }]).ok).toBe(false);
    expect(applyEdits(files, [{ file: "nope.ts", find: "a", replace: "x" }]).error).toMatch(/not loaded/);
    expect(applyEdits(files, []).ok).toBe(false);
    expect(applyEdits(files, null).ok).toBe(false);
  });

  it("a replace containing $ patterns is inserted literally", () => {
    const r = applyEdits({ "a.ts": "cost" }, [{ file: "a.ts", find: "cost", replace: "$& $1" }]);
    expect(r.files["a.ts"]).toBe("$& $1");
  });

  it("convexTouched sees apps/web/convex and convex paths only", () => {
    expect(convexTouched(["apps/web/convex/foo.ts"])).toBe(true);
    expect(convexTouched(["convex/foo.ts"])).toBe(true);
    expect(convexTouched(["apps/web/lib/convex/x.ts", "apps/web/convexity.ts"])).toBe(false);
  });
});

describe("safeRepoPath", () => {
  const root = join(APP_DIR, "..", "..");

  it("makes an apps/web-relative path repo-relative", () => {
    expect(safeRepoPath(root, "playwright/home/x.spec.ts")).toBe("apps/web/playwright/home/x.spec.ts");
    expect(safeRepoPath(root, "apps/web/convex/a.ts")).toBe("apps/web/convex/a.ts");
    expect(safeRepoPath(root, "./apps/web/convex/a.ts")).toBe("apps/web/convex/a.ts");
  });

  it.each([
    [".git/config"],
    ["apps/web/.git/hooks/x"],
    ["node_modules/x/index.js"],
    ["apps/web/node_modules/x.js"],
    [".e2e-local/state.json"],
    ["apps/web/.e2e-local/runs/x"],
    [".claude/settings.json"],
    ["apps/web/.env.local"],
    [".env"],
    ["apps/web/sub/.env.production"],
    ["../../../outside.ts"],
    ["apps/../../outside.ts"],
    ["/etc/passwd"],
  ])("refuses %s", (p) => {
    expect(() => safeRepoPath(root, p)).toThrow(/refusing to plant/);
  });
});

describe("manifest and restore", () => {
  const dirs = [];
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), "e2e-run-test-"));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const put = (root, rel, data) => {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, data);
  };

  // Includes bytes that are not valid UTF-8 and CRLF, which a text round trip would change.
  const binary = Buffer.from([0x00, 0xff, 0xfe, 0x0d, 0x0a, 0xc3, 0x28, 0x80]);

  it("buildManifest records existence, hash and bytes", () => {
    const root = tmp();
    put(root, "apps/web/a.ts", "hello");
    const m = buildManifest(root, ["apps/web/a.ts", "apps/web/new.ts"], { runId: "r" });
    expect(m.runId).toBe("r");
    expect(m.files[0]).toMatchObject({ path: "apps/web/a.ts", existed: true, sha256: sha256(Buffer.from("hello")) });
    expect(Buffer.from(m.files[0].bytes, "base64").toString()).toBe("hello");
    expect(m.files[1]).toEqual({ path: "apps/web/new.ts", existed: false, sha256: null, bytes: null });
  });

  it("restores a changed file byte for byte", () => {
    const root = tmp();
    put(root, "apps/web/a.bin", binary);
    const m = buildManifest(root, ["apps/web/a.bin"]);
    writeFileSync(join(root, "apps/web/a.bin"), "planted break");
    recordPlanted(m, root);
    const r = restoreFromManifest(m, root);
    expect(r).toMatchObject({ ok: true, problems: [], restored: ["apps/web/a.bin"], convexTouched: false });
    expect(readFileSync(join(root, "apps/web/a.bin")).equals(binary)).toBe(true);
  });

  it("removes a file that did not exist before the plant", () => {
    const root = tmp();
    const m = buildManifest(root, ["apps/web/created.ts"]);
    put(root, "apps/web/created.ts", "planted");
    recordPlanted(m, root);
    const r = restoreFromManifest(m, root);
    expect(r.ok).toBe(true);
    expect(existsSync(join(root, "apps/web/created.ts"))).toBe(false);
  });

  it("recreates a file the plant deleted, with its directory", () => {
    const root = tmp();
    put(root, "apps/web/deep/dir/a.ts", "keep me");
    const m = buildManifest(root, ["apps/web/deep/dir/a.ts"]);
    rmSync(join(root, "apps/web/deep"), { recursive: true });
    recordPlanted(m, root);
    expect(restoreFromManifest(m, root).ok).toBe(true);
    expect(readFileSync(join(root, "apps/web/deep/dir/a.ts"), "utf8")).toBe("keep me");
  });

  it("restores from a manifest read back from disk, as after a killed plant", () => {
    const root = tmp();
    put(root, "apps/web/convex/f.ts", binary);
    put(root, "apps/web/spec.ts", "original");
    const m = buildManifest(root, ["apps/web/convex/f.ts", "apps/web/spec.ts", "apps/web/made.ts"], { cmd: "plant" });
    const manifestPath = join(root, "plant.json");
    writeFileSync(manifestPath, JSON.stringify(m));
    // The tool is killed after planting: edits are on disk, nothing restored.
    writeFileSync(join(root, "apps/web/convex/f.ts"), "broken");
    writeFileSync(join(root, "apps/web/spec.ts"), "broken");
    put(root, "apps/web/made.ts", "broken");
    recordPlanted(m, root);
    writeFileSync(manifestPath, JSON.stringify(m));
    const r = restoreFromManifest(JSON.parse(readFileSync(manifestPath, "utf8")), root);
    expect(r.ok).toBe(true);
    expect(r.convexTouched).toBe(true);
    expect(readFileSync(join(root, "apps/web/convex/f.ts")).equals(binary)).toBe(true);
    expect(readFileSync(join(root, "apps/web/spec.ts"), "utf8")).toBe("original");
    expect(existsSync(join(root, "apps/web/made.ts"))).toBe(false);
  });

  it("is idempotent: restoring twice leaves the same bytes", () => {
    const root = tmp();
    put(root, "apps/web/a.ts", "x");
    const m = buildManifest(root, ["apps/web/a.ts"]);
    expect(restoreFromManifest(m, root).ok).toBe(true);
    expect(restoreFromManifest(m, root).ok).toBe(true);
    expect(readFileSync(join(root, "apps/web/a.ts"), "utf8")).toBe("x");
  });

  it("reports a problem, and keeps going, when one entry's path is refused", () => {
    const root = tmp();
    put(root, "apps/web/a.ts", "x");
    const m = buildManifest(root, ["apps/web/a.ts"]);
    m.files.unshift({ path: "apps/web/.env.local", existed: true, sha256: sha256(Buffer.from("s")), bytes: Buffer.from("s").toString("base64") });
    writeFileSync(join(root, "apps/web/a.ts"), "broken");
    recordPlanted(m, root);
    const r = restoreFromManifest(m, root);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/\.env\.local: refusing/);
    expect(existsSync(join(root, "apps/web/.env.local"))).toBe(false);
    expect(readFileSync(join(root, "apps/web/a.ts"), "utf8")).toBe("x");
  });

  it("reports a hash mismatch when the bytes did not land", () => {
    const root = tmp();
    put(root, "apps/web/a.ts", "x");
    const m = buildManifest(root, ["apps/web/a.ts"]);
    const lying = { ...m, files: [{ ...m.files[0], sha256: sha256(Buffer.from("other")) }] };
    recordPlanted(lying, root);
    const r = restoreFromManifest(lying, root);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/hash differs/);
  });

  it("reports a file that is still there after the unlink", () => {
    const root = tmp();
    const m = buildManifest(root, ["apps/web/created.ts"]);
    m.files[0].planted = { exists: true, sha256: sha256(Buffer.from("p")) };
    const fsApi = { existsSync: () => true, readFileSync: () => Buffer.from("p"), writeFileSync, unlinkSync: () => {}, mkdirSync };
    const r = restoreFromManifest(m, root, fsApi);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/still exists/);
  });
});

describe("io seam", () => {
  it("exposes the stubbable side effects", () => {
    for (const k of ["now", "sleep", "capture", "runLogged", "listenerPid", "processCwd", "startViteLogged", "readTarget", "commandLine", "isAlive", "httpUp"]) {
      expect(typeof io[k], k).toBe("function");
    }
  });
});

describe("NEO-622 live-run fixes", () => {
  const prevLocal = process.env.E2E_RUN_LOCAL_DIR;
  const prevCi = process.env.CI;
  afterEach(() => {
    if (prevLocal === undefined) delete process.env.E2E_RUN_LOCAL_DIR;
    else process.env.E2E_RUN_LOCAL_DIR = prevLocal;
    if (prevCi === undefined) delete process.env.CI;
    else process.env.CI = prevCi;
    vi.restoreAllMocks();
  });

  it("status and stop on a fresh worktree (no .e2e-local) say no run, not ENOENT", async () => {
    process.env.E2E_RUN_LOCAL_DIR = join(mkdtempSync(join(tmpdir(), "e2e-fresh-")), "missing", ".e2e-local");
    delete process.env.CI;
    const out = [];
    vi.spyOn(console, "log").mockImplementation((...a) => out.push(a.join(" ")));
    expect(await main(["status"])).toBe(0);
    expect(out.join("\n")).toMatch(/lock: free/);
    expect(await main(["stop"])).toBe(0);
    expect(out.join("\n")).toMatch(/nothing running/);
  });

  const mk = (n) => ({
    title: `t${n}`,
    file: `area/spec-${n}.spec.ts`,
    projectName: "e2e",
    status: "unexpected",
    results: [{ duration: 1, error: { message: "Error: boom" }, attachments: [{ name: "error-context", path: "/runs/r1/results/x/error-context.md" }] }],
  });
  const rep = (tests) => ({ suites: [{ title: "x.spec.ts", file: "x.spec.ts", specs: tests.map((t) => ({ title: t.title, file: t.file, tests: [{ projectName: t.projectName, status: t.status, results: t.results }] })) }] });
  const m0 = { runId: "20260101-plant-e2e", exit: 0, startedAt: "2026-01-01T10:00:00Z", finishedAt: "2026-01-01T10:05:00Z", project: "desktop", worker: 8, port: 3622, paused: "", seedLine: "seed: x", convexLine: "convex/: y" };
  const digest = (meta, over = {}) =>
    buildDigest({ meta: { ...m0, ...meta }, phases: [{ label: "e2e", pw: "e2e", report: rep([mk(1)]) }], literals: [DEP], relRoot: "/", runDir: "/runs/r1", ...over });

  it("a planted red's header names the plant verdict, not PASS (exit 0)", () => {
    expect(digest({ plant: ["PLANT RED as planted (matched --expect)"] }).split("\n")[0]).toMatch(/PLANT RED as planted \(exit 0\)/);
    expect(digest({ plant: ["PLANT RED as planted (matched --expect)"] }).split("\n")[0]).not.toMatch(/PASS/);
    expect(digest({ exit: 1, plant: ["PLANT STAYED GREEN: the spec does not prove this"] }).split("\n")[0]).toMatch(/PLANT STAYED GREEN \(exit 1\)/);
    expect(digest({ exit: 1, plant: ["PLANT: RED, but --expect did not match: x"] }).split("\n")[0]).toMatch(/PLANT RED \(--expect not matched\)/);
    expect(plantVerdict(null)).toBeNull();
  });

  it("a plain run's header is unchanged", () => {
    expect(digest({ exit: 1 }).split("\n")[0]).toMatch(/FAIL \(exit 1\)/);
  });

  it("no fresh-only note when the seed was redone after the earlier run (prior emptied)", () => {
    expect(digest({ exit: 1, prior: [] })).not.toMatch(/ran on this seed/);
  });

  it("the json: line names the spec phase, not setup.json", () => {
    const text = digest(
      { exit: 1 },
      {
        phases: [
          { label: "setup", pw: "setup", kind: "setup", report: { suites: [] } },
          { label: "e2e", pw: "e2e", kind: "spec", report: rep([mk(1)]) },
        ],
      },
    );
    expect(text).toMatch(/json: runs\/r1\/e2e\.json/);
    expect(text).not.toMatch(/setup\.json/);
  });

  it("prints one usable line per attachment, long test-dir names intact", () => {
    const dir = "/runs/r1/results/e2e/area-spec-a-very-long-test-title-with-hashes-0123456789abcdef0123456789abcdef-e2e";
    const t = mk(1);
    t.results[0].attachments = [
      { name: "screenshot", path: `${dir}/test-failed-1.png` },
      { name: "trace", path: `${dir}/trace.zip` },
      { name: "error-context", path: `${dir}/error-context.md` },
    ];
    const text = buildDigest({ meta: { ...m0, exit: 1 }, phases: [{ label: "e2e", pw: "e2e", kind: "spec", report: rep([t]) }], literals: [DEP], relRoot: "/", runDir: "/runs/r1" });
    const lines = text.split("\n");
    for (const [name, file] of [["screenshot", "test-failed-1.png"], ["trace", "trace.zip"], ["error-context", "error-context.md"]]) {
      expect(lines).toContain(`  ${name} ${dir.slice(1)}/${file}`);
    }
    expect(text).not.toMatch(/long token removed/);
  });

  it("still masks the deployment name inside a run-directory path", () => {
    const t = mk(1);
    t.results[0].attachments = [{ name: "screenshot", path: `/runs/r1/results/${DEP}/shot.png` }];
    const text = buildDigest({ meta: { ...m0, exit: 1 }, phases: [{ label: "e2e", pw: "e2e", kind: "spec", report: rep([t]) }], literals: [DEP], relRoot: "/", runDir: "/runs/r1" });
    expect(text).not.toContain(DEP);
    expect(text).toContain("<redacted>");
  });

  const prior = [{ project: "e2e", args: ["area/a"], files: ["area/a.spec.ts"], status: "passed", at: "2026-01-01T10:01:00Z" }];

  it("plant with --expect does not force a re-seed for a spec that already ran, and says so", () => {
    const r = plantReseed({ prior, specs: ["area/a"], pws: ["e2e"], expect: "boom", fresh: false });
    expect(r.fresh).toBe(false);
    expect(r.note).toMatch(/not re-seeding/);
  });

  it("plant without --expect keeps the forced re-seed and announces it", () => {
    const r = plantReseed({ prior, specs: ["area/a"], pws: ["e2e"], expect: undefined, fresh: false });
    expect(r.fresh).toBe(true);
    expect(r.note).toMatch(/re-seeding first/);
  });

  it("plant of a spec that has not run on this seed adds no note", () => {
    expect(plantReseed({ prior: [], specs: ["area/a"], pws: ["e2e"], expect: undefined, fresh: false })).toEqual({ fresh: false, note: null });
  });

  it("the default slice is 170 s in --help and parseArgs", () => {
    expect(HELP).toMatch(/wait up to 170 s/);
    expect(HELP).not.toMatch(/230/);
    expect(parseArgs(["x"]).opts.slice).toBe(170);
  });
});

// ---------------------------------------------------------------- NEO-622 security round

describe("NEO-622 security round", () => {
  const dirs = [];
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), "e2e-sec-"));
    dirs.push(d);
    return d;
  };
  const prevLocal = process.env.E2E_RUN_LOCAL_DIR;
  const prevCi = process.env.CI;
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    if (prevLocal === undefined) delete process.env.E2E_RUN_LOCAL_DIR;
    else process.env.E2E_RUN_LOCAL_DIR = prevLocal;
    if (prevCi === undefined) delete process.env.CI;
    else process.env.CI = prevCi;
    vi.restoreAllMocks();
  });
  const localDir = () => {
    const d = join(tmp(), ".e2e-local");
    mkdirSync(d, { recursive: true });
    process.env.E2E_RUN_LOCAL_DIR = d;
    delete process.env.CI;
    return d;
  };
  const out = () => {
    const lines = [];
    vi.spyOn(console, "log").mockImplementation((...a) => lines.push(a.join(" ")));
    return lines;
  };
  // A readTarget that behaves like the real guard with the main checkout on the same deployment.
  const sharedTarget = () => vi.spyOn(io, "readTarget").mockImplementation((opts, destructive) => target({ allowSharedDev: opts.allowSharedDev, mainEnvLocalText: mainEnv(DEP), destructive }));
  const ownTarget = () => vi.spyOn(io, "readTarget").mockImplementation((opts, destructive) => target({ allowSharedDev: opts.allowSharedDev, destructive }));

  // ---- B1: nothing resets shared dev, however the seed got into the plan
  describe("B1 destructive judged on the whole plan", () => {
    it("planJob: project both plans a seed (the mobile pass), even without --fresh", () => {
      const state = { seededAt: "2026-01-01T00:00:00Z", workers: { 8: { setup: "2026-01-01T00:01:00Z", bootstrap: "2026-01-01T00:02:00Z" } }, ran: [] };
      const plan = planJob({ kind: "run", opts: { project: "both", worker: 8, fresh: false, setup: false }, specs: ["x"], state });
      expect(plan.destructive).toBe(true);
      expect(planJob({ kind: "run", opts: { project: "desktop", worker: 8, fresh: false, setup: false }, specs: ["x"], state }).destructive).toBe(false);
    });

    it("planJob: a plant of a spec that already ran on this seed re-seeds, so it is destructive", () => {
      const state = { seededAt: "2026-01-01T00:00:00Z", workers: {}, ran: [{ project: "e2e", args: ["x"], files: [], status: "passed" }] };
      const opts = { project: "desktop", worker: 8, fresh: false, setup: false, expect: null };
      expect(planJob({ kind: "plant", opts, specs: ["x"], state }).destructive).toBe(true);
      expect(planJob({ kind: "plant", opts: { ...opts, expect: "boom" }, specs: ["x"], state }).destructive).toBe(false);
    });

    it("run --project both --allow-shared-dev refuses on a shared target", async () => {
      localDir();
      const lines = out();
      const guard = sharedTarget();
      expect(await main(["run", "--project", "both", "--allow-shared-dev", "x"])).toBe(EXIT.refused);
      expect(guard.mock.calls[0][1]).toBe(true);
      expect(lines.join("\n")).toMatch(/refused: .*never/);
    });

    it("a plant re-seed on a shared target refuses", async () => {
      const dir = localDir();
      writeFileSync(join(dir, "seed-state.json"), JSON.stringify({ seededAt: "2026-01-01T00:00:00Z", workers: {}, ran: [{ project: "e2e", args: ["x"], files: [], status: "passed" }] }));
      const lines = out();
      const guard = sharedTarget();
      expect(await main(["plant", "--edit", "nope.json", "--allow-shared-dev", "x"])).toBe(EXIT.refused);
      expect(guard.mock.calls[0][1]).toBe(true);
      expect(lines.join("\n")).toMatch(/refused: .*never/);
    });

    it("doSeed re-checks and refuses a shared target without running anything", async () => {
      const guard = sharedTarget();
      const capture = vi.spyOn(io, "capture");
      const run = vi.spyOn(io, "runLogged");
      const logged = [];
      const code = await doSeed({ opts: { allowSharedDev: true }, deployment: DEP, env: {}, logger: { line: (l) => logged.push(l) } });
      expect(code).toBe(EXIT.refused);
      expect(guard).toHaveBeenCalledWith({ allowSharedDev: true }, true);
      expect(capture).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
      expect(logged.join("\n")).toMatch(/seed refused/);
    });
  });

  // ---- S1: patch plants
  describe("S1 patch plants", () => {
    const git = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8" });
    const repoWith = () => {
      const d = tmp();
      git(d, "init", "-q");
      mkdirSync(join(d, "a"));
      writeFileSync(join(d, "a/f"), "hi\n");
      writeFileSync(join(d, "a/empty"), "");
      writeFileSync(join(d, "a/g"), "x\n");
      git(d, "add", "-A");
      git(d, "-c", "user.email=a@b.c", "-c", "user.name=n", "commit", "-qm", "i");
      return d;
    };
    const plan = (d, patch) => {
      writeFileSync(join(d, "p.diff"), patch);
      const num = git(d, "apply", "--numstat", "-z", "p.diff").stdout;
      const sum = git(d, "apply", "--summary", "p.diff").stdout;
      return patchPlan(num, sum);
    };

    it("lists a rename's source and an empty file's delete, which the headers parse missed", () => {
      const d = repoWith();
      git(d, "mv", "a/f", "a/f2");
      git(d, "rm", "-q", "a/empty");
      const diff = git(d, "diff", "-M", "--cached").stdout;
      const r = plan(d, diff);
      expect(r.refusal).toBeNull();
      expect(r.files.sort()).toEqual(["a/empty", "a/f", "a/f2"]);
    });

    it("lists z/-prefixed -p1 paths as git resolves them", () => {
      const r = patchPlan("1\t1\ta/one.ts\0", "");
      expect(r.files).toEqual(["a/one.ts"]);
    });

    it("refuses a copy and a mode-only change", () => {
      const d = repoWith();
      writeFileSync(join(d, "a/gcopy"), "x\n");
      git(d, "add", "-N", "a/gcopy");
      chmodSyncSafe(join(d, "a/g"));
      const diff = git(d, "diff", "-M", "-C", "--find-copies-harder", "HEAD").stdout;
      const r = plan(d, diff);
      expect(r.refusal).toMatch(/copies a file|file mode/);
    });

    it("refuses a symlink creation", () => {
      expect(patchPlan("1\t0\tlink\0", " create mode 120000 link\n").refusal).toMatch(/symlink/);
    });

    it("the backstop sees a file the patch changed outside the manifest, and ignores the manifest's own", () => {
      const before = parsePorcelainZ(" M apps/web/a.ts\0");
      const after = parsePorcelainZ(" M apps/web/a.ts\0 M apps/web/b.ts\0?? apps/web/new.ts\0");
      expect(strayChanges(before, after, ["apps/web/b.ts"])).toEqual(["apps/web/new.ts"]);
      expect(strayChanges(before, after, [])).toEqual(["apps/web/b.ts", "apps/web/new.ts"]);
      expect(parsePorcelainZ("R  new.ts\0old.ts\0")).toEqual({ "new.ts": "R ", "old.ts": "R-" });
    });

    it("plant --patch checks and applies a private copy, and refuses a mode change before running", async () => {
      const dir = localDir();
      ownTarget();
      const lines = out();
      const patch = join(tmp(), "mode.diff");
      writeFileSync(patch, "diff --git a/apps/web/zz-nonexistent.sh b/apps/web/zz-nonexistent.sh\nold mode 100644\nnew mode 100755\n");
      expect(await main(["plant", "--patch", patch, "--expect", "boom", "x"])).toBe(EXIT.refused);
      expect(lines.join("\n")).toMatch(/file mode/);
      expect(readFileSync(join(dir, "plant/patch.diff"), "utf8")).toBe(readFileSync(patch, "utf8"));
    });
  });
  function chmodSyncSafe(file) {
    spawnSync("chmod", ["755", file]);
  }

  // ---- S2: allow-list
  describe("S2 safeRepoPath is an allow-list", () => {
    const root = join(APP_DIR, "..", "..");
    it.each([
      ["apps/web/.ENV.local"],
      ["apps/web/.Env"],
      [".ENV.local"],
      ["apps/web/.Claude/settings.json"],
      ["apps/web/NODE_MODULES/x.js"],
      ["apps/web/.E2E-Local/state.json"],
      ["../../.github/workflows/x.yml"],
      ["apps/web/playwright/tools/e2e-run.mjs"],
      ["apps/web/Playwright/Tools/e2e-run.mjs"],
    ])("refuses %s", (p) => {
      expect(() => safeRepoPath(root, p)).toThrow(/refusing to plant/);
    });

    it("refuses a path through a symlink, and a symlinked file", () => {
      const r = tmp();
      const outside = tmp();
      mkdirSync(join(r, "apps/web"), { recursive: true });
      writeFileSync(join(outside, "secret.ts"), "s");
      symlinkSync(outside, join(r, "apps/web/linkdir"));
      symlinkSync(join(outside, "secret.ts"), join(r, "apps/web/linkfile.ts"));
      writeFileSync(join(r, "apps/web/ok.ts"), "x");
      expect(() => safeRepoPath(r, "apps/web/linkdir/secret.ts", r)).toThrow(/refusing/);
      expect(() => safeRepoPath(r, "apps/web/linkfile.ts", r)).toThrow(/refusing/);
      expect(safeRepoPath(r, "apps/web/ok.ts", r)).toBe("apps/web/ok.ts");
      expect(safeRepoPath(r, "apps/web/not-yet/made.ts", r)).toBe("apps/web/not-yet/made.ts");
    });
  });

  // ---- S3: restore never overwrites a later edit
  describe("S3 restore keeps edits made since the plant", () => {
    const put = (root, rel, data) => {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), data);
    };
    it("restores a file that still holds the planted bytes", () => {
      const r = tmp();
      put(r, "apps/web/a.ts", "orig");
      const m = buildManifest(r, ["apps/web/a.ts"]);
      put(r, "apps/web/a.ts", "planted");
      recordPlanted(m, r);
      expect(restoreFromManifest(m, r)).toMatchObject({ ok: true, edited: [] });
      expect(readFileSync(join(r, "apps/web/a.ts"), "utf8")).toBe("orig");
    });

    it("refuses, lists and leaves a file edited after the plant", () => {
      const r = tmp();
      put(r, "apps/web/a.ts", "orig");
      put(r, "apps/web/b.ts", "orig-b");
      const m = buildManifest(r, ["apps/web/a.ts", "apps/web/b.ts"]);
      put(r, "apps/web/a.ts", "planted");
      put(r, "apps/web/b.ts", "planted-b");
      recordPlanted(m, r);
      put(r, "apps/web/a.ts", "my own edit, later");
      const res = restoreFromManifest(m, r);
      expect(res.ok).toBe(false);
      expect(res.edited).toEqual(["apps/web/a.ts"]);
      expect(res.problems[0]).toMatch(/apps\/web\/a\.ts: changed since the plant/);
      expect(readFileSync(join(r, "apps/web/a.ts"), "utf8")).toBe("my own edit, later");
      expect(readFileSync(join(r, "apps/web/b.ts"), "utf8")).toBe("orig-b");
    });

    it("a file already back at its original needs nothing", () => {
      const r = tmp();
      put(r, "apps/web/a.ts", "orig");
      const m = buildManifest(r, ["apps/web/a.ts"]);
      put(r, "apps/web/a.ts", "planted");
      recordPlanted(m, r);
      put(r, "apps/web/a.ts", "orig");
      expect(restoreFromManifest(m, r)).toMatchObject({ ok: true, restored: ["apps/web/a.ts"] });
    });

    it("a manifest with no planted record never overwrites a changed file", () => {
      const r = tmp();
      put(r, "apps/web/a.ts", "orig");
      const m = buildManifest(r, ["apps/web/a.ts"]);
      put(r, "apps/web/a.ts", "something else");
      expect(restoreFromManifest(m, r).ok).toBe(false);
      expect(readFileSync(join(r, "apps/web/a.ts"), "utf8")).toBe("something else");
    });

    it("status and digest do not restore a pending plant; run does", async () => {
      const dir = localDir();
      const manifest = join(dir, "plant/manifest.json");
      mkdirSync(dirname(manifest), { recursive: true });
      writeFileSync(manifest, JSON.stringify({ pid: 99999999, files: [{ path: "apps/web/zz-nonexistent-e2e-run.ts", existed: false, sha256: null, bytes: null }] }));
      ownTarget();
      const lines = out();
      expect(await main(["status"])).toBe(0);
      expect(await main(["digest"])).toBe(EXIT.refused);
      expect(existsSync(manifest)).toBe(true);
      expect(lines.join("\n")).toMatch(/PLANT PENDING/);
      expect(lines.join("\n")).not.toMatch(/restoring a leftover/);
      await main(["run", "-x"]); // refused at parse time, before recovery
      expect(existsSync(manifest)).toBe(true);
      vi.spyOn(io, "readTarget").mockReturnValue({ ok: false, reason: "stubbed: never start a run in a test" });
      await main(["run", "some-spec"]);
      expect(lines.join("\n")).toMatch(/restoring a leftover/);
      expect(existsSync(manifest)).toBe(false);
    });
  });

  // ---- S4 / S5: the target is pinned
  describe("S4 both client URLs pinned, shell values stripped", () => {
    it.each([
      ["VITE_CONVEX_URL missing", { VITE_CONVEX_URL: null }, /VITE_CONVEX_URL is missing/],
      ["a lookalike prefix host", { VITE_CONVEX_URL: `https://x${DEP}.convex.cloud` }, /VITE_CONVEX_URL/],
      ["a lookalike suffix host", { VITE_CONVEX_URL: `https://${DEP}.convex.cloud.evil.example` }, /VITE_CONVEX_URL/],
      ["a path after the host", { VITE_CONVEX_URL: `https://${DEP}.convex.cloud/x` }, /VITE_CONVEX_URL/],
      ["VITE_CONVEX_SITE_URL missing", { VITE_CONVEX_SITE_URL: null }, /VITE_CONVEX_SITE_URL is missing/],
      ["the site URL of another deployment", { VITE_CONVEX_SITE_URL: `https://${OTHER}.convex.site` }, /VITE_CONVEX_SITE_URL/],
      ["a lookalike site host", { VITE_CONVEX_SITE_URL: `https://x${DEP}.convex.site` }, /VITE_CONVEX_SITE_URL/],
    ])("refuses %s", (_n, over, re) => {
      const r = target({ envLocalText: envLocal(over) });
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(re);
    });

    it("accepts the exact URLs, with or without a trailing slash", () => {
      expect(target({ envLocalText: envLocal({ VITE_CONVEX_URL: `https://${DEP}.convex.cloud/`, VITE_CONVEX_SITE_URL: `https://${DEP}.convex.site/` }) }).ok).toBe(true);
    });

    it("does not inherit VITE_CONVEX_* or CONVEX_* from the shell", () => {
      const r = target({ processEnv: { PATH: "/usr/bin", VITE_CONVEX_URL: "https://evil.convex.cloud", VITE_CONVEX_SITE_URL: "https://evil.convex.site", CONVEX_URL: "x", CONVEX_AGENT_MODE: "y" } });
      expect(r.ok).toBe(true);
      expect(r.env.VITE_CONVEX_URL).toBe(`https://${DEP}.convex.cloud`);
      expect(r.env.VITE_CONVEX_SITE_URL).toBe(`https://${DEP}.convex.site`);
      expect(r.env.CONVEX_URL).toBeUndefined();
      expect(r.env.CONVEX_AGENT_MODE).toBeUndefined();
      expect(r.env.PATH).toBe("/usr/bin");
    });
  });

  describe("S5 apps/web/.env and shared-dev convex plants", () => {
    it("refuses a deploy key or token in apps/web/.env", () => {
      for (const k of ["CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN"]) {
        const r = target({ envText: `${k}=prod:secret|abc\n` });
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/\.env holds/);
        expect(r.reason).not.toContain("secret");
      }
      expect(target({ envText: "SOMETHING=else\n" }).ok).toBe(true);
    });

    it("refuses a convex/ plant on a shared target only", () => {
      expect(plantRefusal({ shared: true, files: ["apps/web/convex/a.ts"] })).toMatch(/shared dev/);
      expect(plantRefusal({ shared: true, files: ["apps/web/playwright/x.spec.ts"] })).toBeNull();
      expect(plantRefusal({ shared: false, files: ["apps/web/convex/a.ts"] })).toBeNull();
    });
  });

  // ---- N1..N4
  describe("N1 secret textboxes are masked in the digest", () => {
    it("masks the value after the colon on a secret-named textbox only", () => {
      expect(maskSecretLine('- textbox "Password" [ref=e12]: hunter2Secret')).toBe('- textbox "Password" [ref=e12]: [masked]');
      expect(maskSecretLine('    - textbox "API key" [active] [ref=e3]: abc123')).toBe('    - textbox "API key" [active] [ref=e3]: [masked]');
      expect(maskSecretLine('- textbox "Verification code": 123456')).toBe('- textbox "Verification code": [masked]');
      expect(maskSecretLine('- textbox "Email": a-name')).toBe('- textbox "Email": a-name');
      expect(maskSecretLine('- textbox "Password" [ref=e1]')).toBe('- textbox "Password" [ref=e1]');
    });

    it("the digest never carries the typed value", () => {
      const md = '# Page snapshot\n\n```yaml\n- heading "Sign in" [ref=e1]\n- textbox "Password" [ref=e12]: hunter2Secret\n- button "Save" [ref=e13]\n```\n';
      const test = { title: "t", file: "a/s.spec.ts", projectName: "e2e", status: "unexpected", results: [{ duration: 1, error: { message: "Error: boom\nLocator: getByRole('button', { name: 'Save' })" }, attachments: [{ name: "error-context", path: "/runs/r1/results/x/error-context.md" }] }] };
      const report = { suites: [{ title: "s.spec.ts", file: "s.spec.ts", specs: [{ title: "t", file: "a/s.spec.ts", tests: [{ projectName: "e2e", status: test.status, results: test.results }] }] }] };
      const text = buildDigest({
        meta: { runId: "r", exit: 1, startedAt: "2026-01-01T10:00:00Z", finishedAt: "2026-01-01T10:01:00Z", project: "desktop", worker: 8, port: 3622, paused: "" },
        phases: [{ label: "e2e", pw: "e2e", report }],
        readText: () => md,
        literals: [DEP],
        relRoot: "/",
        runDir: "/runs/r1",
      });
      expect(text).toContain('textbox "Password"');
      expect(text).toContain("[masked]");
      expect(text).not.toContain("hunter2Secret");
    });
  });

  describe("N2 the Vite log goes through the redactor", () => {
    it("ensureVite starts Vite through the logging filter with the deployment masked", async () => {
      localDir();
      vi.spyOn(io, "listenerPid").mockReturnValueOnce(null).mockReturnValue(4242);
      vi.spyOn(io, "httpUp").mockResolvedValue(true);
      vi.spyOn(io, "sleep").mockResolvedValue(undefined);
      const start = vi.spyOn(io, "startViteLogged").mockReturnValue(1);
      await ensureVite({ port: 3622, env: { A: "b" }, deployment: DEP });
      expect(start).toHaveBeenCalledTimes(1);
      expect(start.mock.calls[0][0]).toMatchObject({ port: 3622, literals: [DEP] });
      expect(start.mock.calls[0][0].logFile).toMatch(/vite-3622\.log$/);
    });

    it("the filter writes a masked log: deployment host, bearer token and the literal", () => {
      const file = join(tmp(), "vite.log");
      const input = `ready\nconnected to https://${DEP}.convex.cloud\nAuthorization: Bearer abcdef0123456789\nname ${DEP} here\n`;
      const r = spawnSync(process.execPath, [join(APP_DIR, "playwright/tools/e2e-run.mjs"), "__logfilter", file], { input, env: { ...process.env, E2E_RUN_LITERALS: JSON.stringify([DEP]) }, encoding: "utf8" });
      expect(r.status).toBe(0);
      const log = readFileSync(file, "utf8");
      expect(log).toContain("ready");
      expect(log).not.toContain(DEP);
      expect(log).not.toContain("abcdef0123456789");
    });
  });

  describe("N3 spec arguments cannot become Playwright options", () => {
    it("refuses a spec starting with a dash", () => {
      expect(parseArgs(["run", "-c", "other.config.ts"]).error).toMatch(/unknown option -c/);
      expect(parseArgs(["run", "-x", "spec"]).error).toMatch(/cannot start with "-"/);
      expect(parseArgs(["plant", "--edit", "f.json", "-g", "spec"]).error).toMatch(/unknown option -g/);
      expect(parseArgs(["-h"]).cmd).toBe("help");
    });
  });

  describe("N4 stop only signals our own runner", () => {
    const setup = (cmd) => {
      const dir = localDir();
      const run = join(dir, "runs", "20260101-000000-desktop");
      mkdirSync(run, { recursive: true });
      writeFileSync(join(dir, "run.lock"), "4242");
      writeFileSync(join(dir, "current"), "20260101-000000-desktop");
      writeFileSync(join(run, "status.json"), JSON.stringify({ state: "running", pid: 4242 }));
      let alive = true;
      vi.spyOn(io, "isAlive").mockImplementation(() => alive);
      vi.spyOn(io, "sleep").mockResolvedValue(undefined);
      vi.spyOn(io, "commandLine").mockReturnValue(cmd);
      return vi.spyOn(process, "kill").mockImplementation(() => {
        alive = false;
        return true;
      });
    };

    it("does not signal a pid that is not the runner", async () => {
      const kill = setup("/bin/sleep 1000");
      const lines = out();
      expect(await main(["stop"])).toBe(EXIT.refused);
      expect(kill).not.toHaveBeenCalled();
      expect(lines.join("\n")).toMatch(/not this tool's runner/);
    });

    it("does not signal when status.json names another pid", async () => {
      const kill = setup("node /x/playwright/tools/e2e-run.mjs __runner /x/run");
      const dir = process.env.E2E_RUN_LOCAL_DIR;
      writeFileSync(join(dir, "runs/20260101-000000-desktop/status.json"), JSON.stringify({ state: "running", pid: 1 }));
      out();
      expect(await main(["stop"])).toBe(EXIT.refused);
      expect(kill).not.toHaveBeenCalled();
    });

    it("signals the runner it recognises", async () => {
      const kill = setup("node /x/playwright/tools/e2e-run.mjs __runner /x/run");
      out();
      expect(await main(["stop"])).toBe(0);
      expect(kill).toHaveBeenCalledWith(4242, "SIGTERM");
    });
  });
});

// ---------------------------------------------------------------- NEO-622 command flows (runner, lock, wait, recovery)

describe("NEO-622 command flows through the io seam", () => {
  const dirs = [];
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), "e2e-flow-"));
    dirs.push(d);
    return d;
  };
  const prevLocal = process.env.E2E_RUN_LOCAL_DIR;
  const prevCi = process.env.CI;
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    if (prevLocal === undefined) delete process.env.E2E_RUN_LOCAL_DIR;
    else process.env.E2E_RUN_LOCAL_DIR = prevLocal;
    if (prevCi === undefined) delete process.env.CI;
    else process.env.CI = prevCi;
    vi.restoreAllMocks();
    vi.mocked(spawn).mockReset();
  });

  const REL = "apps/web/lib/zz-plant-target.ts";
  const ORIGINAL = "export const v = ORIGINAL;\n";

  /** A fake repo root holding one plantable file, a local dir, and every io seam stubbed; no process is started. */
  function harness() {
    const root = tmp();
    mkdirSync(dirname(join(root, REL)), { recursive: true });
    writeFileSync(join(root, REL), ORIGINAL);
    const local = join(tmp(), ".e2e-local");
    mkdirSync(local, { recursive: true });
    process.env.E2E_RUN_LOCAL_DIR = local;
    delete process.env.CI;
    const lines = [];
    vi.spyOn(console, "log").mockImplementation((...a) => lines.push(a.join(" ")));
    vi.spyOn(io, "readTarget").mockImplementation((opts, destructive) => target({ allowSharedDev: opts.allowSharedDev, destructive }));
    vi.spyOn(io, "capture").mockImplementation((cmd, args) => ({ code: 0, stdout: cmd === "git" && args[0] === "rev-parse" ? `${root}\n` : "", stderr: "" }));
    vi.spyOn(io, "listenerPid").mockReturnValue(111);
    vi.spyOn(io, "processCwd").mockReturnValue(APP_DIR);
    vi.spyOn(io, "sleep").mockResolvedValue(undefined);
    return { root, local, lines };
  }

  /** A queued plant job on disk, ready for `main(["__runner", runDir])`. */
  function plantJob(local, expect = null) {
    const runDir = join(local, "runs", "20260101-000000-plant-e2e");
    mkdirSync(runDir, { recursive: true });
    const opts = { ...parseArgs(["plant", "--edit", "e.json", "area/a"]).opts, expect };
    const plant = { files: [REL], edits: [{ file: REL, find: "ORIGINAL", replace: "BROKEN" }], expect };
    writeFileSync(join(runDir, "job.json"), JSON.stringify({ kind: "plant", opts, specs: ["area/a"], plant }));
    return runDir;
  }

  /** runLogged stub: setup and bootstrap pass; the spec phase returns `specCode` after `during()` and writes a Playwright report. */
  function fakePlaywright({ specCode, error = "Error: boom", during = () => {}, throws = false }) {
    return vi.spyOn(io, "runLogged").mockImplementation(async (_cmd, args, { env }) => {
      if (throws) throw new Error("spawn exploded");
      if (!args.includes("--project=e2e") || !args.includes("--no-deps")) return 0;
      during();
      const failed = specCode !== 0;
      writeFileSync(
        env.PLAYWRIGHT_JSON_OUTPUT_FILE,
        JSON.stringify({ suites: [{ title: "a.spec.ts", file: "area/a.spec.ts", specs: [{ title: "t", file: "area/a.spec.ts", tests: [{ projectName: "e2e", status: failed ? "unexpected" : "expected", results: [{ duration: 1, error: failed ? { message: error } : undefined }] }] }] }] }),
      );
      return specCode;
    });
  }
  const finished = (runDir) => ({
    status: JSON.parse(readFileSync(join(runDir, "status.json"), "utf8")),
    meta: JSON.parse(readFileSync(join(runDir, "meta.json"), "utf8")),
  });
  const manifestPath = (local) => join(local, "plant", "manifest.json");

  describe("a plant always ends restored", () => {
    it("a runner that throws mid-plant leaves the file restored and the manifest gone, not exit 4", async () => {
      const { root, local } = harness();
      const runDir = plantJob(local);
      fakePlaywright({ throws: true });
      await main(["__runner", runDir]);
      expect(readFileSync(join(root, REL), "utf8")).toBe(ORIGINAL);
      expect(existsSync(manifestPath(local))).toBe(false);
      const { status, meta } = finished(runDir);
      expect(status.state).toBe("done");
      expect(status.exit).not.toBe(EXIT.restoreFailed);
      expect(status.exit).toBeGreaterThan(0); // the runner's own failure code (today EXIT.refused)
      expect(meta.plant).toBeNull();
    });

    it("the planted file really is broken while the spec runs, then comes back after a red as planted (exit 0)", async () => {
      const { root, local } = harness();
      const runDir = plantJob(local, "boom");
      let seen = null;
      fakePlaywright({ specCode: 1, during: () => (seen = readFileSync(join(root, REL), "utf8")) });
      await main(["__runner", runDir]);
      expect(seen).toBe("export const v = BROKEN;\n");
      expect(readFileSync(join(root, REL), "utf8")).toBe(ORIGINAL);
      expect(existsSync(manifestPath(local))).toBe(false);
      const { status, meta } = finished(runDir);
      expect(status.exit).toBe(0);
      expect(meta.plant[0]).toMatch(/^PLANT RED as planted/);
    });

    it("a plant whose spec stays green exits 1 and is restored", async () => {
      const { root, local } = harness();
      const runDir = plantJob(local);
      fakePlaywright({ specCode: 0 });
      await main(["__runner", runDir]);
      expect(readFileSync(join(root, REL), "utf8")).toBe(ORIGINAL);
      const { status, meta } = finished(runDir);
      expect(status.exit).toBe(1);
      expect(meta.plant[0]).toMatch(/^PLANT STAYED GREEN/);
    });

    it("a red for another reason than --expect exits 1 and is restored", async () => {
      const { root, local } = harness();
      const runDir = plantJob(local, "never-this-text");
      fakePlaywright({ specCode: 1, error: "Error: something else entirely" });
      await main(["__runner", runDir]);
      expect(readFileSync(join(root, REL), "utf8")).toBe(ORIGINAL);
      const { status, meta } = finished(runDir);
      expect(status.exit).toBe(1);
      expect(meta.plant[0]).toMatch(/did not match/);
    });

    it("a file the operator edits during the run is kept, the manifest stays, and the exit is 4", async () => {
      const { root, local } = harness();
      const runDir = plantJob(local);
      fakePlaywright({ specCode: 0, during: () => writeFileSync(join(root, REL), "export const v = MY_OWN_EDIT;\n") });
      await main(["__runner", runDir]);
      expect(readFileSync(join(root, REL), "utf8")).toBe("export const v = MY_OWN_EDIT;\n");
      expect(existsSync(manifestPath(local))).toBe(true);
      const { status, meta } = finished(runDir);
      expect(status.exit).toBe(EXIT.restoreFailed);
      expect(meta.plant[0]).toMatch(/^PLANT RESTORE FAILED/);
    });
  });

  describe("a leftover manifest", () => {
    function leftover(root, local) {
      const m = buildManifest(root, [REL], { pid: 99999999 }); // the original bytes
      writeFileSync(join(root, REL), "export const v = BROKEN;\n");
      recordPlanted(m, root);
      mkdirSync(dirname(manifestPath(local)), { recursive: true });
      writeFileSync(manifestPath(local), JSON.stringify(m));
    }

    it("run restores the file bytes before it starts, while status and digest leave it broken", async () => {
      const { root, local, lines } = harness();
      leftover(root, local);
      vi.spyOn(io, "isAlive").mockReturnValue(false);
      expect(await main(["status"])).toBe(0);
      expect(await main(["digest"])).toBe(EXIT.refused);
      expect(readFileSync(join(root, REL), "utf8")).toBe("export const v = BROKEN;\n");
      io.readTarget.mockReturnValue({ ok: false, reason: "stubbed: stop after recovery" });
      expect(await main(["run", "area/a"])).toBe(EXIT.refused);
      expect(readFileSync(join(root, REL), "utf8")).toBe(ORIGINAL);
      expect(existsSync(manifestPath(local))).toBe(false);
      expect(lines.join("\n")).toMatch(/restoring a leftover plant/);
      expect(spawn).not.toHaveBeenCalled();
    });

    it("a manifest whose runner is still alive is not restored by another run", async () => {
      const { root, local } = harness();
      leftover(root, local);
      const m = JSON.parse(readFileSync(manifestPath(local), "utf8"));
      m.pid = 4242;
      writeFileSync(manifestPath(local), JSON.stringify(m));
      vi.spyOn(io, "isAlive").mockReturnValue(true);
      io.readTarget.mockReturnValue({ ok: false, reason: "stubbed" });
      await main(["run", "area/a"]);
      expect(readFileSync(join(root, REL), "utf8")).toBe("export const v = BROKEN;\n");
      expect(existsSync(manifestPath(local))).toBe(true);
    });
  });

  describe("the lock", () => {
    const fakeChild = (local) => {
      vi.mocked(spawn).mockImplementationOnce((_cmd, args) => {
        // The runner would write its status; here the "runner" is alive and unfinished.
        const runDir = args[2];
        writeFileSync(join(runDir, "status.json"), JSON.stringify({ state: "running", phase: "e2e", pid: 777001, startedAt: "2026-01-01T00:00:00Z" }));
        return { pid: 777001, unref: vi.fn() };
      });
      return local;
    };
    // Every Date.now() call jumps ten minutes, so a --slice 1 wait expires on its first check, with no real waiting.
    const skipClock = () => {
      let t = 0;
      vi.spyOn(Date, "now").mockImplementation(() => (t += 600_000));
    };

    it("a live pid in run.lock gives exit 3 and starts nothing", async () => {
      const { local, lines } = harness();
      writeFileSync(join(local, "run.lock"), "4242");
      vi.spyOn(io, "isAlive").mockImplementation((pid) => pid === 4242);
      expect(await main(["run", "area/a"])).toBe(EXIT.locked);
      expect(lines.join("\n")).toMatch(/lock held/);
      expect(spawn).not.toHaveBeenCalled();
      expect(readFileSync(join(local, "run.lock"), "utf8")).toBe("4242");
    });

    it("a dead pid in run.lock is reclaimed: a runner is started and the lock names it", async () => {
      const { local } = harness();
      writeFileSync(join(local, "run.lock"), "4242");
      vi.spyOn(io, "isAlive").mockImplementation((pid) => pid !== 4242);
      fakeChild(local);
      skipClock();
      expect(await main(["run", "--slice", "1", "area/a"])).toBe(EXIT.running);
      expect(spawn).toHaveBeenCalledTimes(1);
      const [self, mode] = vi.mocked(spawn).mock.calls[0][1];
      expect(self).toMatch(/e2e-run\.mjs$/);
      expect(mode).toBe("__runner");
      expect(readFileSync(join(local, "run.lock"), "utf8")).toBe("777001");
    });

    it("an empty or garbage run.lock counts as free", async () => {
      const { local } = harness();
      writeFileSync(join(local, "run.lock"), "not-a-pid");
      vi.spyOn(io, "isAlive").mockReturnValue(true);
      fakeChild(local);
      skipClock();
      expect(await main(["run", "--slice", "1", "area/a"])).toBe(EXIT.running);
      expect(spawn).toHaveBeenCalledTimes(1);
    });
  });

  describe("wait", () => {
    const runWith = (local, status) => {
      const name = "20260101-000000-desktop";
      mkdirSync(join(local, "runs", name), { recursive: true });
      writeFileSync(join(local, "current"), name);
      writeFileSync(join(local, "runs", name, "status.json"), JSON.stringify(status));
      return join(local, "runs", name);
    };
    const skipClock = () => {
      let t = 0;
      vi.spyOn(Date, "now").mockImplementation(() => (t += 600_000));
    };

    it("an unfinished run whose runner is alive returns 75 when the slice is up", async () => {
      const { local, lines } = harness();
      runWith(local, { state: "running", phase: "e2e", pid: 4242, startedAt: "2026-01-01T00:00:00Z" });
      vi.spyOn(io, "isAlive").mockReturnValue(true);
      skipClock();
      expect(await main(["wait", "--slice", "1"])).toBe(EXIT.running);
      expect(lines.join("\n")).toMatch(/still running: phase e2e/);
    });

    it("an unfinished run whose runner died returns 1, not 75, and shows the log tail", async () => {
      const { local, lines } = harness();
      const dir = runWith(local, { state: "running", phase: "e2e", pid: 4242 });
      writeFileSync(join(dir, "run.log"), "line one\nline two\n");
      vi.spyOn(io, "isAlive").mockReturnValue(false);
      expect(await main(["wait", "--slice", "1"])).toBe(EXIT.fail);
      expect(lines.join("\n")).toMatch(/runner died without finishing/);
      expect(lines.join("\n")).toMatch(/line two/);
    });

    it("a finished run returns its own exit code", async () => {
      const { local } = harness();
      const dir = runWith(local, { state: "done", exit: 1 });
      writeFileSync(join(dir, "meta.json"), JSON.stringify({ runId: "r", exit: 1, kind: "run", phases: [], literals: [], startedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:01:00Z", refused: "stubbed refusal" }));
      expect(await main(["wait", "--slice", "1"])).toBe(1);
    });

    it("with no run at all it says so and refuses", async () => {
      const { lines } = harness();
      expect(await main(["wait"])).toBe(EXIT.refused);
      expect(lines.join("\n")).toMatch(/no run yet/);
    });
  });
});
