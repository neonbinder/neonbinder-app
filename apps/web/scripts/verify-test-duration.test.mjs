/**
 * NEO-591 — the slow-test gate itself (verify-test-duration.mjs) has to exit
 * the way it promises: a guard that exits 0 on a bad report is worse than none.
 *
 * The script is copied beside its helper into a scratch "web root" and run as a
 * child process. The rerun it does for a slow file calls `npx vitest`; a fake
 * `npx` first on PATH answers it from a fixture (or dies), so no real vitest
 * runs and the test stays fast.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPTS = import.meta.dirname;
const FILE = "/w/a.test.ts";
const t = (title, duration, status = "passed") => ({ fullName: title, title, duration, status });
const report = (...tests) => ({ testResults: [{ name: FILE, assertionResults: tests }] });

let root;
beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "nb-verify-duration-"));
  mkdirSync(path.join(root, "scripts"));
  mkdirSync(path.join(root, "bin"));
  for (const f of ["verify-test-duration.mjs", "test-duration.mjs"]) {
    copyFileSync(path.join(SCRIPTS, f), path.join(root, "scripts", f));
  }
  // Fake npx: copies $FAKE_ALONE_REPORT to the --outputFile it was given, or
  // writes nothing (a rerun that died) when the variable is unset.
  const npx = path.join(root, "bin", "npx");
  writeFileSync(
    npx,
    `#!/usr/bin/env node
const fs = require("node:fs");
const out = process.argv.find((a) => a.startsWith("--outputFile="))?.slice("--outputFile=".length);
if (out && process.env.FAKE_ALONE_REPORT) fs.copyFileSync(process.env.FAKE_ALONE_REPORT, out);
fs.appendFileSync(process.env.FAKE_NPX_LOG, process.argv.slice(2).join(" ") + "\\n");
`,
  );
  chmodSync(npx, 0o755);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
function run(fullRun, aloneRun) {
  const id = n++;
  const results = path.join(root, `results-${id}.json`);
  const log = path.join(root, `npx-${id}.log`);
  writeFileSync(log, "");
  if (typeof fullRun === "string") writeFileSync(results, fullRun);
  else if (fullRun) writeFileSync(results, JSON.stringify(fullRun));
  const env = { ...process.env, PATH: `${path.join(root, "bin")}${path.delimiter}${process.env.PATH}`, FAKE_NPX_LOG: log };
  delete env.FAKE_ALONE_REPORT;
  if (aloneRun) {
    const alone = path.join(root, `alone-${id}.json`);
    writeFileSync(alone, JSON.stringify(aloneRun));
    env.FAKE_ALONE_REPORT = alone;
  }
  const r = spawnSync(process.execPath, [path.join(root, "scripts", "verify-test-duration.mjs"), results], {
    env,
    encoding: "utf8",
  });
  return { code: r.status, out: r.stdout, err: r.stderr, reruns: spawnSync("cat", [log], { encoding: "utf8" }).stdout };
}

describe("verify-test-duration.mjs", () => {
  it("passes a run where every test is fast, without re-running anything", () => {
    const r = run(report(t("a", 5), t("b", 1999)));
    expect(r.code).toBe(0);
    expect(r.out).toContain("2 tests, none over 2000 ms");
    expect(r.reruns).toBe("");
  });

  it("passes a test that was slow only under load: its file alone is fast", () => {
    const r = run(report(t("starved", 4000)), report(t("starved", 300)));
    expect(r.code).toBe(0);
    expect(r.out).toContain("re-running 1 file(s) alone");
    expect(r.out).toContain("1 slow only under load");
    expect(r.reruns).toContain("vitest run");
  });

  it("fails a test that is still slow when its file runs alone, naming it and both times", () => {
    const r = run(report(t("sleeps", 4000)), report(t("sleeps", 2600)));
    expect(r.code).toBe(1);
    expect(r.err).toContain("1 test(s) took over 2000 ms");
    expect(r.err).toContain("sleeps");
    expect(r.err).toContain("4000 ms in the run, 2600 ms alone");
  });

  it("fails closed when the rerun died and reported nothing", () => {
    const r = run(report(t("sleeps", 4000)));
    expect(r.code).toBe(1);
    expect(r.err).toContain("no result alone");
  });

  it("fails a report that holds no test durations (a vacuous pass is no pass)", () => {
    const r = run({ testResults: [{ name: FILE, assertionResults: [t("skipped", 1, "skipped")] }] });
    expect(r.code).toBe(1);
    expect(r.err).toContain("holds no test durations");
  });

  it("fails when the report file is missing", () => {
    const r = run(null);
    expect(r.code).toBe(1);
    expect(r.err).toContain("could not read");
  });

  it("fails when the report file is not JSON", () => {
    const r = run("{ not json");
    expect(r.code).toBe(1);
    expect(r.err).toContain("could not read");
  });
});
