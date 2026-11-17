/**
 * The fake eBay's synthesised seller answers (CONTRACT.md, "Fake eBay",
 * "Seller state and the synthesised answers"). Pure functions over one
 * seller's state: the router authenticates and parses, these decide. Shapes
 * are what NB reads (apps/web/convex/adapters/ebaySeller.ts,
 * lib/ebayListing.ts, listingDrainEbay.ts, listingSales.ts) and stay inside
 * eBay's published response schemas (tests/ebay-oas.test.mjs).
 *
 * Validation is what eBay is documented (or was seen) to refuse; anything
 * marked UNVERIFIED in CONTRACT.md is the fake's best guess.
 */
import { randomBytes } from "node:crypto";
import { ebayErrorBody } from "./errors";
import type { EbayOp } from "./paths";
import {
  MAX_IMAGES,
  MAX_ITEMS,
  MAX_LOCATIONS,
  MAX_ORDERS,
  MAX_POLICIES,
  MAX_STORED_JSON_BYTES,
  centsToValue,
  digits,
  jsonBytes,
  valueToCents,
  type EbayOrder,
  type EbaySellerState,
  type FulfillmentService,
  type InventoryItem,
  type Location,
  type Offer,
  type Policy,
} from "./state";

export interface EbayAnswer {
  status: number;
  /** undefined = no body (a 204). */
  body?: unknown;
  headers?: Record<string, string>;
}

export interface SellerCall {
  op: EbayOp;
  params: Record<string, string>;
  query: URLSearchParams;
  /** Parsed JSON body, or undefined. */
  body: unknown;
  /** The raw multipart body and its content type (media upload). */
  raw?: { contentType: string | undefined; bytes: Buffer | undefined };
  now: number;
}

/** The answer, or "needs-model" when the fake has no model for this request (a 501 miss). */
export type SellerResult = EbayAnswer | "needs-model";

export const MARKETPLACE = "EBAY_US";
export const BULK_MAX = 25;
export const SKU_MAX = 50;
export const TITLE_MAX = 80;
export const DESCRIPTION_MAX = 500_000;
export const SELLING_POLICY_MANAGEMENT = "SELLING_POLICY_MANAGEMENT";
/** Where a fake picture "lives": NB's own public fictional test card, never an eBay host. */
export const FAKE_IMAGE_BASE = "https://www.neonbinder.io/placeholder-fixtures/01-vorkle-front.jpg";
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** The order filter NB sends (`ebayListing.ts` ordersFilter): `lastmodifieddate:[<ISO with ms>..]`. */
export const ORDER_FILTER_RE = /^lastmodifieddate:\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)\.\.\]$/;

const LOCATION_KEY_RE = /^[A-Za-z0-9_-]{1,36}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const err = (status: number, ...ids: number[]): EbayAnswer => ({ status, body: ebayErrorBody(ids) });
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown, max = 1000): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const iso = (ms: number) => new Date(ms).toISOString();
const money = (cents: number) => ({ value: centsToValue(cents), currency: "USD" });

// ── Policies ───────────────────────────────────────────────────────────────

const CATEGORY_TYPES = [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES", default: true }];

/** The create-body fields a policy keeps (what NB sends, ebayConnect.ts setMeUp). */
const PAYMENT_FIELDS = ["marketplaceId", "categoryTypes", "immediatePay", "description"] as const;
const RETURN_FIELDS = ["marketplaceId", "categoryTypes", "returnsAccepted", "returnPeriod", "returnShippingCostPayer", "refundMethod", "description"] as const;

function renderPayment(p: Policy): Record<string, unknown> {
  return { paymentPolicyId: p.id, name: p.name, marketplaceId: MARKETPLACE, categoryTypes: CATEGORY_TYPES, ...p.fields };
}

function renderReturn(p: Policy): Record<string, unknown> {
  return { returnPolicyId: p.id, name: p.name, marketplaceId: MARKETPLACE, categoryTypes: CATEGORY_TYPES, ...p.fields };
}

function renderFulfillment(p: Policy): Record<string, unknown> {
  return { fulfillmentPolicyId: p.id, name: p.name, marketplaceId: MARKETPLACE, categoryTypes: CATEGORY_TYPES, ...p.fields };
}

function policyList(kind: "payment" | "return" | "fulfillment", s: EbaySellerState, query: URLSearchParams): EbayAnswer {
  if (query.get("marketplace_id") !== MARKETPLACE) return err(400, 2004);
  // Not opted in: NB never asks (it reads the programs first); answered empty (UNVERIFIED).
  const optedIn = s.optedIn.has(SELLING_POLICY_MANAGEMENT);
  const map = kind === "payment" ? s.payment : kind === "return" ? s.returns : s.fulfillment;
  const render = kind === "payment" ? renderPayment : kind === "return" ? renderReturn : renderFulfillment;
  const list = optedIn ? [...map.values()].map(render) : [];
  const key = kind === "payment" ? "paymentPolicies" : kind === "return" ? "returnPolicies" : "fulfillmentPolicies";
  return { status: 200, body: { total: list.length, [key]: list } };
}

function createPolicy(kind: "payment" | "return", s: EbaySellerState, body: unknown): EbayAnswer {
  if (!isObj(body) || !isStr(body.name, 64) || body.marketplaceId !== MARKETPLACE) return err(400, 2004);
  if (!s.optedIn.has(SELLING_POLICY_MANAGEMENT)) return err(400, 20403);
  const map = kind === "payment" ? s.payment : s.returns;
  for (const p of map.values()) if (p.name.toLowerCase() === body.name.toLowerCase()) return err(400, 20400);
  if (map.size >= MAX_POLICIES) return err(400, 2004);
  const fields: Record<string, unknown> = {};
  for (const k of kind === "payment" ? PAYMENT_FIELDS : RETURN_FIELDS) {
    const v = body[k];
    if (v === undefined) continue;
    if (k === "returnPeriod") {
      if (!isObj(v) || !isInt(v.value, 1, 365) || !isStr(v.unit, 16)) return err(400, 2004);
      fields[k] = { value: v.value, unit: v.unit };
    } else if (k === "categoryTypes") {
      if (!Array.isArray(v) || !v.every((c) => isObj(c) && isStr(c.name, 64))) return err(400, 2004);
      fields[k] = (v as Array<Record<string, unknown>>).map((c) => ({ name: c.name, default: true }));
    } else if (typeof v === "string" || typeof v === "boolean") {
      if (typeof v === "string" && v.length > 1000) return err(400, 2004);
      fields[k] = v;
    } else {
      return err(400, 2004);
    }
  }
  const p: Policy = { id: digits(11), name: body.name, fields };
  map.set(p.id, p);
  const rendered = kind === "payment" ? renderPayment(p) : renderReturn(p);
  return { status: 201, body: { ...rendered, warnings: [] } };
}

export interface SeedFulfillmentPolicy {
  name: string;
  costType: "FLAT_RATE" | "CALCULATED";
  services: FulfillmentService[];
}

/** `POST /__fake/ebay/seller`: a seller's shipping policies, which NB never creates. */
export function seedFulfillmentPolicies(s: EbaySellerState, seeds: SeedFulfillmentPolicy[]): { ok: true; ids: string[] } | { ok: false; error: string } {
  const held = new Set([...s.fulfillment.values()].map((p) => p.name.toLowerCase()));
  for (const seed of seeds) {
    if (held.has(seed.name.toLowerCase())) return { ok: false, error: "a fulfillment policy with that name already exists" };
    held.add(seed.name.toLowerCase());
  }
  if (s.fulfillment.size + seeds.length > MAX_POLICIES) return { ok: false, error: "too many fulfillment policies" };
  const ids: string[] = [];
  for (const seed of seeds) {
    const p: Policy = {
      id: digits(11),
      name: seed.name,
      fields: {
        handlingTime: { value: 1, unit: "DAY" },
        shippingOptions: [
          {
            optionType: "DOMESTIC",
            costType: seed.costType,
            shippingServices: seed.services.map((sv, i) => ({
              sortOrder: i + 1,
              shippingCarrierCode: sv.carrier,
              shippingServiceCode: sv.code,
              freeShipping: sv.freeShipping,
              buyerResponsibleForShipping: false,
              ...(sv.costCents !== null && seed.costType === "FLAT_RATE" ? { shippingCost: money(sv.costCents) } : {}),
            })),
          },
        ],
      },
    };
    s.fulfillment.set(p.id, p);
    ids.push(p.id);
  }
  return { ok: true, ids };
}

// ── Location ───────────────────────────────────────────────────────────────

function readAddress(body: Record<string, unknown>): Record<string, string> | null {
  const loc = body.location;
  if (!isObj(loc) || !isObj(loc.address)) return null;
  const out: Record<string, string> = {};
  for (const k of ["addressLine1", "addressLine2", "city", "stateOrProvince", "postalCode", "country"]) {
    const v = loc.address[k];
    if (v === undefined) continue;
    if (!isStr(v, 128)) return null;
    out[k] = v;
  }
  if (!out.country || !out.postalCode) return null;
  return out;
}

function renderLocation(l: Location): Record<string, unknown> {
  return { merchantLocationKey: l.key, name: l.name, location: { address: l.address }, locationTypes: l.locationTypes, merchantLocationStatus: l.status };
}

function locationWrite(op: "createLocation" | "updateLocation", s: EbaySellerState, key: string, body: unknown): EbayAnswer {
  if (!LOCATION_KEY_RE.test(key)) return err(400, 25709);
  const existing = s.locations.get(key);
  if (op === "createLocation" && existing) return err(400, 25803); // the sandbox's answer, not the contract's 409
  if (op === "updateLocation" && !existing) return err(404, 25804);
  if (!isObj(body)) return err(400, 25709);
  const address = readAddress(body);
  if (!address) return err(400, 25709);
  const types = body.locationTypes === undefined ? ["WAREHOUSE"] : body.locationTypes;
  if (!Array.isArray(types) || !types.every((t) => isStr(t, 32))) return err(400, 25709);
  if (body.name !== undefined && !isStr(body.name, 1000)) return err(400, 25709);
  if (op === "createLocation" && s.locations.size >= MAX_LOCATIONS) return err(400, 25709);
  const status = op === "createLocation" ? (body.merchantLocationStatus === "DISABLED" ? "DISABLED" : "ENABLED") : existing!.status;
  s.locations.set(key, { key, address, name: typeof body.name === "string" ? body.name : (existing?.name ?? key), locationTypes: types as string[], status });
  return { status: 204 };
}

// ── Inventory items ────────────────────────────────────────────────────────

type EntryCheck<T> = { ok: true; value: T } | { ok: false; errorId: number };

function readItem(e: unknown): EntryCheck<InventoryItem> {
  if (!isObj(e) || !isStr(e.sku, SKU_MAX) || !/^[\x21-\x7e]+$/.test(e.sku)) return { ok: false, errorId: 25709 };
  const product = e.product;
  if (!isObj(product)) return { ok: false, errorId: 25709 };
  const images = product.imageUrls;
  if (!Array.isArray(images) || images.length === 0) return { ok: false, errorId: 25717 };
  if (images.length > 24 || !images.every((u) => isStr(u, 500) && u.startsWith("https://"))) return { ok: false, errorId: 25709 };
  if (!isStr(product.title, TITLE_MAX)) return { ok: false, errorId: 25709 };
  if (product.description !== undefined && !(typeof product.description === "string" && product.description.length <= DESCRIPTION_MAX)) return { ok: false, errorId: 25709 };
  const aspects: Record<string, string[]> = {};
  if (product.aspects !== undefined) {
    if (!isObj(product.aspects)) return { ok: false, errorId: 25709 };
    for (const [name, values] of Object.entries(product.aspects)) {
      if (name.length > 65 || !Array.isArray(values) || values.length > 30 || !values.every((v) => isStr(v, 65))) return { ok: false, errorId: 25709 };
      aspects[name] = values as string[];
    }
  }
  if (!isStr(e.condition, 64)) return { ok: false, errorId: 25709 };
  const avail = e.availability;
  const qty = isObj(avail) && isObj(avail.shipToLocationAvailability) ? avail.shipToLocationAvailability.quantity : undefined;
  if (!isInt(qty, 0, 100_000)) return { ok: false, errorId: 25709 };
  if (e.conditionDescriptors !== undefined && !Array.isArray(e.conditionDescriptors)) return { ok: false, errorId: 25709 };
  if (e.packageWeightAndSize !== undefined && !isObj(e.packageWeightAndSize)) return { ok: false, errorId: 25709 };
  // Both are stored as sent: capped, so they cannot grow a seller's memory.
  if (e.conditionDescriptors !== undefined && jsonBytes(e.conditionDescriptors) > MAX_STORED_JSON_BYTES) return { ok: false, errorId: 25709 };
  if (e.packageWeightAndSize !== undefined && jsonBytes(e.packageWeightAndSize) > MAX_STORED_JSON_BYTES) return { ok: false, errorId: 25709 };
  return {
    ok: true,
    value: {
      sku: e.sku,
      locale: typeof e.locale === "string" ? e.locale : "en_US",
      condition: e.condition,
      conditionDescriptors: Array.isArray(e.conditionDescriptors) ? e.conditionDescriptors : null,
      quantity: qty,
      product: { title: product.title, description: typeof product.description === "string" ? product.description : "", aspects, imageUrls: images as string[] },
      packageWeightAndSize: isObj(e.packageWeightAndSize) ? e.packageWeightAndSize : null,
    },
  };
}

function renderItem(i: InventoryItem): Record<string, unknown> {
  return {
    sku: i.sku,
    locale: i.locale,
    condition: i.condition,
    ...(i.conditionDescriptors ? { conditionDescriptors: i.conditionDescriptors } : {}),
    availability: { shipToLocationAvailability: { quantity: i.quantity } },
    ...(i.packageWeightAndSize ? { packageWeightAndSize: i.packageWeightAndSize } : {}),
    product: { title: i.product.title, description: i.product.description, aspects: i.product.aspects, imageUrls: i.product.imageUrls },
  };
}

/** Whole-batch status: 200 all passed, 207 some, 400 none (eBay still sends `responses`). */
function batchStatus(entries: Array<{ statusCode: number }>): number {
  const ok = entries.filter((e) => e.statusCode >= 200 && e.statusCode < 300).length;
  return ok === entries.length ? 200 : ok === 0 ? 400 : 207;
}

function readRequests(body: unknown): unknown[] | null {
  if (!isObj(body) || !Array.isArray(body.requests) || body.requests.length < 1 || body.requests.length > BULK_MAX) return null;
  return body.requests;
}

function bulkItems(s: EbaySellerState, body: unknown): EbayAnswer {
  const reqs = readRequests(body);
  if (!reqs) return err(400, 25709);
  const responses = reqs.map((e) => {
    const r = readItem(e);
    const sku = isObj(e) && typeof e.sku === "string" ? e.sku.slice(0, SKU_MAX) : undefined;
    const locale = isObj(e) && typeof e.locale === "string" ? e.locale.slice(0, 16) : "en_US";
    if (!r.ok) return { statusCode: 400, ...(sku !== undefined ? { sku } : {}), locale, errors: ebayErrorBody([r.errorId]).errors };
    if (!s.items.has(r.value.sku) && s.items.size >= MAX_ITEMS) return { statusCode: 400, sku: r.value.sku, locale, errors: ebayErrorBody([25709]).errors };
    s.items.set(r.value.sku, r.value);
    return { statusCode: 200, sku: r.value.sku, locale };
  });
  return { status: batchStatus(responses), body: { responses } };
}

function getItem(s: EbaySellerState, sku: string): EbayAnswer {
  const i = s.items.get(sku);
  return i ? { status: 200, body: renderItem(i) } : err(404, 25710);
}

function deleteItem(s: EbaySellerState, sku: string): EbayAnswer {
  if (!s.items.has(sku)) return err(404, 25710);
  s.items.delete(sku);
  // eBay also deletes the SKU's offers and ends its listing.
  const offerId = s.offerBySku.get(sku);
  if (offerId !== undefined) {
    s.offers.delete(offerId);
    s.offerBySku.delete(sku);
  }
  return { status: 204 };
}

function listItems(s: EbaySellerState, query: URLSearchParams): EbayAnswer {
  const limit = query.has("limit") ? Number(query.get("limit")) : 25;
  const page = query.has("offset") ? Number(query.get("offset")) : 0;
  if (!isInt(limit, 1, 200) || !isInt(page, 0, 100_000)) return err(400, 25709);
  const all = [...s.items.values()].sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));
  // `offset` is a PAGE number on this endpoint (unlike getOrders).
  const slice = all.slice(page * limit, page * limit + limit);
  const base = "/sell/inventory/v1/inventory_item";
  const more = (page + 1) * limit < all.length;
  return {
    status: 200,
    body: {
      href: `${base}?limit=${limit}&offset=${page}`,
      limit,
      size: slice.length,
      total: all.length,
      inventoryItems: slice.map(renderItem),
      ...(more ? { next: `${base}?limit=${limit}&offset=${page + 1}` } : {}),
    },
  };
}

// ── Offers ─────────────────────────────────────────────────────────────────

interface OfferFields {
  availableQuantity: number;
  categoryId: string;
  listingDescription: string;
  listingDuration: string;
  listingPolicies: Record<string, unknown>;
  price: { value: string; currency: string };
  merchantLocationKey: string;
}

function readOfferFields(e: Record<string, unknown>): EntryCheck<OfferFields> {
  if (!isInt(e.availableQuantity, 0, 100_000)) return { ok: false, errorId: 25709 };
  if (!isStr(e.categoryId, 16) || !/^\d+$/.test(e.categoryId)) return { ok: false, errorId: 25709 };
  if (e.listingDescription !== undefined && !(typeof e.listingDescription === "string" && e.listingDescription.length <= DESCRIPTION_MAX)) return { ok: false, errorId: 25709 };
  if (e.listingDuration !== undefined && e.listingDuration !== "GTC") return { ok: false, errorId: 25709 };
  const lp = e.listingPolicies;
  if (!isObj(lp)) return { ok: false, errorId: 25709 };
  for (const k of ["fulfillmentPolicyId", "paymentPolicyId", "returnPolicyId"]) if (!isStr(lp[k], 64)) return { ok: false, errorId: 25709 };
  const ps = e.pricingSummary;
  const price = isObj(ps) && isObj(ps.price) ? ps.price : null;
  if (!price || valueToCents(price.value) === null || price.currency !== "USD") return { ok: false, errorId: 25709 };
  if (!isStr(e.merchantLocationKey, 36)) return { ok: false, errorId: 25709 };
  const policies: Record<string, unknown> = { fulfillmentPolicyId: lp.fulfillmentPolicyId, paymentPolicyId: lp.paymentPolicyId, returnPolicyId: lp.returnPolicyId };
  if (isObj(lp.bestOfferTerms) && typeof lp.bestOfferTerms.bestOfferEnabled === "boolean") policies.bestOfferTerms = { bestOfferEnabled: lp.bestOfferTerms.bestOfferEnabled };
  return {
    ok: true,
    value: {
      availableQuantity: e.availableQuantity,
      categoryId: e.categoryId,
      listingDescription: typeof e.listingDescription === "string" ? e.listingDescription : "",
      listingDuration: "GTC",
      listingPolicies: policies,
      price: { value: price.value as string, currency: "USD" },
      merchantLocationKey: e.merchantLocationKey,
    },
  };
}

function renderOffer(o: Offer): Record<string, unknown> {
  return {
    offerId: o.offerId,
    sku: o.sku,
    marketplaceId: o.marketplaceId,
    format: o.format,
    availableQuantity: o.availableQuantity,
    categoryId: o.categoryId,
    listingDescription: o.listingDescription,
    listingDuration: o.listingDuration,
    listingPolicies: o.listingPolicies,
    pricingSummary: { price: o.price },
    merchantLocationKey: o.merchantLocationKey,
    status: o.status,
    ...(o.listingId !== null ? { listing: { listingId: o.listingId, listingStatus: o.listingStatus ?? "ENDED", soldQuantity: o.soldQuantity } } : {}),
  };
}

function bulkOffers(s: EbaySellerState, body: unknown): EbayAnswer {
  const reqs = readRequests(body);
  if (!reqs) return err(400, 25709);
  const responses = reqs.map((e) => {
    const sku = isObj(e) && typeof e.sku === "string" ? e.sku.slice(0, SKU_MAX) : undefined;
    const base = { ...(sku !== undefined ? { sku } : {}), marketplaceId: MARKETPLACE, format: "FIXED_PRICE" };
    const fail = (errorId: number) => ({ statusCode: 400, ...base, errors: ebayErrorBody([errorId]).errors });
    if (!isObj(e) || sku === undefined || e.marketplaceId !== MARKETPLACE || e.format !== "FIXED_PRICE") return fail(25709);
    if (!s.items.has(sku)) return fail(25702);
    if (s.offerBySku.has(sku)) return fail(25002); // NB adopts the existing offer through GET offer?sku=
    const f = readOfferFields(e);
    if (!f.ok) return fail(f.errorId);
    const offerId = digits(10);
    s.offers.set(offerId, { offerId, sku, marketplaceId: MARKETPLACE, format: "FIXED_PRICE", ...f.value, status: "UNPUBLISHED", listingId: null, listingStatus: null, soldQuantity: 0 });
    s.offerBySku.set(sku, offerId);
    return { statusCode: 201, ...base, offerId };
  });
  return { status: batchStatus(responses), body: { responses } };
}

function updateOffer(s: EbaySellerState, offerId: string, body: unknown): EbayAnswer {
  const o = s.offers.get(offerId);
  if (!o) return err(404, 25713);
  if (!isObj(body)) return err(400, 25709);
  const f = readOfferFields(body);
  if (!f.ok) return err(400, f.errorId);
  Object.assign(o, f.value);
  return { status: 204 };
}

function getOffers(s: EbaySellerState, query: URLSearchParams): EbayAnswer {
  const sku = query.get("sku");
  if (!isStr(sku, SKU_MAX)) return err(400, 25709);
  const limit = query.has("limit") ? Number(query.get("limit")) : 100;
  if (!isInt(limit, 1, 200)) return err(400, 25709);
  const mp = query.get("marketplace_id");
  const format = query.get("format");
  const id = s.offerBySku.get(sku);
  const o = id !== undefined ? s.offers.get(id) : undefined;
  const offers = o && (mp === null || mp === o.marketplaceId) && (format === null || format === o.format) ? [o] : [];
  // eBay answers a SKU with no offers 404 / 25713; NB reads that as "none".
  if (offers.length === 0) return err(404, 25713);
  return { status: 200, body: { href: `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&limit=${limit}`, limit, size: offers.length, total: offers.length, offers: offers.map(renderOffer) } };
}

function publish(s: EbaySellerState, offerId: string): EbayAnswer {
  const o = s.offers.get(offerId);
  if (!o) return err(404, 25713);
  if (o.status === "PUBLISHED" && o.listingStatus === "ACTIVE" && o.listingId !== null) return { status: 200, body: { listingId: o.listingId, warnings: [] } };
  const item = s.items.get(o.sku);
  if (!item) return err(400, 25702);
  if (item.product.imageUrls.length === 0) return err(400, 25717);
  const lp = o.listingPolicies;
  if (!s.fulfillment.has(String(lp.fulfillmentPolicyId))) return err(400, 25007);
  if (!s.payment.has(String(lp.paymentPolicyId)) || !s.returns.has(String(lp.returnPolicyId))) return err(400, 25002);
  const loc = s.locations.get(o.merchantLocationKey);
  if (!loc || loc.status !== "ENABLED") return err(400, 25002);
  o.status = "PUBLISHED";
  o.listingId = digits(12);
  o.listingStatus = "ACTIVE";
  o.soldQuantity = 0;
  return { status: 200, body: { listingId: o.listingId, warnings: [] } };
}

function withdraw(s: EbaySellerState, offerId: string): EbayAnswer {
  const o = s.offers.get(offerId);
  // An offer that is not live: 404 / 25713, which NB reads as already ended (UNVERIFIED).
  if (!o || o.status !== "PUBLISHED" || o.listingStatus !== "ACTIVE" || o.listingId === null) return err(404, 25713);
  o.status = "UNPUBLISHED";
  o.listingStatus = "ENDED";
  return { status: 200, body: { listingId: o.listingId, warnings: [] } };
}

function bulkPriceQuantity(s: EbaySellerState, body: unknown): EbayAnswer {
  const reqs = readRequests(body);
  if (!reqs) return err(400, 25709);
  const responses: Array<Record<string, unknown> & { statusCode: number }> = [];
  for (const e of reqs) {
    const sku = isObj(e) && typeof e.sku === "string" ? e.sku.slice(0, SKU_MAX) : undefined;
    const fail = (errorId: number, offerId?: string) =>
      responses.push({ statusCode: 400, ...(sku !== undefined ? { sku } : {}), ...(offerId !== undefined ? { offerId } : {}), errors: ebayErrorBody([errorId]).errors });
    if (!isObj(e) || sku === undefined) {
      fail(25709);
      continue;
    }
    const item = s.items.get(sku);
    if (!item) {
      fail(25702);
      continue;
    }
    const ship = e.shipToLocationAvailability;
    if (ship !== undefined) {
      if (!isObj(ship) || !isInt(ship.quantity, 0, 100_000)) {
        fail(25709);
        continue;
      }
      item.quantity = ship.quantity;
    }
    const offers = e.offers === undefined ? [] : e.offers;
    if (!Array.isArray(offers) || offers.length > 25) {
      fail(25709);
      continue;
    }
    if (offers.length === 0) responses.push({ statusCode: 200, sku });
    for (const raw of offers) {
      const id = isObj(raw) && typeof raw.offerId === "string" ? raw.offerId.slice(0, 64) : undefined;
      const o = id !== undefined ? s.offers.get(id) : undefined;
      if (!isObj(raw) || !o || o.sku !== sku) {
        fail(25713, id);
        continue;
      }
      if (raw.availableQuantity !== undefined && !isInt(raw.availableQuantity, 0, 100_000)) {
        fail(25709, id);
        continue;
      }
      const price = raw.price;
      if (price !== undefined && !(isObj(price) && valueToCents(price.value) !== null && price.currency === "USD")) {
        fail(25709, id);
        continue;
      }
      if (typeof raw.availableQuantity === "number") o.availableQuantity = raw.availableQuantity;
      if (isObj(price)) o.price = { value: price.value as string, currency: "USD" };
      responses.push({ statusCode: 200, sku, offerId: o.offerId });
    }
  }
  return { status: batchStatus(responses), body: { responses } };
}

// ── Media ──────────────────────────────────────────────────────────────────

const IMAGE_MAGIC: Array<{ type: string; test: (b: Buffer) => boolean }> = [
  { type: "image/jpeg", test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: "image/png", test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: "image/gif", test: (b) => b.length > 6 && (b.subarray(0, 6).toString("latin1") === "GIF87a" || b.subarray(0, 6).toString("latin1") === "GIF89a") },
  { type: "image/webp", test: (b) => b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
];

/** The bytes of the multipart part named `image`, or null. Reads only part headers and the part body. */
export function multipartImage(contentType: string | undefined, raw: Buffer | undefined): Buffer | null {
  if (!contentType || !raw) return null;
  const m = /^multipart\/form-data;.*\bboundary=(?:"([^"]{1,70})"|([^\s;]{1,70}))/i.exec(contentType);
  if (!m) return null;
  const delim = Buffer.from(`--${m[1] ?? m[2]}`, "latin1");
  let at = raw.indexOf(delim);
  while (at !== -1) {
    const headStart = at + delim.length + 2; // past CRLF
    const headEnd = raw.indexOf("\r\n\r\n", headStart, "latin1");
    if (headEnd === -1) return null;
    const head = raw.subarray(headStart, headEnd).toString("latin1");
    const next = raw.indexOf(delim, headEnd + 4);
    if (next === -1) return null;
    if (/content-disposition:[^\r\n]*\bname="image"/i.test(head)) {
      return raw.subarray(headEnd + 4, next - 2); // drop the CRLF before the delimiter
    }
    at = next;
  }
  return null;
}

function renderImage(id: string, imageUrl: string, expirationDate: string): Record<string, unknown> {
  void id;
  return { imageUrl, expirationDate };
}

function uploadImage(s: EbaySellerState, call: SellerCall): EbayAnswer {
  const bytes = multipartImage(call.raw?.contentType, call.raw?.bytes);
  if (!bytes || bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES || !IMAGE_MAGIC.some((t) => t.test(bytes))) return err(400, 190202);
  if (s.images.size >= MAX_IMAGES) {
    const first = s.images.keys().next().value;
    if (first !== undefined) s.images.delete(first);
  }
  const id = `fake${randomBytes(12).toString("hex")}`;
  const image = { id, imageUrl: `${FAKE_IMAGE_BASE}?fake-ebay-image=${id}`, expirationDate: iso(call.now + 30 * 24 * 3600 * 1000) };
  s.images.set(id, image);
  return {
    status: 201,
    // A path on the fake, never an eBay host; NB takes the id from it and reads the configured media base.
    headers: { location: `/ebay/apim/commerce/media/v1_beta/image/${id}` },
    body: renderImage(id, image.imageUrl, image.expirationDate),
  };
}

// ── Orders ─────────────────────────────────────────────────────────────────

export function renderOrder(o: EbayOrder, username: string): Record<string, unknown> {
  const subtotal = o.lines.reduce((n, l) => n + l.priceCents * l.quantity, 0);
  return {
    orderId: o.orderId,
    creationDate: o.creationDate,
    lastModifiedDate: o.lastModifiedDate,
    orderFulfillmentStatus: o.fulfillmentStatus,
    orderPaymentStatus: o.paymentStatus,
    sellerId: username,
    cancelStatus: { cancelState: o.cancelled ? "CANCELED" : "NONE_REQUESTED", cancelRequests: [] },
    pricingSummary: { priceSubtotal: money(subtotal), deliveryCost: money(0), total: money(subtotal) },
    totalMarketplaceFee: money(Math.round(subtotal * 0.1325)),
    lineItems: o.lines.map((l) => ({
      lineItemId: l.lineItemId,
      legacyItemId: l.legacyItemId,
      ...(l.sku !== null ? { sku: l.sku } : {}),
      title: l.title,
      quantity: l.quantity,
      lineItemCost: money(l.priceCents * l.quantity),
      total: money(l.priceCents * l.quantity),
      soldFormat: "FIXED_PRICE",
      listingMarketplaceId: MARKETPLACE,
      purchaseMarketplaceId: MARKETPLACE,
      lineItemFulfillmentStatus: o.fulfillmentStatus === "FULFILLED" ? "FULFILLED" : "NOT_STARTED",
    })),
  };
}

function orders(s: EbaySellerState, query: URLSearchParams): SellerResult {
  const filter = query.get("filter");
  const m = filter === null ? null : ORDER_FILTER_RE.exec(filter);
  // Only the filter NB sends is modelled; anything else is a needs-model miss.
  if (!m) return "needs-model";
  const since = Date.parse(m[1]);
  if (Number.isNaN(since)) return err(400, 2004);
  for (const k of query.keys()) if (!["filter", "limit", "offset"].includes(k)) return "needs-model";
  const limit = query.has("limit") ? Number(query.get("limit")) : 50;
  const offset = query.has("offset") ? Number(query.get("offset")) : 0;
  if (!isInt(limit, 1, 200) || !isInt(offset, 0, 100_000)) return err(400, 2004);
  const all = [...s.orders.values()]
    .filter((o) => Date.parse(o.lastModifiedDate) >= since)
    .sort((a, b) => (a.lastModifiedDate < b.lastModifiedDate ? -1 : a.lastModifiedDate > b.lastModifiedDate ? 1 : a.orderId < b.orderId ? -1 : 1));
  const page = all.slice(offset, offset + limit);
  const href = (off: number) => `/sell/fulfillment/v1/order?filter=${encodeURIComponent(filter!)}&limit=${limit}&offset=${off}`;
  return {
    status: 200,
    body: {
      href: href(offset),
      total: all.length,
      limit,
      offset,
      orders: page.map((o) => renderOrder(o, s.username)),
      ...(offset + limit < all.length ? { next: href(offset + limit) } : {}),
    },
  };
}

export interface FakeEbayOrderLine {
  sku?: string;
  title?: string;
  quantity: number;
  priceCents?: number;
  listingId?: string;
}

export interface FakeEbayOrder {
  orderId?: string;
  paymentStatus?: string;
  cancelled?: boolean;
  fulfillmentStatus?: string;
  creationDateMs?: number;
  lines: FakeEbayOrderLine[];
}

const PAYMENT_STATUSES = new Set(["PAID", "PARTIALLY_REFUNDED", "FULLY_REFUNDED", "PENDING", "FAILED"]);
const FULFILLMENT_STATUSES = new Set(["NOT_STARTED", "IN_PROGRESS", "FULFILLED"]);
const ORDER_ID_RE = /^[0-9A-Za-z-]{1,64}$/;

export function readFakeEbayOrder(input: unknown): { ok: true; order: FakeEbayOrder } | { ok: false; error: string } {
  if (!isObj(input)) return { ok: false, error: "order must be an object" };
  const o = input;
  if (o.orderId !== undefined && !(typeof o.orderId === "string" && ORDER_ID_RE.test(o.orderId))) return { ok: false, error: "orderId" };
  if (o.paymentStatus !== undefined && !(typeof o.paymentStatus === "string" && PAYMENT_STATUSES.has(o.paymentStatus))) return { ok: false, error: "paymentStatus" };
  if (o.fulfillmentStatus !== undefined && !(typeof o.fulfillmentStatus === "string" && FULFILLMENT_STATUSES.has(o.fulfillmentStatus))) return { ok: false, error: "fulfillmentStatus" };
  if (o.cancelled !== undefined && typeof o.cancelled !== "boolean") return { ok: false, error: "cancelled" };
  if (o.creationDateMs !== undefined && !(typeof o.creationDateMs === "number" && Number.isFinite(o.creationDateMs) && o.creationDateMs > 0 && o.creationDateMs < 8.64e15)) {
    return { ok: false, error: "creationDateMs" };
  }
  if (!Array.isArray(o.lines) || o.lines.length < 1 || o.lines.length > 50) return { ok: false, error: "lines must hold 1-50 lines" };
  const lines: FakeEbayOrderLine[] = [];
  for (const [i, raw] of o.lines.entries()) {
    if (!isObj(raw)) return { ok: false, error: `lines[${i}]` };
    if (raw.sku !== undefined && !(typeof raw.sku === "string" && raw.sku.length >= 1 && raw.sku.length <= SKU_MAX)) return { ok: false, error: `lines[${i}].sku` };
    if (raw.title !== undefined && !(typeof raw.title === "string" && raw.title.length >= 1 && raw.title.length <= TITLE_MAX && !/[\u0000-\u001f\u007f]/.test(raw.title))) {
      return { ok: false, error: `lines[${i}].title` };
    }
    if (!isInt(raw.quantity, 1, 1000)) return { ok: false, error: `lines[${i}].quantity` };
    if (raw.priceCents !== undefined && !isInt(raw.priceCents, 0, 10_000_000)) return { ok: false, error: `lines[${i}].priceCents` };
    if (raw.listingId !== undefined && !(typeof raw.listingId === "string" && /^\d{1,40}$/.test(raw.listingId))) return { ok: false, error: `lines[${i}].listingId` };
    lines.push({
      quantity: raw.quantity,
      ...(raw.sku !== undefined ? { sku: raw.sku as string } : {}),
      ...(raw.title !== undefined ? { title: raw.title as string } : {}),
      ...(raw.priceCents !== undefined ? { priceCents: raw.priceCents as number } : {}),
      ...(raw.listingId !== undefined ? { listingId: raw.listingId as string } : {}),
    });
  }
  return {
    ok: true,
    order: {
      lines,
      ...(o.orderId !== undefined ? { orderId: o.orderId as string } : {}),
      ...(o.paymentStatus !== undefined ? { paymentStatus: o.paymentStatus as string } : {}),
      ...(o.fulfillmentStatus !== undefined ? { fulfillmentStatus: o.fulfillmentStatus as string } : {}),
      ...(o.cancelled !== undefined ? { cancelled: o.cancelled as boolean } : {}),
      ...(o.creationDateMs !== undefined ? { creationDateMs: o.creationDateMs as number } : {}),
    },
  };
}

/** Stores an injected order (a known orderId replaces its order). Sells down a new order's SKUs, as eBay does. */
export function addEbayOrder(s: EbaySellerState, input: FakeEbayOrder, now: number): { ok: true; order: EbayOrder } | { ok: false; error: string } {
  const prev = input.orderId !== undefined ? s.orders.get(input.orderId) : undefined;
  if (!prev && s.orders.size >= MAX_ORDERS) return { ok: false, error: "too many orders for this seller" };
  const orderId = input.orderId ?? `${digits(2)}-${digits(5)}-${digits(5)}`;
  const lines = input.lines.map((l) => {
    const offerId = l.sku !== undefined ? s.offerBySku.get(l.sku) : undefined;
    const offer = offerId !== undefined ? s.offers.get(offerId) : undefined;
    const listingId = l.listingId ?? offer?.listingId ?? digits(12);
    const priceCents = l.priceCents ?? (offer ? (valueToCents(offer.price.value) ?? 99) : 99);
    return {
      lineItemId: digits(14),
      sku: l.sku ?? null,
      title: l.title ?? s.items.get(l.sku ?? "")?.product.title ?? "Fake eBay item",
      quantity: l.quantity,
      priceCents,
      legacyItemId: listingId,
    };
  });
  const order: EbayOrder = {
    orderId,
    creationDate: prev?.creationDate ?? iso(input.creationDateMs ?? now),
    lastModifiedDate: iso(now),
    paymentStatus: input.paymentStatus ?? "PAID",
    fulfillmentStatus: input.fulfillmentStatus ?? "NOT_STARTED",
    cancelled: input.cancelled ?? false,
    lines,
  };
  s.orders.set(orderId, order);
  const sells = !order.cancelled && (order.paymentStatus === "PAID" || order.paymentStatus === "PARTIALLY_REFUNDED");
  if (!prev && sells) {
    for (const l of lines) {
      if (l.sku === null) continue;
      const item = s.items.get(l.sku);
      if (item) item.quantity = Math.max(0, item.quantity - l.quantity);
      const offerId = s.offerBySku.get(l.sku);
      const offer = offerId !== undefined ? s.offers.get(offerId) : undefined;
      if (offer && offer.listingId === l.legacyItemId) {
        offer.availableQuantity = Math.max(0, offer.availableQuantity - l.quantity);
        offer.soldQuantity += l.quantity;
      }
    }
  }
  return { ok: true, order };
}

// ── Dispatch ───────────────────────────────────────────────────────────────

export function identityUser(s: EbaySellerState): Record<string, unknown> {
  return { userId: s.userId, username: s.username, accountType: "INDIVIDUAL", registrationMarketplaceId: MARKETPLACE, status: "CONFIRMED" };
}

/** A seller call (a user token named this seller). */
export function answerSeller(s: EbaySellerState, call: SellerCall): SellerResult {
  const p = call.params;
  switch (call.op) {
    case "identityUser":
      return { status: 200, body: identityUser(s) };
    case "optedInPrograms":
      return { status: 200, body: { programs: [...s.optedIn].map((programType) => ({ programType })) } };
    case "optIn": {
      if (!isObj(call.body) || call.body.programType !== SELLING_POLICY_MANAGEMENT) return err(400, 2004);
      if (s.optedIn.has(SELLING_POLICY_MANAGEMENT)) return err(409, 20409);
      s.optedIn.add(SELLING_POLICY_MANAGEMENT);
      return { status: 200, body: {} };
    }
    case "listPaymentPolicies":
      return policyList("payment", s, call.query);
    case "listReturnPolicies":
      return policyList("return", s, call.query);
    case "listFulfillmentPolicies":
      return policyList("fulfillment", s, call.query);
    case "createPaymentPolicy":
      return createPolicy("payment", s, call.body);
    case "createReturnPolicy":
      return createPolicy("return", s, call.body);
    case "getLocation": {
      const l = s.locations.get(p.merchantLocationKey);
      return l ? { status: 200, body: renderLocation(l) } : err(404, 25804);
    }
    case "createLocation":
      return locationWrite("createLocation", s, p.merchantLocationKey, call.body);
    case "updateLocation":
      return locationWrite("updateLocation", s, p.merchantLocationKey, call.body);
    case "enableLocation": {
      const l = s.locations.get(p.merchantLocationKey);
      if (!l) return err(404, 25804);
      l.status = "ENABLED";
      return { status: 200, body: {} };
    }
    case "bulkItems":
      return bulkItems(s, call.body);
    case "bulkOffers":
      return bulkOffers(s, call.body);
    case "bulkPriceQuantity":
      return bulkPriceQuantity(s, call.body);
    case "getOffers":
      return getOffers(s, call.query);
    case "updateOffer":
      return ID_RE.test(p.offerId) ? updateOffer(s, p.offerId, call.body) : err(404, 25713);
    case "publishOffer":
      return ID_RE.test(p.offerId) ? publish(s, p.offerId) : err(404, 25713);
    case "withdrawOffer":
      return ID_RE.test(p.offerId) ? withdraw(s, p.offerId) : err(404, 25713);
    case "listItems":
      return listItems(s, call.query);
    case "getItem":
      return getItem(s, p.sku);
    case "deleteItem":
      return deleteItem(s, p.sku);
    case "uploadImage":
      return uploadImage(s, call);
    case "getImage": {
      const img = s.images.get(p.imageId);
      return img ? { status: 200, body: renderImage(img.id, img.imageUrl, img.expirationDate) } : err(404, 190011);
    }
    case "orders":
      return orders(s, call.query);
    default:
      return "needs-model";
  }
}
