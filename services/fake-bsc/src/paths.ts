/**
 * BSC API paths the fake knows, and the template names a request answers to
 * (for faults and miss lists). Paths are normalised (`requestKey.normalisePath`).
 */
import { CARD_LISTING_RE, CATALOGUE_PATH_TEMPLATES } from "./sanitise";

export const ORDER_DETAIL_RE = /^seller\/order\/([A-Za-z0-9_-]{1,64})$/;
export const ATTACHMENT_RE = /^common\/card\/([A-Za-z0-9_-]{1,64})\/product\/([A-Za-z0-9_-]{1,64})\/attachment$/;

/** Every template a path answers to; the literal path last. */
export function templatesFor(path: string): string[] {
  if (path === CATALOGUE_PATH_TEMPLATES.filters || path === CATALOGUE_PATH_TEMPLATES.results) return [path];
  if (CARD_LISTING_RE.test(path)) return [CATALOGUE_PATH_TEMPLATES.cardListing, path];
  if (ORDER_DETAIL_RE.test(path)) return ["seller/order/:id", path];
  const a = ATTACHMENT_RE.exec(path);
  if (a) {
    // Convex names it with BSC's own literal "undefined" segments.
    return ["common/card/:id/product/:id/attachment", "common/card/undefined/product/undefined/attachment", path];
  }
  return [path];
}

/** The card id in a card-listing path, if it is one. */
export function cardIdOf(path: string): string | null {
  return CARD_LISTING_RE.exec(path)?.[1] ?? null;
}

/** The write endpoints a capture may describe (CONTRACT.md, "Write capture"). */
export const WRITE_ENDPOINTS = {
  "PUT seller/bulk-upload": "put-seller-bulk-upload",
  "POST common/card/undefined/product/undefined/attachment": "post-attachment",
} as const;
export type WriteEndpoint = keyof typeof WRITE_ENDPOINTS;

export function isWriteEndpoint(v: unknown): v is WriteEndpoint {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(WRITE_ENDPOINTS, v);
}

/** The write endpoint a request is, if any. */
export function writeEndpointFor(method: string, path: string): WriteEndpoint | null {
  if (method === "PUT" && path === "seller/bulk-upload") return "PUT seller/bulk-upload";
  if (method === "POST" && ATTACHMENT_RE.test(path)) return "POST common/card/undefined/product/undefined/attachment";
  return null;
}
