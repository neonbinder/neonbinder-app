/**
 * eBay read and write captures (CONTRACT.md, "Write and read captures
 * (eBay)"): the endpoint names `/__fake/write-captures` accepts for eBay,
 * each with the fake's own answer to check a capture against. None is on the
 * required list (`Captures.missing` stays BSC-only until PR B).
 */
import { shapeOf, type Shape } from "../shape";
import { endpointName, REFUSED, sampleAnswers } from "./sample";

/** Every eBay capture endpoint name, in the order the sample walks them. */
export const EBAY_CAPTURE_ENDPOINTS: readonly string[] = Object.freeze([
  // Reads (rows 1, 3, 6, 10, 12, 13, 15, 16; media GET is production only)
  endpointName("optedInPrograms"),
  endpointName("listPaymentPolicies"),
  endpointName("listReturnPolicies"),
  endpointName("listFulfillmentPolicies"),
  endpointName("getLocation"),
  endpointName("getOffers"),
  endpointName("listItems"),
  endpointName("orders"),
  endpointName("identityUser"),
  endpointName("publicKey"),
  endpointName("getImage"),
  // The token endpoint, per grant (row 14)
  endpointName("token", "authorization_code"),
  endpointName("token", "refresh_token"),
  endpointName("token", "client_credentials"),
  // Writes the sandbox accepts
  endpointName("optIn"),
  endpointName("optIn", "409"),
  endpointName("createPaymentPolicy"),
  endpointName("createReturnPolicy"),
  endpointName("createLocation"),
  endpointName("updateLocation"),
  endpointName("enableLocation"),
  endpointName("bulkItems"),
  endpointName("bulkOffers"),
  endpointName("updateOffer"),
  endpointName("publishOffer", REFUSED),
  endpointName("deleteItem"),
  // Writes only production accepts (`ebay-capture --prod`)
  endpointName("uploadImage"),
  endpointName("publishOffer"),
  endpointName("bulkPriceQuantity"),
  endpointName("withdrawOffer"),
]);

const SET = new Set(EBAY_CAPTURE_ENDPOINTS);

export function isEbayCaptureEndpoint(v: unknown): v is string {
  return typeof v === "string" && SET.has(v);
}

/** The object name a capture is stored under: `write-captures/<slug>.json`. */
export function ebayCaptureSlug(endpoint: string): string {
  return `ebay-${endpoint
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`.slice(0, 150);
}

/**
 * Paths the fake's answer carries that a stored capture may legitimately lack,
 * because eBay includes them only for some objects and the capture saw one
 * object. A path here is never required of the capture; if the capture has it
 * its types are still compared. A prefix covers everything below it.
 * Evidence is the first sandbox capture (2026-11-16): each was documented in
 * eBay's contract and absent from the answer the sandbox gave.
 */
const CAPTURE_OPTIONAL: Record<string, readonly string[]> = {
  // Account state: the sandbox seller's user answer has no `status`; NB reads userId and username only.
  [endpointName("identityUser")]: ["status"],
  // A return policy made some other way (Seller Hub, the older API) has no `default` on its category type.
  [endpointName("listReturnPolicies")]: ["returnPolicies[].categoryTypes[].default"],
  // `listing` exists only once an offer has been published; the capture's offer was not.
  [endpointName("getOffers")]: ["offers[].listing"],
  // The capture reads the seller's FIRST item (limit=1), which need not be the one NB just sent: the
  // descriptors and package type are optional on an item, and aspect names with a space or a digit run
  // collapse to `*` in a shape, so which aspect paths exist depends on the item's names.
  [endpointName("listItems")]: [
    "inventoryItems[].conditionDescriptors",
    "inventoryItems[].packageWeightAndSize.packageType",
    "inventoryItems[].product.aspects.*",
  ],
};

/** Is `path` one a capture of `endpoint` may lack? (Exact, or below a listed path.) */
export function isOptionalCapturePath(endpoint: string, path: string): boolean {
  return (CAPTURE_OPTIONAL[endpoint] ?? []).some((p) => path === p || path.startsWith(`${p}.`) || path.startsWith(`${p}[]`));
}

let cached: Record<string, { status: number; shape: Shape }> | null = null;

/** The status and shape the fake answers this endpoint with (from the sample walk). */
export function ebaySynthesisedCapture(endpoint: string): { status: number; shape: Shape } {
  if (!cached) {
    cached = {};
    for (const [name, a] of Object.entries(sampleAnswers())) cached[name] = { status: a.status, shape: a.body === undefined ? {} : shapeOf(a.body) };
  }
  const got = cached[endpoint];
  if (!got) throw new Error("no synthesised answer for this eBay capture endpoint");
  return got;
}
