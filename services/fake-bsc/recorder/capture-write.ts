/**
 * `recorder capture-write` (CONTRACT.md, "Write capture"): send EXACTLY ONE
 * write to real BSC, and upload only its status and shape (key paths and
 * types, no values). No retry, whatever the answer. Without `--yes` it only
 * lists what it would send, and sends nothing.
 *
 * A listing PUT is built the way NeonBinder builds one, so the capture is of
 * the write NB really sends. The request file carries only the intent (card,
 * set filters, condition, price, a capture SKU); with the signed-in session
 * the tool then:
 *   1. reads the seller id (`GET marketplace/user/profile`), as
 *      `fetchBscSellerId` does (apps/web/convex/adapters/bscSeller.ts);
 *   2. reads that condition's seller sheet for the set
 *      (`POST seller/bulk-upload/results`, the body `readBscSellerSheet`
 *      sends) and takes the one row for the card;
 *   3. PUTs `{sellerId, listings: [{...row, condition, availableQuantity: 1,
 *      price, sellerSku}]}`, the row `planBscSheet` builds
 *      (apps/web/convex/lib/bscSheetPlan.ts).
 * It refuses to write when the card is already listed (quantity > 0), so the
 * undo can never take down a listing that was there before, and when the
 * sheet does not hold exactly one row for the card.
 *
 * A capture lists ONE copy at $500 or more (nobody buys it in the minutes it
 * is live) under a `NBCAPTURE-` SKU, which NB's `parseListingSku` never
 * accepts: an account later connected to NB can never mistake it for an NB
 * listing.
 *
 * `undo-write` mirrors NB's delist: the same two reads, then the fresh row at
 * `availableQuantity: 0` (`planBscSheet`'s "zero" row), then one more sheet
 * read to tell the operator whether the row is down. A photo upload has no
 * undo through the API (README, "Undoing a capture").
 *
 * SECURITY: the seller id, the sheet's rows and every value BSC answers stay
 * in memory. Nothing here prints or uploads them; only the write answer's
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
/** `BSC_MAX_PRICE_CENTS` in apps/web/convex/lib/bscMoney.ts: NB never sends more. */
export const BSC_MAX_PRICE_CENTS = 99_900;
/** `MAX_SHEET_ROW_BYTES` in apps/web/convex/lib/bscSheetPlan.ts: a longer row is unreadable. */
export const MAX_SHEET_ROW_BYTES = 16 * 1024;
/** `MAX_SHEET_CARD_ID` in bscSheetPlan.ts. */
const MAX_CARD_ID = 64;
/** BSC's raw conditions, both eras (apps/web/convex/lib/bscConditions.ts). Only these reach BSC. */
export const BSC_RAW_CONDITIONS = [
  "near_mint", "excellent", "very_good", "poor",
  "mint", "nm-mt", "nm", "ex-mt", "ex", "vg-ex", "vg", "good", "fair", "poor-v",
] as const;

/** Most bytes read of one answer (`BSC_SELLER_MAX_BYTES` in bscSeller.ts). */
export const MAX_BYTES = { profile: 256 * 1024, sheet: 12 * 1024 * 1024, put: 4 * 1024 * 1024, photo: 64 * 1024 } as const;
/** Per-request bounds, as `BSC_SELLER_TIMEOUTS_MS` in bscSeller.ts (the profile gets one longer attempt: no retry here). */
const TIMEOUT_MS = { profile: 20_000, sheet: 90_000, put: 90_000, photo: 45_000 } as const;

// ── The capture's own rules ────────────────────────────────────────────────

/**
 * A capture listing's SKU. `NBCAPTURE-` can never match NB's listing SKU
 * (`parseListingSku`: `NB1-<id>-<code>-<id>`), so the listing is never read
 * back as NB's.
 */
export const CAPTURE_SKU_RE = /^NBCAPTURE-[A-Za-z0-9_-]{1,80}$/;
/** A capture lists exactly one copy. */
export const CAPTURE_QUANTITY = 1;
/** Nobody should buy a capture in the minutes it is live: $500 to NB's $999 ceiling. */
export const CAPTURE_MIN_PRICE_CENTS = 50_000;
/** The only photo upload path BSC's seller app posts to, literally. */
export const PHOTO_PATH = "common/card/undefined/product/undefined/attachment";

const FACET_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const MAX_FACET_VALUE = 200;

const PROFILE_PATH = "marketplace/user/profile";
const SHEET_PATH = "seller/bulk-upload/results";

// ── The request file ───────────────────────────────────────────────────────

/** What a listing capture means to do; the tool builds the row from BSC's sheet. */
export interface ListingIntent {
  cardId: string;
  /** One value per facet, as NB sends them (`planBscFanOut`): BSC answers a multi-value facet with no rows. */
  filters: Record<string, [string]>;
  condition: (typeof BSC_RAW_CONDITIONS)[number];
  /** Always `CAPTURE_QUANTITY`. */
  quantity: number;
  priceCents: number;
  /** Matches `CAPTURE_SKU_RE`. */
  sellerSku: string;
}

export interface WriteRequest {
  endpoint: WriteEndpoint;
  method: string;
  path: string;
  /** A listing PUT's intent. */
  intent?: ListingIntent;
  /** A photo upload: the file sent as the multipart `attachment` part, named `capture<ext>`. */
  file?: { bytes: Buffer; fileName: string; contentType: string };
}

const CONTENT_TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp" };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Reads and checks a listing intent; throws with what is wrong, never with a value. */
export function readListingIntent(v: unknown): ListingIntent {
  if (!isRecord(v)) throw new Error("a PUT needs a `listing` object: {cardId, filters, condition, price, sellerSku}");
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
  if (quantity !== undefined && quantity !== CAPTURE_QUANTITY) {
    throw new Error(`a capture lists exactly ${CAPTURE_QUANTITY} copy: leave listing.quantity out`);
  }
  if (typeof price !== "number" || !Number.isFinite(price)) throw new Error("listing.price must be a number of dollars");
  const priceCents = Math.round(price * 100);
  if (Math.abs(priceCents - price * 100) > 1e-6) throw new Error("listing.price must be whole cents");
  if (priceCents < CAPTURE_MIN_PRICE_CENTS || priceCents > BSC_MAX_PRICE_CENTS) {
    throw new Error("listing.price must be from 500 to 999 dollars (high enough that nobody buys it; NB never sends more than 999)");
  }
  if (typeof sellerSku !== "string" || !CAPTURE_SKU_RE.test(sellerSku)) {
    throw new Error("listing.sellerSku must be a capture SKU: NBCAPTURE- then 1 to 80 letters, digits, - or _ (never an NB SKU)");
  }
  return { cardId, filters: outFilters, condition: condition as ListingIntent["condition"], quantity: CAPTURE_QUANTITY, priceCents, sellerSku };
}

/**
 * Reads `--request <file.json>`: `{method: "PUT", path: "seller/bulk-upload",
 * listing: {...}}`, or `{method: "POST", path: PHOTO_PATH}` with
 * `--file <image>`. Refuses anything that is not a known write endpoint, a
 * photo path other than the literal one, and a PUT that carries its own
 * `body` (the tool builds the row; a hand-written one is not what NB sends).
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
    if (p !== PHOTO_PATH) throw new Error(`a photo upload goes to ${PHOTO_PATH} exactly`);
    if (!imageFile) throw new Error("a photo upload needs --file <image>");
    const ext = path.extname(imageFile).toLowerCase();
    const contentType = CONTENT_TYPES[ext];
    if (!contentType) throw new Error("--file must be a .jpg, .png, .gif or .webp image");
    // The file's own name never reaches BSC.
    return { endpoint, method, path: p, file: { bytes: await readFile(imageFile), fileName: `capture${ext}`, contentType } };
  }
  if (s.body !== undefined) {
    throw new Error("a PUT request names the listing, not a body: {method, path, listing: {cardId, filters, condition, price, sellerSku}} (README, capture-write)");
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
    `${req.method} ${req.path}: 1 listing row, quantity ${CAPTURE_QUANTITY} (REAL WRITE)`,
  ];
}

/** What `undo-write` sends after sign-in, in order, with no values. */
export function describeUndo(req: WriteRequest): string[] {
  const condition = req.intent?.condition ?? "?";
  return [
    `GET ${PROFILE_PATH}: the seller id (read)`,
    `POST ${SHEET_PATH}: the ${condition} seller sheet for the set (read); stops here unless the card's one row is listed with this capture SKU`,
    `${req.method} ${req.path}: that row set to quantity 0 (a second REAL WRITE)`,
    `POST ${SHEET_PATH}: the ${condition} sheet again, to check the row is down (read, once)`,
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

/**
 * The answer's text, or null once it is over `maxBytes`: a `Content-Length`
 * above the cap is refused before the body is read, and the body is counted
 * while it streams in (`readCappedText` in bscSeller.ts).
 */
export async function readCappedText(res: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
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
    const text = await readCappedText(res, limits.maxBytes);
    if (text === null) return { ok: false, reason: "too_large" };
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
  | { step: "sheet"; reason: "unreadable_row" }
  | { step: "sheet"; reason: "oversized_row" };

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

function jsonSize(v: unknown): number {
  try {
    return JSON.stringify(v)?.length ?? 0;
  } catch {
    return Infinity;
  }
}

/**
 * Reads the seller sheet for the intent's set and condition, with the body
 * `readBscSellerSheet` sends, and returns the card's row: matched on
 * `card.id` (agreeing with a top-level `cardId` when both are sent) and the
 * condition, raw rows only, as `planBscSheet` keys them. A row longer than
 * `MAX_SHEET_ROW_BYTES` is dropped unread, as `narrowBscSheet` drops it; if
 * it is the card's, the read is refused. Exactly one row, or a refusal.
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
  const matches: Record<string, unknown>[] = [];
  for (const v of rows.slice(0, SHEET_MAX_ROWS)) {
    if (!isRecord(v) || !isRecord(v.card) || v.card.id !== intent.cardId) continue;
    if (jsonSize(v) > MAX_SHEET_ROW_BYTES) return { ok: false, refusal: { step: "sheet", reason: "oversized_row" } };
    if (v.cardId !== undefined && v.cardId !== null && v.cardId !== intent.cardId) continue;
    if (v.productType !== undefined && v.productType !== null && v.productType !== "" && v.productType !== "raw") continue;
    if (v.condition === intent.condition) matches.push(v);
  }
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
        availableQuantity: CAPTURE_QUANTITY,
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

/**
 * `writeSent` is true once the PUT or the photo POST went out: from then on
 * a failure may still have changed the account, and the operator is told to
 * undo it.
 */
export type CaptureResult =
  | { ok: true; sent: number; writeSent: true; status: number; paths: number; verdict: string; driftPaths: string[] }
  | { ok: false; sent: number; writeSent: true; reason: "timeout" | "network" | "too_large" | "upload_refused" }
  | { ok: false; sent: number; writeSent: false; reason: "read_refused"; refusal: ReadRefusal }
  | { ok: false; sent: number; writeSent: false; reason: "already_listed" };

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
    if (!seller.ok) return { ok: false, sent, writeSent: false, reason: "read_refused", refusal: seller.refusal };
    sent += 1;
    const sheet = await readCardSheetRow(deps, req.intent);
    if (!sheet.ok) return { ok: false, sent, writeSent: false, reason: "read_refused", refusal: sheet.refusal };
    if (sheet.row.quantity > 0) return { ok: false, sent, writeSent: false, reason: "already_listed" };
    sent += 1;
    write = await sendOnce(
      deps,
      { method: req.method, path: req.path, json: buildListingPut(seller.sellerId, sheet.row, req.intent) },
      { timeoutMs: TIMEOUT_MS.put, maxBytes: MAX_BYTES.put },
    );
  }
  if (!write.ok) return { ok: false, sent, writeSent: true, reason: write.reason };
  const shape: Shape = shapeOf(write.parsed);
  try {
    const verdict = await deps.fake.uploadCapture({
      endpoint: req.endpoint,
      status: write.status,
      shape,
      capturedAt: new Date((deps.now ?? Date.now)()).toISOString(),
    });
    return { ok: true, sent, writeSent: true, status: write.status, paths: Object.keys(shape).length, verdict: verdict.verdict, driftPaths: verdict.paths ?? [] };
  } catch {
    return { ok: false, sent, writeSent: true, reason: "upload_refused" };
  }
}

// ── undo-write ─────────────────────────────────────────────────────────────

/** What the one sheet read after the undo's PUT found. Never carries a BSC value. */
export type UndoCheck =
  | { state: "down" }
  /** Quantity 0, but the row carries a SKU that is neither the capture's nor blank. */
  | { state: "down_other_sku" }
  | { state: "still_listed" }
  /** Listed, under a SKU that is not the capture's. */
  | { state: "listed_other_sku" }
  | { state: "unchecked"; refusal: ReadRefusal };

export type UndoResult =
  | { ok: true; sent: number; writeSent: true; status: number; check: UndoCheck }
  | { ok: false; sent: number; writeSent: true; reason: "timeout" | "network" | "too_large"; check: UndoCheck }
  | { ok: false; sent: number; writeSent: false; reason: "nothing_to_undo" | "not_listed" | "not_ours" }
  | { ok: false; sent: number; writeSent: false; reason: "read_refused"; refusal: ReadRefusal };

async function checkUndone(deps: BscDeps, intent: ListingIntent): Promise<UndoCheck> {
  const after = await readCardSheetRow(deps, intent);
  if (!after.ok) return { state: "unchecked", refusal: after.refusal };
  const ours = after.row.sellerSku === intent.sellerSku;
  if (after.row.quantity === 0) return ours || after.row.sellerSku === null ? { state: "down" } : { state: "down_other_sku" };
  return ours ? { state: "still_listed" } : { state: "listed_other_sku" };
}

/**
 * Takes a captured listing down as NB delists: a fresh sheet read, then that
 * row at quantity 0, then one more sheet read (no retry) to report whether it
 * is down. Refuses when the row is not listed, or its SKU is not the
 * request's capture SKU (someone else's listing). Uploads nothing to the fake.
 */
export async function runUndoWrite(deps: BscDeps & { request: WriteRequest }): Promise<UndoResult> {
  const req = deps.request;
  if (req.endpoint !== "PUT seller/bulk-upload" || !req.intent) return { ok: false, sent: 0, writeSent: false, reason: "nothing_to_undo" };
  const intent = req.intent;
  let sent = 1;
  const seller = await readSellerId(deps);
  if (!seller.ok) return { ok: false, sent, writeSent: false, reason: "read_refused", refusal: seller.refusal };
  sent += 1;
  const sheet = await readCardSheetRow(deps, intent);
  if (!sheet.ok) return { ok: false, sent, writeSent: false, reason: "read_refused", refusal: sheet.refusal };
  if (sheet.row.quantity === 0) return { ok: false, sent, writeSent: false, reason: "not_listed" };
  if (sheet.row.sellerSku === null || !CAPTURE_SKU_RE.test(sheet.row.sellerSku) || sheet.row.sellerSku !== intent.sellerSku) {
    return { ok: false, sent, writeSent: false, reason: "not_ours" };
  }
  sent += 1;
  const r = await sendOnce(deps, { method: req.method, path: req.path, json: buildDelistPut(seller.sellerId, sheet.row) }, { timeoutMs: TIMEOUT_MS.put, maxBytes: MAX_BYTES.put });
  sent += 1;
  const check = await checkUndone(deps, intent);
  return r.ok ? { ok: true, sent, writeSent: true, status: r.status, check } : { ok: false, sent, writeSent: true, reason: r.reason, check };
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
    case "oversized_row":
      return "the card's sheet row is longer than NB reads";
  }
}

/** One line for the post-undo check, with no BSC value in it. */
export function describeUndoCheck(c: UndoCheck): string {
  switch (c.state) {
    case "down":
      return "checked: the row is down (quantity 0)";
    case "down_other_sku":
      return "checked: the row is down (quantity 0), but it now carries a SKU that is not the capture's; look at it in BSC's seller pages";
    case "still_listed":
      return "CHECK FAILED: the row is still listed under the capture SKU; take it down by hand in BSC's seller pages";
    case "listed_other_sku":
      return "CHECK FAILED: the row is listed under a SKU that is not the capture's; look at it in BSC's seller pages";
    case "unchecked":
      return `NOT CHECKED: ${describeRefusal(c.refusal)}; look at the card in BSC's seller pages`;
  }
}
