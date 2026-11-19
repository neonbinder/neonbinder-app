/**
 * One sample seller walked through NB's whole eBay flow, answer by answer:
 * opt in, policies, location, item, offer, publish, price update, order,
 * picture, withdraw, delete. The fake's own answers, keyed by the capture
 * endpoint names (`captures.ts`), so the write captures, the drift's
 * synthesised shapes and the OpenAPI conformance test all read the same
 * synthesis and none of them can drift from it.
 */
import { tokenAnswer } from "./oauth";
import { notificationKey } from "./notificationKey";
import { newSellerState } from "./state";
import { addEbayOrder, answerSeller, seedFulfillmentPolicies, type EbayAnswer, type SellerCall } from "./synth";
import { createEbayTokens, FAKE_EBAY_CLIENT_ID, FAKE_EBAY_CLIENT_SECRET } from "./tokens";
import { EBAY_ROUTES, type EbayOp } from "./paths";

const SAMPLE_NOW = Date.parse("2026-01-02T03:04:05.000Z");
export const SAMPLE_SKU = "NB2-samplecard-NM";
const SAMPLE_SKU_2 = "NB2-samplecard-EX";
const LOCATION_KEY = "neonbinder-main";

/** A 1x1 JPEG (the smallest valid baseline JPEG header the magic check accepts). */
const JPEG = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");

/** The variant of the publish capture the sandbox's refusal is filed under (it names no error id: the id varies). */
export const REFUSED = "refused";

function templateOf(op: EbayOp): { method: string; template: string } {
  const r = EBAY_ROUTES.find((x) => x.op === op);
  if (!r) throw new Error(`no route for ${op}`);
  return { method: r.method, template: r.template };
}

/** The capture endpoint name of an op, with an optional variant (`#refused`). */
export function endpointName(op: EbayOp, variant?: string): string {
  const { method, template } = templateOf(op);
  return `${method} ${template}${variant ? ` #${variant}` : ""}`;
}

export function sampleMultipart(): { contentType: string; bytes: Buffer } {
  const boundary = "nbfakeboundary";
  const bytes = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="front.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`, "latin1"),
    JPEG,
    Buffer.from(`\r\n--${boundary}--\r\n`, "latin1"),
  ]);
  return { contentType: `multipart/form-data; boundary=${boundary}`, bytes };
}

function itemBody(sku: string): Record<string, unknown> {
  return {
    sku,
    locale: "en_US",
    condition: "USED_VERY_GOOD",
    conditionDescriptors: [{ name: "40001", values: ["400010"] }],
    availability: { shipToLocationAvailability: { quantity: 2 } },
    packageWeightAndSize: { weight: { value: 1, unit: "OUNCE" }, dimensions: { length: 6, width: 4, height: 1, unit: "INCH" }, packageType: "LETTER" },
    product: {
      title: "2024 Sample Base #1 Vorkle",
      description: "A sample card",
      aspects: { Sport: ["Baseball"], "Card Number": ["1"] },
      imageUrls: ["https://www.neonbinder.io/placeholder-fixtures/01-vorkle-front.jpg"],
    },
  };
}

function offerBody(sku: string, policies: { fulfillmentPolicyId: string; paymentPolicyId: string; returnPolicyId: string }): Record<string, unknown> {
  return {
    sku,
    marketplaceId: "EBAY_US",
    format: "FIXED_PRICE",
    availableQuantity: 2,
    categoryId: "261328",
    listingDescription: "A sample card",
    listingDuration: "GTC",
    listingPolicies: { ...policies, bestOfferTerms: { bestOfferEnabled: false } },
    pricingSummary: { price: { value: "12.50", currency: "USD" } },
    merchantLocationKey: LOCATION_KEY,
  };
}

const first = (a: EbayAnswer): Record<string, unknown> => ((a.body as { responses?: Array<Record<string, unknown>> }).responses ?? [])[0] ?? {};

/** Every sample answer, by capture endpoint name. Deterministic in shape (ids are random). */
export function sampleAnswers(): Record<string, EbayAnswer> {
  const out: Record<string, EbayAnswer> = {};
  const s = newSellerState("sample", "main");
  const call = (op: EbayOp, extra: Partial<SellerCall> = {}): EbayAnswer => {
    const a = answerSeller(s, { op, params: {}, query: new URLSearchParams(), body: undefined, now: SAMPLE_NOW, ...extra });
    if (a === "needs-model") throw new Error(`sample: ${op} has no model`);
    return a;
  };
  const put = (op: EbayOp, a: EbayAnswer, variant?: string): EbayAnswer => {
    out[endpointName(op, variant)] = a;
    return a;
  };
  const mp = new URLSearchParams({ marketplace_id: "EBAY_US" });

  put("optIn", call("optIn", { body: { programType: "SELLING_POLICY_MANAGEMENT" } }));
  put("optIn", call("optIn", { body: { programType: "SELLING_POLICY_MANAGEMENT" } }), "409");
  put("optedInPrograms", call("optedInPrograms"));
  const pay = put(
    "createPaymentPolicy",
    call("createPaymentPolicy", { body: { name: "NB Payment", marketplaceId: "EBAY_US", categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }], immediatePay: true } }),
  );
  const ret = put(
    "createReturnPolicy",
    call("createReturnPolicy", {
      body: {
        name: "NB Returns (30 days)",
        marketplaceId: "EBAY_US",
        categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }],
        returnsAccepted: true,
        returnPeriod: { value: 30, unit: "DAY" },
        returnShippingCostPayer: "BUYER",
        refundMethod: "MONEY_BACK",
      },
    }),
  );
  const seeded = seedFulfillmentPolicies(s, [
    { name: "Under $20", costType: "FLAT_RATE", services: [{ code: "US_eBayStandardEnvelope", carrier: "USPS", costCents: 99, freeShipping: false }] },
    { name: "$20 and up", costType: "FLAT_RATE", services: [{ code: "USPSGroundAdvantage", carrier: "USPS", costCents: 0, freeShipping: true }] },
  ]);
  if (!seeded.ok) throw new Error("sample: seed failed");
  put("listPaymentPolicies", call("listPaymentPolicies", { query: mp }));
  put("listReturnPolicies", call("listReturnPolicies", { query: mp }));
  put("listFulfillmentPolicies", call("listFulfillmentPolicies", { query: mp }));

  const loc = { location: { address: { city: "Austin", stateOrProvince: "TX", postalCode: "78701", country: "US" } }, locationTypes: ["WAREHOUSE"], name: "NeonBinder" };
  const p = { merchantLocationKey: LOCATION_KEY };
  put("createLocation", call("createLocation", { params: p, body: { ...loc, merchantLocationStatus: "ENABLED" } }));
  put("updateLocation", call("updateLocation", { params: p, body: loc }));
  put("enableLocation", call("enableLocation", { params: p }));
  put("getLocation", call("getLocation", { params: p }));

  const policies = {
    fulfillmentPolicyId: seeded.ids[0],
    paymentPolicyId: String((pay.body as Record<string, unknown>).paymentPolicyId),
    returnPolicyId: String((ret.body as Record<string, unknown>).returnPolicyId),
  };
  put("bulkItems", call("bulkItems", { body: { requests: [itemBody(SAMPLE_SKU)] } }));
  const offers = put("bulkOffers", call("bulkOffers", { body: { requests: [offerBody(SAMPLE_SKU, policies)] } }));
  const offerId = String(first(offers).offerId);
  const { sku: _sku, marketplaceId: _mp, format: _f, ...update } = offerBody(SAMPLE_SKU, policies);
  void _sku;
  void _mp;
  void _f;
  put("updateOffer", call("updateOffer", { params: { offerId }, body: update }));

  // The publish refusal: HTTP 400 with the Inventory error envelope. The
  // sandbox refused with errorId 25007 (no usable shipping service), so the
  // sample's offer names a fulfillment policy the seller does not hold.
  call("bulkItems", { body: { requests: [itemBody(SAMPLE_SKU_2)] } });
  const refused = call("bulkOffers", { body: { requests: [offerBody(SAMPLE_SKU_2, { ...policies, fulfillmentPolicyId: "1" })] } });
  put("publishOffer", call("publishOffer", { params: { offerId: String(first(refused).offerId) } }), REFUSED);

  put("publishOffer", call("publishOffer", { params: { offerId } }));
  put(
    "bulkPriceQuantity",
    call("bulkPriceQuantity", {
      body: { requests: [{ sku: SAMPLE_SKU, shipToLocationAvailability: { quantity: 2 }, offers: [{ offerId, availableQuantity: 2, price: { value: "12.49", currency: "USD" } }] }] },
    }),
  );
  put("getOffers", call("getOffers", { query: new URLSearchParams({ sku: SAMPLE_SKU, marketplace_id: "EBAY_US", format: "FIXED_PRICE", limit: "5" }) }));
  const order = addEbayOrder(s, { lines: [{ sku: SAMPLE_SKU, quantity: 1 }, { title: "Unknown card", quantity: 1, priceCents: 150 }] }, SAMPLE_NOW);
  if (!order.ok) throw new Error("sample: order failed");
  put("orders", call("orders", { query: new URLSearchParams({ filter: "lastmodifieddate:[2026-01-01T00:00:00.000Z..]", limit: "100", offset: "0" }) }));

  const image = put("uploadImage", call("uploadImage", { raw: sampleMultipart() }));
  const imageId = String(image.headers?.location?.split("/").pop());
  put("getImage", call("getImage", { params: { imageId } }));

  put("withdrawOffer", call("withdrawOffer", { params: { offerId } }));
  put("listItems", call("listItems", { query: new URLSearchParams({ limit: "100", offset: "0" }) }));
  put("deleteItem", call("deleteItem", { params: { sku: SAMPLE_SKU } }));
  put("identityUser", call("identityUser"));

  // Row 14 and row 16.
  const tokens = createEbayTokens({ secret: "sample", now: () => SAMPLE_NOW });
  const basic = `Basic ${Buffer.from(`${FAKE_EBAY_CLIENT_ID}:${FAKE_EBAY_CLIENT_SECRET}`).toString("base64")}`;
  const { code } = tokens.mintCode({ ns: "sample", seller: "main" });
  const codeGrant = tokenAnswer(tokens, basic, { grant_type: "authorization_code", code, redirect_uri: "nb-ru-name" });
  put("token", codeGrant, "authorization_code");
  const refreshToken = String((codeGrant.body as Record<string, unknown>).refresh_token);
  put("token", tokenAnswer(tokens, basic, { grant_type: "refresh_token", refresh_token: refreshToken }), "refresh_token");
  put("token", tokenAnswer(tokens, basic, { grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }), "client_credentials");
  const key = notificationKey("sample");
  put("publicKey", { status: 200, body: { algorithm: "ECDSA", digest: "SHA1", key: key.publicPem } });
  return out;
}
