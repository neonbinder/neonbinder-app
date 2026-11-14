/**
 * `recorder capture-write` (CONTRACT.md, "Write capture"): send EXACTLY ONE
 * write to real BSC, and upload only its status and shape (key paths and
 * types, no values). No retry, whatever the answer. Without `--yes` it only
 * describes what it would send.
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

export async function runCaptureWrite(deps: CaptureDeps): Promise<CaptureResult> {
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
  let status: number;
  let shape: Shape;
  try {
    // Exactly one send. No retry on any answer.
    const res = await f(`${deps.apiBase}/${req.path}`, { method: req.method, headers, body, signal, redirect: "error" });
    status = res.status;
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null; // a non-JSON answer is captured as shape-less
    }
    shape = shapeOf(parsed);
  } catch {
    return { ok: false, reason: signal.aborted ? "timeout" : "network" };
  }
  try {
    const verdict = await deps.fake.uploadCapture({
      endpoint: req.endpoint,
      status,
      shape,
      capturedAt: new Date((deps.now ?? Date.now)()).toISOString(),
    });
    return { ok: true, status, paths: Object.keys(shape).length, verdict: verdict.verdict, driftPaths: verdict.paths ?? [] };
  } catch {
    return { ok: false, reason: "upload_refused" };
  }
}
