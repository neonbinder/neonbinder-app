/**
 * Synthesised seller orders: empty until a test injects one with
 * `POST /__fake/orders {ns, order}` (CONTRACT.md, "Test controls from
 * Convex"). Rendered into the wire shape `apps/web/convex/lib/bscOrders.ts`
 * parses (`parseBscOrder`, `parseBscOrderHistoryPage`). No buyer data is
 * synthesised at all.
 */
import { randomBytes } from "node:crypto";
import { listingKey, MAX_ORDERS_PER_NAMESPACE, newProductId, type NamespaceState } from "../state";
import { bscTimestamp } from "./sheet";

export interface FakeOrderItem {
  cardId: string;
  condition: string;
  quantity: number;
  priceCents?: number;
  sellerSku?: string;
}

export interface FakeOrder {
  orderNo?: string;
  status?: string;
  orderDateMs?: number;
  items: FakeOrderItem[];
}

const CARD_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ORDER_NO_RE = /^[A-Za-z0-9-]{1,64}$/;
const STATUS_RE = /^[A-Z_]{1,64}$/;

/** Statuses that sell (they lower the listing), as `bscOrderDisposition` reads them. */
const SALE_STATUSES = new Set(["READY_TO_SHIP", "PARTIALLY_REFUNDED_READY_TO_SHIP", "SHIPPED", "PARTIALLY_REFUNDED_SHIPPED"]);

export type FakeOrderRead = { ok: true; order: FakeOrder } | { ok: false; error: string };

export function readFakeOrder(input: unknown): FakeOrderRead {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "order must be an object" };
  const o = input as Record<string, unknown>;
  if (o.orderNo !== undefined && !(typeof o.orderNo === "string" && ORDER_NO_RE.test(o.orderNo))) return { ok: false, error: "orderNo" };
  if (o.status !== undefined && !(typeof o.status === "string" && STATUS_RE.test(o.status))) return { ok: false, error: "status" };
  if (o.orderDateMs !== undefined && !(typeof o.orderDateMs === "number" && Number.isFinite(o.orderDateMs) && o.orderDateMs > 0)) {
    return { ok: false, error: "orderDateMs" };
  }
  if (!Array.isArray(o.items) || o.items.length < 1 || o.items.length > 50) return { ok: false, error: "items must hold 1-50 lines" };
  const items: FakeOrderItem[] = [];
  for (const [i, raw] of o.items.entries()) {
    if (!raw || typeof raw !== "object") return { ok: false, error: `items[${i}]` };
    const it = raw as Record<string, unknown>;
    if (typeof it.cardId !== "string" || !CARD_ID_RE.test(it.cardId)) return { ok: false, error: `items[${i}].cardId` };
    if (typeof it.condition !== "string" || it.condition.length < 1 || it.condition.length > 32) return { ok: false, error: `items[${i}].condition` };
    if (typeof it.quantity !== "number" || !Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > 1000) {
      return { ok: false, error: `items[${i}].quantity` };
    }
    if (it.priceCents !== undefined && !(typeof it.priceCents === "number" && Number.isInteger(it.priceCents) && it.priceCents >= 0 && it.priceCents <= 10_000_000)) {
      return { ok: false, error: `items[${i}].priceCents` };
    }
    if (it.sellerSku !== undefined && !(typeof it.sellerSku === "string" && it.sellerSku.length <= 100)) return { ok: false, error: `items[${i}].sellerSku` };
    items.push({
      cardId: it.cardId,
      condition: it.condition,
      quantity: it.quantity,
      ...(it.priceCents !== undefined ? { priceCents: it.priceCents as number } : {}),
      ...(it.sellerSku !== undefined ? { sellerSku: it.sellerSku as string } : {}),
    });
  }
  return {
    ok: true,
    order: {
      ...(o.orderNo !== undefined ? { orderNo: o.orderNo as string } : {}),
      ...(o.status !== undefined ? { status: o.status as string } : {}),
      ...(o.orderDateMs !== undefined ? { orderDateMs: o.orderDateMs as number } : {}),
      items,
    },
  };
}

const cents = (c: number): string => (c / 100).toFixed(2);

/**
 * Renders and stores an order; a selling status lowers the namespace's
 * listings as BSC would (to 0 at most, removing a sold-out listing).
 */
export interface AddedOrder {
  orderId: string;
  orderNo: string;
  status: string;
  /** The lines as rendered: price in cents, the SKU actually used. */
  items: Array<{ cardId: string; condition: string; quantity: number; priceCents: number; sellerSku: string | null }>;
}

export function addOrder(state: NamespaceState, order: FakeOrder, nowMs: number): AddedOrder | { error: string } {
  if (state.orders.size >= MAX_ORDERS_PER_NAMESPACE) return { error: "too many orders in this namespace" };
  const orderId = randomBytes(10).toString("hex");
  const orderNo = order.orderNo ?? `FAKE-${randomBytes(4).toString("hex").toUpperCase()}`;
  const status = order.status ?? "READY_TO_SHIP";
  const dateMs = order.orderDateMs ?? nowMs;
  let subtotal = 0;
  const added: AddedOrder["items"] = [];
  const orderItems = order.items.map((it) => {
    const listing = state.listings.get(listingKey(it.cardId, it.condition));
    const priceCents = it.priceCents ?? Math.round((listing?.price ?? 0.25) * 100);
    subtotal += priceCents * it.quantity;
    const card: Record<string, unknown> = { id: it.cardId };
    for (const [k, v] of Object.entries(listing?.card ?? {})) if (k !== "id") card[k] = v;
    const sellerSku = it.sellerSku ?? listing?.sellerSku ?? null;
    added.push({ cardId: it.cardId, condition: it.condition, quantity: it.quantity, priceCents, sellerSku });
    return {
      productId: listing?.productId ?? newProductId(),
      productType: "raw",
      cardId: it.cardId,
      price: cents(priceCents),
      condition: it.condition,
      orderQuantity: it.quantity,
      sellerSku,
      sellerId: state.sellerId,
      card,
    };
  });
  const wire: Record<string, unknown> = {
    orderId,
    orderNo,
    orderDate: bscTimestamp(dateMs, 6),
    orderStatus: status,
    orderCurrency: "USD",
    subTotal: cents(subtotal),
    shippingCost: "0.0",
    salesTax: "0.0",
    sellerFee: "0.0",
    buyerDiscountAmount: "0.0",
    total: cents(subtotal),
    sellerNetTotal: cents(subtotal),
    refundTotal: 0.0,
    sellerId: state.sellerId,
    orderItems,
  };
  state.orders.set(orderId, wire);
  if (SALE_STATUSES.has(status)) {
    for (const it of order.items) {
      const key = listingKey(it.cardId, it.condition);
      const l = state.listings.get(key);
      if (!l) continue;
      l.availableQuantity = Math.max(0, l.availableQuantity - it.quantity);
      l.updatedTimestamp = bscTimestamp(nowMs);
      if (l.availableQuantity === 0) state.listings.delete(key);
    }
  }
  return { orderId, orderNo, status, items: added };
}

/** `POST seller/order/history`: newest first, paged. */
export function orderHistory(state: NamespaceState, body: unknown): Record<string, unknown> {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const page = typeof b.page === "number" && Number.isInteger(b.page) && b.page >= 0 ? b.page : 0;
  const size = typeof b.size === "number" && Number.isInteger(b.size) && b.size >= 1 && b.size <= 200 ? b.size : 50;
  const statuses = Array.isArray(b.status) ? b.status.filter((s): s is string => typeof s === "string") : [];
  const all = [...state.orders.values()]
    .filter((o) => statuses.length === 0 || statuses.includes(o.orderStatus as string))
    .sort((a, b2) => ((a.orderDate as string) < (b2.orderDate as string) ? 1 : (a.orderDate as string) > (b2.orderDate as string) ? -1 : 0));
  const results = all.slice(page * size, page * size + size).map((o) => ({
    orderId: o.orderId,
    orderNo: o.orderNo,
    orderDate: (o.orderDate as string).slice(0, 19),
    orderStatus: o.orderStatus,
  }));
  return { totalElements: all.length, results };
}

export function orderDetail(state: NamespaceState, orderId: string): Record<string, unknown> | null {
  return state.orders.get(orderId) ?? null;
}
