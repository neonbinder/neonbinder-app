/**
 * What the recorder will replay against real BSC (CONTRACT.md, "Recorder"),
 * and so what the fake keeps durably (CONTRACT.md, "Durable misses"). It
 * lives in src/ so the server image, which ships no recorder code, can use
 * it; `recorder/replay-allowlist.ts` re-exports it.
 *
 * The miss list is written by any holder of the caller key (every PR's
 * Convex), and the recorder replays it under a real BSC account. So a miss is
 * sent only when its request is exactly the shape NB's own catalogue calls
 * have, with every value bounded:
 *
 *   POST search/bulk-upload/filters   {filters}
 *   POST search/bulk-upload/results   {filters, condition?, page?, size?, sort?}
 *   GET  marketplace/card/<hex id>/card-listing
 *
 * `filters` holds only the five BSC facets, each a short list of slugs. No
 * query string anywhere, and the body is a few KB at most. Anything else is
 * refused with a reason, never sent. The values come from what Convex sends
 * (adapters/buysportscards.ts: `{filters}` and `{condition: "all", page: 0,
 * size: 5000, sort: "default", filters}`; bscSeller.ts card-listing ids).
 *
 * eBay (NEO-555, CONTRACT.md "Fake eBay"): exactly the two reads NB makes,
 * pinned whole (path and query), so a miss can name nothing else:
 *
 *   GET ebay/api/sell/metadata/v1/shipping/marketplace/EBAY_US/get_shipping_services
 *   GET ebay/api/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category?category_id=261328
 */
import type { CanonicalRequest } from "./requestKey";
import { CARD_LISTING_RE, catalogueEndpointFor, isEbayCatalogueEndpoint } from "./sanitise";

export const MAX_REPLAY_BODY_BYTES = 4096;
export const REPLAY_FACETS = ["sport", "year", "setName", "variant", "variantName"] as const;
export const MAX_FACET_VALUES = 50;
/** A BSC facet slug: `baseball`, `1996`, `topps-chrome`, `gold-refractor`. */
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
/** A BSC card id (a database id): hex only. */
const CARD_ID_RE = /^[0-9a-f]{8,64}$/i;
const RESULTS_CONDITIONS = new Set(["all"]);
const RESULTS_SORTS = new Set(["default"]);
const MAX_PAGE = 100;
const MAX_SIZE = 5000;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function filtersRefusal(v: unknown): string | null {
  if (!isPlainObject(v)) return "filters_not_an_object";
  for (const [facet, values] of Object.entries(v)) {
    if (!(REPLAY_FACETS as readonly string[]).includes(facet)) return "filters_unknown_facet";
    if (!Array.isArray(values) || values.length === 0 || values.length > MAX_FACET_VALUES) return "filters_bad_list";
    if (!values.every((s) => typeof s === "string" && SLUG_RE.test(s))) return "filters_bad_value";
  }
  return null;
}

/** Null when the request may be replayed, else the reason (never a value). */
export function replayRefusal(req: CanonicalRequest): string | null {
  const endpoint = catalogueEndpointFor(req.method, req.path);
  if (!endpoint) return "not_a_catalogue_request";
  if (isEbayCatalogueEndpoint(endpoint)) return ebayReplayRefusal(req);
  if (req.query.length > 0) return "query_string";
  if (endpoint === "cardListing") {
    const id = CARD_LISTING_RE.exec(req.path)?.[1];
    if (!id || !CARD_ID_RE.test(id)) return "card_id_not_hex";
    return req.body === undefined ? null : "body_on_get";
  }
  if (Buffer.byteLength(JSON.stringify(req.body ?? null), "utf8") > MAX_REPLAY_BODY_BYTES) return "body_too_large";
  const body = req.body;
  if (!isPlainObject(body)) return "body_not_an_object";
  const allowed = endpoint === "filters" ? ["filters"] : ["filters", "condition", "page", "size", "sort"];
  for (const k of Object.keys(body)) if (!allowed.includes(k)) return "body_unknown_field";
  if (!("filters" in body)) return "filters_missing";
  const f = filtersRefusal(body.filters);
  if (f) return f;
  if (endpoint === "results") {
    if (body.condition !== undefined && !(typeof body.condition === "string" && RESULTS_CONDITIONS.has(body.condition))) return "bad_condition";
    if (body.sort !== undefined && !(typeof body.sort === "string" && RESULTS_SORTS.has(body.sort))) return "bad_sort";
    if (body.page !== undefined && !(Number.isInteger(body.page) && (body.page as number) >= 0 && (body.page as number) <= MAX_PAGE)) return "bad_page";
    if (body.size !== undefined && !(Number.isInteger(body.size) && (body.size as number) >= 1 && (body.size as number) <= MAX_SIZE)) return "bad_size";
  }
  return null;
}

/** The eBay reads the eBay recorder may replay (CONTRACT.md, "Fake eBay"), as canonical requests. */
export const EBAY_PINNED_REQUESTS: ReadonlyArray<{ endpoint: "ebayShippingServices" | "ebayItemAspects"; method: "GET"; path: string; query: Array<[string, string]> }> = [
  { endpoint: "ebayShippingServices", method: "GET", path: "ebay/api/sell/metadata/v1/shipping/marketplace/EBAY_US/get_shipping_services", query: [] },
  {
    endpoint: "ebayItemAspects",
    method: "GET",
    path: "ebay/api/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category",
    query: [["category_id", "261328"]],
  },
];

/** Null when the eBay request is one of the two pinned reads, else why not (never a value). */
export function ebayReplayRefusal(req: CanonicalRequest): string | null {
  if (req.body !== undefined) return "body_on_get";
  const pinned = EBAY_PINNED_REQUESTS.find((p) => p.method === req.method && p.path === req.path);
  if (!pinned) return "ebay_not_pinned";
  if (JSON.stringify(req.query) !== JSON.stringify(pinned.query)) return "ebay_query_not_pinned";
  return null;
}
