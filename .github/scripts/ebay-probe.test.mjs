// NEO-555: branch coverage for ebay-probe-verdict.sh, ebay-drift-verdict.sh and
// the bounded 429 retry in ebay-probe.sh. No real network: a loopback server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const VERDICT = join(SCRIPTS, "ebay-probe-verdict.sh");
const DRIFT = join(SCRIPTS, "ebay-drift-verdict.sh");
const PROBE = join(SCRIPTS, "ebay-probe.sh");

const OK_PROBE = (target) => ({
  ebayTarget: target,
  outcome: "ok",
  appLeg: { ok: true, outcome: "ok" },
  accountLeg: { ok: true, outcome: "ok", scopes: "readonly" },
  shapes: { "GET ebay/api/x": { "a.b": "string" } },
  statuses: { "GET ebay/api/x": 200 },
  hashes: {},
  steps: [],
  durationMs: 10,
});

function verdict(expect, body, status = 200) {
  const dir = mkdtempSync(join(tmpdir(), "ebayprobe-"));
  const p = join(dir, "probe.json");
  writeFileSync(p, typeof body === "string" ? body : JSON.stringify(body));
  const r = spawnSync("bash", [VERDICT, expect, p, String(status)], { encoding: "utf8" });
  return { status: r.status, outcome: /^outcome=(.*)$/m.exec(r.stdout)?.[1], err: r.stderr };
}

test("real and fake: a clean probe passes", () => {
  for (const t of ["real", "fake"]) {
    const r = verdict(t, OK_PROBE(t));
    assert.equal(r.status, 0);
    assert.equal(r.outcome, "ok");
  }
});

test("the wrong target fails (prod must be real, a preview fake)", () => {
  assert.equal(verdict("real", OK_PROBE("fake")).outcome, "wrong_target");
  assert.equal(verdict("fake", OK_PROBE("real")).outcome, "wrong_target");
  assert.equal(verdict("fake", { ...OK_PROBE("fake"), ebayTarget: undefined }).outcome, "wrong_target");
  assert.equal(verdict("real", OK_PROBE("fake")).status, 1);
});

test("a bad expectation is refused", () => {
  const r = verdict("sandbox", OK_PROBE("real"));
  assert.equal(r.status, 1);
  assert.equal(r.outcome, "wrong_target");
});

test("non-200, 429 and unreadable bodies fail", () => {
  assert.equal(verdict("real", "{}", 404).outcome, "probe_call_failed");
  assert.equal(verdict("real", "{}", 409).outcome, "probe_call_failed");
  assert.equal(verdict("real", "{}", 429).outcome, "rate_limited");
  assert.equal(verdict("real", "<html>").outcome, "probe_unreadable");
});

test("app_failed fails", () => {
  const r = verdict("real", {
    ...OK_PROBE("real"),
    outcome: "app_failed",
    appLeg: { ok: false, outcome: "token_failed", detail: "app.token: 401" },
  });
  assert.equal(r.status, 1);
  assert.equal(r.outcome, "app_failed");
  assert.match(r.err, /token_failed/);
});

test("account_warning passes with a warning when the app leg is sound", () => {
  const r = verdict("real", {
    ...OK_PROBE("real"),
    outcome: "account_warning",
    accountLeg: { ok: false, outcome: "skipped_not_connected", scopes: null, detail: "no probe account is configured" },
  });
  assert.equal(r.status, 0);
  assert.equal(r.outcome, "account_warning");
  assert.match(r.err, /::warning::/);
});

test("account_warning with a broken app leg is inconsistent and fails", () => {
  const r = verdict("real", { ...OK_PROBE("real"), outcome: "account_warning", appLeg: { ok: false, outcome: "x" } });
  assert.equal(r.status, 1);
  assert.equal(r.outcome, "inconsistent_probe");
});

test("skipped_paused passes with a warning", () => {
  const r = verdict("real", { ...OK_PROBE("real"), outcome: "skipped_paused", appLeg: { ok: false } });
  assert.equal(r.status, 0);
  assert.equal(r.outcome, "skipped_paused");
  assert.match(r.err, /::warning::/);
});

test("an ok without a sound app leg, and an unknown outcome, fail", () => {
  assert.equal(verdict("real", { ...OK_PROBE("real"), appLeg: { ok: false } }).outcome, "inconsistent_probe");
  assert.equal(verdict("real", { ...OK_PROBE("real"), outcome: "fine" }).outcome, "unknown_outcome");
});

function drift(env) {
  const r = spawnSync("bash", [DRIFT], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });
  return { status: r.status, out: r.stdout + r.stderr };
}

test("drift: ok and ok passes; account_warning still compares", () => {
  assert.equal(drift({ PROD_OUTCOME: "ok", DRIFT_OUTCOME: "ok" }).status, 0);
  assert.equal(drift({ PROD_OUTCOME: "account_warning", DRIFT_OUTCOME: "ok" }).status, 0);
  assert.equal(drift({ PROD_OUTCOME: "account_warning", DRIFT_OUTCOME: "shape_drift", DRIFT_PATHS: "a b" }).status, 1);
});

test("drift: shape_drift fails and lists the paths", () => {
  const r = drift({ PROD_OUTCOME: "ok", DRIFT_OUTCOME: "shape_drift", DRIFT_PATHS: "GET ebay/api/x a.b,GET ebay/api/y c.d" });
  assert.equal(r.status, 1);
  assert.match(r.out, /`GET ebay\/api\/x a\.b`/);
  assert.match(r.out, /`GET ebay\/api\/y c\.d`/);
});

test("drift: a hash mismatch is a warning annotation, not a failure", () => {
  const r = drift({ PROD_OUTCOME: "ok", DRIFT_OUTCOME: "ok", DRIFT_WARNINGS: "GET ebay/api/x:hash_mismatch" });
  assert.equal(r.status, 0);
  assert.match(r.out, /::warning::ebay-drift: GET ebay\/api\/x:hash_mismatch/);
  assert.match(r.out, /PASS/);
});

test("drift: an unrecorded pinned key passes with a warning", () => {
  const r = drift({ PROD_OUTCOME: "ok", DRIFT_OUTCOME: "unrecorded pinned key" });
  assert.equal(r.status, 0);
  assert.match(r.out, /::warning::/);
});

test("drift: a comparison that did not run or errored fails", () => {
  assert.equal(drift({ PROD_OUTCOME: "ok", DRIFT_OUTCOME: "" }).status, 1);
  assert.equal(drift({ PROD_OUTCOME: "ok", DRIFT_OUTCOME: "http_500" }).status, 1);
});

test("drift: paused passes without a comparison; app_failed and others fail", () => {
  const p = drift({ PROD_OUTCOME: "skipped_paused" });
  assert.equal(p.status, 0);
  assert.match(p.out, /paused/);
  for (const o of ["app_failed", "wrong_target", "rate_limited", "probe_call_failed", ""]) {
    assert.equal(drift({ PROD_OUTCOME: o, DRIFT_OUTCOME: "ok" }).status, 1, o);
  }
});

// --- ebay-probe.sh: the bounded 429 retry, against a loopback server -----------

async function runProbe(expect, handler, env = {}) {
  const hits = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      hits.push({ url: req.url, auth: req.headers.authorization, body });
      handler(hits.length, res);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const dir = mkdtempSync(join(tmpdir(), "ebayprobe-sh-"));
  const outFile = join(dir, "gh-output");
  writeFileSync(outFile, "");
  const child = spawn("bash", [PROBE, expect], {
    env: {
      PATH: process.env.PATH,
      TARGET_URL: `http://127.0.0.1:${server.address().port}/`,
      PROBE_ID_TOKEN: "tok",
      OUT_DIR: dir,
      GITHUB_OUTPUT: outFile,
      ...env,
    },
  });
  let stdout = "";
  child.stdout.on("data", (c) => (stdout += c));
  const code = await new Promise((r) => child.on("close", r));
  server.close();
  return { code, stdout, hits, ghOutput: readFileSync(outFile, "utf8") };
}

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};

test("ebay-probe.sh: one 429 is waited out (Retry-After) and the retry's answer is judged", async () => {
  const r = await runProbe("real", (n, res) =>
    n === 1 ? json(res, 429, { error: "slow down" }, { "Retry-After": "1" }) : json(res, 200, OK_PROBE("real")));
  assert.equal(r.code, 0);
  assert.equal(r.hits.length, 2);
  assert.ok(r.hits.every((h) => h.url === "/probe/ebay" && h.auth === "Bearer tok"));
  assert.match(r.ghOutput, /outcome=ok/);
});

test("ebay-probe.sh: a 429 that never clears stops after the bounded retries", async () => {
  const r = await runProbe("real", (_n, res) => json(res, 429, {}, { "Retry-After": "1" }), { EBAY_PROBE_RETRIES: "1" });
  assert.equal(r.code, 1);
  assert.equal(r.hits.length, 2);
  assert.match(r.ghOutput, /outcome=rate_limited/);
});

test("ebay-probe.sh: real sends an empty body; fake sends the minted refresh token", async () => {
  const real = await runProbe("real", (_n, res) => json(res, 200, OK_PROBE("real")), { EBAY_FAKE_REFRESH_TOKEN: "ignored" });
  assert.equal(real.hits[0].body, "{}");
  const fake = await runProbe("fake", (_n, res) => json(res, 200, OK_PROBE("fake")), { EBAY_FAKE_REFRESH_TOKEN: "v^1.1#fake#abc" });
  assert.equal(JSON.parse(fake.hits[0].body).refreshToken, "v^1.1#fake#abc");
  const bare = await runProbe("fake", (_n, res) => json(res, 200, OK_PROBE("fake")));
  assert.equal(bare.hits[0].body, "{}");
});

test("ebay-probe.sh: a prod answer that says fake fails as wrong_target", async () => {
  const r = await runProbe("real", (_n, res) => json(res, 200, OK_PROBE("fake")));
  assert.equal(r.code, 1);
  assert.match(r.ghOutput, /outcome=wrong_target/);
});

// --- ebay-fake-token.sh: consent + code grant against a loopback fake -----------

async function runMint(handler) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ url: req.url, headers: req.headers, body });
      handler(req.url, res);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const dir = mkdtempSync(join(tmpdir(), "ebaymint-"));
  const outFile = join(dir, "gh-output");
  writeFileSync(outFile, "");
  const child = spawn("bash", [join(SCRIPTS, "ebay-fake-token.sh")], {
    env: {
      PATH: process.env.PATH,
      FAKE_URL: `http://127.0.0.1:${server.address().port}`,
      FAKE_ID_TOKEN: "idtok",
      FAKE_CALLER_KEY: "callerkey",
      OUT_DIR: dir,
      GITHUB_OUTPUT: outFile,
    },
  });
  const code = await new Promise((r) => child.on("close", r));
  server.close();
  let token = null;
  try { token = readFileSync(join(dir, "refresh-token"), "utf8"); } catch { /* none */ }
  return { code, seen, token, ghOutput: readFileSync(outFile, "utf8") };
}

test("ebay-fake-token.sh: consent then code grant with the fake's public client", async () => {
  const r = await runMint((url, res) => {
    if (url === "/__fake/ebay/consent") return json(res, 200, { code: "c0de", expiresIn: 300 });
    if (url === "/ebay/api/identity/v1/oauth2/token") return json(res, 200, { refresh_token: "v^1.1#fake#r" });
    return json(res, 404, {});
  });
  assert.equal(r.code, 0);
  assert.equal(r.token, "v^1.1#fake#r");
  assert.match(r.ghOutput, /minted=true/);
  assert.equal(r.seen[0].headers["x-nb-fake-bsc-key"], "callerkey");
  assert.equal(r.seen[0].headers["x-nb-fake-id-token"], "idtok");
  assert.match(r.seen[1].body, /grant_type=authorization_code/);
  assert.match(r.seen[1].body, /code=c0de/);
  assert.match(r.seen[1].headers.authorization, /^Basic /);
});

test("ebay-fake-token.sh: any failure degrades to minted=false and exits 0", async () => {
  const consent404 = await runMint((_u, res) => json(res, 404, {}));
  assert.equal(consent404.code, 0);
  assert.match(consent404.ghOutput, /minted=false/);
  assert.equal(consent404.token, null);
  const grant400 = await runMint((url, res) =>
    url === "/__fake/ebay/consent" ? json(res, 200, { code: "x" }) : json(res, 400, { error: "invalid_grant" }));
  assert.equal(grant400.code, 0);
  assert.match(grant400.ghOutput, /minted=false/);
});
