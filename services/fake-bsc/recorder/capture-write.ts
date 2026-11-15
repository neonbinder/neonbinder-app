/**
 * `recorder capture-write` (CONTRACT.md, "Write capture"): send EXACTLY ONE
 * write to real BSC, and upload only its status and shape (key paths and
 * types, no values). No retry, whatever the answer. Without `--yes` it only
 * lists what it would send, and sends nothing.
 *
 * A listing PUT is built the way NeonBinder builds one, so the capture is of
 * the write NB really sends. The request file carries only the intent (card,
 * set filters, condition, quantity, price, SKU); with the signed-in session
 * the tool then:
 *   1. reads the seller id (`GET marketplace/user/profile`), as
 *      `fetchBscSellerId` does (apps/web/convex/adapters/bscSeller.ts);
 *   2. reads that condition's seller sheet for the set
 *      (`POST seller/bulk-upload/results`, the body `readBscSellerSheet`
 *      sends) and takes the one row for the card;
 *   3. PUTs `{sellerId, listings: [{...row, condition, availableQuantity,
 *      price, sellerSku}]}`, the row `planBscSheet` builds
 *      (apps/web/convex/lib/bscSheetPlan.ts).
 * It refuses to write when the card is already listed (quantity > 0), so the
 * undo can never take down a listing that was there before, and when the
 * sheet does not hold exactly one row for the card.
 *
 * `undo-write` mirrors NB's delist: the same two reads, then the fresh row at
 * `availableQuantity: 0` (`planBscSheet`'s "zero" row). A photo upload has no
 * undo through the API (README, "Undoing a capture").
 *
 * SECURITY: the seller id, the sheet's rows and every value BSC answers stay
 * in memory. Nothing here prints or uploads them; only the PUT answer's
 * shape goes to the fake.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalisePath } from "../src/requestKey";
import { writeEndpointFor, type WriteEndpoint } from "../src/paths";
import { shapeOf, type Shape } from "../src/shape";

// ── Copies of NB's rules ───────────────────────────────────────────────────
// The recorder cannot import apps/web (its own rootDir, and no Convex), so
// these are copies; tests/recorder.test.mjs checks them against the source.

/** `SELLER_ID_RE` in apps/web/convex/adapters/bscSeller.ts. */
export const SELLER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** `SHEET_MAX_ROWS` in bscSeller.ts: the sheet read's `size`. */
export const SHEET_MAX_ROWS = 5000;
/** `BSC_MIN_PRICE_CENTS` / `BSC_MAX_PRICE_CENTS` in apps/web/convex/lib/bscMoney.ts. */
export const BSC_MIN_PRICE_CENTS = 25;
export const BSC_MAX_PRICE_CENTS = 99_900;
/** `MAX_SHEET_CARD_ID` and `MAX_SHEET_SKU` in apps/web/convex/lib/bscSheetPlan.ts. */
const MAX_CARD_ID = 64;
const MAX_SKU = 100;
/** BSC's raw conditions, both eras (apps/web/convex/lib/bscConditions.ts). Only these reach BSC. */
export const BSC_RAW_CONDITIONS = [
  "near_mint", "excellent", "very_good", "poor",
  "mint", "nm-mt", "nm", "ex-mt", "ex", "vg-ex", "vg", "good", "fair", "poor-v",
] as const;

/** Per-request bounds, as `BSC_SELLER_TIMEOUTS_MS` in bscSeller.ts (the profile gets one longer attempt: no retry here). */
const TIMEOUT_MS = { profile: 20_000, sheet: 90_000, put: 90_000, photo: 45_000 } as const;
/** Most bytes read of one answer (`BSC_SELLER_MAX_BYTES` in bscSeller.ts). */
const MAX_BYTES = { profile: 256 * 1024, sheet: 12 * 1024 * 1024, put: 4 * 1024 * 1024, photo: 64 * 1024 } as const;

const FACET_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const MAX_FACET_VALUE = 200;
const MAX_QUANTITY = 100;

const PROFILE_PATH = "marketplace/user/profile";
const SHEET_PATH = "seller/bulk-upload/results";

// ── The request file ───────────────────────────────────────────────────────

/** What a listing capture means to do; the tool builds the row from BSC's sheet. */
export interface ListingIntent {
  cardId: string;
  /** One value per facet, as NB sends them (`planBscFanOut`): BSC answers a multi-value facet with no rows. */
  filters: Record<string, [string]>;
  condition: (typeof BSC_RAW_CONDITIONS)[number];
  quantity: number;
  priceCents: number;
  sellerSku: string;
}

export interface WriteRequest {
  endpoint: WriteEndpoint;
  method: string;
  path: string;
  /** A listing PUT's intent. */
  intent?: ListingIntent;
  /** A photo upload: the file sent as the multipart `attachment` part. */
  file?: { bytes: Buffer; fileName: string; contentType: string };
}

const CONTENT_TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp" };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Reads and checks a listing intent; throws with what is wrong, never with a value. */
export function readListingIntent(v: unknown): ListingIntent {
  if (!isRecord(v)) throw new Error("a PUT needs a `listing` object: {cardId, filters, condition, quantity, price, sellerSku}");
  const { cardId, filters, condition, quantity, price, sellerSku } = v;
  if (typeof cardId !== "string" || cardId.length > MAX_CARD_ID || !/^[A-Za-z0-9_-]+$/.test(cardId)) {
    throw new Error("listing.cardId must be a BSC card id (letters, digits, - and _, at most 64)");
  }
  if (!isRecord(filters) || Object.keys(filters).length === 0) throw new Error("listing.filters must name the card's set, one value per facet");
  const outFilters: Record<string, [string]> = {};
  for (const [k, val] of Object.entries(filters)) {
    if (!FACET_KEY_RE.test(k)) throw new Error("listing.filters has a key that is not a BSC facet name");
    if (!Array.isArray(val) || val.length !== 1 || typeof val[0] !== "string" || val[0] === "" || val[0].length > MAX_FACET_VALUE) {
      throw new Error("each listing.filters facet must be an array of exactly one value (BSC answers a multi-value facet with no rows)");
    }
    outFilters[k] = [val[0]];
  }
  if (typeof condition !== "string" || !(BSC_RAW_CONDITIONS as readonly string[]).includes(condition)) {
    throw new Error(`listing.condition must be one of BSC's raw conditions: ${BSC_RAW_CONDITIONS.join(", ")}`);
  }
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    throw new Error(`listing.quantity must be a whole number from 1 to ${MAX_QUANTITY}`);
  }
  if (typeof price !== "number" || !Number.isFinite(price)) throw new Error("listing.price must be a number of dollars");
  const priceCents = Math.round(price * 100);
  if (Math.abs(priceCents - price * 100) > 1e-6) throw new Error("listing.price must be whole cents");
  if (priceCents < BSC_MIN_PRICE_CENTS || priceCents > BSC_MAX_PRICE_CENTS) {
    throw new Error("listing.price must be from 0.25 to 999 dollars (NB never sends more than 999)");
  }
  if (typeof sellerSku !== "string" || sellerSku.trim() === "" || sellerSku.length > MAX_SKU) {
    throw new Error(`listing.sellerSku must be a non-empty string of at most ${MAX_SKU} characters`);
  }
  return { cardId, filters: outFilters, condition: condition as ListingIntent["condition"], quantity, priceCents, sellerSku };
}

/**
 * Reads `--request <file.json>`: `{method: "PUT", path: "seller/bulk-upload",
 * listing: {...}}`, or `{method: "POST", path: <the attachment path>}` with
 * `--file <image>`. Refuses anything that is not a known write endpoint, and a
 * PUT that carries its own `body` (the tool builds the row; a hand-written
 * one is not what NB sends).
 */
export async function loadWriteRequest(requestFile: string, imageFile?: string): Promise<WriteRequest> {
  let spec: unknown;
  try {
    spec = JSON.parse(await readFile(requestFile, "utf8"));
  } catch {
    throw new Error("--request must be a JSON file: {method, path, listing?}");
  }
  const s = (spec ?? {}) as Record<string, unknown>;
  if (typeof s.method !== "string" || typeof s.path !== "string") throw new Error("--request needs method and path");
  const method = s.method.toUpperCase();
  const p = normalisePath(s.path);
  const endpoint = writeEndpointFor(method, p);
  if (!endpoint) throw new Error("--request is not a known BSC write endpoint (PUT seller/bulk-upload, POST the photo attachment)");
  if (endpoint === "POST common/card/undefined/product/undefined/attachment") {
    if (!imageFile) throw new Error("a photo upload needs --file <image>");
    const ext = path.extname(imageFile).toLowerCase();
    const contentType = CONTENT_TYPES[ext];
    if (!contentType) throw new Error("--file must be a .jpg, .png, .gif or .webp image");
    return { endpoint, method, path: p, file: { bytes: await readFile(imageFile), fileName: path.basename(imageFile), contentType } };
  }
  if (s.body !== undefined) {
    throw new Error("a PUT request names the listing, not a body: {method, path, listing: {cardId, filters, condition, quantity, price, sellerSku}} (README, capture-write)");
  }
  return { endpoint, method, path: p, intent: readListingIntent(s.listing) };
}

// ── The plan (dry run) ─────────────────────────────────────────────────────

/** Every request a capture sends to BSC after sign-in, in order, with no values. */
export function describeWrite(req: WriteRequest): string[] {
  if (req.file) return [`${req.method} ${req.path}: one ${req.file.contentType} file, ${req.file.bytes.length} bytes (REAL WRITE)`];
  return [
    `GET ${PROFILE_PATH}: the seller id (read)`,
    `POST ${SHEET_PATH}: the ${req.intent?.condition ?? "?"} seller sheet for the set (read); stops here unless it holds exactly one row for the card, unlisted`,
    `${req.method} ${req.path}: 1 listing row, quantity ${req.intent?.quantity ?? "?"} (REAL WRITE)`,
  ];
}

/** What `undo-write` sends after sign-in, in order, with no values. */
export function describeUndo(req: WriteRequest): string[] {
  return [
    `GET ${PROFILE_PATH}: the seller id (read)`,
    `POST ${SHEET_PATH}: the ${req.intent?.condition ?? "?"} seller sheet for the set (read); stops here unless the card's one row is listed with this SKU`,
    `${req.method} ${req.path}: that row set to quantity 0 (a second REAL WRITE)`,
  ];
}

// ── Sending ────────────────────────────────────────────────────────────────

export interface BscDeps {
  apiBase: string;
  token: string;
  headers: (token: string, opts?: { json?: boolean }) => Record<string, string>;
  fetchImpl?: typeof fetch;
  /** Overrides every per-request timeout (tests). */
  timeoutMs?: number;
}

type Sent = { ok: true; status: number; parsed: unknown } | { ok: false; reason: "timeout" | "network" | "too_large" };

/** Exactly one request. No retry on any answer. */
async function sendOnce(
  deps: BscDeps,
  req: { method: string; path: string; json?: unknown; file?: WriteRequest["file"] },
  limits: { timeoutMs: number; maxBytes: number },
): Promise<Sent> {
  const f = deps.fetchImpl ?? fetch;
  let body: BodyInit | undefined;
  let headers: Record<string, string>;
  if (req.file) {
    const form = new FormData();
    form.append("attachment", new Blob([new Uint8Array(req.file.bytes)], { type: req.file.contentType }), req.file.fileName);
    body = form;
    headers = deps.headers(deps.token, { json: false });
  } else if (req.json !== undefined) {
    body = JSON.stringify(req.json);
    headers = deps.headers(deps.token);
  } else {
    headers = deps.headers(deps.token, { json: false });
  }
  const signal = AbortSignal.timeout(deps.timeoutMs ?? limits.timeoutMs);
  try {
    const res = await f(`${deps.apiBase}/${req.path}`, { method: req.method, headers, ...(body !== undefined ? { body } : {}), signal, redirect: "error" });
    const len = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(len) && len > limits.maxBytes) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: false, reason: "too_large" };
    }
    const text = await res.text();
    if (text.length > limits.maxBytes) return { ok: false, reason: "too_large" };
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null; // a non-JSON answer is captured as shape-less
    }
    return { ok: true, status: res.status, parsed };
  } catch {
    return { ok: false, reason: signal.aborted ? "timeout" : "network" };
  }
}

/** Why a read stopped the run. Never carries a BSC value. */
export type ReadRefusal =
  | { step: "profile" | "sheet"; reason: "timeout" | "network" | "too_large" }
  | { step: "profile" | "sheet"; reason: "http"; status: number }
  | { step: "profile"; reason: "no_seller_id" }
  | { step: "sheet"; reason: "unreadable_sheet" }
  | { step: "sheet"; reason: "card_not_on_sheet" }
  | { step: "sheet"; reason: "card_on_sheet_more_than_once"; rows: number }
  | { step: "sheet"; reason: "unreadable_row" };

/** The seller id, as `fetchBscSellerId` reads it: `sellerProfile.sellerId`, in NB's stored shape. */
export async function readSellerId(deps: BscDeps): Promise<{ ok: true; sellerId: string } | { ok: false; refusal: ReadRefusal }> {
  const r = await sendOnce(deps, { method: "GET", path: PROFILE_PATH }, { timeoutMs: TIMEOUT_MS.profile, maxBytes: MAX_BYTES.profile });
  if (!r.ok) return { ok: false, refusal: { step: "profile", reason: r.reason } };
  if (r.status < 200 || r.status >= 300) return { ok: false, refusal: { step: "profile", reason: "http", status: r.status } };
  const profile = isRecord(r.parsed) && isRecord(r.parsed.sellerProfile) ? r.parsed.sellerProfile : null;
  const sellerId = profile && typeof profile.sellerId === "string" ? profile.sellerId : null;
  if (sellerId === null || !SELLER_ID_RE.test(sellerId)) return { ok: false, refusal: { step: "profile", reason: "no_seller_id" } };
  return { ok: true, sellerId };
}

/** The card's one sheet row: the raw row as BSC sent it, plus what the run checks. */
export interface CardSheetRow {
  raw: Readonly<Record<string, unknown>>;
  condition: string;
  quantity: number;
  sellerSku: string | null;
}

/**
 * Reads the seller sheet for the intent's set and condition, with the body
 * `readBscSellerSheet` sends, and returns the card's row: matched on
 * `card.id` (agreeing with a top-level `cardId` when both are sent) and the
 * condition, raw rows only, as `planBscSheet` keys them. Exactly one row, or
 * a refusal.
 */
export async function readCardSheetRow(deps: BscDeps, intent: ListingIntent): Promise<{ ok: true; row: CardSheetRow } | { ok: false; refusal: ReadRefusal }> {
  const r = await sendOnce(
    deps,
    {
      method: "POST",
      path: SHEET_PATH,
      json: { condition: intent.condition, currentListings: true, productType: "raw", page: 0, size: SHEET_MAX_ROWS, sort: "default", filters: intent.filters },
    },
    { timeoutMs: TIMEOUT_MS.sheet, maxBytes: MAX_BYTES.sheet },
  );
  if (!r.ok) return { ok: false, refusal: { step: "sheet", reason: r.reason } };
  if (r.status < 200 || r.status >= 300) return { ok: false, refusal: { step: "sheet", reason: "http", status: r.status } };
  const rows = Array.isArray(r.parsed) ? r.parsed : isRecord(r.parsed) && Array.isArray(r.parsed.results) ? r.parsed.results : null;
  if (rows === null) return { ok: false, refusal: { step: "sheet", reason: "unreadable_sheet" } };
  const matches = rows.filter((v): v is Record<string, unknown> => {
    if (!isRecord(v) || !isRecord(v.card) || v.card.id !== intent.cardId) return false;
    if (v.cardId !== undefined && v.cardId !== null && v.cardId !== intent.cardId) return false;
    if (v.productType !== undefined && v.productType !== null && v.productType !== "" && v.productType !== "raw") return false;
    return v.condition === intent.condition;
  });
  if (matches.length === 0) return { ok: false, refusal: { step: "sheet", reason: "card_not_on_sheet" } };
  if (matches.length > 1) return { ok: false, refusal: { step: "sheet", reason: "card_on_sheet_more_than_once", rows: matches.length } };
  const raw = matches[0];
  const q = raw.availableQuantity;
  if (typeof q !== "number" || !Number.isInteger(q) || q < 0) return { ok: false, refusal: { step: "sheet", reason: "unreadable_row" } };
  const sku = typeof raw.sellerSku === "string" && raw.sellerSku !== "" ? raw.sellerSku : null;
  return { ok: true, row: { raw, condition: intent.condition, quantity: q, sellerSku: sku } };
}

/** The PUT body NB sends for one target: `planBscSheet`'s "set" row (no photo keys). */
export function buildListingPut(sellerId: string, row: CardSheetRow, intent: ListingIntent): { sellerId: string; listings: Record<string, unknown>[] } {
  return {
    sellerId,
    listings: [
      {
        ...row.raw,
        condition: row.condition,
        availableQuantity: intent.quantity,
        price: Math.round(intent.priceCents) / 100,
        sellerSku: intent.sellerSku,
      },
    ],
  };
}

/** The PUT body NB sends to take a row down: `planBscSheet`'s "zero" row, from a fresh read. */
export function buildDelistPut(sellerId: string, row: CardSheetRow): { sellerId: string; listings: Record<string, unknown>[] } {
  return { sellerId, listings: [{ ...row.raw, condition: row.condition, availableQuantity: 0 }] };
}

// ── capture-write ──────────────────────────────────────────────────────────

export interface CaptureDeps extends BscDeps {
  request: WriteRequest;
  fake: { uploadCapture(capture: unknown): Promise<{ verdict: string; paths: string[] }> };
  now?: () => number;
}

export type CaptureResult =
  | { ok: true; sent: number; status: number; paths: number; verdict: string; driftPaths: string[] }
  | { ok: false; sent: number; reason: "timeout" | "network" | "too_large" | "upload_refused" }
  | { ok: false; sent: number; reason: "read_refused"; refusal: ReadRefusal }
  | { ok: false; sent: number; reason: "already_listed" };

export async function runCaptureWrite(deps: CaptureDeps): Promise<CaptureResult> {
  const req = deps.request;
  let sent = 0;
  let write: Sent;
  if (req.file) {
    sent += 1;
    write = await sendOnce(deps, { method: req.method, path: req.path, file: req.file }, { timeoutMs: TIMEOUT_MS.photo, maxBytes: MAX_BYTES.photo });
  } else {
    if (!req.intent) throw new Error("a listing PUT needs its intent");
    sent += 1;
    const seller = await readSellerId(deps);
    if (!seller.ok) return { ok: false, sent, reason: "read_refused", refusal: seller.refusal };
    sent += 1;
    const sheet = await readCardSheetRow(deps, req.intent);
    if (!sheet.ok) return { ok: false, sent, reason: "read_refused", refusal: sheet.refusal };
    if (sheet.row.quantity > 0) return { ok: false, sent, reason: "already_listed" };
    sent += 1;
    write = await sendOnce(
      deps,
      { method: req.method, path: req.path, json: buildListingPut(seller.sellerId, sheet.row, req.intent) },
      { timeoutMs: TIMEOUT_MS.put, maxBytes: MAX_BYTES.put },
    );
  }
  if (!write.ok) return { ok: false, sent, reason: write.reason };
  const shape: Shape = shapeOf(write.parsed);
  try {
    const verdict = await deps.fake.uploadCapture({
      endpoint: req.endpoint,
      status: write.status,
      shape,
      capturedAt: new Date((deps.now ?? Date.now)()).toISOString(),
    });
    return { ok: true, sent, status: write.status, paths: Object.keys(shape).length, verdict: verdict.verdict, driftPaths: verdict.paths ?? [] };
  } catch {
    return { ok: false, sent, reason: "upload_refused" };
  }
}

// ── undo-write ─────────────────────────────────────────────────────────────

export type UndoResult =
  | { ok: true; sent: number; status: number }
  | { ok: false; sent: number; reason: "timeout" | "network" | "too_large" | "nothing_to_undo" | "not_listed" | "not_ours" }
  | { ok: false; sent: number; reason: "read_refused"; refusal: ReadRefusal };

/**
 * Takes a captured listing down as NB delists: a fresh sheet read, then that
 * row at quantity 0. Refuses when the row is not listed, or its SKU is not
 * the request's (someone else's listing). Uploads nothing to the fake.
 */
export async function runUndoWrite(deps: BscDeps & { request: WriteRequest }): Promise<UndoResult> {
  const req = deps.request;
  if (req.endpoint !== "PUT seller/bulk-upload" || !req.intent) return { ok: false, sent: 0, reason: "nothing_to_undo" };
  let sent = 1;
  const seller = await readSellerId(deps);
  if (!seller.ok) return { ok: false, sent, reason: "read_refused", refusal: seller.refusal };
  sent += 1;
  const sheet = await readCardSheetRow(deps, req.intent);
  if (!sheet.ok) return { ok: false, sent, reason: "read_refused", refusal: sheet.refusal };
  if (sheet.row.quantity === 0) return { ok: false, sent, reason: "not_listed" };
  if (sheet.row.sellerSku !== req.intent.sellerSku) return { ok: false, sent, reason: "not_ours" };
  sent += 1;
  const r = await sendOnce(deps, { method: req.method, path: req.path, json: buildDelistPut(seller.sellerId, sheet.row) }, { timeoutMs: TIMEOUT_MS.put, maxBytes: MAX_BYTES.put });
  return r.ok ? { ok: true, sent, status: r.status } : { ok: false, sent, reason: r.reason };
}

/** One line for a read refusal, with no BSC value in it. */
export function describeRefusal(r: ReadRefusal): string {
  const where = r.step === "profile" ? "the seller profile read" : "the seller sheet read";
  switch (r.reason) {
    case "http":
      return `${where} answered HTTP ${r.status}`;
    case "timeout":
    case "network":
      return `${where} failed (${r.reason})`;
    case "too_large":
      return `${where} answered more than the tool reads`;
    case "no_seller_id":
      return "the profile carries no seller id in the shape NB stores (is this a seller account?)";
    case "unreadable_sheet":
      return "the seller sheet came back in a shape NB cannot read";
    case "card_not_on_sheet":
      return "the sheet holds no row for this card and condition (check listing.filters names the card's set)";
    case "card_on_sheet_more_than_once":
      return `the sheet holds ${r.rows} rows for this card and condition; NB never writes a duplicated row`;
    case "unreadable_row":
      return "the card's sheet row carries no readable quantity";
  }
}
