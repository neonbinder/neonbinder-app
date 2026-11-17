// The stub eBay the recorder tests share (and the child process in
// ebay-recorder.test.mjs that runs a production capture with a closed
// stderr). Every eBay answer is a stub function; nothing reaches eBay.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { EbayApi } = require("../dist/recorder/ebay-api.js");

export const REFRESH = "v^1.1#i^1#REFRESH-TOKEN-VALUE-never-printed";
export const CERT = "PRD-cert-id-value-never-printed";
export const NOW = Date.parse("2026-11-16T12:00:00.000Z");
export const PRD_SKU = "NBCAPTURE-PRD-20261116";
export const SBX_SKU = "NBCAPTURE-SBX-20261116";

/**
 * A stub eBay. `routes` maps "METHOD /path" (no query) to a handler returning
 * {status, body?, location?}; unmatched requests answer 404. Every request is
 * recorded (method, path, query, body text) for assertions.
 */
export function stubEbay(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    let bodyText = "";
    if (typeof init.body === "string") bodyText = init.body;
    else if (init.body instanceof FormData) bodyText = "<multipart>";
    calls.push({ method, host: u.hostname, path: u.pathname, query: Object.fromEntries(u.searchParams), body: bodyText, headers: init.headers });
    const key = `${method} ${u.pathname}`;
    const h = routes[key] ?? Object.entries(routes).find(([k]) => k.endsWith("*") && key.startsWith(k.slice(0, -1)))?.[1];
    const out = h ? h({ method, path: u.pathname, query: u.searchParams, body: bodyText, calls }) : { status: 404, body: { errors: [{ errorId: 25710 }] } };
    if (out instanceof Error) throw out;
    const headers = new Headers(out.location ? { location: out.location } : {});
    return new Response(out.body === undefined ? null : JSON.stringify(out.body), { status: out.status, headers });
  };
  return { calls, fetchImpl };
}

export const tokenOk = () => ({ status: 200, body: { access_token: "v^1.1#ACCESS", expires_in: 7200, token_type: "User Access Token" } });

export function api(env, routes, over = {}) {
  const stub = stubEbay({ "POST /identity/v1/oauth2/token": tokenOk, ...routes });
  let t = NOW;
  const sleeps = [];
  const a = new EbayApi({
    env,
    creds: { clientId: "NB-app-id", certId: CERT, refreshToken: REFRESH },
    fetchImpl: stub.fetchImpl,
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    ...over,
  });
  return { api: a, stub, sleeps };
}

export const PICTURE = { filename: "front.jpg", contentType: "image/jpeg", bytes: Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex") };

/** A production account where everything works; `over` replaces routes. */
export function prodRoutes(over = {}) {
  const state = { item: false, offer: false, live: false };
  const routes = {
    [`GET /sell/inventory/v1/inventory_item/${PRD_SKU}`]: () => (state.item ? { status: 200, body: { sku: PRD_SKU } } : { status: 404, body: { errors: [{ errorId: 25710 }] } }),
    "GET /sell/inventory/v1/offer": () => (state.offer ? { status: 200, body: { offers: [{ offerId: "777", sku: PRD_SKU, status: state.live ? "PUBLISHED" : "UNPUBLISHED" }] } } : { status: 404, body: { errors: [{ errorId: 25713 }] } }),
    "GET /sell/account/v1/payment_policy": () => ({ status: 200, body: { total: 1, paymentPolicies: [{ paymentPolicyId: "11", name: "p" }] } }),
    "GET /sell/account/v1/return_policy": () => ({ status: 200, body: { total: 1, returnPolicies: [{ returnPolicyId: "22", name: "r" }] } }),
    "GET /sell/account/v1/fulfillment_policy": () => ({ status: 200, body: { total: 1, fulfillmentPolicies: [{ fulfillmentPolicyId: "33", name: "f" }] } }),
    "GET /sell/inventory/v1/location/neonbinder-main": () => ({ status: 200, body: { merchantLocationKey: "neonbinder-main", merchantLocationStatus: "ENABLED" } }),
    "POST /commerce/media/v1_beta/image/create_image_from_file": () => ({ status: 201, body: { imageUrl: "https://i.ebayimg.com/x.jpg", expirationDate: "2026-12-16T00:00:00.000Z" }, location: "https://apim.ebay.com/commerce/media/v1_beta/image/IMG1" }),
    "GET /commerce/media/v1_beta/image/IMG1": () => ({ status: 200, body: { imageUrl: "https://i.ebayimg.com/x.jpg", expirationDate: "2026-12-16T00:00:00.000Z" } }),
    "POST /sell/inventory/v1/bulk_create_or_replace_inventory_item": () => {
      state.item = true;
      return { status: 200, body: { responses: [{ statusCode: 200, sku: PRD_SKU, locale: "en_US" }] } };
    },
    "POST /sell/inventory/v1/bulk_create_offer": () => {
      state.offer = true;
      return { status: 200, body: { responses: [{ statusCode: 201, sku: PRD_SKU, offerId: "777" }] } };
    },
    "POST /sell/inventory/v1/offer/777/publish": () => {
      state.live = true;
      return { status: 200, body: { listingId: "110000000001", warnings: [] } };
    },
    "POST /sell/inventory/v1/bulk_update_price_quantity": () => ({ status: 200, body: { responses: [{ statusCode: 200, sku: PRD_SKU, offerId: "777" }] } }),
    "POST /sell/inventory/v1/offer/777/withdraw": () => {
      if (!state.live) return { status: 404, body: { errors: [{ errorId: 25713 }] } };
      state.live = false;
      return { status: 200, body: { listingId: "110000000001", warnings: [] } };
    },
    [`DELETE /sell/inventory/v1/inventory_item/${PRD_SKU}`]: () => {
      if (!state.item) return { status: 404 };
      state.item = false;
      state.offer = false;
      return { status: 204 };
    },
  };
  for (const [k, v] of Object.entries(over)) routes[k] = typeof v === "function" ? (ctx) => v(ctx, state, routes) : v;
  return { routes, state };
}

export function sink() {
  const stored = [];
  return { stored, uploadCapture: async (c) => (stored.push(c), { verdict: "ok", paths: [] }) };
}
