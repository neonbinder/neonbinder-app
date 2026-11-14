// Shared test scaffolding: an in-process fake on a loopback port with a
// memory store, a stub identity module and a stub ID-token verifier. Never
// reaches the network beyond 127.0.0.1.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const express = require("express");
export const { createApp } = require("../dist/src/app.js");
export const { Catalogue, checkRecording } = require("../dist/src/catalogue.js");
export const { Captures } = require("../dist/src/captures.js");
export const { StateStore } = require("../dist/src/state.js");
export const { MemoryStore, LocalDirStore } = require("../dist/src/store/local.js");
export const { readConfig } = require("../dist/src/config.js");
export const { setLogSink } = require("../dist/src/log.js");

export const CALLER_KEY = "c".repeat(40);
export const ADMIN_KEY = "a".repeat(40);
export const AUDIENCE = "https://fake-bsc.example.run.app";
export const CALLER = "convex@example.iam.gserviceaccount.com";
export const LOADER = "loader@example.iam.gserviceaccount.com";
export const STRANGER = "stranger@example.iam.gserviceaccount.com";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

/** A token the stub verifier accepts when its signature is "valid". */
export function idToken(email, { sig = "valid", exp = Math.floor(Date.now() / 1000) + 600, aud = AUDIENCE, iss = "https://accounts.google.com", verified = true } = {}) {
  return `${b64({ alg: "RS256" })}.${b64({ iss, aud, exp, email, email_verified: verified })}.${sig}`;
}

export async function stubVerifier(token) {
  const [, payload, sig] = token.split(".");
  if (sig !== "valid") return null;
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

export function testConfig(over = {}) {
  return readConfig({
    FAKE_BSC_CALLER_KEY: CALLER_KEY,
    FAKE_BSC_ADMIN_KEY: ADMIN_KEY,
    FAKE_BSC_ALLOWED_CALLERS: `${CALLER},${LOADER}`,
    FAKE_BSC_ADMIN_CALLERS: LOADER,
    FAKE_BSC_AUDIENCE: AUDIENCE,
    PORT: "0",
    ...over,
  });
}

/** A stub of src/identity: BSC tokens "tok-<ns>" map to <ns>. */
export function stubIdentity() {
  const resets = [];
  const router = express.Router();
  router.get("/ping", (_req, res) => res.json({ ok: true }));
  return {
    resets,
    identityRouter: router,
    namespaceForToken: (t) => (typeof t === "string" && t.startsWith("tok-") ? t.slice(4) : null),
    resetIdentity: (sel) => resets.push(sel),
  };
}

export async function startFake({ store = new MemoryStore(), configOver = {}, now, sleep } = {}) {
  setLogSink(() => {});
  const config = testConfig(configOver);
  const catalogue = new Catalogue(store);
  await catalogue.load();
  const captures = new Captures(store);
  await captures.load();
  const state = new StateStore(now);
  const identity = stubIdentity();
  const app = createApp({ config, catalogue, captures, state, identity, verifyIdToken: stubVerifier, instanceId: "test-instance", now, sleep });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = (email = CALLER, { admin = false, bsc } = {}) => ({
    "x-nb-fake-bsc-key": CALLER_KEY,
    "X-Serverless-Authorization": `Bearer ${idToken(email)}`,
    ...(admin ? { "x-nb-fake-bsc-admin-key": ADMIN_KEY } : {}),
    ...(bsc ? { authorization: `Bearer ${bsc}` } : {}),
  });
  const call = async (method, path, { body, email, admin, bsc, extra = {} } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { ...headers(email, { admin, bsc }), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...extra },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, headers: res.headers, body: json };
  };
  return { server, base, config, catalogue, captures, state, identity, store, headers, call, close: () => new Promise((r) => server.close(r)) };
}

export const RESULTS_PATH = "search/bulk-upload/results";
export const FILTERS_PATH = "search/bulk-upload/filters";

export function resultsBody(filters) {
  return { condition: "all", page: 0, size: 5000, sort: "default", filters };
}

/** A catalogue results row as BSC sends it, before sanitising (with seller noise). */
export function rawResultsRow(id, cardNo, players) {
  return {
    id,
    setName: "1996-score",
    players,
    cardNo,
    playerAttribute: "",
    playerAttributeDesc: "",
    cardNoOrder: 1,
    cardNoSequence: 1,
    cardNoSort: cardNo,
    imgFront: "/Catalog/front.jpg",
    sellerId: "real-seller",
    seller: { email: "someone@example.com", name: "Real Person" },
  };
}
