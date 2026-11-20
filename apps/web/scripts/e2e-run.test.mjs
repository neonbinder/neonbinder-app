// NEO-622: playwright/tools/e2e-run.mjs, the local E2E runner. Importing it has no side
// effects; its spawn/lsof/git seams sit behind `io`. These tests cover the pure parts:
// argument parsing, the target guard (what it refuses), the port rule, phase planning,
// the digest (size cap, no deployment name), exactly-once edits, and byte-exact restore.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  APP_DIR,
  DIGEST_LIMIT,
  EXIT,
  HELP,
  applyEdits,
  buildDigest,
  buildManifest,
  cleanText,
  collectTests,
  convexLine,
  convexTouched,
  io,
  locatorNames,
  needsPhases,
  parseArgs,
  parseEnvFile,
  parseErrorContext,
  patchFiles,
  phasePlan,
  ranOnSeed,
  resolveTarget,
  restoreFromManifest,
  safeRepoPath,
  seedLine,
  sha256,
  snapshotWindow,
  vitePort,
} from "../playwright/tools/e2e-run.mjs";

// A deployment name that must never appear in output. Built so the literal is not a
// plausible real one.
const DEP = "happy-otter-123";
const OTHER = "shared-dev-456";
const envLocal = (over = {}) =>
  Object.entries({ CONVEX_DEPLOYMENT: `dev:${DEP}`, VITE_CONVEX_URL: `https://${DEP}.convex.cloud`, ...over })
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

  it("patchFiles lists the files a diff touches, renames and all, not /dev/null", () => {
    const diff = ["--- a/x/one.ts", "+++ b/x/one.ts", "--- /dev/null", "+++ b/x/new.ts", "rename from old.ts", "rename to moved.ts"].join("\n");
    expect(patchFiles(diff).sort()).toEqual(["moved.ts", "old.ts", "x/new.ts", "x/one.ts"]);
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
    const r = restoreFromManifest(m, root);
    expect(r).toMatchObject({ ok: true, problems: [], restored: ["apps/web/a.bin"], convexTouched: false });
    expect(readFileSync(join(root, "apps/web/a.bin")).equals(binary)).toBe(true);
  });

  it("removes a file that did not exist before the plant", () => {
    const root = tmp();
    const m = buildManifest(root, ["apps/web/created.ts"]);
    put(root, "apps/web/created.ts", "planted");
    const r = restoreFromManifest(m, root);
    expect(r.ok).toBe(true);
    expect(existsSync(join(root, "apps/web/created.ts"))).toBe(false);
  });

  it("recreates a file the plant deleted, with its directory", () => {
    const root = tmp();
    put(root, "apps/web/deep/dir/a.ts", "keep me");
    const m = buildManifest(root, ["apps/web/deep/dir/a.ts"]);
    rmSync(join(root, "apps/web/deep"), { recursive: true });
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
    const r = restoreFromManifest(lying, root);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/hash differs/);
  });

  it("reports a file that is still there after the unlink", () => {
    const root = tmp();
    const m = buildManifest(root, ["apps/web/created.ts"]);
    const fsApi = { existsSync: () => true, readFileSync, writeFileSync, unlinkSync: () => {}, mkdirSync };
    const r = restoreFromManifest(m, root, fsApi);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/still exists/);
  });
});

describe("io seam", () => {
  it("exposes the stubbable side effects", () => {
    for (const k of ["now", "sleep", "capture", "runLogged", "listenerPid", "processCwd", "startDetached", "isAlive", "httpUp"]) {
      expect(typeof io[k], k).toBe("function");
    }
  });
});
