/**
 * NEO-555: the ONLY eBay requests `POST /probe/ebay` may make with a user or
 * application access token. Every entry is a GET with a fixed host, a fixed
 * path and a fixed query; nothing here is built from a request, an env var or
 * a stored value. `probeGet` (./ebay-probe.ts) refuses any object that is not
 * one of these exact entries (by reference), so a forged copy with the same
 * fields is refused too.
 *
 * WHY. In prod the probe reads a real seller account on eBay (there is no
 * separate prod test seller). It must be
 * read-only by construction, not by convention: no listing, no policy write,
 * no opt-in, no delete. tests/ebay-probe.test.mjs fails on any non-GET entry
 * here and on any egress in the probe modules outside probeGet and the token
 * grant.
 *
 * Rows are the eBay-surface rows of the NEO-555 plan:
 *    1  get_opted_in_programs
 *    3  payment / return / fulfillment policies
 *    5  metadata get_shipping_services        (hashed: sorted service codes)
 *    6  inventory location GET (NB's own key)
 *    7  taxonomy get_item_aspects_for_category (hashed: sorted aspect names; app token)
 *   10  offer?sku= (GET only; a SKU NB never mints, so the answer is the 404 shape)
 *   13  fulfillment orders, limit=1        (top-level keys only: never an order)
 *   15  commerce identity getUser (apiz host)
 *
 * SHAPES. Each entry reports only `shapePaths` (shapeMap's allowlist dialect):
 * the fields NB's Convex parsers read (apps/web/convex/adapters/ebaySeller.ts,
 * lib/ebayListing.ts), plus eBay's error envelope. Everything else, buyer
 * names, addresses and ship-to blocks included, is dropped unseen, because the
 * prod probe's shapes are uploaded as a public drift artifact.
 */

/** Which eBay host an entry is served from (eBay serves Commerce Identity from `apiz`). */
export type EbayProbeHost = "api" | "apiz";

/** Which token reads it: the app token (client_credentials) or the seller's user token. */
export type EbayProbeLeg = "app" | "account";

/**
 * A query value: a literal, or a date window resolved at call time to
 * `lastmodifieddate:[<UTC midnight N days ago>..]` (the filter NB's sales poll
 * sends, lib/ebayListing.ordersModifiedSinceFilter). Still not free-form: the
 * only input is the clock.
 */
export type EbayProbeQueryValue = string | { readonly lastModifiedSinceDays: number };

/** Which value-free digest an entry contributes to the response's `hashes`. */
export type EbayProbeHashKind = "shippingServiceCodes" | "aspectNames";

export interface EbayProbeEntry {
  /** The NEO-555 eBay-surface row. */
  readonly row: number;
  /** Step name in the response's `steps`. */
  readonly step: string;
  readonly leg: EbayProbeLeg;
  readonly method: "GET";
  readonly host: EbayProbeHost;
  /**
   * The fake's endpoint name (services/fake-bsc/CONTRACT.md, "Drift"):
   * method, the fake host part and the path, variable segments as `:name`.
   * The key of this entry in the response's `shapes`, `statuses` and `hashes`.
   */
  readonly endpoint: string;
  /** The concrete path requested (the template with NB's fixed values). */
  readonly path: string;
  readonly query: Readonly<Record<string, EbayProbeQueryValue>>;
  /** Statuses that count as a readable answer (a 404 is "not there" for rows 6 and 10). */
  readonly okStatuses: readonly number[];
  /** The ONLY paths reported in `shapes`. */
  readonly shapePaths: readonly string[];
  readonly hash?: EbayProbeHashKind;
}

/** NB's own fixed values (apps/web/convex/lib/ebayListing.ts). */
const MARKETPLACE_ID = "EBAY_US";
const MERCHANT_LOCATION_KEY = "neonbinder-main";
const CATEGORY_TREE_ID = "0";
const CARD_CATEGORY_ID = "261328";
/**
 * Row 10's SKU. NB's SKUs are `<cardId>-<conditionCode>` (buildEbaySku); this
 * one cannot be minted by it, so the read never names a real listing and the
 * answer is eBay's no-offer 404 envelope.
 */
export const PROBE_ABSENT_SKU = "NBPROBE-ABSENT";
/** Row 13's window. Rounded to UTC midnight, so the URL is stable for a day. */
export const PROBE_ORDERS_SINCE_DAYS = 30;

/** eBay's error envelope: present on every non-2xx answer. */
const ERROR_PATHS = ["errors[].errorId", "errors[].domain", "errors[].category"];

const amountPaths = (prefix: string): string[] => [`${prefix}.value`, `${prefix}.currency`];

export const EBAY_PROBE_SHAPE_PATHS = Object.freeze({
  // adapters/ebaySeller.getOptedInPrograms
  programs: Object.freeze(["programs[].programType", ...ERROR_PATHS]),
  // lib/ebayListing.readPaymentPolicies
  paymentPolicies: Object.freeze([
    "paymentPolicies[].paymentPolicyId",
    "paymentPolicies[].name",
    "total",
    ...ERROR_PATHS,
  ]),
  // lib/ebayListing.readReturnPolicies
  returnPolicies: Object.freeze([
    "returnPolicies[].returnPolicyId",
    "returnPolicies[].name",
    "returnPolicies[].returnsAccepted",
    "returnPolicies[].returnPeriod.value",
    "returnPolicies[].returnPeriod.unit",
    "returnPolicies[].returnShippingCostPayer",
    "total",
    ...ERROR_PATHS,
  ]),
  // lib/ebayListing.readFulfillmentPolicies
  fulfillmentPolicies: Object.freeze([
    "fulfillmentPolicies[].fulfillmentPolicyId",
    "fulfillmentPolicies[].name",
    "fulfillmentPolicies[].shippingOptions[].optionType",
    "fulfillmentPolicies[].shippingOptions[].shippingServices[].shippingServiceCode",
    "fulfillmentPolicies[].shippingOptions[].shippingServices[].freeShipping",
    ...amountPaths("fulfillmentPolicies[].shippingOptions[].shippingServices[].shippingCost"),
    "total",
    ...ERROR_PATHS,
  ]),
  // adapters/ebaySeller.getShippingServices
  shippingServices: Object.freeze([
    "shippingServices[].shippingService",
    "shippingServices[].description",
    "shippingServices[].shippingCarrier",
    "shippingServices[].internationalService",
    "shippingServices[].validForSellingFlow",
    "shippingServices[].shippingCostTypes[]",
    "shippingServices[].shippingCategory",
    "shippingServices[].minShippingTime",
    "shippingServices[].maxShippingTime",
    ...[
      "maxWeight",
      "minWeight",
      "maxLength",
      "minLength",
      "maxWidth",
      "minWidth",
      "maxHeight",
      "minHeight",
      "maxGirth",
      "minGirth",
      "weightUnit",
      "dimensionUnit",
    ].map((k) => `shippingServices[].packageLimits.${k}`),
    ...ERROR_PATHS,
  ]),
  // adapters/ebaySeller.readInventoryLocation
  location: Object.freeze(["merchantLocationKey", "merchantLocationStatus", ...ERROR_PATHS]),
  // lib/ebayListing.readCategoryAspects
  aspects: Object.freeze([
    "aspects[].localizedAspectName",
    "aspects[].aspectConstraint.aspectRequired",
    "aspects[].aspectConstraint.aspectMaxLength",
    ...ERROR_PATHS,
  ]),
  // adapters/ebaySeller.getOfferBySku
  offers: Object.freeze([
    "offers[].offerId",
    "offers[].sku",
    "offers[].status",
    "offers[].listing.listingId",
    "total",
    ...ERROR_PATHS,
  ]),
  // Row 13: the page's TOP-LEVEL keys only. Never an `orders[]` element path,
  // and not `next` (present only when more than one order matched): the prod
  // shapes are a public artifact, and an element path, or `next`, would say
  // whether the seller had orders in the window. `orders` itself reports as
  // "array" whether it is empty or not. The fake's drift compare reads an
  // `orders` array with no element paths as "says nothing about its items".
  orders: Object.freeze(["href", "limit", "offset", "total", "orders", ...ERROR_PATHS]),
  // services/ebay-oauth.fetchEbayIdentity
  identity: Object.freeze(["userId", "username", ...ERROR_PATHS]),
});

const OK = Object.freeze([200]);
const OK_OR_ABSENT = Object.freeze([200, 404]);

function entry(e: EbayProbeEntry): EbayProbeEntry {
  // Freeze each query value too: `{ lastModifiedSinceDays }` is an object, and
  // a shallow freeze of the query would leave it writable.
  const query = Object.fromEntries(Object.entries(e.query).map(([k, v]) => [k, typeof v === "string" ? v : Object.freeze({ ...v })]));
  return Object.freeze({ ...e, query: Object.freeze(query) });
}

/**
 * The allowlist, in the order the probe reads it. Frozen, entries and queries
 * included. Order: the app leg first (it gates the deploy), then the seller's
 * account, cheapest reads first.
 */
export const EBAY_PROBE_ALLOWLIST: readonly EbayProbeEntry[] = Object.freeze([
  entry({
    row: 7,
    step: "app.item_aspects",
    leg: "app",
    method: "GET",
    host: "api",
    endpoint: "GET ebay/api/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category",
    path: `/commerce/taxonomy/v1/category_tree/${CATEGORY_TREE_ID}/get_item_aspects_for_category`,
    query: { category_id: CARD_CATEGORY_ID },
    okStatuses: OK,
    shapePaths: EBAY_PROBE_SHAPE_PATHS.aspects,
    hash: "aspectNames",
  }),
  entry({
    row: 15,
    step: "account.identity",
    leg: "account",
    method: "GET",
    host: "apiz",
    endpoint: "GET ebay/apiz/commerce/identity/v1/user",
    path: "/commerce/identity/v1/user/",
    query: {},
    okStatuses: OK,
    shapePaths: EBAY_PROBE_SHAPE_PATHS.identity,
  }),
  entry({
    row: 1,
    step: "account.opted_in_programs",
    leg: "account",
    method: "GET",
    host: "api",
    endpoint: "GET ebay/api/sell/account/v1/program/get_opted_in_programs",
    path: "/sell/account/v1/program/get_opted_in_programs",
    query: {},
    okStatuses: OK,
    shapePaths: EBAY_PROBE_SHAPE_PATHS.programs,
  }),
  entry({
    row: 3,
    step: "account.payment_policies",
    leg: "account",
    method: "GET",
    host: "api",
    endpoint: "GET ebay/api/sell/account/v1/payment_policy",
    path: "/sell/account/v1/payment_policy",
    query: { marketplace_id: MARKETPLACE_ID },
    okStatuses: OK,
    shapePaths: EBAY_PROBE_SHAPE_PATHS.paymentPolicies,
  }),
  entry({
    row: 3,
    step: "account.return_policies",
    leg: "account",
    method: "GET",
    host: "api",
    endpoint: "GET ebay/api/sell/account/v1/return_policy",
    path: "/sell/account/v1/return_policy",
    query: { marketplace_id: MARKETPLACE_ID },
    okStatuses: OK,
    shapePaths: EBAY_PROBE_SHAPE_PATHS.returnPolicies,
  }),
  entry({
    row: 3,
    step: "account.fulfillment_policies",
    leg: "account",
    method: "GET",
    host: "api",
    endpoint: "GET ebay/api/sell/account/v1/fulfillment_policy",
    path: "/sell/account/v1/fulfillment_policy",
    query: { marketplace_id: MARKETPLACE_ID },
    okStatuses: OK,
    shapePaths: EBAY_PROBE_SHAPE_PATHS.fulfillmentPolicies,
  }),
  entry({
    row: 5,
    step: "account.shipping_services",
    leg: "account",
    method: "GET",
    host: "api",
    endpoint: "GET ebay/api/sell/metadata/v1/shipping/marketplace/EBAY_US/get_shipping_services",
    path: `/sell/metadata/v1/shipping/marketplace/${MARKETPLACE_ID}/get_shipping_services`,
    query: {},
    okStatuses: OK,
    shapePaths: EBAY_PROBE_SHAPE_PATHS.shippingServices,
    hash: "shippingServiceCodes",
  }),
  entry({
    row: 6,
    step: "account.inventory_location",
    leg: "account",
    method: "GET",
    host: "api",
    endpoint: "GET ebay/api/sell/inventory/v1/location/:merchantLocationKey",
    path: `/sell/inventory/v1/location/${MERCHANT_LOCATION_KEY}`,
    query: {},
    okStatuses: OK_OR_ABSENT,
    shapePaths: EBAY_PROBE_SHAPE_PATHS.location,
  }),
  entry({
    row: 10,
    step: "account.offer_by_sku",
    leg: "account",
    method: "GET",
    host: "api",
    endpoint: "GET ebay/api/sell/inventory/v1/offer",
    path: "/sell/inventory/v1/offer",
    query: { sku: PROBE_ABSENT_SKU, marketplace_id: MARKETPLACE_ID, format: "FIXED_PRICE", limit: "5" },
    okStatuses: OK_OR_ABSENT,
    shapePaths: EBAY_PROBE_SHAPE_PATHS.offers,
  }),
  entry({
    row: 13,
    step: "account.orders",
    leg: "account",
    method: "GET",
    host: "api",
    endpoint: "GET ebay/api/sell/fulfillment/v1/order",
    path: "/sell/fulfillment/v1/order",
    query: { filter: { lastModifiedSinceDays: PROBE_ORDERS_SINCE_DAYS }, limit: "1", offset: "0" },
    okStatuses: OK,
    shapePaths: EBAY_PROBE_SHAPE_PATHS.orders,
  }),
]);

/** Resolve one query value against the clock (see EbayProbeQueryValue). */
export function resolveProbeQueryValue(value: EbayProbeQueryValue, nowMs: number): string {
  if (typeof value === "string") return value;
  const day = 24 * 60 * 60 * 1000;
  const since = Math.floor((nowMs - value.lastModifiedSinceDays * day) / day) * day;
  return `lastmodifieddate:[${new Date(since).toISOString()}..]`;
}
