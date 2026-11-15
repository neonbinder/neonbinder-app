/**
 * What the recorder will replay against real BSC (CONTRACT.md, "Recorder").
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
 */
import type { CanonicalRequest } from "../src/requestKey";
import { CARD_LISTING_RE, catalogueEndpointFor } from "../src/sanitise";

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
