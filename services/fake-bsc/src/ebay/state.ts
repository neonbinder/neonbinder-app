/**
 * One fake eBay seller's state, in memory per namespace and seller (CONTRACT.md,
 * "Fake eBay", "Seller state"). It hangs off the namespace's BSC state
 * (`NamespaceState.ebay`), so `/__fake/reset` clears it with the rest of the
 * run and nothing else has to know about it. Tokens are not here: they are
 * sealed and stateless (`tokens.ts`).
 */
import { createHash, randomInt } from "node:crypto";
import type { NamespaceState } from "../state";
import type { EbaySeller } from "./tokens";

export interface Money {
  value: string;
  currency: string;
}

export interface FulfillmentService {
  code: string;
  carrier: string;
  costCents: number | null;
  freeShipping: boolean;
}

export interface Policy {
  id: string;
  name: string;
  /** The fields the create carried (payment, return), or the seeded shape (fulfillment). */
  fields: Record<string, unknown>;
}

export interface Location {
  key: string;
  address: Record<string, string>;
  name: string;
  locationTypes: string[];
  status: "ENABLED" | "DISABLED";
}

export interface InventoryItem {
  sku: string;
  locale: string;
  condition: string;
  conditionDescriptors: unknown[] | null;
  quantity: number;
  product: { title: string; description: string; aspects: Record<string, string[]>; imageUrls: string[] };
  packageWeightAndSize: Record<string, unknown> | null;
}

export interface Offer {
  offerId: string;
  sku: string;
  marketplaceId: string;
  format: string;
  availableQuantity: number;
  categoryId: string;
  listingDescription: string;
  listingDuration: string;
  listingPolicies: Record<string, unknown>;
  price: Money;
  merchantLocationKey: string;
  status: "UNPUBLISHED" | "PUBLISHED";
  /** Set once published; kept after a withdraw (eBay keeps the id on the ended listing). */
  listingId: string | null;
  listingStatus: "ACTIVE" | "ENDED" | null;
  soldQuantity: number;
}

export interface EbayImage {
  id: string;
  imageUrl: string;
  expirationDate: string;
}

export interface EbayOrderLine {
  lineItemId: string;
  sku: string | null;
  title: string;
  quantity: number;
  priceCents: number;
  legacyItemId: string;
}

export interface EbayOrder {
  orderId: string;
  creationDate: string;
  lastModifiedDate: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  cancelled: boolean;
  lines: EbayOrderLine[];
}

export interface EbaySellerState {
  seller: EbaySeller;
  userId: string;
  username: string;
  optedIn: Set<string>;
  payment: Map<string, Policy>;
  returns: Map<string, Policy>;
  fulfillment: Map<string, Policy>;
  locations: Map<string, Location>;
  items: Map<string, InventoryItem>;
  offers: Map<string, Offer>;
  /** sku -> offerId (one FIXED_PRICE offer per SKU on EBAY_US, as NB lists). */
  offerBySku: Map<string, string>;
  images: Map<string, EbayImage>;
  orders: Map<string, EbayOrder>;
}

export const MAX_POLICIES = 50;
export const MAX_LOCATIONS = 20;
export const MAX_ITEMS = 20_000;
export const MAX_IMAGES = 5_000;
export const MAX_ORDERS = 500;

function hash(s: string, n: number): string {
  return createHash("sha256").update(s).digest("hex").slice(0, n);
}

/** A numeric id of `digits` digits (eBay's offer, policy and listing ids are digit strings). */
export function digits(n: number): string {
  let s = String(randomInt(1, 10));
  while (s.length < n) s += String(randomInt(0, 10));
  return s;
}

export function newSellerState(ns: string, seller: EbaySeller): EbaySellerState {
  const h = hash(`${ns}|${seller}`, 12);
  return {
    seller,
    userId: `fakeEbay${h}`,
    username: `nb_fake_${h.slice(0, 8)}`,
    optedIn: new Set(),
    payment: new Map(),
    returns: new Map(),
    fulfillment: new Map(),
    locations: new Map(),
    items: new Map(),
    offers: new Map(),
    offerBySku: new Map(),
    images: new Map(),
    orders: new Map(),
  };
}

/** The namespace's seller, created on first use. */
export function sellerOf(space: NamespaceState, seller: EbaySeller): EbaySellerState {
  space.ebay ??= {};
  let s = space.ebay[seller];
  if (!s) {
    s = newSellerState(space.ns, seller);
    space.ebay[seller] = s;
  }
  return s;
}

/** Cents to eBay's decimal string ("12.50"). */
export function centsToValue(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** eBay's decimal string to whole cents, or null when it is not one. */
export function valueToCents(v: unknown): number | null {
  if (typeof v !== "string" || !/^\d{1,9}(\.\d{1,2})?$/.test(v)) return null;
  return Math.round(Number(v) * 100);
}
