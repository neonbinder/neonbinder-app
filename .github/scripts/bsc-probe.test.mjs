// NEO-552: branch coverage for bsc-probe-verdict.sh and bsc-drift-verdict.sh.
// Pure files/env in, outcome and exit status out. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const VERDICT = join(SCRIPTS, "bsc-probe-verdict.sh");
const DRIFT = join(SCRIPTS, "bsc-drift-verdict.sh");

const OK_PROBE = (target) => ({
  bscTarget: target,
  outcome: "ok",
  signIn: { ok: true },
  catalogue: { ok: true, status: 200 },
  parser: { ok: true },
  shapes: { "search/bulk-upload/filters": { "a.b": "string" } },
});

function probe(expect, health, body, status = 200) {
  const dir = mkdtempSync(join(tmpdir(), "bscprobe-"));
  const h = join(dir, "health.json");
  const p = join(dir, "probe.json");
  writeFileSync(h, typeof health === "string" ? health : JSON.stringify(health));
  writeFileSync(p, typeof body === "string" ? body : JSON.stringify(body));
  const r = spawnSync("bash", [VERDICT, expect, h, p, String(status)], { encoding: "utf8" });
  return { status: r.status, outcome: /^outcome=(.*)$/m.exec(r.stdout)?.[1], err: r.stderr };
}

test("fake: healthy fake and a clean probe pass", () => {
  const r = probe("fake", { bscTarget: "fake" }, OK_PROBE("fake"));
  assert.equal(r.status, 0);
  assert.equal(r.outcome, "ok");
});

test("real: healthy real target and a clean probe pass", () => {
  assert.equal(probe("real", { bscTarget: "real" }, OK_PROBE("real")).status, 0);
});

test("prod must say real: /health saying fake is wrong_target", () => {
  const r = probe("real", { bscTarget: "fake" }, OK_PROBE("real"));
  assert.equal(r.status, 1);
  assert.equal(r.outcome, "wrong_target");
});

test("a preview must say fake: /health saying real is wrong_target", () => {
  assert.equal(probe("fake", { bscTarget: "real" }, OK_PROBE("fake")).outcome, "wrong_target");
});

test("a probe body that names the wrong target is wrong_target", () => {
  assert.equal(probe("real", { bscTarget: "real" }, OK_PROBE("fake")).outcome, "wrong_target");
});

test("a missing bscTarget (old service) is wrong_target", () => {
  assert.equal(probe("fake", {}, OK_PROBE("fake")).outcome, "wrong_target");
});

test("unreadable health and probe bodies fail", () => {
  assert.equal(probe("fake", "<html>", OK_PROBE("fake")).outcome, "health_unreadable");
  assert.equal(probe("fake", { bscTarget: "fake" }, "not json").outcome, "probe_unreadable");
});

test("a non-200 probe call fails", () => {
  assert.equal(probe("real", { bscTarget: "real" }, "{}", 404).outcome, "probe_call_failed");
});

test("each failing outcome is reported and exits 1", () => {
  for (const outcome of ["signin_failed", "bsc_unavailable", "catalogue_non_2xx", "parser_rejected"]) {
    const r = probe("real", { bscTarget: "real" }, { ...OK_PROBE("real"), outcome });
    assert.equal(r.status, 1, outcome);
    assert.equal(r.outcome, outcome);
  }
});

test("skipped_paused passes with a warning and no other leg checked", () => {
  const r = probe("real", { bscTarget: "real" }, {
    bscTarget: "real",
    outcome: "skipped_paused",
    signIn: { ok: false },
    catalogue: { ok: false, status: 0 },
    parser: { ok: false },
    shapes: {},
  });
  assert.equal(r.status, 0);
  assert.equal(r.outcome, "skipped_paused");
  assert.match(r.err, /::warning::/);
});

test("an unknown outcome fails", () => {
  const r = probe("real", { bscTarget: "real" }, { ...OK_PROBE("real"), outcome: "fine" });
  assert.equal(r.outcome, "unknown_outcome");
});

test("an ok that is not backed by every leg is inconsistent", () => {
  for (const patch of [
    { signIn: { ok: false } },
    { catalogue: { ok: true, status: 500 } },
    { catalogue: { ok: false, status: 200 } },
    { parser: { ok: false } },
  ]) {
    const r = probe("real", { bscTarget: "real" }, { ...OK_PROBE("real"), ...patch });
    assert.equal(r.outcome, "inconsistent_probe", JSON.stringify(patch));
    assert.equal(r.status, 1);
  }
});

function drift(env) {
  const r = spawnSync("bash", [DRIFT], {
    env: { PATH: process.env.PATH, ...env },
    encoding: "utf8",
  });
  return { status: r.status, out: r.stdout };
}

test("drift: ok and ok passes", () => {
  assert.equal(drift({ PROD_OUTCOME: "ok", DRIFT_OUTCOME: "ok" }).status, 0);
});

test("drift: signin_failed fails immediately", () => {
  assert.equal(drift({ PROD_OUTCOME: "signin_failed", PREV_OUTCOME: "ok" }).status, 1);
});

test("drift: bsc_unavailable warns the first day and fails the second", () => {
  assert.equal(drift({ PROD_OUTCOME: "bsc_unavailable", PREV_OUTCOME: "ok" }).status, 0);
  assert.equal(drift({ PROD_OUTCOME: "bsc_unavailable", PREV_OUTCOME: "" }).status, 0);
  assert.equal(drift({ PROD_OUTCOME: "bsc_unavailable", PREV_OUTCOME: "bsc_unavailable" }).status, 1);
});

test("drift: shape_drift fails and lists the paths", () => {
  const r = drift({ PROD_OUTCOME: "ok", DRIFT_OUTCOME: "shape_drift", DRIFT_PATHS: "a.b,c.d" });
  assert.equal(r.status, 1);
  assert.match(r.out, /`a\.b`/);
  assert.match(r.out, /`c\.d`/);
});

test("drift: a comparison that did not run or errored fails", () => {
  assert.equal(drift({ PROD_OUTCOME: "ok", DRIFT_OUTCOME: "" }).status, 1);
  assert.equal(drift({ PROD_OUTCOME: "ok", DRIFT_OUTCOME: "http_500" }).status, 1);
});

test("drift: a paused BSC passes without a comparison", () => {
  const r = drift({ PROD_OUTCOME: "skipped_paused", DRIFT_OUTCOME: "" });
  assert.equal(r.status, 0);
  assert.match(r.out, /paused/);
});

test("drift: any other prod outcome, or none, fails", () => {
  for (const o of ["parser_rejected", "catalogue_non_2xx", "wrong_target", ""]) {
    assert.equal(drift({ PROD_OUTCOME: o, DRIFT_OUTCOME: "ok" }).status, 1, o);
  }
});

test("drift: an unrecorded pinned key passes with a warning and a recorder note", () => {
  const r = spawnSync("bash", [DRIFT], {
    env: { PATH: process.env.PATH, PROD_OUTCOME: "ok", DRIFT_OUTCOME: "unrecorded pinned key" },
    encoding: "utf8",
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout + r.stderr, /::warning::/);
  assert.match(r.stdout, /recorder/);
  assert.match(r.stdout, /PASS/);
});

test("probe verdict: the failing-outcome list names skipped_paused once", () => {
  const src = readFileSync(VERDICT, "utf8");
  const line = src.split("\n").find((l) => /^\s+skipped_paused\|signin_failed/.test(l));
  assert.ok(line, "case line present");
  assert.equal(line.split("skipped_paused").length - 1, 1);
});
