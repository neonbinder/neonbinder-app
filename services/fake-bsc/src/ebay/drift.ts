/**
 * `POST /__fake/drift-compare {marketplace: "ebay", shapes, statuses?, hashes?}`
 * (CONTRACT.md, "Drift"): the prod eBay probe's value-free shapes against what
 * the fake serves. Rows 5 and 7 compare against the recording of NB's pinned
 * request (allowlisted paths only); the other rows against the fake's own
 * synthesis (the sample walk), on the paths NB reads. The rows 5 and 7 hashes
 * (shipping-service codes, aspect names) are a warning only: the recordings
 * come from the sandbox, whose metadata differs from production's.
 */
import { createHash } from "node:crypto";
import type { Catalogue } from "../catalogue";
import { compare, readProbeShape, type DriftEndpointResult } from "../drift";
import { canonicalRequest, requestKey } from "../requestKey";
import { SPECS, specAllowsPath, type EbayCatalogueEndpoint } from "../sanitise";
import { EBAY_PINNED_REQUESTS } from "../replayAllowlist";
import { shapeOf, type Shape } from "../shape";
import { ebayErrorBody } from "./errors";
import { endpointName, sampleAnswers } from "./sample";
import type { EbayOp } from "./paths";

/**
 * The one definition of the rows 5 and 7 digest: non-empty strings, made
 * unique, sorted with JavaScript's default sort, then the lowercase hex
 * SHA-256 of the UTF-8 of `JSON.stringify(list)`. The browser probe's
 * `digestNames` must agree (services/browser/src/routes/ebay-probe.ts).
 */
export function ebayCatalogueHash(names: readonly unknown[]): string {
  const list = [...new Set(names.filter((n): n is string => typeof n === "string" && n.length > 0))].sort();
  return createHash("sha256").update(JSON.stringify(list), "utf8").digest("hex");
}

/** The names a recorded row 5 or row 7 body digests. */
export function namesOf(endpoint: EbayCatalogueEndpoint, body: unknown): unknown[] {
  if (!body || typeof body !== "object") return [];
  const b = body as Record<string, unknown>;
  const list = endpoint === "ebayShippingServices" ? b.shippingServices : b.aspects;
  if (!Array.isArray(list)) return [];
  const field = endpoint === "ebayShippingServices" ? "shippingService" : "localizedAspectName";
  return list.map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>)[field] : undefined));
}

const AMOUNT = (p: string) => [p, `${p}.value`, `${p}.currency`];

/**
 * The synthesised rows: the probe's endpoint name, the sample op whose answer
 * is served, the paths NB reads, and those of them an answer may lack
 * (never drift when absent).
 */
const SYNTH_ROWS: ReadonlyArray<{ op: EbayOp; read: readonly string[]; optional?: readonly string[] }> = [
  { op: "optedInPrograms", read: ["", "programs", "programs[]", "programs[].programType"] },
  { op: "listPaymentPolicies", read: ["", "total", "paymentPolicies", "paymentPolicies[]", "paymentPolicies[].paymentPolicyId", "paymentPolicies[].name"] },
  {
    op: "listReturnPolicies",
    read: [
      "",
      "total",
      "returnPolicies",
      "returnPolicies[]",
      "returnPolicies[].returnPolicyId",
      "returnPolicies[].name",
      "returnPolicies[].returnsAccepted",
      "returnPolicies[].returnPeriod",
      "returnPolicies[].returnPeriod.value",
      "returnPolicies[].returnPeriod.unit",
      "returnPolicies[].returnShippingCostPayer",
    ],
    // A policy that takes no returns has no period or payer.
    optional: ["returnPolicies[].returnPeriod", "returnPolicies[].returnShippingCostPayer"],
  },
  {
    op: "listFulfillmentPolicies",
    read: [
      "",
      "total",
      "fulfillmentPolicies",
      "fulfillmentPolicies[]",
      "fulfillmentPolicies[].fulfillmentPolicyId",
      "fulfillmentPolicies[].name",
      "fulfillmentPolicies[].shippingOptions",
      "fulfillmentPolicies[].shippingOptions[]",
      "fulfillmentPolicies[].shippingOptions[].optionType",
      "fulfillmentPolicies[].shippingOptions[].shippingServices",
      "fulfillmentPolicies[].shippingOptions[].shippingServices[]",
      "fulfillmentPolicies[].shippingOptions[].shippingServices[].shippingServiceCode",
      "fulfillmentPolicies[].shippingOptions[].shippingServices[].freeShipping",
      ...AMOUNT("fulfillmentPolicies[].shippingOptions[].shippingServices[].shippingCost"),
    ],
    // Calculated or free shipping carries no cost.
    optional: ["fulfillmentPolicies[].shippingOptions[].shippingServices[].shippingCost", "fulfillmentPolicies[].shippingOptions[].shippingServices[].freeShipping"],
  },
  { op: "getLocation", read: ["", "merchantLocationKey", "merchantLocationStatus"] },
  {
    op: "getOffers",
    read: ["", "total", "offers", "offers[]", "offers[].offerId", "offers[].sku", "offers[].status", "offers[].listing", "offers[].listing.listingId"],
    optional: ["offers[].listing"],
  },
  {
    op: "orders",
    read: [
      "",
      "total",
      "next",
      "orders",
      "orders[]",
      "orders[].orderId",
      "orders[].creationDate",
      "orders[].lastModifiedDate",
      "orders[].cancelStatus",
      "orders[].cancelStatus.cancelState",
      "orders[].orderPaymentStatus",
      "orders[].orderFulfillmentStatus",
      "orders[].pricingSummary",
      ...AMOUNT("orders[].pricingSummary.priceSubtotal"),
      ...AMOUNT("orders[].pricingSummary.deliveryCost"),
      ...AMOUNT("orders[].pricingSummary.total"),
      ...AMOUNT("orders[].totalMarketplaceFee"),
      "orders[].lineItems",
      "orders[].lineItems[]",
      "orders[].lineItems[].legacyItemId",
      "orders[].lineItems[].sku",
      "orders[].lineItems[].quantity",
      "orders[].lineItems[].title",
      ...AMOUNT("orders[].lineItems[].lineItemCost"),
    ],
    // The last page has no `next`; a line may have no SKU (NEO-520); fees and delivery may be absent.
    optional: ["next", "orders[].lineItems[].sku", "orders[].totalMarketplaceFee", "orders[].pricingSummary.deliveryCost"],
  },
  { op: "identityUser", read: ["", "userId", "username"] },
];

/** The probe names rows 15 without the trailing slash and row 5 and 7 with NB's fixed values. */
const CATALOGUE_ROWS: ReadonlyArray<{ name: string; endpoint: EbayCatalogueEndpoint }> = [
  { name: "GET ebay/api/sell/metadata/v1/shipping/marketplace/EBAY_US/get_shipping_services", endpoint: "ebayShippingServices" },
  { name: "GET ebay/api/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category", endpoint: "ebayItemAspects" },
];

/** eBay's error envelope, which every non-2xx probe answer carries (404 on rows 6 and 10). */
const ERROR_READ = ["", "errors", "errors[]", "errors[].errorId", "errors[].domain", "errors[].category"];

export type EbayDriftWarning = { endpoint: string; kind: "hash_mismatch" | "hash_unrecorded" | "not_2xx" };

export interface EbayDriftResult {
  outcome: "ok" | "shape_drift" | "unrecorded pinned key";
  paths: string[];
  endpoints: DriftEndpointResult[];
  warnings: EbayDriftWarning[];
}

let served: Map<string, { shape: Shape; status: number }> | null = null;
function servedShapes(): Map<string, { shape: Shape; status: number }> {
  if (!served) {
    const answers = sampleAnswers();
    served = new Map();
    for (const row of SYNTH_ROWS) {
      const a = answers[endpointName(row.op)];
      served.set(endpointName(row.op), { shape: a.body === undefined ? {} : shapeOf(a.body), status: a.status });
    }
  }
  return served;
}

const HEX64 = /^[0-9a-f]{64}$/;

export function compareEbayDrift(input: unknown, catalogue: Catalogue): { ok: true; result: EbayDriftResult } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "body must be an object" };
  const b = input as Record<string, unknown>;
  if (!b.shapes || typeof b.shapes !== "object" || Array.isArray(b.shapes)) return { ok: false, error: "shapes must be an object" };
  const entries = Object.entries(b.shapes as Record<string, unknown>);
  if (entries.length > 20) return { ok: false, error: "at most 20 endpoints" };
  const statuses: Record<string, number> = {};
  if (b.statuses !== undefined) {
    if (!b.statuses || typeof b.statuses !== "object" || Array.isArray(b.statuses)) return { ok: false, error: "statuses must be an object" };
    for (const [k, v] of Object.entries(b.statuses as Record<string, unknown>)) {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 599) return { ok: false, error: `statuses[${k.slice(0, 200)}]` };
      statuses[k] = v;
    }
  }
  const hashes: Record<string, string> = {};
  if (b.hashes !== undefined) {
    if (!b.hashes || typeof b.hashes !== "object" || Array.isArray(b.hashes)) return { ok: false, error: "hashes must be an object" };
    for (const [k, v] of Object.entries(b.hashes as Record<string, unknown>)) {
      if (typeof v !== "string" || !HEX64.test(v)) return { ok: false, error: `hashes[${k.slice(0, 200)}] must be lowercase hex sha256` };
      hashes[k] = v;
    }
  }

  const results: DriftEndpointResult[] = [];
  const warnings: EbayDriftWarning[] = [];
  for (const [name, rawShape] of entries) {
    if (name.length > 200) return { ok: false, error: "endpoint name too long" };
    const probe = readProbeShape(rawShape);
    if (!probe) return { ok: false, error: `shapes[${name}] is not a shape` };
    const status = statuses[name];
    const catalogueRow = CATALOGUE_ROWS.find((r) => r.name === name);
    const synthRow = SYNTH_ROWS.find((r) => endpointName(r.op) === name);
    if (!catalogueRow && !synthRow) {
      results.push({ endpoint: name, verdict: "not_compared", paths: [] });
      continue;
    }

    // Not a 2xx: a 404 on a read NB treats as "absent" compares eBay's error
    // envelope; anything else says nothing about the shape.
    if (status !== undefined && (status < 200 || status > 299)) {
      if (status === 404 && synthRow && (synthRow.op === "getLocation" || synthRow.op === "getOffers")) {
        const paths = compare(probe, shapeOf(ebayErrorBody([25713])), (p) => ERROR_READ.includes(p));
        results.push({ endpoint: name, verdict: paths.length ? "shape_drift" : "ok", paths });
      } else {
        results.push({ endpoint: name, verdict: "not_compared", paths: [] });
        warnings.push({ endpoint: name, kind: "not_2xx" });
      }
      continue;
    }

    if (catalogueRow) {
      const pinned = EBAY_PINNED_REQUESTS.find((p) => p.endpoint === catalogueRow.endpoint)!;
      const rec = catalogue.get(requestKey(canonicalRequest({ method: pinned.method, path: pinned.path, query: pinned.query })));
      if (!rec || rec.response.status !== 200) {
        results.push({ endpoint: name, verdict: "unrecorded pinned key", paths: [] });
        if (hashes[name] !== undefined) warnings.push({ endpoint: name, kind: "hash_unrecorded" });
        continue;
      }
      const spec = SPECS[catalogueRow.endpoint];
      const paths = compare(probe, shapeOf(rec.response.body), (p) => specAllowsPath(spec, p));
      results.push({ endpoint: name, verdict: paths.length ? "shape_drift" : "ok", paths });
      const want = hashes[name];
      if (want !== undefined && want !== ebayCatalogueHash(namesOf(catalogueRow.endpoint, rec.response.body))) warnings.push({ endpoint: name, kind: "hash_mismatch" });
      continue;
    }

    const row = synthRow!;
    const fake = servedShapes().get(name)!;
    const required = new Set(row.read.filter((p) => !(row.optional ?? []).includes(p)));
    const paths = compare(probe, fake.shape, (p) => row.read.includes(p), required);
    results.push({ endpoint: name, verdict: paths.length ? "shape_drift" : "ok", paths });
  }

  const paths = results.flatMap((r) => r.paths.map((p) => `${r.endpoint} ${p}`));
  const outcome = results.some((r) => r.verdict === "shape_drift")
    ? "shape_drift"
    : results.some((r) => r.verdict === "unrecorded pinned key")
      ? "unrecorded pinned key"
      : "ok";
  return { ok: true, result: { outcome, paths, endpoints: results, warnings } };
}
