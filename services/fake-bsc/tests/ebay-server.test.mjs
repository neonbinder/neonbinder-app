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

// ── Adversarial pass (NEO-555 PR A): isolation between namespaces and sellers ──

describe("fake eBay tokens (adversarial): sealed, typed, expiring, instance-bound", () => {
  const { createEbayTokens, ACCESS_TOKEN_TTL_S, REFRESH_TOKEN_TTL_S, AUTH_CODE_TTL_S, APP_TOKEN_TTL_S } = require("../dist/src/ebay/tokens.js");
  const U = { ns: "tok-adv-a", seller: "alt" };

  const make = (t) => {
    const clock = { t };
    return { clock, tokens: createEbayTokens({ secret: "s".repeat(40), now: () => clock.t }) };
  };

  it("each token kind opens only its own door", () => {
    const { tokens } = make(1_000_000);
    const { accessToken, refreshToken } = tokens.mintUserTokens(U);
    const code = tokens.mintCode(U).code;
    const app = tokens.mintApp();
    const kinds = { access: accessToken, refresh: refreshToken, code, app };
    const doors = {
      access: (t) => tokens.userForAccess(t) !== null,
      refresh: (t) => tokens.userForRefresh(t) !== null,
      app: (t) => tokens.isApp(t),
    };
    assert.deepEqual(Object.entries(doors).map(([d, f]) => [d, Object.entries(kinds).filter(([, t]) => f(t)).map(([k]) => k)]), [
      ["access", ["access"]],
      ["refresh", ["refresh"]],
      ["app", ["app"]],
    ]);
    assert.deepEqual(tokens.userForAccess(`Bearer ${accessToken}`), U, "the Bearer form opens the same door");
    assert.equal(tokens.redeemCode(accessToken), null);
    assert.deepEqual(tokens.redeemCode(code), U);
  });

  it("expires at the second: access 2 h, code 5 min, app 2 h, refresh about 18 months", () => {
    const { tokens, clock } = make(1_000_000);
    const t0 = clock.t;
    const { accessToken, refreshToken } = tokens.mintUserTokens(U);
    const code = tokens.mintCode(U).code;
    const app = tokens.mintApp();
    clock.t = t0 + AUTH_CODE_TTL_S * 1000 - 1;
    assert.notEqual(tokens.redeemCode(code), null);
    clock.t = t0 + ACCESS_TOKEN_TTL_S * 1000 - 1;
    assert.notEqual(tokens.userForAccess(accessToken), null);
    assert.equal(tokens.isApp(app), true);
    clock.t = t0 + ACCESS_TOKEN_TTL_S * 1000;
    assert.equal(tokens.userForAccess(accessToken), null);
    assert.equal(APP_TOKEN_TTL_S, ACCESS_TOKEN_TTL_S);
    assert.equal(tokens.isApp(app), false);
    clock.t = t0 + REFRESH_TOKEN_TTL_S * 1000 - 1;
    assert.notEqual(tokens.userForRefresh(refreshToken), null);
    clock.t = t0 + REFRESH_TOKEN_TTL_S * 1000;
    assert.equal(tokens.userForRefresh(refreshToken), null);
    const expired = make(5_000_000);
    const c = expired.tokens.mintCode(U).code;
    expired.clock.t += AUTH_CODE_TTL_S * 1000;
    assert.equal(expired.tokens.redeemCode(c), null);
  });

  it("a token from another instance (other key) is worthless, and so is any single flipped character", () => {
    const a = make(1_000_000).tokens;
    const b = createEbayTokens({ secret: "z".repeat(40), now: () => 1_000_000 });
    const { accessToken } = a.mintUserTokens(U);
    assert.equal(b.userForAccess(accessToken), null);
    const head = "v^1.1#fake#";
    for (let i = 0; i < accessToken.length - head.length; i += 7) {
      const at = head.length + i;
      const flipped = accessToken.slice(0, at) + (accessToken[at] === "A" ? "B" : "A") + accessToken.slice(at + 1);
      assert.equal(a.userForAccess(flipped), null, `flip at ${at}`);
    }
    assert.equal(a.userForAccess(`${accessToken}${"A".repeat(5000)}`), null);
    assert.equal(a.userForAccess(accessToken.slice(0, -1)), null);
    for (const junk of [undefined, null, "", "Bearer", "Bearer ", "v^1.1#fake#", "v^1.1#fake#AAAA"]) assert.equal(a.userForAccess(junk), null);
  });

  it("a code is single use even when redeemed at the same instant, and revokeAll kills every kind", () => {
    const { tokens } = make(1_000_000);
    const code = tokens.mintCode(U).code;
    assert.equal([tokens.redeemCode(code), tokens.redeemCode(code)].filter(Boolean).length, 1);
    const { accessToken, refreshToken } = tokens.mintUserTokens(U);
    const app = tokens.mintApp();
    const unspent = tokens.mintCode(U).code;
    tokens.revokeAll();
    assert.equal(tokens.userForAccess(accessToken), null);
    assert.equal(tokens.userForRefresh(refreshToken), null);
    assert.equal(tokens.isApp(app), false);
    assert.equal(tokens.redeemCode(unspent), null);
  });
});

describe("fake eBay (adversarial): namespaces and the alt seller stay apart", () => {
  let fake;
  before(async () => (fake = await startFake()));
  after(() => fake.close());

  const mkItem = (sku) => item(sku, { availability: { shipToLocationAvailability: { quantity: 1 } } });
  const put = (tok, sku) => ebay(fake, "POST", `${INV}/bulk_create_or_replace_inventory_item`, { token: tok, body: { requests: [mkItem(sku)] } });

  it("x-nb-fake-ns never re-points a user token: reads and writes stay in the token's own namespace", async () => {
    const a = (await connect(fake, "adv-iso-a")).access;
    const b = (await connect(fake, "adv-iso-b")).access;
    assert.equal((await put(b, "NB2-b-only-NM")).status, 200);
    const spoof = { "x-nb-fake-ns": "adv-iso-b" };
    assert.equal((await ebay(fake, "GET", `${INV}/inventory_item/NB2-b-only-NM`, { token: a, extra: spoof })).status, 404, "A with B's header saw B's item");
    assert.equal((await put(a, "NB2-a-spoof-NM")).status, 200);
    assert.equal((await ebay(fake, "GET", `${INV}/inventory_item/NB2-a-spoof-NM`, { token: b })).status, 404);
    // The spoofing write went to A, whichever header rode along.
    assert.equal((await ebay(fake, "POST", `${INV}/bulk_create_or_replace_inventory_item`, { token: a, extra: spoof, body: { requests: [mkItem("NB2-a-header-NM")] } })).status, 200);
    assert.equal((await ebay(fake, "GET", `${INV}/inventory_item/NB2-a-header-NM`, { token: a })).status, 200);
    assert.equal((await ebay(fake, "GET", `${INV}/inventory_item/NB2-a-header-NM`, { token: b })).status, 404);
    // Nor do misses: an unmodelled call by A with B's header is A's miss, not B's.
    await ebay(fake, "GET", `${INV}/never_modelled_path`, { token: a, extra: spoof });
    const forB = await fake.call("GET", "/__fake/misses?ns=adv-iso-b");
    assert.ok(!JSON.stringify(forB.body).includes("never_modelled_path"));
  });

  it("a fault set for one namespace never hits another's token, spoofed header or not, and cannot be dodged by one", async () => {
    const a = (await connect(fake, "adv-flt-a")).access;
    const b = (await connect(fake, "adv-flt-b")).access;
    const rule = { match: { method: "GET", pathTemplate: "ebay/apiz/commerce/identity/v1/user" }, kind: "429", times: 5 };
    assert.equal((await fake.call("POST", "/__fake/faults", { body: { ns: "adv-flt-b", rules: [rule] } })).status, 200);
    const me = (tok, extra = {}) => ebay(fake, "GET", "/ebay/apiz/commerce/identity/v1/user/", { token: tok, extra });
    assert.equal((await me(a)).status, 200);
    assert.equal((await me(a, { "x-nb-fake-ns": "adv-flt-b" })).status, 200, "a header must not pull in B's fault");
    assert.equal((await me(b, { "x-nb-fake-ns": "adv-flt-a" })).status, 429, "a header must not dodge B's own fault");
    assert.equal((await me(b, { "x-nb-fake-ns": "adv-flt-b-" })).status, 429);
  });

  it("the alt seller shares nothing with main: policies, items, offers, orders, images and ids", async () => {
    const NS = "adv-alt-ns";
    const main = (await connect(fake, NS)).access;
    const alt = (await connect(fake, NS, "alt")).access;
    const pol = await setUpSeller(fake, NS, main);
    assert.equal((await put(main, "NB2-main-NM")).status, 200);
    const off = await ebay(fake, "POST", `${INV}/bulk_create_offer`, { token: main, body: { requests: [offer("NB2-main-NM", pol)] } });
    const offerId = off.body.responses[0].offerId;
    assert.ok(offerId);
    assert.equal((await fake.call("POST", "/__fake/ebay/orders", { body: { ns: NS, order: { lines: [{ title: "main only", quantity: 1, priceCents: 100 }] } } })).status, 200);

    const total = async (tok, path) => (await ebay(fake, "GET", path, { token: tok })).body;
    assert.equal((await total(alt, `${ACC}/payment_policy?marketplace_id=EBAY_US`)).total, 0);
    assert.equal((await total(alt, `${ACC}/fulfillment_policy?marketplace_id=EBAY_US`)).total, 0);
    assert.deepEqual(await total(alt, `${ACC}/program/get_opted_in_programs`), { programs: [] });
    assert.equal((await ebay(fake, "GET", `${INV}/location/neonbinder-main`, { token: alt })).status, 404);
    assert.equal((await ebay(fake, "GET", `${INV}/inventory_item/NB2-main-NM`, { token: alt })).status, 404);
    assert.equal((await ebay(fake, "GET", `${INV}/offer?sku=NB2-main-NM&marketplace_id=EBAY_US&format=FIXED_PRICE&limit=5`, { token: alt })).status, 404);
    assert.equal((await total(alt, `/ebay/api/sell/fulfillment/v1/order?filter=${encodeURIComponent(NB_FILTER)}&limit=100&offset=0`)).total, 0);
    // Main's offer id, presented by alt, is not an offer at all; main's still is.
    const pub = await ebay(fake, "POST", `${INV}/offer/${offerId}/publish`, { token: alt });
    assert.equal(pub.status, 404);
    assert.equal((await ebay(fake, "POST", `${INV}/offer/${offerId}/withdraw`, { token: alt })).status, 404);
    assert.equal((await ebay(fake, "DELETE", `${INV}/inventory_item/NB2-main-NM`, { token: alt })).status, 404);
    assert.equal((await ebay(fake, "GET", `${INV}/inventory_item/NB2-main-NM`, { token: main })).status, 200, "alt's delete touched main's item");
    // The other way: alt's writes never appear on main.
    assert.equal((await put(alt, "NB2-alt-NM")).status, 200);
    assert.equal((await ebay(fake, "GET", `${INV}/inventory_item/NB2-alt-NM`, { token: main })).status, 404);
  });

  it("a refresh token keeps its seller: alt refreshes to alt, never to main, and the app token has no seller", async () => {
    const NS = "adv-refresh-ns";
    const main = await connect(fake, NS);
    const alt = await connect(fake, NS, "alt");
    const idOf = async (access) => (await ebay(fake, "GET", "/ebay/apiz/commerce/identity/v1/user/", { token: access })).body.userId;
    const refreshed = await token(fake, { grant_type: "refresh_token", refresh_token: alt.refresh });
    assert.equal(refreshed.status, 200);
    assert.equal(await idOf(refreshed.body.access_token), await idOf(alt.access));
    assert.notEqual(await idOf(refreshed.body.access_token), await idOf(main.access));
  });

  it("the consent door takes only main or alt, and a namespace named like an Object member pollutes nothing", async () => {
    for (const seller of ["__proto__", "constructor", "ALT", " alt", "alt ", "main,alt", 1, null, [], {}]) {
      const r = await fake.call("POST", "/__fake/ebay/consent", { body: { ns: "adv-bad-seller", seller } });
      assert.equal(r.status, 400, JSON.stringify(seller));
    }
    for (const ns of ["__proto__", "Adv-Upper", "a b", "a/b", "../x", "", "x".repeat(101), 7, null]) {
      assert.equal((await fake.call("POST", "/__fake/ebay/consent", { body: { ns } })).status, 400, JSON.stringify(ns));
    }
    const odd = (await connect(fake, "constructor")).access;
    assert.equal((await ebay(fake, "GET", "/ebay/apiz/commerce/identity/v1/user/", { token: odd })).status, 200);
    assert.equal({}.ebay, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, "main"), false);
    const other = (await connect(fake, "adv-clean")).access;
    assert.deepEqual((await ebay(fake, "GET", `${ACC}/program/get_opted_in_programs`, { token: other })).body, { programs: [] });
  });

  it("a code redeemed by six simultaneous requests yields one token set", async () => {
    const c = await fake.call("POST", "/__fake/ebay/consent", { body: { ns: "adv-race" } });
    const results = await Promise.all(
      Array.from({ length: 6 }, () => token(fake, { grant_type: "authorization_code", code: c.body.code, redirect_uri: "nb-ru" })),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400, 400, 400, 400, 400]);
  });

  it("eBay tokens open nothing on the BSC API, and a refresh or auth-code string is no bearer token", async () => {
    const { access, refresh } = await connect(fake, "adv-cross");
    for (const t of [access, refresh]) {
      assert.equal((await fake.call("GET", "/api/marketplace/user/profile", { bsc: t })).status, 401);
    }
    const c = (await fake.call("POST", "/__fake/ebay/consent", { body: { ns: "adv-cross" } })).body.code;
    assert.equal((await ebay(fake, "GET", `${ACC}/program/get_opted_in_programs`, { token: refresh })).status, 401);
    assert.equal((await ebay(fake, "GET", `${ACC}/program/get_opted_in_programs`, { token: c })).status, 401);
  });

  it("the control door needs the caller headers: no key, no consent", async () => {
    const res = await fetch(`${fake.base}/__fake/ebay/consent`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ns: "adv-nokey" }) });
    assert.ok(res.status === 401 || res.status === 403);
  });
});

// ── Audit round (NEO-555): every error id and cap the synthesis answers ─────

describe("fake eBay (audit): error ids and caps", () => {
  const { MAX_LOCATIONS, MAX_ITEMS, MAX_STORED_JSON_BYTES, sellerOf } = require("../dist/src/ebay/state.js");
  let fake;
  let tok;
  let policies;
  const NS = "errtable-ns";
  before(async () => {
    fake = await startFake();
    tok = (await connect(fake, NS)).access;
    await ebay(fake, "POST", `${ACC}/program/opt_in`, { token: tok, body: { programType: "SELLING_POLICY_MANAGEMENT" } });
    policies = await setUpSeller(fake, NS, tok);
    assert.equal((await ebay(fake, "POST", `${INV}/bulk_create_or_replace_inventory_item`, { token: tok, body: { requests: [item("NB2-err-NM")] } })).status, 200);
  });
  after(() => fake.close());

  /** Asserts eBay's status and first error id. */
  const refused = (r, status, errorId, what) => {
    assert.equal(r.status, status, `${what}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.errors[0].errorId, errorId, what);
  };
  /** A bulk answer: whole status, then the first entry's status and error id. */
  const refusedEntry = (r, errorId, what) => {
    assert.equal(r.status, 400, `${what}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.responses[0].statusCode, 400, what);
    assert.equal(r.body.responses[0].errors[0].errorId, errorId, what);
  };

  it("20409: a second opt_in", async () => {
    refused(await ebay(fake, "POST", `${ACC}/program/opt_in`, { token: tok, body: { programType: "SELLING_POLICY_MANAGEMENT" } }), 409, 20409, "opt_in again");
  });

  it("25710: GET and DELETE of an item that does not exist; 25713: an offer that does not exist", async () => {
    refused(await ebay(fake, "GET", `${INV}/inventory_item/NB2-nope-NM`, { token: tok }), 404, 25710, "GET item");
    refused(await ebay(fake, "DELETE", `${INV}/inventory_item/NB2-nope-NM`, { token: tok }), 404, 25710, "DELETE item");
    const { sku: _s, marketplaceId: _m, format: _f, ...update } = offer("NB2-err-NM", policies);
    refused(await ebay(fake, "PUT", `${INV}/offer/4040404040`, { token: tok, body: update }), 404, 25713, "PUT offer");
    refused(await ebay(fake, "POST", `${INV}/offer/4040404040/publish`, { token: tok }), 404, 25713, "publish");
    refused(await ebay(fake, "POST", `${INV}/offer/4040404040/withdraw`, { token: tok }), 404, 25713, "withdraw");
    refused(await ebay(fake, "GET", `${INV}/offer?sku=NB2-nope-NM`, { token: tok }), 404, 25713, "GET offer?sku=");
  });

  it("25804: GET, update and enable of a location that does not exist", async () => {
    const { merchantLocationStatus: _s, ...details } = LOCATION;
    refused(await ebay(fake, "GET", `${INV}/location/no-such-loc`, { token: tok }), 404, 25804, "GET location");
    refused(await ebay(fake, "POST", `${INV}/location/no-such-loc/update_location_details`, { token: tok, body: details }), 404, 25804, "update");
    refused(await ebay(fake, "POST", `${INV}/location/no-such-loc/enable`, { token: tok }), 404, 25804, "enable");
  });

  it("190011: an image that does not exist; 195000: a public key that does not exist", async () => {
    refused(await ebay(fake, "GET", "/ebay/apim/commerce/media/v1_beta/image/fakenope", { token: tok }), 404, 190011, "image");
    const app = await appToken(fake);
    refused(await ebay(fake, "GET", "/ebay/api/commerce/notification/v1/public_key/other-kid", { token: app }), 404, 195000, "public key");
  });

  it("MAX_LOCATIONS: the 21st location is refused 25709, an update of an existing one is not", async () => {
    const own = (await connect(fake, "errtable-locs")).access;
    for (let i = 0; i < MAX_LOCATIONS; i++) assert.equal((await ebay(fake, "POST", `${INV}/location/loc-${i}`, { token: own, body: LOCATION })).status, 204, `location ${i}`);
    refused(await ebay(fake, "POST", `${INV}/location/loc-${MAX_LOCATIONS}`, { token: own, body: LOCATION }), 400, 25709, "21st location");
    const { merchantLocationStatus: _s, ...details } = LOCATION;
    assert.equal((await ebay(fake, "POST", `${INV}/location/loc-0/update_location_details`, { token: own, body: details })).status, 204);
  });

  it("MAX_ITEMS: a new SKU past the cap is refused 25709 per entry; replacing a held SKU still works", async () => {
    const own = (await connect(fake, "errtable-items")).access;
    const s = sellerOf(fake.state.get("errtable-items"), "main");
    const held = { locale: "en_US", condition: "USED_VERY_GOOD", conditionDescriptors: null, quantity: 1, product: { title: "t", description: "", aspects: {}, imageUrls: ["https://www.neonbinder.io/x.jpg"] }, packageWeightAndSize: null };
    for (let i = 0; i < MAX_ITEMS; i++) s.items.set(`SEED-${i}`, { ...held, sku: `SEED-${i}` });
    assert.equal(s.items.size, MAX_ITEMS);
    const r = await ebay(fake, "POST", `${INV}/bulk_create_or_replace_inventory_item`, { token: own, body: { requests: [item("SEED-0"), item("NB2-over-NM")] } });
    assert.equal(r.status, 207);
    assert.equal(r.body.responses[0].statusCode, 200, "a held SKU is replaced");
    assert.equal(r.body.responses[1].statusCode, 400);
    assert.equal(r.body.responses[1].errors[0].errorId, 25709);
    assert.equal(s.items.size, MAX_ITEMS);
  });

  it("pagination: limit 0, limit 201 and a negative page are 25709 on inventory_item and offer", async () => {
    for (const q of ["limit=0", "limit=201", "offset=-1", "limit=1.5", "offset=x"]) {
      refused(await ebay(fake, "GET", `${INV}/inventory_item?${q}`, { token: tok }), 400, 25709, `inventory_item?${q}`);
    }
    for (const q of ["limit=0", "limit=201"]) refused(await ebay(fake, "GET", `${INV}/offer?sku=NB2-err-NM&${q}`, { token: tok }), 400, 25709, `offer?${q}`);
    refused(await ebay(fake, "GET", `${INV}/offer`, { token: tok }), 400, 25709, "offer with no sku");
    assert.equal((await ebay(fake, "GET", `${INV}/inventory_item?limit=200&offset=0`, { token: tok })).status, 200, "the bounds themselves are accepted");
  });

  it("25709 on every item-validation branch, per entry", async () => {
    const big = (n) => "x".repeat(n);
    const cases = [
      ["an http:// picture", item("NB2-v1-NM", { product: { title: "t", imageUrls: ["http://www.neonbinder.io/x.jpg"] } })],
      ["a data: picture", item("NB2-v1-NM", { product: { title: "t", imageUrls: ["data:image/jpeg;base64,AAAA"] } })],
      ["25 pictures", item("NB2-v1-NM", { product: { title: "t", imageUrls: Array.from({ length: 25 }, () => "https://www.neonbinder.io/x.jpg") } })],
      ["a title of 81 characters", item("NB2-v1-NM", { product: { title: big(81), imageUrls: ["https://www.neonbinder.io/x.jpg"] } })],
      ["no title", item("NB2-v1-NM", { product: { imageUrls: ["https://www.neonbinder.io/x.jpg"] } })],
      ["quantity -1", item("NB2-v1-NM", { availability: { shipToLocationAvailability: { quantity: -1 } } })],
      ["quantity 100001", item("NB2-v1-NM", { availability: { shipToLocationAvailability: { quantity: 100_001 } } })],
      ["quantity 1.5", item("NB2-v1-NM", { availability: { shipToLocationAvailability: { quantity: 1.5 } } })],
      ["no condition", item("NB2-v1-NM", { condition: undefined })],
      ["a SKU with a space", item("NB2 v1 NM")],
      ["a SKU of 51 characters", item(big(51))],
      ["an aspect value of 66 characters", item("NB2-v1-NM", { product: { title: "t", aspects: { Sport: [big(66)] }, imageUrls: ["https://www.neonbinder.io/x.jpg"] } })],
      ["conditionDescriptors not a list", item("NB2-v1-NM", { conditionDescriptors: { name: "40001" } })],
      ["packageWeightAndSize not an object", item("NB2-v1-NM", { packageWeightAndSize: [1] })],
    ];
    for (const [what, entry] of cases) {
      refusedEntry(await ebay(fake, "POST", `${INV}/bulk_create_or_replace_inventory_item`, { token: tok, body: { requests: [entry] } }), 25709, what);
    }
    refused(await ebay(fake, "POST", `${INV}/bulk_create_or_replace_inventory_item`, { token: tok, body: { requests: [] } }), 400, 25709, "no requests");
    refused(await ebay(fake, "POST", `${INV}/bulk_create_or_replace_inventory_item`, { token: tok, body: { requests: "x" } }), 400, 25709, "requests not a list");
  });

  it("25709 on every offer-validation branch, per entry, and on the PUT", async () => {
    const without = (o, ...keys) => {
      const c = structuredClone(o);
      for (const k of keys) delete c.listingPolicies[k];
      return c;
    };
    const base = offer("NB2-err-NM", policies);
    const cases = [
      ["marketplaceId EBAY_GB", { ...base, marketplaceId: "EBAY_GB" }],
      ["format AUCTION", { ...base, format: "AUCTION" }],
      ["no marketplaceId", { ...base, marketplaceId: undefined }],
      ["price in EUR", { ...base, pricingSummary: { price: { value: "12.50", currency: "EUR" } } }],
      ["price with three decimals", { ...base, pricingSummary: { price: { value: "12.505", currency: "USD" } } }],
      ["price as a number", { ...base, pricingSummary: { price: { value: 12.5, currency: "USD" } } }],
      ["listingDuration DAYS_7", { ...base, listingDuration: "DAYS_7" }],
      ["no fulfillmentPolicyId", without(base, "fulfillmentPolicyId")],
      ["no paymentPolicyId", without(base, "paymentPolicyId")],
      ["no returnPolicyId", without(base, "returnPolicyId")],
      ["no listingPolicies", { ...base, listingPolicies: undefined }],
      ["availableQuantity -1", { ...base, availableQuantity: -1 }],
      ["a categoryId that is not digits", { ...base, categoryId: "abc" }],
      ["no merchantLocationKey", { ...base, merchantLocationKey: undefined }],
    ];
    for (const [what, entry] of cases) {
      refusedEntry(await ebay(fake, "POST", `${INV}/bulk_create_offer`, { token: tok, body: { requests: [JSON.parse(JSON.stringify(entry))] } }), 25709, what);
    }
    // The PUT checks the same fields (an offer must exist first).
    const made = await ebay(fake, "POST", `${INV}/bulk_create_offer`, { token: tok, body: { requests: [base] } });
    const offerId = made.body.responses[0].offerId;
    const { sku: _s, marketplaceId: _m, format: _f, ...update } = base;
    refused(await ebay(fake, "PUT", `${INV}/offer/${offerId}`, { token: tok, body: { ...update, listingDuration: "DAYS_30" } }), 400, 25709, "PUT listingDuration");
    refused(await ebay(fake, "PUT", `${INV}/offer/${offerId}`, { token: tok, body: { ...update, pricingSummary: { price: { value: "1.00", currency: "CAD" } } } }), 400, 25709, "PUT currency");
    refused(await ebay(fake, "PUT", `${INV}/offer/${offerId}`, { token: tok, body: [] }), 400, 25709, "PUT a list");
  });

  it("25709 on every bulk_update_price_quantity branch, per entry", async () => {
    const got = await ebay(fake, "GET", `${INV}/offer?sku=NB2-err-NM`, { token: tok });
    const offerId = got.body.offers[0].offerId;
    const cases = [
      ["no SKU", { offers: [{ offerId, price: { value: "1.00", currency: "USD" } }] }],
      ["a quantity of -1", { sku: "NB2-err-NM", shipToLocationAvailability: { quantity: -1 } }],
      ["shipToLocationAvailability not an object", { sku: "NB2-err-NM", shipToLocationAvailability: 3 }],
      ["offers not a list", { sku: "NB2-err-NM", offers: { offerId } }],
      ["26 offers", { sku: "NB2-err-NM", offers: Array.from({ length: 26 }, () => ({ offerId })) }],
      ["an offer availableQuantity of 1.5", { sku: "NB2-err-NM", offers: [{ offerId, availableQuantity: 1.5 }] }],
      ["a price in GBP", { sku: "NB2-err-NM", offers: [{ offerId, price: { value: "1.00", currency: "GBP" } }] }],
      ["a price that is not money", { sku: "NB2-err-NM", offers: [{ offerId, price: { value: "one", currency: "USD" } }] }],
    ];
    for (const [what, entry] of cases) {
      refusedEntry(await ebay(fake, "POST", `${INV}/bulk_update_price_quantity`, { token: tok, body: { requests: [entry] } }), 25709, what);
    }
    refused(await ebay(fake, "POST", `${INV}/bulk_update_price_quantity`, { token: tok, body: { requests: [] } }), 400, 25709, "no requests");
    refused(await ebay(fake, "POST", `${INV}/bulk_update_price_quantity`, { token: tok, body: {} }), 400, 25709, "no requests key");
    // Control: a good update still goes through, and refused entries changed nothing.
    const ok = await ebay(fake, "POST", `${INV}/bulk_update_price_quantity`, { token: tok, body: { requests: [{ sku: "NB2-err-NM", offers: [{ offerId, price: { value: "2.00", currency: "USD" } }] }] } });
    assert.equal(ok.status, 200);
    assert.equal((await ebay(fake, "GET", `${INV}/inventory_item/NB2-err-NM`, { token: tok })).body.availability.shipToLocationAvailability.quantity, 3);
  });

  it("conditionDescriptors and packageWeightAndSize are stored only up to 2 KB of JSON each", async () => {
    assert.equal(MAX_STORED_JSON_BYTES, 2048);
    // The largest list that fits: one descriptor padded to exactly the cap.
    const descriptorsOf = (bytes) => {
      const shell = JSON.stringify([{ name: "40001", values: [""] }]).length;
      return [{ name: "40001", values: ["v".repeat(bytes - shell)] }];
    };
    const packageOf = (bytes) => {
      const shell = JSON.stringify({ packageType: "LETTER", note: "" }).length;
      return { packageType: "LETTER", note: "n".repeat(bytes - shell) };
    };
    assert.equal(JSON.stringify(descriptorsOf(2048)).length, 2048);
    assert.equal(JSON.stringify(packageOf(2048)).length, 2048);
    const at = await ebay(fake, "POST", `${INV}/bulk_create_or_replace_inventory_item`, {
      token: tok,
      body: { requests: [item("NB2-cap-NM", { conditionDescriptors: descriptorsOf(2048), packageWeightAndSize: packageOf(2048) })] },
    });
    assert.equal(at.status, 200, JSON.stringify(at.body));
    const stored = await ebay(fake, "GET", `${INV}/inventory_item/NB2-cap-NM`, { token: tok });
    assert.deepEqual(stored.body.conditionDescriptors, descriptorsOf(2048));
    assert.deepEqual(stored.body.packageWeightAndSize, packageOf(2048));
    refusedEntry(
      await ebay(fake, "POST", `${INV}/bulk_create_or_replace_inventory_item`, { token: tok, body: { requests: [item("NB2-cap2-NM", { conditionDescriptors: descriptorsOf(2049) })] } }),
      25709,
      "descriptors one byte over",
    );
    refusedEntry(
      await ebay(fake, "POST", `${INV}/bulk_create_or_replace_inventory_item`, { token: tok, body: { requests: [item("NB2-cap2-NM", { packageWeightAndSize: packageOf(2049) })] } }),
      25709,
      "package one byte over",
    );
    // Multi-byte text counts in bytes, not characters: 700 three-byte characters are over.
    refusedEntry(
      await ebay(fake, "POST", `${INV}/bulk_create_or_replace_inventory_item`, { token: tok, body: { requests: [item("NB2-cap2-NM", { packageWeightAndSize: { note: "€".repeat(700) } })] } }),
      25709,
      "package in multi-byte text",
    );
    // A refused replace leaves the held item as it was.
    refusedEntry(
      await ebay(fake, "POST", `${INV}/bulk_create_or_replace_inventory_item`, { token: tok, body: { requests: [item("NB2-cap-NM", { conditionDescriptors: descriptorsOf(4096) })] } }),
      25709,
      "replace over the cap",
    );
    assert.deepEqual((await ebay(fake, "GET", `${INV}/inventory_item/NB2-cap-NM`, { token: tok })).body.conditionDescriptors, descriptorsOf(2048));
    assert.equal((await ebay(fake, "GET", `${INV}/inventory_item/NB2-cap2-NM`, { token: tok })).status, 404);
  });
});
