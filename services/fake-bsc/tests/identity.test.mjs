// NEO-552: the fake BSC's Azure B2C identity (src/identity). Drives the
// protocol over real HTTP on a loopback port, the way services/browser's
// sign-in does. services/browser/tests/bsc-fake-identity-contract.test.mjs
// runs the browser's own sign-in code against this same module.
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const b2c = require("../dist/src/identity/b2c.js");
const { namespaceFromUsername } = require("../dist/src/namespace.js");

const TENANT_POLICY = "/tenant.example/b2c_1a_signin";
const CLIENT_ID = "client-123";
const REDIRECT = "https://app.example/";
const SCOPE = "openid profile offline_access";
const USER = "nb+happy-cat-123-w0@fake.invalid";
const NS = "happy-cat-123-w0";

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function pkce() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/** One fake identity behind a loopback server, mounted at /identity. */
async function startServer(opts = {}) {
  const clock = { t: Date.parse("2026-11-14T12:00:00Z") };
  const lines = [];
  const identity = b2c.createFakeIdentity({
    tokenSecret: "x".repeat(40),
    namespaceFromUsername,
    now: () => clock.t,
    log: (op, fields) => lines.push({ op, ...fields }),
    ...opts,
  });
  const server = http.createServer((req, res) => {
    if (!req.url.startsWith("/identity/")) {
      res.statusCode = 404;
      res.end();
      return;
    }
    req.url = req.url.slice("/identity".length);
    identity.handle(req, res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/identity${TENANT_POLICY}`;
  return { server, identity, clock, lines, base };
}

class Jar {
  constructor() { this.c = new Map(); }
  ingest(res) {
    for (const sc of res.headers.getSetCookie()) {
      const [nv, ...attrs] = sc.split(";");
      const eq = nv.indexOf("=");
      const name = nv.slice(0, eq).trim();
      const value = nv.slice(eq + 1).trim();
      const cleared = !value || attrs.some((a) => /expires=thu, 01 jan 1970/i.test(a.trim()));
      if (cleared) this.c.delete(name); else this.c.set(name, value);
    }
  }
  header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join("; "); }
}

const SETTINGS_RE = /var SETTINGS\s*=\s*(\{.*?\});/s;

async function authorize(base, { challenge, state = "st-1", prompt = "select_account", cookie } = {}) {
  const u = new URL(`${base}/oauth2/v2.0/authorize`);
  u.search = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: "code", scope: SCOPE,
    code_challenge: challenge, code_challenge_method: "S256", state, nonce: "n",
    response_mode: "fragment", ...(prompt ? { prompt } : {}),
  }).toString();
  return fetch(u, { redirect: "manual", headers: cookie ? { Cookie: cookie } : {} });
}

/** Steps 1-3; returns the jar, the code (or undefined) and the SelfAsserted body. */
async function passwordSteps(base, { username = USER, password = "fake-bsc-password", challenge, rememberMe = true } = {}) {
  const jar = new Jar();
  const a = await authorize(base, { challenge });
  jar.ingest(a);
  const html = await a.text();
  const settings = JSON.parse(SETTINGS_RE.exec(html)[1]);
  const sa = await fetch(`${base}/SelfAsserted?tx=${encodeURIComponent(settings.transId)}&p=B2C_1A_signin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-CSRF-TOKEN": settings.csrf,
      Cookie: jar.header(),
    },
    body: new URLSearchParams({ request_type: "RESPONSE", signInName: username, password }).toString(),
  });
  jar.ingest(sa);
  const saBody = await sa.text();
  const c = await fetch(
    `${base}/api/${settings.api}/confirmed?` +
      new URLSearchParams({ rememberMe: String(rememberMe), csrf_token: settings.csrf, tx: settings.transId, p: "B2C_1A_signin" }),
    { redirect: "manual", headers: { Cookie: jar.header() } },
  );
  jar.ingest(c);
  const loc = c.headers.get("location") ?? "";
  const frag = new URLSearchParams(loc.split("#")[1] ?? "");
  return { jar, settings, saStatus: sa.status, saBody, confirmedStatus: c.status, location: loc, code: frag.get("code") ?? undefined, frag };
}

async function tokenGrant(base, params) {
  const r = await fetch(`${base}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE, ...params }).toString(),
  });
  return { status: r.status, json: await r.json() };
}

async function signIn(base) {
  const { verifier, challenge } = pkce();
  const steps = await passwordSteps(base, { challenge });
  const tok = await tokenGrant(base, { grant_type: "authorization_code", code: steps.code, redirect_uri: REDIRECT, code_verifier: verifier });
  return { ...steps, tok };
}

describe("fake BSC identity", () => {
  let s;
  beforeEach(async () => {
    if (s) s.server.close();
    s = await startServer();
  });
  after(() => s?.server.close());

  it("serves a sign-in page whose SETTINGS blob carries csrf, transId and api", async () => {
    const r = await authorize(s.base, { challenge: pkce().challenge });
    assert.equal(r.status, 200);
    const html = await r.text();
    const settings = JSON.parse(SETTINGS_RE.exec(html)[1]);
    assert.equal(settings.api, "SelfAsserted");
    assert.ok(settings.csrf && settings.transId.startsWith("StateProperties="));
    const names = r.headers.getSetCookie().map((c) => c.split("=")[0]);
    assert.deepEqual(names.sort(), ["x-ms-cpim-csrf", "x-ms-cpim-trans"]);
  });

  it("signs in with fake-bsc-password: 302 #state&code, SSO cookie, BSC's token lifetimes", async () => {
    const { verifier, challenge } = pkce();
    const steps = await passwordSteps(s.base, { challenge });
    assert.equal(steps.saStatus, 200);
    assert.deepEqual(JSON.parse(steps.saBody), { status: "200" });
    assert.equal(steps.confirmedStatus, 302);
    assert.ok(steps.location.startsWith(`${REDIRECT}#`));
    assert.equal(steps.frag.get("state"), "st-1");
    assert.ok(steps.code);
    assert.ok([...steps.jar.c.keys()].some((k) => k.startsWith("x-ms-cpim-sso")));
    assert.ok(!steps.jar.c.has("x-ms-cpim-trans"), "the trans cookie is cleared on /confirmed");

    const tok = await tokenGrant(s.base, { grant_type: "authorization_code", code: steps.code, redirect_uri: REDIRECT, code_verifier: verifier });
    assert.equal(tok.status, 200);
    assert.equal(tok.json.token_type, "Bearer");
    assert.equal(tok.json.expires_in, 3600);
    assert.equal(tok.json.refresh_token_expires_in, 86400);
    assert.equal(s.identity.namespaceForToken(tok.json.access_token), NS);
    assert.equal(s.identity.namespaceForToken(`Bearer ${tok.json.access_token}`), NS);
    // Opaque: not a JWT, and the namespace is not readable from it.
    assert.equal(tok.json.access_token.split(".").length, 1);
    assert.ok(!Buffer.from(tok.json.access_token.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("latin1").includes(NS));
    // A refresh token or id token is not an access token.
    assert.equal(s.identity.namespaceForToken(tok.json.refresh_token), null);
    assert.equal(s.identity.namespaceForToken(tok.json.id_token), null);
  });

  it("wrong-password and non-fake usernames get B2C's rejected-credentials envelope, no echo", async () => {
    for (const [username, password] of [
      [USER, "wrong-password"],
      [USER, "something-else"],
      ["seller@example.com", "fake-bsc-password"],
    ]) {
      const steps = await passwordSteps(s.base, { username, password, challenge: pkce().challenge });
      assert.equal(steps.saStatus, 200);
      const body = JSON.parse(steps.saBody);
      assert.equal(body.status, "400");
      assert.ok(!steps.saBody.includes(username) && !steps.saBody.includes(password));
      // /confirmed after a rejection gives no code.
      assert.equal(steps.code, undefined);
      assert.equal(steps.frag.get("error"), "access_denied");
    }
    assert.ok(!JSON.stringify(s.lines).includes("wrong-password"));
  });

  it("a bad csrf on SelfAsserted is a 400 that is NOT the credential envelope", async () => {
    const a = await authorize(s.base, { challenge: pkce().challenge });
    const jar = new Jar();
    jar.ingest(a);
    const settings = JSON.parse(SETTINGS_RE.exec(await a.text())[1]);
    const r = await fetch(`${s.base}/SelfAsserted?tx=${encodeURIComponent(settings.transId)}&p=B2C_1A_signin`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-CSRF-TOKEN": "nope", Cookie: jar.header() },
      body: "request_type=RESPONSE&signInName=x&password=y",
    });
    assert.equal(r.status, 400);
    const text = await r.text();
    assert.throws(() => JSON.parse(text));
  });

  it("verifies PKCE S256 and makes a code single-use", async () => {
    const { challenge, verifier } = pkce();
    const steps = await passwordSteps(s.base, { challenge });
    const bad = await tokenGrant(s.base, { grant_type: "authorization_code", code: steps.code, redirect_uri: REDIRECT, code_verifier: pkce().verifier });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error, "invalid_grant");
    // The failed attempt spent the code (best effort, per instance).
    const again = await tokenGrant(s.base, { grant_type: "authorization_code", code: steps.code, redirect_uri: REDIRECT, code_verifier: verifier });
    assert.equal(again.json.error, "invalid_grant");
  });

  it("checks redirect_uri and client_id on the code exchange", async () => {
    for (const patch of [{ redirect_uri: "https://other.example/" }, { client_id: "someone-else" }]) {
      const { challenge, verifier } = pkce();
      const steps = await passwordSteps(s.base, { challenge });
      const r = await tokenGrant(s.base, { grant_type: "authorization_code", code: steps.code, redirect_uri: REDIRECT, code_verifier: verifier, ...patch });
      assert.equal(r.json.error, "invalid_grant", JSON.stringify(patch));
    }
  });

  it("rotates refresh tokens leniently inside an ABSOLUTE 24h window", async () => {
    const first = await signIn(s.base);
    s.clock.t += 2 * 3600 * 1000;
    const r1 = await tokenGrant(s.base, { grant_type: "refresh_token", refresh_token: first.tok.json.refresh_token });
    assert.equal(r1.status, 200);
    assert.notEqual(r1.json.refresh_token, first.tok.json.refresh_token);
    assert.equal(r1.json.expires_in, 3600);
    assert.equal(r1.json.refresh_token_expires_in, 86400 - 2 * 3600);
    assert.equal(s.identity.namespaceForToken(r1.json.access_token), NS);

    // Lenient: an earlier, still-unexpired refresh token is accepted (no
    // replay protection in a test fake), and every grant bumps the rotation
    // counter carried in the token.
    const replay = await tokenGrant(s.base, { grant_type: "refresh_token", refresh_token: first.tok.json.refresh_token });
    assert.equal(replay.status, 200);
    const r2 = await tokenGrant(s.base, { grant_type: "refresh_token", refresh_token: r1.json.refresh_token });
    assert.equal(r2.status, 200);
    const rotations = s.lines.filter((l) => l.op === "identity_token" && l.outcome === "issued" && l.grant === "refresh_token").map((l) => l.rotation);
    assert.deepEqual(rotations, [1, 1, 2]);

    // Past the window, rotation does not help.
    s.clock.t += 22 * 3600 * 1000 + 1000;
    const late = await tokenGrant(s.base, { grant_type: "refresh_token", refresh_token: r1.json.refresh_token });
    assert.equal(late.json.error, "invalid_grant");
  });

  it("expires access tokens after 3600 s", async () => {
    const { tok } = await signIn(s.base);
    s.clock.t += 3599 * 1000;
    assert.equal(s.identity.namespaceForToken(tok.json.access_token), NS);
    s.clock.t += 2000;
    assert.equal(s.identity.namespaceForToken(tok.json.access_token), null);
  });

  it("honours the SSO cookie on a prompt-less authorize, re-issues it, and opens a fresh window", async () => {
    const first = await signIn(s.base);
    s.clock.t += 30 * 3600 * 1000; // past the first refresh window
    const { challenge, verifier } = pkce();
    const r = await authorize(s.base, { challenge, prompt: null, cookie: first.jar.header() });
    assert.equal(r.status, 302);
    const loc = r.headers.get("location");
    const frag = new URLSearchParams(loc.split("#")[1]);
    assert.equal(frag.get("state"), "st-1");
    const reissued = r.headers.getSetCookie().find((c) => c.startsWith("x-ms-cpim-sso"));
    assert.match(reissued, /Max-Age=5356800/);
    const tok = await tokenGrant(s.base, { grant_type: "authorization_code", code: frag.get("code"), redirect_uri: REDIRECT, code_verifier: verifier });
    assert.equal(tok.json.refresh_token_expires_in, 86400);
    assert.equal(s.identity.namespaceForToken(tok.json.access_token), NS);
  });

  it("serves the form for a forcing prompt or no cookie, and interaction_required for prompt=none", async () => {
    const first = await signIn(s.base);
    const forced = await authorize(s.base, { challenge: pkce().challenge, prompt: "select_account", cookie: first.jar.header() });
    assert.equal(forced.status, 200);
    const noCookie = await authorize(s.base, { challenge: pkce().challenge, prompt: null });
    assert.equal(noCookie.status, 200);
    const none = await authorize(s.base, { challenge: pkce().challenge, prompt: "none" });
    assert.equal(none.status, 302);
    assert.equal(new URLSearchParams(none.headers.get("location").split("#")[1]).get("error"), "interaction_required");
  });

  it("rejects an authorize without S256 PKCE", async () => {
    const u = new URL(`${s.base}/oauth2/v2.0/authorize`);
    u.search = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: "code", code_challenge: "short", code_challenge_method: "plain", state: "s" }).toString();
    const r = await fetch(u, { redirect: "manual" });
    assert.equal(r.status, 302);
    assert.equal(new URLSearchParams(r.headers.get("location").split("#")[1]).get("error"), "invalid_request");
  });

  it("keeps tokens valid across a restart with the same secret, and only then", async () => {
    const { tok, jar } = await signIn(s.base);
    const same = b2c.createFakeIdentity({ tokenSecret: "x".repeat(40), namespaceFromUsername, now: () => s.clock.t });
    const other = b2c.createFakeIdentity({ tokenSecret: "y".repeat(40), namespaceFromUsername, now: () => s.clock.t });
    assert.equal(same.namespaceForToken(tok.json.access_token), NS);
    assert.equal(other.namespaceForToken(tok.json.access_token), null);
    assert.ok(jar.header().includes("x-ms-cpim-sso"));
  });

  it("a fresh instance (scale-to-zero restart) honours every token, code and cookie the old one issued", async () => {
    // Instance A issues a session and an unredeemed code, then "restarts".
    const session = await signIn(s.base);
    const pending = pkce();
    const unredeemed = await passwordSteps(s.base, { challenge: pending.challenge });
    s.server.close();
    s.clock.t += 60 * 1000; // a restart inside the code's 300 s lifetime

    const fresh = await startServer({ now: () => s.clock.t });
    try {
      // The code A issued redeems on B, and A's access token validates there.
      const redeemed = await tokenGrant(fresh.base, {
        grant_type: "authorization_code", code: unredeemed.code, redirect_uri: REDIRECT, code_verifier: pending.verifier,
      });
      assert.equal(redeemed.status, 200);
      assert.equal(fresh.identity.namespaceForToken(redeemed.json.access_token), NS);
      assert.equal(fresh.identity.namespaceForToken(session.tok.json.access_token), NS);

      s.clock.t += 2 * 3600 * 1000 - 60 * 1000; // an idle gap; A's access token has expired
      assert.equal(fresh.identity.namespaceForToken(session.tok.json.access_token), null);

      // The refresh token A issued rotates on B, inside A's absolute window.
      const refreshed = await tokenGrant(fresh.base, { grant_type: "refresh_token", refresh_token: session.tok.json.refresh_token });
      assert.equal(refreshed.status, 200);
      assert.equal(refreshed.json.refresh_token_expires_in, 86400 - 2 * 3600);
      assert.equal(fresh.identity.namespaceForToken(refreshed.json.access_token), NS);

      // A's SSO cookie signs in silently on B.
      const silentPkce = pkce();
      const silent = await authorize(fresh.base, { challenge: silentPkce.challenge, prompt: null, cookie: session.jar.header() });
      assert.equal(silent.status, 302);
      const code = new URLSearchParams(silent.headers.get("location").split("#")[1]).get("code");
      const viaSso = await tokenGrant(fresh.base, { grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: silentPkce.verifier });
      assert.equal(viaSso.status, 200);
      assert.equal(fresh.identity.namespaceForToken(viaSso.json.access_token), NS);
    } finally {
      fresh.server.close();
    }

    // None of it survives a change of secret.
    const rekeyed = await startServer({ tokenSecret: "y".repeat(40), now: () => s.clock.t });
    try {
      const refresh = await tokenGrant(rekeyed.base, { grant_type: "refresh_token", refresh_token: session.tok.json.refresh_token });
      assert.equal(refresh.json.error, "invalid_grant");
      const silent = await authorize(rekeyed.base, { challenge: pkce().challenge, prompt: null, cookie: session.jar.header() });
      assert.equal(silent.status, 200, "an unreadable SSO cookie falls back to the sign-in form");
    } finally {
      rekeyed.server.close();
    }
    s = await startServer();
  });

  it("rejects a token presented as the wrong kind", async () => {
    const { tok, code } = await signIn(s.base);
    // An access token is not a refresh token, and a refresh token is not an access token.
    const asRefresh = await tokenGrant(s.base, { grant_type: "refresh_token", refresh_token: tok.json.access_token });
    assert.equal(asRefresh.json.error, "invalid_grant");
    assert.equal(s.identity.namespaceForToken(tok.json.refresh_token), null);
    assert.equal(s.identity.namespaceForToken(code), null);
    const refreshAsCode = await tokenGrant(s.base, {
      grant_type: "authorization_code", code: tok.json.refresh_token, redirect_uri: REDIRECT, code_verifier: pkce().verifier,
    });
    assert.equal(refreshAsCode.json.error, "invalid_grant");
  });

  it("resetIdentity revokes the selected namespaces' tokens and no others", async () => {
    const a = await signIn(s.base);
    s.clock.t += 1;
    s.identity.reset({ prefix: "happy-cat-" });
    s.clock.t += 1;
    assert.equal(s.identity.namespaceForToken(a.tok.json.access_token), null);
    const refresh = await tokenGrant(s.base, { grant_type: "refresh_token", refresh_token: a.tok.json.refresh_token });
    assert.equal(refresh.json.error, "invalid_grant");
    // A sign-in after the reset works again.
    const b = await signIn(s.base);
    assert.equal(s.identity.namespaceForToken(b.tok.json.access_token), NS);
    s.clock.t += 1;
    s.identity.reset({ ns: "someone-else" });
    assert.equal(s.identity.namespaceForToken(b.tok.json.access_token), NS);
    s.identity.reset({});
    s.clock.t += 1;
    assert.equal(s.identity.namespaceForToken(b.tok.json.access_token), null);
  });

  it("logs no secret: no password, token, code or csrf in any log line", async () => {
    const { tok, code, settings } = await signIn(s.base);
    const text = JSON.stringify(s.lines);
    for (const secret of ["fake-bsc-password", tok.json.access_token, tok.json.refresh_token, code, settings.csrf]) {
      assert.ok(!text.includes(secret));
    }
  });

  it("answers 404 (or next()) for paths it does not serve", async () => {
    const r = await fetch(`${s.base}/v2.0/.well-known/openid-configuration`);
    assert.equal(r.status, 404);
    let called = false;
    s.identity.handle({ url: "/x/y/z", method: "GET", headers: {} }, {}, () => { called = true; });
    assert.ok(called);
  });
});

describe("fake BSC identity Router (src/identity/index.ts)", () => {
  let server;
  let base;
  let mod;
  before(async () => {
    const express = require("express");
    mod = require("../dist/src/identity/index.js");
    mod.configureIdentity({ tokenSecret: "z".repeat(40) });
    const app = express();
    app.use(express.json());
    app.use("/identity", mod.identityRouter);
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}/identity${TENANT_POLICY}`;
  });
  after(() => server?.close());

  it("exports the CONTRACT interface", () => {
    assert.equal(typeof mod.identityRouter, "function");
    assert.equal(typeof mod.namespaceForToken, "function");
    assert.equal(typeof mod.resetIdentity, "function");
  });

  it("runs a full sign-in behind express.json() and maps the token to its namespace", async () => {
    const { tok } = await signIn(base);
    assert.equal(tok.status, 200);
    assert.equal(mod.namespaceForToken(tok.json.access_token), NS);
    mod.resetIdentity({ ns: NS });
    await new Promise((r) => setTimeout(r, 2));
    assert.equal(mod.namespaceForToken(tok.json.access_token), null);
  });

  it("keys the singleton from FAKE_BSC_ADMIN_KEY, so a restarted singleton honours old tokens", async () => {
    const saved = process.env.FAKE_BSC_ADMIN_KEY;
    try {
      process.env.FAKE_BSC_ADMIN_KEY = "a".repeat(40);
      mod.configureIdentity();
      const { tok } = await signIn(base);
      assert.equal(tok.status, 200);
      mod.configureIdentity(); // a new instance with the same env
      assert.equal(mod.namespaceForToken(tok.json.access_token), NS);
      const refreshed = await tokenGrant(base, { grant_type: "refresh_token", refresh_token: tok.json.refresh_token });
      assert.equal(refreshed.status, 200);
      process.env.FAKE_BSC_ADMIN_KEY = "b".repeat(40);
      mod.configureIdentity();
      assert.equal(mod.namespaceForToken(tok.json.access_token), null);
    } finally {
      if (saved === undefined) delete process.env.FAKE_BSC_ADMIN_KEY;
      else process.env.FAKE_BSC_ADMIN_KEY = saved;
      mod.configureIdentity({ tokenSecret: "z".repeat(40) });
    }
  });
});
