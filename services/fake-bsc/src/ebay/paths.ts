/**
 * The eBay paths the fake answers (CONTRACT.md, "Fake eBay"), as templates
 * with `:name` segments, prefixed by the host part (`ebay/api`, `ebay/apiz`,
 * `ebay/apim`). Paths are normalised (`requestKey.normalisePath`), so they
 * carry no leading or trailing slash: eBay's `commerce/identity/v1/user/` is
 * `ebay/apiz/commerce/identity/v1/user` here.
 */

export type EbayOp =
  | "token"
  | "identityUser"
  | "publicKey"
  | "optedInPrograms"
  | "optIn"
  | "listPaymentPolicies"
  | "listReturnPolicies"
  | "listFulfillmentPolicies"
  | "createPaymentPolicy"
  | "createReturnPolicy"
  | "shippingServices"
  | "itemAspects"
  | "getLocation"
  | "createLocation"
  | "updateLocation"
  | "enableLocation"
  | "bulkItems"
  | "bulkOffers"
  | "bulkPriceQuantity"
  | "getOffers"
  | "updateOffer"
  | "publishOffer"
  | "withdrawOffer"
  | "listItems"
  | "getItem"
  | "deleteItem"
  | "uploadImage"
  | "getImage"
  | "orders";

interface Route {
  op: EbayOp;
  method: string;
  template: string;
}

const API = "ebay/api";

export const EBAY_ROUTES: readonly Route[] = [
  { op: "token", method: "POST", template: `${API}/identity/v1/oauth2/token` },
  { op: "identityUser", method: "GET", template: "ebay/apiz/commerce/identity/v1/user" },
  { op: "publicKey", method: "GET", template: `${API}/commerce/notification/v1/public_key/:publicKeyId` },
  { op: "optedInPrograms", method: "GET", template: `${API}/sell/account/v1/program/get_opted_in_programs` },
  { op: "optIn", method: "POST", template: `${API}/sell/account/v1/program/opt_in` },
  { op: "listPaymentPolicies", method: "GET", template: `${API}/sell/account/v1/payment_policy` },
  { op: "listReturnPolicies", method: "GET", template: `${API}/sell/account/v1/return_policy` },
  { op: "listFulfillmentPolicies", method: "GET", template: `${API}/sell/account/v1/fulfillment_policy` },
  { op: "createPaymentPolicy", method: "POST", template: `${API}/sell/account/v1/payment_policy` },
  { op: "createReturnPolicy", method: "POST", template: `${API}/sell/account/v1/return_policy` },
  { op: "shippingServices", method: "GET", template: `${API}/sell/metadata/v1/shipping/marketplace/:marketplaceId/get_shipping_services` },
  { op: "itemAspects", method: "GET", template: `${API}/commerce/taxonomy/v1/category_tree/:categoryTreeId/get_item_aspects_for_category` },
  { op: "getLocation", method: "GET", template: `${API}/sell/inventory/v1/location/:merchantLocationKey` },
  { op: "createLocation", method: "POST", template: `${API}/sell/inventory/v1/location/:merchantLocationKey` },
  { op: "updateLocation", method: "POST", template: `${API}/sell/inventory/v1/location/:merchantLocationKey/update_location_details` },
  { op: "enableLocation", method: "POST", template: `${API}/sell/inventory/v1/location/:merchantLocationKey/enable` },
  { op: "bulkItems", method: "POST", template: `${API}/sell/inventory/v1/bulk_create_or_replace_inventory_item` },
  { op: "bulkOffers", method: "POST", template: `${API}/sell/inventory/v1/bulk_create_offer` },
  { op: "bulkPriceQuantity", method: "POST", template: `${API}/sell/inventory/v1/bulk_update_price_quantity` },
  { op: "getOffers", method: "GET", template: `${API}/sell/inventory/v1/offer` },
  { op: "updateOffer", method: "PUT", template: `${API}/sell/inventory/v1/offer/:offerId` },
  { op: "publishOffer", method: "POST", template: `${API}/sell/inventory/v1/offer/:offerId/publish` },
  { op: "withdrawOffer", method: "POST", template: `${API}/sell/inventory/v1/offer/:offerId/withdraw` },
  { op: "listItems", method: "GET", template: `${API}/sell/inventory/v1/inventory_item` },
  { op: "getItem", method: "GET", template: `${API}/sell/inventory/v1/inventory_item/:sku` },
  { op: "deleteItem", method: "DELETE", template: `${API}/sell/inventory/v1/inventory_item/:sku` },
  { op: "uploadImage", method: "POST", template: "ebay/apim/commerce/media/v1_beta/image/create_image_from_file" },
  { op: "getImage", method: "GET", template: "ebay/apim/commerce/media/v1_beta/image/:imageId" },
  { op: "orders", method: "GET", template: `${API}/sell/fulfillment/v1/order` },
];

/** The bulk calls: a refused batch is answered per entry (`{responses: [...]}`). */
export const BULK_OPS: ReadonlySet<EbayOp> = new Set<EbayOp>(["bulkItems", "bulkOffers", "bulkPriceQuantity"]);

const MAX_PARAM = 256;

/** Matches a normalised path against a template; params decoded, or null. */
function matchTemplate(template: string, path: string): Record<string, string> | null {
  const t = template.split("/");
  const p = path.split("/");
  if (t.length !== p.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < t.length; i++) {
    if (t[i].startsWith(":")) {
      if (p[i].length === 0 || p[i].length > MAX_PARAM) return null;
      let v: string;
      try {
        v = decodeURIComponent(p[i]);
      } catch {
        return null;
      }
      params[t[i].slice(1)] = v;
    } else if (t[i] !== p[i]) {
      return null;
    }
  }
  return params;
}

export interface EbayRouteMatch {
  op: EbayOp;
  template: string;
  params: Record<string, string>;
}

/** The route a (method, normalised path) is, if the fake models it. */
export function matchEbayRoute(method: string, path: string): EbayRouteMatch | null {
  const m = method.toUpperCase();
  for (const r of EBAY_ROUTES) {
    if (r.method !== m) continue;
    const params = matchTemplate(r.template, path);
    if (params) return { op: r.op, template: r.template, params };
  }
  return null;
}

/** True for a path under the fake's eBay hosts. */
export function isEbayPath(path: string): boolean {
  return path === "ebay" || path.startsWith("ebay/");
}

/**
 * Every template a normalised eBay path answers to (any method), the literal
 * path last. A path no route knows answers only a host-level name, never the
 * literal (it may hold a SKU or an id): `ebay/api/<first two segments>/...`.
 */
export function ebayTemplatesFor(path: string): string[] {
  const out: string[] = [];
  for (const r of EBAY_ROUTES) if (!out.includes(r.template) && matchTemplate(r.template, path)) out.push(r.template);
  if (out.length > 0) return [...out, path];
  return [unknownTemplate(path), path];
}

/** A safe name for an unmodelled eBay path: the host part and the API name only. */
export function unknownTemplate(path: string): string {
  const seg = path.split("/");
  const safe = seg.slice(0, 4).map((s) => (/^[A-Za-z0-9_.-]{1,40}$/.test(s) ? s : ":x"));
  return `${safe.join("/")}${seg.length > 4 ? "/..." : ""}`;
}
