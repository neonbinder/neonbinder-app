/**
 * `recorder capture-write` (CONTRACT.md, "Write capture"): send EXACTLY ONE
 * write to real BSC, and upload only its status and shape (key paths and
 * types, no values). No retry, whatever the answer. Without `--yes` it only
 * describes what it would send.
 *
 * The write is REAL: a PUT creates or changes a listing on the account that
 * signed in, a photo upload stores a real image. `undo-write` sends the one
 * follow-up BSC allows, a quantity-0 PUT of the same rows (itself a second
 * real write, also behind `--yes`). A photo upload has no undo through the
 * API (README, "Undoing a capture").
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalisePath } from "../src/requestKey";
import { writeEndpointFor, type WriteEndpoint } from "../src/paths";
import { shapeOf, type Shape } from "../src/shape";

export interface WriteRequest {
  endpoint: WriteEndpoint;
  method: string;
  path: string;
  /** JSON body (PUT), or a file to send as the multipart `attachment` part. */
  json?: unknown;
  file?: { bytes: Buffer; fileName: string; contentType: string };
}

const CONTENT_TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp" };

/**
 * Reads `--request <file.json>` (`{method, path, body}`) and, for a photo,
 * `--file <image>`. Refuses anything that is not a known write endpoint.
 */
export async function loadWriteRequest(requestFile: string, imageFile?: string): Promise<WriteRequest> {
  let spec: unknown;
  try {
    spec = JSON.parse(await readFile(requestFile, "utf8"));
  } catch {
    throw new Error("--request must be a JSON file: {method, path, body?}");
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
  if (s.body === undefined) throw new Error("a PUT needs a body");
  return { endpoint, method, path: p, json: s.body };
}

/** What would be sent, with no values: for the dry run. */
export function describeWrite(req: WriteRequest): string {
  if (req.file) return `${req.method} ${req.path}: one ${req.file.contentType} file, ${req.file.bytes.length} bytes`;
  const body = (req.json ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(body.listings) ? body.listings.length : 0;
  return `${req.method} ${req.path}: ${rows} listing row(s)`;
}

export interface CaptureDeps {
  request: WriteRequest;
  apiBase: string;
  token: string;
  headers: (token: string, opts?: { json?: boolean }) => Record<string, string>;
  fake: { uploadCapture(capture: unknown): Promise<{ verdict: string; paths: string[] }> };
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

export type CaptureResult =
  | { ok: true; status: number; paths: number; verdict: string; driftPaths: string[] }
  | { ok: false; reason: "timeout" | "network" | "upload_refused" };

type SendResult = { ok: true; status: number; parsed: unknown } | { ok: false; reason: "timeout" | "network" };

/** Exactly one send of a write. No retry on any answer. */
async function sendOnce(deps: Pick<CaptureDeps, "request" | "apiBase" | "token" | "headers" | "fetchImpl" | "timeoutMs">): Promise<SendResult> {
  const f = deps.fetchImpl ?? fetch;
  const req = deps.request;
  let body: BodyInit;
  let headers: Record<string, string>;
  if (req.file) {
    const form = new FormData();
    form.append("attachment", new Blob([new Uint8Array(req.file.bytes)], { type: req.file.contentType }), req.file.fileName);
    body = form;
    headers = deps.headers(deps.token, { json: false });
  } else {
    body = JSON.stringify(req.json);
    headers = deps.headers(deps.token);
  }
  const signal = AbortSignal.timeout(deps.timeoutMs ?? 60_000);
  try {
    const res = await f(`${deps.apiBase}/${req.path}`, { method: req.method, headers, body, signal, redirect: "error" });
    const text = await res.text();
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

export async function runCaptureWrite(deps: CaptureDeps): Promise<CaptureResult> {
  const sent = await sendOnce(deps);
  if (!sent.ok) return sent;
  const shape: Shape = shapeOf(sent.parsed);
  try {
    const verdict = await deps.fake.uploadCapture({
      endpoint: deps.request.endpoint,
      status: sent.status,
      shape,
      capturedAt: new Date((deps.now ?? Date.now)()).toISOString(),
    });
    return { ok: true, status: sent.status, paths: Object.keys(shape).length, verdict: verdict.verdict, driftPaths: verdict.paths ?? [] };
  } catch {
    return { ok: false, reason: "upload_refused" };
  }
}

/**
 * The follow-up that undoes a captured PUT: the same rows with
 * `availableQuantity: 0`, which takes those listings down. Null for a photo
 * upload (no API undo) or a PUT with no rows. Caution: a row that was an
 * existing listing before the capture is taken down too, not restored to its
 * earlier quantity.
 */
export function buildUndoRequest(req: WriteRequest): WriteRequest | null {
  if (req.endpoint !== "PUT seller/bulk-upload") return null;
  const body = req.json;
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.listings) || b.listings.length === 0) return null;
  const listings = b.listings.map((row) => (row && typeof row === "object" && !Array.isArray(row) ? { ...(row as Record<string, unknown>), availableQuantity: 0 } : row));
  return { ...req, json: { ...b, listings } };
}

/** What `undo-write` would send, with no values: card ids are counted, not printed. */
export function describeUndo(req: WriteRequest): string {
  const rows = ((req.json as Record<string, unknown>).listings as unknown[]).length;
  return `${req.method} ${req.path}: ${rows} listing row(s) set to quantity 0 (a second real write)`;
}

export type UndoResult = { ok: true; status: number } | { ok: false; reason: "timeout" | "network" | "nothing_to_undo" };

/** Sends the undo once. Uploads nothing to the fake. */
export async function runUndoWrite(deps: Omit<CaptureDeps, "fake" | "now">): Promise<UndoResult> {
  const undo = buildUndoRequest(deps.request);
  if (!undo) return { ok: false, reason: "nothing_to_undo" };
  const sent = await sendOnce({ ...deps, request: undo });
  return sent.ok ? { ok: true, status: sent.status } : sent;
}
