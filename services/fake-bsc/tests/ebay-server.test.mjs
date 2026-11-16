// The fake eBay over HTTP: tokens, the seller flow NB drives, orders, media,
// faults, resets, misses and captures. In-process fake on 127.0.0.1 only;
// nothing here reaches eBay.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createVerify } from "node:crypto";
import { ADMIN_KEY, CALLER, LOADER, setLogSink, startFake } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const { FAKE_EBAY_CLIENT_ID, FAKE_EBAY_CLIENT_SECRET } = require("../dist/src/ebay/tokens.js");
const { FAKE_EBAY_PUBLIC_KEY_ID } = require("../dist/src/ebay/notificationKey.js");
const { EBAY_CAPTURE_ENDPOINTS } = require("../dist/src/ebay/captures.js");
const { planMisses } = require("../dist/recorder/record.js");
const { replayRefusal } = require("../dist/src/replayAllowlist.js");

const BASIC = `Basic ${Buffer.from(`${FAKE_EBAY_CLIENT_ID}:${FAKE_EBAY_CLIENT_SECRET}`).toString("base64")}`;
const INV = "/ebay/api/sell/inventory/v1";
const ACC = "/ebay/api/sell/account/v1";
const NB_FILTER = "lastmodifieddate:[2020-01-01T00:00:00.000Z..]";

/** A request to the fake's eBay surface, with the caller headers and an optional eBay token. */
async function ebay(fake, method, path, { token, body, form, raw, contentType, extra = {} } = {}) {
  const headers = { ...fake.headers(CALLER), ...extra };
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  } else if (form !== undefined) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    payload = new URLSearchParams(form).toString();
  } else if (raw !== undefined) {
    headers["content-type"] = contentType;
    payload = raw;
  }
  const res = await fetch(`${fake.base}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, headers: res.headers, body: json };
}

const token = (fake, form, auth = BASIC) => ebay(fake, "POST", "/ebay/api/identity/v1/oauth2/token", { form, extra: { authorization: auth } });

/** The consent and code grant NB's connect flow does, against the fake. */
async function connect(fake, ns, seller) {
  const c = await fake.call("POST", "/__fake/ebay/consent", { body: { ns, ...(seller ? { seller } : {}) } });
  assert.equal(c.status, 200);
  const t = await token(fake, { grant_type: "authorization_code", code: c.body.code, redirect_uri: "nb-ru" });
  assert.equal(t.status, 200);
  return { access: t.body.access_token, refresh: t.body.refresh_token };
}

async function appToken(fake) {
  const t = await token(fake, { grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" });
  assert.equal(t.status, 200);
  return t.body.access_token;
}

function item(sku, over = {}) {
  return {
    sku,
    locale: "en_US",
    condition: "USED_VERY_GOOD",
    conditionDescriptors: [{ name: "40001", values: ["400010"] }],
    availability: { shipToLocationAvailability: { quantity: 3 } },
    product: { title: "1996 Score #1 Vorkle", description: "d", aspects: { Sport: ["Baseball"] }, imageUrls: ["https://www.neonbinder.io/x.jpg"] },
    ...over,
  };
}

function offer(sku, policies, over = {}) {
  return {
    sku,
    marketplaceId: "EBAY_US",
    format: "FIXED_PRICE",
    availableQuantity: 3,
    categoryId: "261328",
    listingDescription: "d",
    listingDuration: "GTC",
    listingPolicies: { ...policies, bestOfferTerms: { bestOfferEnabled: false } },
    pricingSummary: { price: { value: "12.50", currency: "USD" } },
    merchantLocationKey: "neonbinder-main",
    ...over,
  };
}

const LOCATION = { location: { address: { city: "Austin", stateOrProvince: "TX", postalCode: "78701", country: "US" } }, locationTypes: ["WAREHOUSE"], name: "NeonBinder", merchantLocationStatus: "ENABLED" };

/** A seller NB has set up: opted in, three policies, an enabled location. */
async function setUpSeller(fake, ns, tok) {
  const seed = await fake.call("POST", "/__fake/ebay/seller", {
    body: { ns, fulfillmentPolicies: [{ name: "Under $20", services: [{ code: "US_eBayStandardEnvelope", costCents: 99 }] }, { name: "$20+", services: [{ code: "USPSGroundAdvantage", freeShipping: true }] }] },
  });
  assert.equal(seed.status, 200);
  const pay = await ebay(fake, "POST", `${ACC}/payment_policy`, { token: tok, body: { name: "NB Payment", marketplaceId: "EBAY_US", categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }], immediatePay: true } });
  assert.equal(pay.status, 201);
  const ret = await ebay(fake, "POST", `${ACC}/return_policy`, {
    token: tok,
    body: { name: "NB Returns (30 days)", marketplaceId: "EBAY_US", returnsAccepted: true, returnPeriod: { value: 30, unit: "DAY" }, returnShippingCostPayer: "BUYER", refundMethod: "MONEY_BACK" },
  });
  assert.equal(ret.status, 201);
  assert.equal((await ebay(fake, "POST", `${INV}/location/neonbinder-main`, { token: tok, body: LOCATION })).status, 204);
  return { fulfillmentPolicyId: seed.body.fulfillmentPolicyIds[0], paymentPolicyId: pay.body.paymentPolicyId, returnPolicyId: ret.body.returnPolicyId };
}

/** Item, offer, publish. Answers the offer id and listing id. */
async function list(fake, tok, sku, policies) {
  assert.equal((await ebay(fake, "POST", `${INV}/bulk_create_or_replace_inventory_item`, { token: tok, body: { requests: [item(sku)] } })).status, 200);
  const o = await ebay(fake, "POST", `${INV}/bulk_create_offer`, { token: tok, body: { requests: [offer(sku, policies)] } });
  assert.equal(o.status, 200);
  const offerId = o.body.responses[0].offerId;
  const p = await ebay(fake, "POST", `${INV}/offer/${offerId}/publish`, { token: tok });
  assert.equal(p.status, 200);
  return { offerId, listingId: p.body.listingId };
}

describe("fake eBay: tokens (row 14)", () => {
  let fake;
  before(async () => (fake = await startFake()));
  after(() => fake.close());

  it("refuses a wrong client with invalid_client, and every eBay path needs the caller headers", async () => {
    const bad = await token(fake, { grant_type: "client_credentials" }, `Basic ${Buffer.from("x:y").toString("base64")}`);
    assert.equal(bad.status, 401);
    assert.equal(bad.body.error, "invalid_client");
    const res = await fetch(`${fake.base}/ebay/api/identity/v1/oauth2/token`, { method: "POST" });
    assert.ok(res.status === 401 || res.status === 403);
  });

  it("exchanges a consent code once, for a refresh token NB stores", async () => {
    const c = await fake.call("POST", "/__fake/ebay/consent", { body: { ns: "tok-ns-1" } });
    assert.equal(c.body.expiresIn, 300);
    const t = await token(fake, { grant_type: "authorization_code", code: c.body.code, redirect_uri: "nb-ru" });
    assert.equal(t.status, 200);
    assert.equal(t.body.token_type, "User Access Token");
    assert.equal(t.body.expires_in, 7200);
    assert.equal(typeof t.body.refresh_token, "string");
    assert.equal(t.body.refresh_token_expires_in, 47304000);
    const again = await token(fake, { grant_type: "authorization_code", code: c.body.code, redirect_uri: "nb-ru" });
    assert.equal(again.status, 400);
    assert.equal(again.body.error, "invalid_grant");
  });

  it("refreshes with NB's scopes or their read-only forms, never another scope", async () => {
    const { refresh } = await connect(fake, "tok-ns-2");
    const full = await token(fake, {
      grant_type: "refresh_token",
      refresh_token: refresh,
      scope: ["", "/sell.inventory", "/sell.account", "/sell.fulfillment", "/commerce.identity.readonly"].map((s) => `https://api.ebay.com/oauth/api_scope${s}`).join(" "),
    });
    assert.equal(full.status, 200);
    assert.equal(full.body.refresh_token, undefined, "eBay does not rotate the refresh token");
    const ro = await token(fake, { grant_type: "refresh_token", refresh_token: refresh, scope: "https://api.ebay.com/oauth/api_scope/sell.account.readonly" });
    assert.equal(ro.status, 200);
    const wide = await token(fake, { grant_type: "refresh_token", refresh_token: refresh, scope: "https://api.ebay.com/oauth/api_scope/sell.finances" });
    assert.equal(wide.body.error, "invalid_scope");
    const forged = await token(fake, { grant_type: "refresh_token", refresh_token: `${refresh.slice(0, -4)}AAAA` });
    assert.equal(forged.body.error, "invalid_grant");
    const kind = await token(fake, { grant_type: "password" });
    assert.equal(kind.body.error, "unsupported_grant_type");
    const missing = await token(fake, { grant_type: "refresh_token" });
    assert.equal(missing.body.error, "invalid_request");
  });

  it("an access token is not a refresh token, and an app token is not a user token", async () => {
    const { access } = await connect(fake, "tok-ns-3");
    assert.equal((await token(fake, { grant_type: "refresh_token", refresh_token: access })).body.error, "invalid_grant");
    const app = await appToken(fake);
    const me = await ebay(fake, "GET", "/ebay/apiz/commerce/identity/v1/user/", { token: app });
    assert.equal(me.status, 401);
    assert.equal(me.body.errors[0].errorId, 1001);
  });

  it("reset keeps tokens; reset-all revokes every token issued before it", async () => {
    const { access, refresh } = await connect(fake, "tok-ns-4");
    assert.equal((await fake.call("POST", "/__fake/reset", { body: { ns: "tok-ns-4" } })).status, 200);
    assert.equal((await ebay(fake, "GET", "/ebay/apiz/commerce/identity/v1/user/", { token: access })).status, 200);
    assert.equal((await fake.call("POST", "/__fake/reset-all", { email: LOADER, admin: true })).status, 200);
    assert.equal((await ebay(fake, "GET", "/ebay/apiz/commerce/identity/v1/user/", { token: access })).status, 401);
    assert.equal((await token(fake, { grant_type: "refresh_token", refresh_token: refresh })).body.error, "invalid_grant");
    // A token minted after the revocation works, even within the same millisecond.
    const fresh = await connect(fake, "tok-ns-4");
    assert.equal((await ebay(fake, "GET", "/ebay/apiz/commerce/identity/v1/user/", { token: fresh.access })).status, 200);
  });
});

describe("fake eBay: identity and public key (rows 15, 16)", () => {
  let fake;
  before(async () => (fake = await startFake()));
  after(() => fake.close());

  it("each namespace and each of its two sellers is a different eBay account", async () => {
    const ids = [];
    for (const [ns, seller] of [["id-a", undefined], ["id-a", "alt"], ["id-b", undefined]]) {
      const { access } = await connect(fake, ns, seller);
      const me = await ebay(fake, "GET", "/ebay/apiz/commerce/identity/v1/user/", { token: access });
      assert.equal(me.status, 200);
      assert.match(me.body.userId, /^[A-Za-z0-9._-]{1,64}$/);
      assert.equal(typeof me.body.username, "string");
      ids.push(me.body.userId);
    }
    assert.equal(new Set(ids).size, 3);
  });

  it("serves a stable P-256 key to an app token that verifies a body signed the way eBay signs", async () => {
    const app = await appToken(fake);
    const pk = await ebay(fake, "GET", `/ebay/api/commerce/notification/v1/public_key/${FAKE_EBAY_PUBLIC_KEY_ID}`, { token: app });
    assert.equal(pk.status, 200);
    assert.equal(pk.body.algorithm, "ECDSA");
    assert.equal(pk.body.digest, "SHA1");
    const { notificationKey } = require("../dist/src/ebay/notificationKey.js");
    const k = notificationKey(ADMIN_KEY);
    assert.equal(pk.body.key, k.publicPem, "derived from the admin key, so a restart serves the same key");
    const bodyText = JSON.stringify({ metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION" } });
    const header = JSON.parse(Buffer.from(k.signatureHeader(bodyText), "base64").toString("utf8"));
    assert.equal(header.kid, FAKE_EBAY_PUBLIC_KEY_ID);
    const v = createVerify("SHA1");
    v.update(bodyText);
    assert.equal(v.verify(pk.body.key, Buffer.from(header.signature, "base64")), true);
    assert.equal((await ebay(fake, "GET", "/ebay/api/commerce/notification/v1/public_key/other-kid", { token: app })).status, 404);
    const { access } = await connect(fake, "pk-user");
    assert.equal((await ebay(fake, "GET", `/ebay/api/commerce/notification/v1/public_key/${FAKE_EBAY_PUBLIC_KEY_ID}`, { token: access })).status, 401);
  });
});

describe("fake eBay: the seller flow NB drives (rows 1-4, 6, 9-12)", () => {
  let fake;
  let tok;
  let policies;
  const NS = "flow-ns-w0";
  before(async () => {
    fake = await startFake();
    tok = (await connect(fake, NS)).access;
  });
  after(() => fake.close());

  it("a new seller is opted in to nothing and has no policies; a second opt_in is 409", async () => {
    const fresh = (await connect(fake, "flow-fresh")).access;
    const programs = await ebay(fake, "GET", `${ACC}/program/get_opted_in_programs`, { token: fresh });
    assert.deepEqual(programs.body, { programs: [] });
    const create = await ebay(fake, "POST", `${ACC}/payment_policy`, { token: fresh, body: { name: "NB Payment", marketplaceId: "EBAY_US" } });
    assert.equal(create.status, 400);
    assert.equal(create.body.errors[0].errorId, 20403);
    assert.equal((await ebay(fake, "POST", `${ACC}/program/opt_in`, { token: fresh, body: { programType: "SELLING_POLICY_MANAGEMENT" } })).status, 200);
    assert.equal((await ebay(fake, "POST", `${ACC}/program/opt_in`, { token: fresh, body: { programType: "SELLING_POLICY_MANAGEMENT" } })).status, 409);
    const after = await ebay(fake, "GET", `${ACC}/program/get_opted_in_programs`, { token: fresh });
    assert.deepEqual(after.body.programs, [{ programType: "SELLING_POLICY_MANAGEMENT" }]);
  });

  it("stores policies, refuses a duplicate name, and lists the seeded shipping policies NB reads", async () => {
    policies = await setUpSeller(fake, NS, tok);
    const dup = await ebay(fake, "POST", `${ACC}/payment_policy`, { token: tok, body: { name: "nb payment", marketplaceId: "EBAY_US" } });
    assert.equal(dup.status, 400);
    assert.equal(dup.body.errors[0].errorId, 20400);
    const ful = await ebay(fake, "GET", `${ACC}/fulfillment_policy?marketplace_id=EBAY_US`, { token: tok });
    assert.equal(ful.body.total, 2);
    const svc = ful.body.fulfillmentPolicies[0].shippingOptions.find((o) => o.optionType === "DOMESTIC").shippingServices[0];
    assert.equal(svc.shippingServiceCode, "US_eBayStandardEnvelope");
    assert.equal(svc.shippingCost.value, "0.99");
    assert.equal(ful.body.fulfillmentPolicies[1].shippingOptions[0].shippingServices[0].freeShipping, true);
    const ret = await ebay(fake, "GET", `${ACC}/return_policy?marketplace_id=EBAY_US`, { token: tok });
    assert.deepEqual(ret.body.returnPolicies[0].returnPeriod, { value: 30, unit: "DAY" });
    assert.equal(ret.body.returnPolicies[0].returnShippingCostPayer, "BUYER");
    const reseed = await fake.call("POST", "/__fake/ebay/seller", { body: { ns: NS, fulfillmentPolicies: [{ name: "under $20", services: [{ code: "X" }] }] } });
    assert.equal(reseed.status, 409);
  });

  it("location: 404 until created, 400 25803 on a second create (the sandbox's answer), then update and enable", async () => {
    const other = (await connect(fake, "flow-loc")).access;
    const missing = await ebay(fake, "GET", `${INV}/location/neonbinder-main`, { token: other });
    assert.equal(missing.status, 404);
    assert.equal((await ebay(fake, "POST", `${INV}/location/neonbinder-main`, { token: other, body: { ...LOCATION, merchantLocationStatus: "DISABLED" } })).status, 204);
    const again = await ebay(fake, "POST", `${INV}/location/neonbinder-main`, { token: other, body: LOCATION });
    assert.equal(again.status, 400);
    assert.equal(again.body.errors[0].errorId, 25803);
    assert.equal((await ebay(fake, "GET", `${INV}/location/neonbinder-main`, { token: other })).body.merchantLocationStatus, "DISABLED");
    const { merchantLocationStatus: _s, ...details } = LOCATION;
    assert.equal((await ebay(fake, "POST", `${INV}/location/neonbinder-main/update_location_details`, { token: other, body: details })).status, 204);
    assert.equal((await ebay(fake, "POST", `${INV}/location/neonbinder-main/enable`, { token: other })).status, 200);
    assert.equal((await ebay(fake, "GET", `${INV}/location/neonbinder-main`, { token: other })).body.merchantLocationStatus, "ENABLED");
  });

  it("bulk items answer per entry: 207 with 25717 for the one without a picture, 400 with responses when all fail", async () => {
    const mixed = await ebay(fake, "POST", `${INV}/bulk_create_or_replace_inventory_item`, {
      token: tok,
      body: { requests: [item("NB2-a-NM"), item("NB2-b-NM", { product: { title: "t", imageUrls: [] } })] },
    });
    assert.equal(mixed.status, 207);
    assert.equal(mixed.body.responses[0].statusCode, 200);
    assert.equal(mixed.body.responses[1].statusCode, 400);
    assert.equal(mixed.body.responses[1].sku, "NB2-b-NM");
    assert.equal(mixed.body.responses[1].errors[0].errorId, 25717);
    const none = await ebay(fake, "POST", `${INV}/bulk_create_or_replace_inventory_item`, { token: tok, body: { requests: [item("x".repeat(51))] } });
    assert.equal(none.status, 400);
    assert.equal(none.body.responses.length, 1);
    assert.equal(none.body.responses[0].errors[0].errorId, 25709);
    const tooMany = await ebay(fake, "POST", `${INV}/bulk_create_or_replace_inventory_item`, { token: tok, body: { requests: Array.from({ length: 26 }, (_, i) => item(`S${i}`)) } });
    assert.equal(tooMany.status, 400);
  });

  it("an offer per SKU: 25002 on a second create (NB adopts it via GET offer?sku=), 25702 with no item", async () => {
    const first = await ebay(fake, "POST", `${INV}/bulk_create_offer`, { token: tok, body: { requests: [offer("NB2-a-NM", policies), offer("NB2-none-NM", policies)] } });
    assert.equal(first.status, 207);
    assert.equal(first.body.responses[0].statusCode, 201);
    assert.match(first.body.responses[0].offerId, /^\d+$/);
    assert.equal(first.body.responses[1].errors[0].errorId, 25702);
    const dup = await ebay(fake, "POST", `${INV}/bulk_create_offer`, { token: tok, body: { requests: [offer("NB2-a-NM", policies)] } });
    assert.equal(dup.status, 400);
    assert.equal(dup.body.responses[0].errors[0].errorId, 25002);
    const got = await ebay(fake, "GET", `${INV}/offer?sku=NB2-a-NM&marketplace_id=EBAY_US&format=FIXED_PRICE&limit=5`, { token: tok });
    assert.equal(got.status, 200);
    assert.equal(got.body.offers[0].offerId, first.body.responses[0].offerId);
    assert.equal(got.body.offers[0].status, "UNPUBLISHED");
    assert.equal(got.body.offers[0].listing, undefined);
    const none = await ebay(fake, "GET", `${INV}/offer?sku=NB2-zzz-NM&marketplace_id=EBAY_US`, { token: tok });
    assert.equal(none.status, 404);
  });

  it("publish: 25007 with no shipping policy, 25002 with no enabled location, then a listing id (the same one twice)", async () => {
    const other = (await connect(fake, "flow-pub")).access;
    await fake.call("POST", "/__fake/ebay/seller", { body: { ns: "flow-pub", optedIn: true } });
    await ebay(fake, "POST", `${INV}/bulk_create_or_replace_inventory_item`, { token: other, body: { requests: [item("NB2-p-NM")] } });
    const pay = await ebay(fake, "POST", `${ACC}/payment_policy`, { token: other, body: { name: "P", marketplaceId: "EBAY_US" } });
    const ret = await ebay(fake, "POST", `${ACC}/return_policy`, { token: other, body: { name: "R", marketplaceId: "EBAY_US", returnsAccepted: true } });
    const pol = { fulfillmentPolicyId: "123", paymentPolicyId: pay.body.paymentPolicyId, returnPolicyId: ret.body.returnPolicyId };
    const o = await ebay(fake, "POST", `${INV}/bulk_create_offer`, { token: other, body: { requests: [offer("NB2-p-NM", pol)] } });
    const offerId = o.body.responses[0].offerId;
    const noShip = await ebay(fake, "POST", `${INV}/offer/${offerId}/publish`, { token: other });
    assert.equal(noShip.body.errors[0].errorId, 25007);
    const seeded = await fake.call("POST", "/__fake/ebay/seller", { body: { ns: "flow-pub", fulfillmentPolicies: [{ name: "S", services: [{ code: "USPSGroundAdvantage", costCents: 400 }] }] } });
    const { sku: _s, marketplaceId: _m, format: _f, ...update } = offer("NB2-p-NM", { ...pol, fulfillmentPolicyId: seeded.body.fulfillmentPolicyIds[0] });
    assert.equal((await ebay(fake, "PUT", `${INV}/offer/${offerId}`, { token: other, body: update })).status, 204);
    const noLoc = await ebay(fake, "POST", `${INV}/offer/${offerId}/publish`, { token: other });
    assert.equal(noLoc.status, 400);
    assert.equal(noLoc.body.errors[0].errorId, 25002);
    await ebay(fake, "POST", `${INV}/location/neonbinder-main`, { token: other, body: LOCATION });
    const pub = await ebay(fake, "POST", `${INV}/offer/${offerId}/publish`, { token: other });
    assert.equal(pub.status, 200);
    assert.match(pub.body.listingId, /^\d{12}$/);
    assert.equal((await ebay(fake, "POST", `${INV}/offer/${offerId}/publish`, { token: other })).body.listingId, pub.body.listingId);
  });

  it("an order line's legacyItemId is the published listing id; a paid order sells the quantity down", async () => {
    const { offerId, listingId } = await list(fake, tok, "NB2-o-NM", policies);
    const injected = await fake.call("POST", "/__fake/ebay/orders", { body: { ns: NS, order: { lines: [{ sku: "NB2-o-NM", quantity: 2 }, { title: "A card NB never listed", quantity: 1, priceCents: 150 }] } } });
    assert.equal(injected.status, 200);
    assert.equal(injected.body.orders[0].lines[0].listingId, listingId);
    const orders = await ebay(fake, "GET", `/ebay/api/sell/fulfillment/v1/order?filter=${encodeURIComponent(NB_FILTER)}&limit=100&offset=0`, { token: tok });
    assert.equal(orders.status, 200);
    assert.equal(orders.body.total, 1);
    const o = orders.body.orders[0];
    assert.equal(o.orderPaymentStatus, "PAID");
    assert.equal(o.cancelStatus.cancelState, "NONE_REQUESTED");
    assert.equal(o.lineItems[0].legacyItemId, listingId);
    assert.equal(o.lineItems[0].sku, "NB2-o-NM");
    assert.equal(o.lineItems[0].lineItemCost.value, "25.00");
    assert.equal(o.lineItems[1].sku, undefined);
    assert.equal(o.lineItems[1].title, "A card NB never listed");
    assert.equal(o.pricingSummary.total.value, "26.50");
    const got = await ebay(fake, "GET", `${INV}/offer?sku=NB2-o-NM`, { token: tok });
    assert.equal(got.body.offers[0].availableQuantity, 1);
    assert.equal((await ebay(fake, "GET", `${INV}/inventory_item/NB2-o-NM`, { token: tok })).body.availability.shipToLocationAvailability.quantity, 1);
    // A later cancel replaces the order and moves lastModifiedDate; quantities are not sold twice.
    const cancel = await fake.call("POST", "/__fake/ebay/orders", { body: { ns: NS, order: { orderId: o.orderId, cancelled: true, paymentStatus: "FULLY_REFUNDED", lines: [{ sku: "NB2-o-NM", quantity: 2 }] } } });
    assert.equal(cancel.status, 200);
    const later = await ebay(fake, "GET", `/ebay/api/sell/fulfillment/v1/order?filter=${encodeURIComponent(`lastmodifieddate:[${o.lastModifiedDate}..]`)}`, { token: tok });
    assert.equal(later.body.orders[0].cancelStatus.cancelState, "CANCELED");
    assert.equal((await ebay(fake, "GET", `${INV}/offer?sku=NB2-o-NM`, { token: tok })).body.offers[0].availableQuantity, 1);
    void offerId;
  });

  it("orders page by record offset; a filter NB never sends is a needs-model miss", async () => {
    for (let i = 0; i < 3; i++) await fake.call("POST", "/__fake/ebay/orders", { body: { ns: NS, order: { lines: [{ title: `t${i}`, quantity: 1 }] } } });
    const page = await ebay(fake, "GET", `/ebay/api/sell/fulfillment/v1/order?filter=${encodeURIComponent(NB_FILTER)}&limit=2&offset=0`, { token: tok });
    assert.equal(page.body.orders.length, 2);
    assert.match(page.body.next, /offset=2$/);
    const tail = await ebay(fake, "GET", `/ebay/api/sell/fulfillment/v1/order?filter=${encodeURIComponent(NB_FILTER)}&limit=2&offset=2`, { token: tok });
    assert.equal(tail.body.orders.length, 2);
    assert.equal(tail.body.next, undefined);
    const other = await ebay(fake, "GET", `/ebay/api/sell/fulfillment/v1/order?filter=${encodeURIComponent("creationdate:[2020-01-01T00:00:00.000Z..]")}`, { token: tok });
    assert.equal(other.status, 501);
    assert.equal(other.headers.get("x-nb-fake"), "unrecorded");
    const misses = await fake.call("GET", `/__fake/misses?ns=${NS}`);
    const m = misses.body.misses.find((x) => x.kind === "needs-model");
    assert.equal(m.path, "ebay/api/sell/fulfillment/v1/order");
  });

  it("price and quantity update by offer; withdraw ends the listing (404 the second time); delete removes item and offer", async () => {
    const { offerId } = await list(fake, tok, "NB2-w-NM", policies);
    const upd = await ebay(fake, "POST", `${INV}/bulk_update_price_quantity`, {
      token: tok,
      body: { requests: [{ sku: "NB2-w-NM", shipToLocationAvailability: { quantity: 5 }, offers: [{ offerId, availableQuantity: 5, price: { value: "9.99", currency: "USD" } }] }] },
    });
    assert.equal(upd.status, 200);
    assert.deepEqual(upd.body.responses[0], { statusCode: 200, sku: "NB2-w-NM", offerId });
    const got = await ebay(fake, "GET", `${INV}/offer?sku=NB2-w-NM`, { token: tok });
    assert.equal(got.body.offers[0].pricingSummary.price.value, "9.99");
    assert.equal(got.body.offers[0].availableQuantity, 5);
    const wrong = await ebay(fake, "POST", `${INV}/bulk_update_price_quantity`, { token: tok, body: { requests: [{ sku: "NB2-w-NM", offers: [{ offerId: "999", price: { value: "1.00", currency: "USD" } }] }] } });
    assert.equal(wrong.body.responses[0].errors[0].errorId, 25713);
    const wd = await ebay(fake, "POST", `${INV}/offer/${offerId}/withdraw`, { token: tok });
    assert.equal(wd.status, 200);
    assert.equal(typeof wd.body.listingId, "string");
    assert.equal((await ebay(fake, "POST", `${INV}/offer/${offerId}/withdraw`, { token: tok })).status, 404);
    assert.equal((await ebay(fake, "DELETE", `${INV}/inventory_item/NB2-w-NM`, { token: tok })).status, 204);
    assert.equal((await ebay(fake, "DELETE", `${INV}/inventory_item/NB2-w-NM`, { token: tok })).status, 404);
    assert.equal((await ebay(fake, "GET", `${INV}/offer?sku=NB2-w-NM`, { token: tok })).status, 404);
  });

  it("inventory_item lists by PAGE offset, as eBay does", async () => {
    const own = (await connect(fake, "flow-page")).access;
    await ebay(fake, "POST", `${INV}/bulk_create_or_replace_inventory_item`, { token: own, body: { requests: ["A", "B", "C"].map((s) => item(`NB2-${s}-NM`)) } });
    const p0 = await ebay(fake, "GET", `${INV}/inventory_item?limit=2&offset=0`, { token: own });
    assert.deepEqual(p0.body.inventoryItems.map((i) => i.sku), ["NB2-A-NM", "NB2-B-NM"]);
    assert.match(p0.body.next, /[?&]offset=1(?:&|$)/);
    const p1 = await ebay(fake, "GET", `${INV}/inventory_item?limit=2&offset=1`, { token: own });
    assert.deepEqual(p1.body.inventoryItems.map((i) => i.sku), ["NB2-C-NM"]);
    assert.equal(p1.body.next, undefined);
  });

  it("namespaces are isolated, and so are a namespace's two sellers", async () => {
    const stranger = (await connect(fake, "flow-other")).access;
    assert.equal((await ebay(fake, "GET", `${INV}/inventory_item/NB2-a-NM`, { token: stranger })).status, 404);
    const alt = (await connect(fake, NS, "alt")).access;
    assert.equal((await ebay(fake, "GET", `${INV}/inventory_item/NB2-a-NM`, { token: alt })).status, 404);
    assert.equal((await ebay(fake, "GET", `${INV}/inventory_item/NB2-a-NM`, { token: tok })).status, 200);
  });

  it("/__fake/reset clears the seller's eBay state with the rest of the run", async () => {
    assert.equal((await fake.call("POST", "/__fake/reset", { body: { ns: NS } })).status, 200);
    assert.equal((await ebay(fake, "GET", `${INV}/inventory_item/NB2-a-NM`, { token: tok })).status, 404);
    assert.deepEqual((await ebay(fake, "GET", `${ACC}/program/get_opted_in_programs`, { token: tok })).body, { programs: [] });
  });

  it("a seller call with no token, or a BSC token, is eBay's 401", async () => {
    const none = await ebay(fake, "GET", `${ACC}/program/get_opted_in_programs`);
    assert.equal(none.status, 401);
    assert.equal(none.body.errors[0].errorId, 1001);
    assert.equal((await ebay(fake, "GET", `${ACC}/program/get_opted_in_programs`, { token: "tok-flow-ns-w0" })).status, 401);
  });
});

describe("fake eBay: media (row 8)", () => {
  let fake;
  let tok;
  before(async () => {
    fake = await startFake();
    tok = (await connect(fake, "media-ns")).access;
  });
  after(() => fake.close());

  const JPEG = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");
  const multipart = (name, bytes) => {
    const b = "nbtestboundary";
    return {
      contentType: `multipart/form-data; boundary=${b}`,
      raw: Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${name}"; filename="front.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), bytes, Buffer.from(`\r\n--${b}--\r\n`)]),
    };
  };

  it("answers 201 with a Location on the fake and an image URL on an NB host, never an eBay one", async () => {
    const up = await ebay(fake, "POST", "/ebay/apim/commerce/media/v1_beta/image/create_image_from_file", { token: tok, ...multipart("image", JPEG) });
    assert.equal(up.status, 201);
    const loc = up.headers.get("location");
    const id = /\/commerce\/media\/v1_beta\/image\/([^/?#]{1,256})\/?$/.exec(loc)?.[1];
    assert.ok(id, "NB parses the id from the Location header");
    assert.ok(loc.startsWith("/ebay/apim/"));
    const url = new URL(up.body.imageUrl);
    assert.equal(url.protocol, "https:");
    assert.equal(url.hostname, "www.neonbinder.io");
    assert.ok(up.body.imageUrl.length <= 500);
    assert.ok(!Number.isNaN(Date.parse(up.body.expirationDate)));
    const got = await ebay(fake, "GET", `/ebay/apim/commerce/media/v1_beta/image/${id}`, { token: tok });
    assert.equal(got.body.imageUrl, up.body.imageUrl);
    assert.equal((await ebay(fake, "GET", "/ebay/apim/commerce/media/v1_beta/image/nope", { token: tok })).status, 404);
  });

  it("refuses an upload with no image part, or bytes that are not a picture", async () => {
    const wrongPart = await ebay(fake, "POST", "/ebay/apim/commerce/media/v1_beta/image/create_image_from_file", { token: tok, ...multipart("file", JPEG) });
    assert.equal(wrongPart.status, 400);
    assert.equal(wrongPart.body.errors[0].errorId, 190202);
    const notImage = await ebay(fake, "POST", "/ebay/apim/commerce/media/v1_beta/image/create_image_from_file", { token: tok, ...multipart("image", Buffer.from("hello")) });
    assert.equal(notImage.status, 400);
  });

  it("refuses a body past the media limit with 413", async () => {
    const big = await ebay(fake, "POST", "/ebay/apim/commerce/media/v1_beta/image/create_image_from_file", { token: tok, ...multipart("image", Buffer.alloc(4 * 1024 * 1024 + 70 * 1024, 0xff)) });
    assert.equal(big.status, 413);
  });
});

describe("fake eBay: recorded rows 5 and 7, misses and the recorders", () => {
  let fake;
  before(async () => (fake = await startFake()));
  after(() => fake.close());

  const SHIP = "/ebay/api/sell/metadata/v1/shipping/marketplace/EBAY_US/get_shipping_services";
  const ASPECTS = "/ebay/api/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category?category_id=261328";

  it("an unrecorded read is a 501 catalogue miss owned by the token's namespace, replayable by the eBay recorder only", async () => {
    const { access } = await connect(fake, "rec-ns-w0");
    const r = await ebay(fake, "GET", SHIP, { token: access });
    assert.equal(r.status, 501);
    assert.equal(r.headers.get("x-nb-fake"), "unrecorded");
    const misses = (await fake.call("GET", "/__fake/misses?ns=rec-ns-w0")).body.misses;
    const m = misses.find((x) => x.kind === "catalogue");
    assert.equal(m.endpoint, "ebayShippingServices");
    assert.equal(replayRefusal(m.request), null);
    const plan = planMisses([m]);
    assert.equal(plan.todo.length, 0, "the BSC recorder never sends an eBay request to BSC");
    assert.match(plan.refused[0].label, /not_a_bsc_request/);
  });

  it("a request NB never makes is a miss the recorder may not replay", async () => {
    const app = await appToken(fake);
    const r = await ebay(fake, "GET", "/ebay/api/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category?category_id=1", { token: app, extra: { "x-nb-fake-ns": "rec-ns-w1" } });
    assert.equal(r.status, 501);
    const m = (await fake.call("GET", "/__fake/misses?ns=rec-ns-w1")).body.misses[0];
    assert.equal(replayRefusal(m.request), "ebay_query_not_pinned");
  });

  it("replays a recording to a user token or an app token", async () => {
    const up = await fake.call("POST", "/__fake/recordings", {
      email: LOADER,
      admin: true,
      body: {
        recordings: [
          {
            request: { method: "GET", path: "ebay/api/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category", query: [["category_id", "261328"]] },
            response: { status: 200, body: { aspects: [{ localizedAspectName: "Sport", aspectConstraint: { aspectRequired: true, aspectMaxLength: 65 } }] } },
          },
        ],
      },
    });
    assert.equal(up.status, 200, JSON.stringify(up.body));
    const app = await appToken(fake);
    const viaApp = await ebay(fake, "GET", ASPECTS, { token: app });
    assert.equal(viaApp.status, 200);
    assert.equal(viaApp.body.aspects[0].localizedAspectName, "Sport");
    const { access } = await connect(fake, "rec-ns-w2");
    assert.equal((await ebay(fake, "GET", ASPECTS, { token: access })).status, 200);
    assert.equal((await ebay(fake, "GET", ASPECTS)).status, 401);
  });

  it("refuses a recording with a field outside the allowlist (aspect values are not kept)", async () => {
    const up = await fake.call("POST", "/__fake/recordings", {
      email: LOADER,
      admin: true,
      body: {
        recordings: [
          {
            request: { method: "GET", path: "ebay/api/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category", query: [["category_id", "261328"]] },
            response: { status: 200, body: { aspects: [{ localizedAspectName: "Player/Athlete", aspectValues: [{ localizedValue: "Someone" }] }] } },
          },
        ],
      },
    });
    assert.equal(up.status, 400);
    assert.ok(up.body.droppedPaths.some((p) => p.includes("aspectValues")));
  });

  it("an unmodelled eBay path is a needs-model miss naming only a safe template, never the literal path", async () => {
    const { access } = await connect(fake, "rec-ns-w3");
    const r = await ebay(fake, "GET", "/ebay/api/sell/inventory/v1/inventory_item_group/SECRET-SKU-123", { token: access });
    assert.equal(r.status, 501);
    const m = (await fake.call("GET", "/__fake/misses?ns=rec-ns-w3")).body.misses[0];
    assert.equal(m.kind, "needs-model");
    assert.ok(!m.path.includes("SECRET-SKU-123"), m.path);
  });

  it("the request log names the route template, never a SKU", async () => {
    const lines = [];
    setLogSink((l) => lines.push(typeof l === "string" ? l : JSON.stringify(l)));
    const { access } = await connect(fake, "rec-ns-w4");
    await ebay(fake, "GET", `${INV}/inventory_item/NB2-LOGSKU-NM`, { token: access });
    await new Promise((r) => setTimeout(r, 20));
    setLogSink(() => {});
    const text = lines.join("\n");
    assert.ok(text.includes("ebay/api/sell/inventory/v1/inventory_item/:sku"), text);
    assert.ok(!text.includes("NB2-LOGSKU-NM"));
  });
});

describe("fake eBay: faults", () => {
  let fake;
  let tok;
  const NS = "fault-ns-w0";
  before(async () => {
    fake = await startFake();
    tok = (await connect(fake, NS)).access;
  });
  after(() => fake.close());

  const faults = (rules) => fake.call("POST", "/__fake/faults", { body: { ns: NS, rules } });

  it("ebayError answers eBay's body with the given ids; on a bulk path, per entry", async () => {
    assert.equal((await faults([{ match: { method: "POST", pathTemplate: "ebay/api/sell/inventory/v1/offer/:offerId/publish" }, kind: "ebayError", status: 400, errorIds: [25002], times: 1 }])).status, 200);
    const r = await ebay(fake, "POST", `${INV}/offer/123/publish`, { token: tok });
    assert.equal(r.status, 400);
    assert.equal(r.body.errors[0].errorId, 25002);
    // times: 1, so the next is the real (here: no such offer) answer.
    assert.equal((await ebay(fake, "POST", `${INV}/offer/123/publish`, { token: tok })).body.errors[0].errorId, 25713);
    await faults([{ match: { method: "POST", pathTemplate: "ebay/api/sell/inventory/v1/bulk_create_offer" }, kind: "ebayError", status: 400, errorIds: [25007, 25001] }]);
    const bulk = await ebay(fake, "POST", `${INV}/bulk_create_offer`, { token: tok, body: { requests: [{ sku: "A" }, { sku: "B" }] } });
    assert.equal(bulk.status, 400);
    assert.deepEqual(bulk.body.responses.map((e) => e.sku), ["A", "B"]);
    assert.deepEqual(bulk.body.responses[1].errors.map((e) => e.errorId), [25007, 25001]);
  });

  it("unauthorized answers 401 for `times`, then the call goes through (NB refreshes and retries)", async () => {
    await faults([{ match: { method: "*", pathTemplate: "ebay/api/sell/*" }, kind: "unauthorized", times: 1 }]);
    const first = await ebay(fake, "GET", `${ACC}/program/get_opted_in_programs`, { token: tok });
    assert.equal(first.status, 401);
    assert.equal(first.body.errors[0].errorId, 1001);
    assert.equal((await ebay(fake, "GET", `${ACC}/program/get_opted_in_programs`, { token: tok })).status, 200);
  });

  it("the existing kinds work on eBay templates", async () => {
    await faults([{ match: { method: "GET", pathTemplate: "ebay/apiz/commerce/identity/v1/user" }, kind: "429", retryAfterS: 3, times: 1 }]);
    const r = await ebay(fake, "GET", "/ebay/apiz/commerce/identity/v1/user/", { token: tok });
    assert.equal(r.status, 429);
    assert.equal(r.headers.get("retry-after"), "3");
  });

  it("eBay-only kinds are refused on a BSC template, and ebayError needs a status and ids", async () => {
    assert.equal((await faults([{ match: { method: "GET", pathTemplate: "marketplace/user/profile" }, kind: "unauthorized" }])).status, 400);
    assert.equal((await faults([{ match: { method: "GET", pathTemplate: "ebay/api/x" }, kind: "ebayError", status: 200, errorIds: [1] }])).status, 400);
    assert.equal((await faults([{ match: { method: "GET", pathTemplate: "ebay/api/x" }, kind: "ebayError", status: 400, errorIds: [] }])).status, 400);
    assert.equal((await faults([{ match: { method: "GET", pathTemplate: "ebay/api/x" }, kind: "429", errorIds: [1] }])).status, 400);
  });

  it("an app-token call is scoped by x-nb-fake-ns", async () => {
    await faults([{ match: { method: "POST", pathTemplate: "ebay/api/identity/v1/oauth2/token" }, kind: "503", times: 1 }]);
    const hit = await ebay(fake, "POST", "/ebay/api/identity/v1/oauth2/token", { form: { grant_type: "client_credentials" }, extra: { authorization: BASIC, "x-nb-fake-ns": NS } });
    assert.equal(hit.status, 503);
    const unscoped = await ebay(fake, "POST", "/ebay/api/identity/v1/oauth2/token", { form: { grant_type: "client_credentials" }, extra: { authorization: BASIC } });
    assert.equal(unscoped.status, 200);
  });
});

describe("fake eBay: captures", () => {
  let fake;
  before(async () => (fake = await startFake()));
  after(() => fake.close());

  it("accepts every eBay capture name, checks it against the fake's answer, and never makes one required", async () => {
    const synth = require("../dist/src/ebay/captures.js").ebaySynthesisedCapture;
    for (const endpoint of EBAY_CAPTURE_ENDPOINTS) {
      const s = synth(endpoint);
      const r = await fake.call("POST", "/__fake/write-captures", { email: LOADER, admin: true, body: { endpoint, status: s.status, shape: s.shape } });
      assert.equal(r.status, 200, endpoint);
      assert.equal(r.body.verdict, "ok", `${endpoint}: ${r.body.paths}`);
    }
    const health = await fake.call("GET", "/__fake/health");
    assert.deepEqual(health.body.writeCaptures.missing, ["PUT seller/bulk-upload", "POST common/card/undefined/product/undefined/attachment"]);
  });

  it("flags a capture whose shape lacks a path the fake answers with", async () => {
    const r = await fake.call("POST", "/__fake/write-captures", {
      email: LOADER,
      admin: true,
      body: { endpoint: "POST ebay/api/sell/inventory/v1/offer/:offerId/publish", status: 200, shape: { "": ["object"], warnings: ["array"] } },
    });
    assert.equal(r.body.verdict, "shape_drift");
    assert.deepEqual(r.body.paths, ["listingId"]);
  });

  it("refuses an eBay name it does not know", async () => {
    const r = await fake.call("POST", "/__fake/write-captures", { email: LOADER, admin: true, body: { endpoint: "POST ebay/api/sell/inventory/v1/nope", status: 200, shape: { "": ["object"] } } });
    assert.equal(r.status, 400);
  });

  it("keeps eBay captures across a restart", async () => {
    const restarted = await startFake({ store: fake.store });
    try {
      const list = await restarted.call("GET", "/__fake/write-captures", { email: LOADER, admin: true });
      assert.ok(list.body.captures.some((c) => c.endpoint === "GET ebay/api/sell/fulfillment/v1/order"));
    } finally {
      await restarted.close();
    }
  });
});
