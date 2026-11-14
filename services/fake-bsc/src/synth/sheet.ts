/**
 * The synthesised seller side: profile, seller sheet, listing PUT and photo
 * upload. Shapes follow what NeonBinder parses:
 *
 *   profile   apps/web/convex/adapters/bscSeller.ts fetchBscSellerId and
 *             services/browser bsc-adapter attemptSellerProfile:
 *             `sellerProfile.sellerId`, `sellerProfile.sellerStoreName`.
 *   sheet     apps/web/convex/lib/bscSheetPlan.ts narrowBscSheetRow: a bare
 *             array of rows with `card.id`, `card.cardNo`, `cardId`,
 *             `condition`, `availableQuantity`, `price` (dollar string),
 *             `productType`, `sellerSku`, `sellerImgFront/Back`, `productId`.
 *   put       bscSeller.ts putBscListings: `{sellerId, listings}`; NB ignores
 *             the answer and reads the sheet back.
 *   photo     bscSeller.ts uploadBscSellerPhoto: `{objectKey}`.
 *
 * The PUT and photo answers are the fake's best guess until a write capture
 * pins them (`/__fake/write-captures`); `putAnswer` and `photoAnswer` are the
 * one place each is built.
 */
import { randomBytes } from "node:crypto";
import { canonicalRequest, type CanonicalRequest } from "../requestKey";
import { listingKey, newProductId, MAX_LISTINGS_PER_NAMESPACE, type Listing, type NamespaceState } from "../state";

export const DEFAULT_IMG_FRONT = "/Images/DefaultFront.gif";
export const DEFAULT_IMG_BACK = "/Images/DefaultBack.gif";
export const BSC_PUT_MAX_ROWS = 100;
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

const CARD_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const IMG_RE = /^[A-Za-z0-9._\-/]{1,300}$/;

/** BSC timestamps carry no zone and six fraction digits. */
export function bscTimestamp(ms: number, fractionDigits = 6): string {
  const iso = new Date(ms).toISOString(); // 2026-10-30T15:01:06.541Z
  const base = iso.slice(0, 19);
  if (fractionDigits === 0) return base;
  return `${base}.${iso.slice(20, 23).padEnd(fractionDigits, "0")}`;
}

export function profileAnswer(state: Pick<NamespaceState, "userId" | "sellerId" | "storeName">): Record<string, unknown> {
  return {
    userId: state.userId,
    sellerProfile: { sellerId: state.sellerId, sellerStoreName: state.storeName },
  };
}

// ── Sheet ──────────────────────────────────────────────────────────────────

export type SheetRequest =
  | { ok: true; condition: string; filters: Record<string, unknown> }
  | { ok: false; status: number; error: string };

/**
 * Reads a `POST seller/bulk-upload/results` body. Like BSC: a missing or null
 * condition is a 500; "" and "all" answer blank templates (see `synthSheet`).
 */
export function readSheetRequest(body: unknown): SheetRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, status: 400, error: "body must be an object" };
  const b = body as Record<string, unknown>;
  if (b.condition === undefined || b.condition === null) return { ok: false, status: 500, error: "condition is required" };
  if (typeof b.condition !== "string" || b.condition.length > 32) return { ok: false, status: 400, error: "condition" };
  const filters = b.filters;
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) return { ok: false, status: 400, error: "filters" };
  return { ok: true, condition: b.condition, filters: filters as Record<string, unknown> };
}

/**
 * The catalogue request whose recording a sheet for `filters` is built from:
 * exactly what `fetchBscChecklist` sends, so recording it serves both.
 */
export function catalogueRequestFor(filters: Record<string, unknown>): CanonicalRequest {
  return canonicalRequest({
    method: "POST",
    path: "search/bulk-upload/results",
    body: { condition: "all", page: 0, size: 5000, sort: "default", filters },
  });
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : null;
}

function cardFrom(row: Record<string, unknown>, id: string): Record<string, unknown> {
  const card: Record<string, unknown> = { id };
  const cardNo = str(row.cardNo ?? row.cardNumber ?? row.number);
  if (cardNo !== null) card.cardNo = cardNo;
  for (const k of ["players", "playerAttribute", "playerAttributeDesc", "setName"]) {
    if (row[k] !== undefined) card[k] = row[k];
  }
  return card;
}

function dollars(price: number): string {
  return price.toFixed(2);
}

/**
 * One row per catalogue card for `condition`: the namespace's listing when it
 * has one, otherwise a blank template (quantity 0, price "0", a NEW productId
 * on every read, BSC's default images). "" and "all" answer templates only,
 * hiding listings, as BSC does.
 */
export function synthSheet(
  catalogueRows: readonly unknown[],
  state: NamespaceState,
  condition: string,
  nowMs: number,
): Record<string, unknown>[] {
  const showListings = condition !== "" && condition.toLowerCase() !== "all";
  const out: Record<string, unknown>[] = [];
  for (const raw of catalogueRows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const id = str(row.id);
    if (id === null) continue;
    const card = cardFrom(row, id);
    const listing = showListings ? state.listings.get(listingKey(id, condition)) : undefined;
    if (listing) {
      out.push({
        productId: listing.productId,
        productType: "raw",
        cardId: id,
        price: dollars(listing.price),
        condition,
        availableQuantity: listing.availableQuantity,
        active: listing.availableQuantity > 0,
        sellerId: state.sellerId,
        sellerSku: listing.sellerSku,
        sellerImgFront: listing.sellerImgFront ?? DEFAULT_IMG_FRONT,
        sellerImgBack: listing.sellerImgBack ?? DEFAULT_IMG_BACK,
        updatedTimestamp: listing.updatedTimestamp,
        card,
      });
    } else {
      out.push({
        productId: newProductId(),
        productType: "raw",
        cardId: id,
        price: "0",
        condition,
        availableQuantity: 0,
        active: false,
        sellerId: state.sellerId,
        sellerSku: null,
        sellerImgFront: DEFAULT_IMG_FRONT,
        sellerImgBack: DEFAULT_IMG_BACK,
        updatedTimestamp: bscTimestamp(nowMs),
        card,
      });
    }
  }
  return out;
}

// ── PUT seller/bulk-upload ─────────────────────────────────────────────────

/** Dollars (string or number) → a dollar number, or null. */
export function readDollars(v: unknown): number | null {
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && /^\s*\d*\.?\d+\s*$/.test(v)) n = Number(v);
  else return null;
  return Number.isFinite(n) && n >= 0 && n <= 100_000 ? Math.round(n * 100) / 100 : null;
}

export type PutOutcome =
  | { status: 200; body: unknown }
  | { status: 400 | 403 | 500; body: { error: string } };

interface PutRow {
  cardId: string;
  condition: string;
  availableQuantity: number;
  price: number;
  sellerSku: string | null;
  sellerImgFront: string | null;
  sellerImgBack: string | null;
  card: Record<string, unknown> | null;
}

function readPutRow(v: unknown): PutRow | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const card = r.card && typeof r.card === "object" && !Array.isArray(r.card) ? (r.card as Record<string, unknown>) : null;
  const cardId = typeof r.cardId === "string" ? r.cardId : card && typeof card.id === "string" ? card.id : null;
  if (cardId === null || !CARD_ID_RE.test(cardId)) return null;
  if (card && card.id !== undefined && card.id !== cardId) return null;
  if (typeof r.condition !== "string" || r.condition.length < 1 || r.condition.length > 32) return null;
  const q = r.availableQuantity;
  if (typeof q !== "number" || !Number.isInteger(q) || q < 0 || q > 100_000) return null;
  const price = readDollars(r.price);
  if (price === null) return null;
  const sku = r.sellerSku;
  if (sku !== undefined && sku !== null && (typeof sku !== "string" || sku.length > 100)) return null;
  const img = (x: unknown): string | null | undefined =>
    x === undefined || x === null ? null : typeof x === "string" && IMG_RE.test(x) ? x : undefined;
  const front = img(r.sellerImgFront);
  const back = img(r.sellerImgBack);
  if (front === undefined || back === undefined) return null;
  const keptCard: Record<string, unknown> | null = card
    ? Object.fromEntries(
        ["id", "cardNo", "players", "setName", "variant", "variantName", "sport", "year", "playerAttribute"]
          .filter((k) => typeof card[k] === "string" || typeof card[k] === "number")
          .map((k) => [k, card[k]]),
      )
    : null;
  return {
    cardId,
    condition: r.condition,
    availableQuantity: q,
    price,
    sellerSku: typeof sku === "string" && sku !== "" ? sku : null,
    sellerImgFront: front,
    sellerImgBack: back,
    card: keptCard,
  };
}

/** The PUT's answer: the rows as saved. Pinned by a write capture once one exists. */
export function putAnswer(saved: readonly Listing[], state: NamespaceState): unknown {
  return saved.map((l) => ({
    productId: l.productId,
    productType: "raw",
    cardId: l.cardId,
    condition: l.condition,
    availableQuantity: l.availableQuantity,
    price: dollars(l.price),
    sellerId: state.sellerId,
    sellerSku: l.sellerSku,
    updatedTimestamp: l.updatedTimestamp,
  }));
}

/**
 * Applies a PUT. Every row is checked first (a bad row refuses the whole PUT
 * with nothing applied). Two rows for one (card, condition) is BSC's 500 that
 * was half applied (NEO-370): rows before the repeat are saved, then 500.
 * Quantity 0 removes the listing (the card shows a blank template again).
 */
export function applyPut(state: NamespaceState, body: unknown, nowMs: number): PutOutcome {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { status: 400, body: { error: "body must be an object" } };
  const b = body as Record<string, unknown>;
  if (b.sellerId !== state.sellerId) return { status: 403, body: { error: "sellerId does not match this account" } };
  if (!Array.isArray(b.listings) || b.listings.length === 0) return { status: 400, body: { error: "listings must be a non-empty array" } };
  if (b.listings.length > BSC_PUT_MAX_ROWS) return { status: 400, body: { error: `at most ${BSC_PUT_MAX_ROWS} listings` } };
  const rows: PutRow[] = [];
  for (const raw of b.listings) {
    const row = readPutRow(raw);
    if (!row) return { status: 400, body: { error: "a listing row could not be read" } };
    rows.push(row);
  }
  const seen = new Set<string>();
  const saved: Listing[] = [];
  const ts = bscTimestamp(nowMs);
  for (const row of rows) {
    const key = listingKey(row.cardId, row.condition);
    if (seen.has(key)) return { status: 500, body: { error: "Internal Server Error" } };
    seen.add(key);
    const prev = state.listings.get(key);
    if (row.availableQuantity === 0) {
      state.listings.delete(key);
      saved.push({ ...(prev ?? emptyListing(row, ts)), availableQuantity: 0, price: row.price, updatedTimestamp: ts });
      continue;
    }
    if (!prev && state.listings.size >= MAX_LISTINGS_PER_NAMESPACE) return { status: 500, body: { error: "Internal Server Error" } };
    const listing: Listing = {
      cardId: row.cardId,
      condition: row.condition,
      productId: prev?.productId ?? newProductId(),
      availableQuantity: row.availableQuantity,
      price: row.price,
      sellerSku: row.sellerSku,
      sellerImgFront: row.sellerImgFront ?? prev?.sellerImgFront ?? null,
      sellerImgBack: row.sellerImgBack ?? prev?.sellerImgBack ?? null,
      updatedTimestamp: ts,
      card: row.card ?? prev?.card ?? null,
    };
    state.listings.set(key, listing);
    saved.push(listing);
  }
  return { status: 200, body: putAnswer(saved, state) };
}

function emptyListing(row: PutRow, ts: string): Listing {
  return {
    cardId: row.cardId,
    condition: row.condition,
    productId: newProductId(),
    availableQuantity: 0,
    price: row.price,
    sellerSku: row.sellerSku,
    sellerImgFront: null,
    sellerImgBack: null,
    updatedTimestamp: ts,
    card: row.card,
  };
}

// ── Photo upload ───────────────────────────────────────────────────────────

export function photoAnswer(objectKey: string): unknown {
  return { objectKey };
}

/**
 * A multipart photo upload: needs a multipart content type and an
 * `attachment` part. Bytes are not kept; only a counter and the key.
 */
export function applyPhotoUpload(
  state: NamespaceState,
  contentType: string | undefined,
  body: Buffer | undefined,
): { status: 200; body: unknown } | { status: 400 | 413; body: { error: string } } {
  if (!contentType || !/^multipart\/form-data;\s*boundary=/i.test(contentType)) return { status: 400, body: { error: "multipart/form-data required" } };
  if (!body || body.length === 0) return { status: 400, body: { error: "empty upload" } };
  if (body.length > MAX_PHOTO_BYTES) return { status: 413, body: { error: "too large" } };
  const head = body.subarray(0, Math.min(body.length, 4096)).toString("latin1");
  if (!/name="attachment"/.test(head)) return { status: 400, body: { error: "attachment part required" } };
  state.photos += 1;
  const key = `/prod/card/undefined/product/undefined/fake-${randomBytes(8).toString("hex")}.jpg`;
  return { status: 200, body: photoAnswer(key) };
}
