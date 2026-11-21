// NEO-627: e2e-inert-final.sh, the AND of the scope verdict and the path filters.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "e2e-inert-final.sh");
const BASE = { SCOPE: "true", F_WEB: "false", F_BROWSER: "false", F_BROWSER_PREVIEW: "false", F_PREPROCESS: "false", F_SCANNER: "false", F_SCRIPTS: "false" };
const FILTERS = ["F_WEB", "F_BROWSER", "F_BROWSER_PREVIEW", "F_PREPROCESS", "F_SCANNER", "F_SCRIPTS"];

function run(env, unset = []) {
  const e = { PATH: process.env.PATH, ...BASE, ...env };
  for (const k of unset) delete e[k];
  const r = spawnSync("bash", [SCRIPT], { env: e, encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.split("\n").filter(Boolean).length, 1, "exactly one output line");
  return r.stdout.trim();
}

test("scope true and every filter false is inert", () => {
  assert.equal(run({}), "e2e_inert=true");
});

test("any area filter true makes it full", () => {
  for (const k of FILTERS) assert.equal(run({ [k]: "true" }), "e2e_inert=false", k);
});

test("an unset, empty or odd filter output makes it full", () => {
  for (const k of FILTERS) {
    assert.equal(run({}, [k]), "e2e_inert=false", `${k} unset`);
    for (const v of ["", "TRUE", "skipped"]) assert.equal(run({ [k]: v }), "e2e_inert=false", `${k}=${v}`);
  }
});

test("a scope verdict that is not exactly true is full, whatever the filters say", () => {
  for (const v of ["false", "", "TRUE", "yes"]) assert.equal(run({ SCOPE: v }), "e2e_inert=false", JSON.stringify(v));
  assert.equal(run({}, ["SCOPE"]), "e2e_inert=false");
});

test("fake_bsc is deliberately not consulted", () => {
  assert.equal(run({ F_FAKE_BSC: "true" }), "e2e_inert=true");
});

test("scope true with the scripts filter true (pr-watch skill, agents, workflows) is full", () => {
  assert.equal(run({ SCOPE: "true", F_SCRIPTS: "true" }), "e2e_inert=false");
});
