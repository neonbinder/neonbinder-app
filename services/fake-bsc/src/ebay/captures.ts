/**
 * eBay read and write captures (CONTRACT.md, "Write and read captures
 * (eBay)"): the endpoint names `/__fake/write-captures` accepts for eBay,
 * each with the fake's own answer to check a capture against. The writes the
 * recorder stores are on the required list (`EBAY_REQUIRED_CAPTURES` below),
 * which `Captures.missing` and `/__fake/health` report like BSC's two.
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

/**
 * The eBay captures `/__fake/health` `writeCaptures.missing` names until each
 * is stored, like BSC's two write endpoints: every write `recorder ebay-capture`
 * stores whatever the sandbox answers (so a normal run always has it), plus the
 * eight the production run stores (`--prod`, manual, the account owner only). Without one, the
 * fake's answer for that write is checked against nothing. Read captures and
 * the token endpoint are not on it. The unit test "the required eBay captures
 * are exactly what the recorder stores" runs both captures against stubs, so a
 * renamed or dropped capture goes red here.
 */
export const EBAY_REQUIRED_CAPTURES: readonly string[] = Object.freeze([
  // Both runs: the item, the offer and the delete (sandbox 2xx, production the real answers)
  endpointName("bulkItems"),
  endpointName("bulkOffers"),
  endpointName("deleteItem"),
  // Sandbox only (stored whatever status the sandbox answered; the location create is stored
  // only on a 2xx, and the gate 0 sandbox run stored it, HTTP 204)
  endpointName("createLocation"),
  endpointName("updateLocation"),
  endpointName("enableLocation"),
  endpointName("updateOffer"),
  endpointName("publishOffer", REFUSED),
  // Production only (`ebay-capture --prod`)
  endpointName("uploadImage"),
  endpointName("getImage"),
  endpointName("publishOffer"),
  endpointName("bulkPriceQuantity"),
  endpointName("withdrawOffer"),
]);

/**
 * Writes the sandbox run stores only when eBay answers 2xx, and that a
 * sandbox may legitimately not answer 2xx: not required. The opt-in answers
 * 200 the first time and 409 once the account is opted in, so which of its two
 * names a run stores depends on account state (either is fine). The payment
 * and return policy creates were not stored by the first sandbox capture
 * (the sandbox refused them), and stored captures persist, so requiring them
 * would hold `missing[]` red for good. The location create was stored (HTTP
 * 204) and is required. Promote one of these only once a sandbox run is seen
 * to store it.
 */
export const EBAY_CONDITIONAL_WRITE_CAPTURES: readonly string[] = Object.freeze([
  endpointName("optIn"),
  endpointName("optIn", "409"),
  endpointName("createPaymentPolicy"),
  endpointName("createReturnPolicy"),
]);

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
 * One path a capture may lack. By default it covers everything below it (a
 * prefix). `parentOnly` covers the path itself, and what is below it only when
 * the capture lacks the path altogether: an object that is present must still
 * carry its required fields.
 */
interface OptionalRule {
  readonly path: string;
  readonly parentOnly?: true;
}

/**
 * Paths the fake's answer carries that a stored capture may legitimately lack,
 * because eBay includes them only for some objects and the capture saw one
 * object. A path here is never required of the capture; if the capture has it
 * its types are still compared. Scoped per endpoint.
 * Evidence is the first sandbox capture (2026-11-16): each was documented in
 * eBay's contract and absent from the answer the sandbox gave.
 */
const CAPTURE_OPTIONAL: Record<string, readonly OptionalRule[]> = {
  // Account state: the sandbox seller's user answer has no `status`; NB reads userId and username only.
  [endpointName("identityUser")]: [{ path: "status" }],
  // A return policy made some other way (Seller Hub, the older API) has no `default` on its category type.
  [endpointName("listReturnPolicies")]: [{ path: "returnPolicies[].categoryTypes[].default" }],
  // `listing` exists only once an offer has been published; the capture's offer was not. NB reads
  // `listing.listingId` and `status`, so once `listing` is there `listingId` is required and type-checked.
  // `listingStatus` and `soldQuantity` are not read by NB and may vary.
  [endpointName("getOffers")]: [
    { path: "offers[].listing", parentOnly: true },
    { path: "offers[].listing.listingStatus" },
    { path: "offers[].listing.soldQuantity" },
  ],
  // The capture reads the seller's FIRST item (limit=1), which need not be the one NB just sent: the
  // descriptors, package type and aspects are optional on an item, and aspect names with a space or a digit
  // run collapse to `*` in a shape, so which aspect paths exist depends on the item's names (a first item
  // may lack a name such as Sport, or carry no aspects at all).
  [endpointName("listItems")]: [
    { path: "inventoryItems[].conditionDescriptors" },
    { path: "inventoryItems[].packageWeightAndSize.packageType" },
    { path: "inventoryItems[].product.aspects" },
  ],
};

const isBelow = (path: string, parent: string): boolean => path.startsWith(`${parent}.`) || path.startsWith(`${parent}[]`);

/** Is `path` one a capture of `endpoint` may lack? `capture` is the stored shape being checked. */
export function isOptionalCapturePath(endpoint: string, path: string, capture: Shape): boolean {
  const rules = Object.hasOwn(CAPTURE_OPTIONAL, endpoint) ? CAPTURE_OPTIONAL[endpoint] : [];
  return rules.some((r) => {
    if (path === r.path) return true;
    if (!isBelow(path, r.path)) return false;
    if (!r.parentOnly) return true;
    // Below a parent-only rule: optional only while the parent is wholly absent from the capture.
    return capture[r.path] === undefined && !Object.keys(capture).some((k) => isBelow(k, r.path));
  });
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
