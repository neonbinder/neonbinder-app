/**
 * NEO-377 — the one place NeonBinder talks to Cloudflare R2 (S3-compatible),
 * where copy photos live. Default runtime: `aws4fetch` signs with Web Crypto,
 * so this runs in actions and HTTP actions without `"use node"`.
 *
 * Four Convex env vars, per deployment (prod: the prod bucket; dev and the
 * preview defaults: the dev bucket, which expires objects after 14 days):
 *   R2_ENDPOINT          https://<account-id>.r2.cloudflarestorage.com
 *   R2_BUCKET            the bucket name
 *   R2_ACCESS_KEY_ID     an R2 API token's key id (Object Read & Write)
 *   R2_SECRET_ACCESS_KEY that token's secret
 * Missing any of them, `r2Config` returns null and callers refuse plainly.
 *
 * Signing is all this module does with the secret: it never leaves the
 * deployment, and only signed URLs (bearer, short-lived) reach a browser.
 */

import { AwsClient } from "aws4fetch";

/**
 * `base` is the path-style bucket URL (`<endpoint>/<bucket>`), which every
 * server-side call and every read URL uses. `virtualBase` is the same bucket on
 * its virtual-hosted host (`https://<bucket>.<account>.r2.cloudflarestorage.com`),
 * absent when the endpoint or bucket name can't form one.
 *
 * NEO-466: a browser's retry of a stalled photo PUT goes to `virtualBase`. R2
 * serves HTTP/1.1 only, so the browser pools keep-alive sockets per host; a
 * stale one (the thumbnails' signed GETs ride the path-style host too) can
 * swallow a PUT whole. A different host can't reuse that socket.
 */
export type R2Config = { client: AwsClient; base: string; virtualBase?: string };

/** Which host a signed URL names: the endpoint's (path style) or the bucket's own (virtual-hosted). */
export type R2HostStyle = "path" | "virtual";

/** A bucket name that is one DNS label, so it can lead a hostname. */
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** `https://<bucket>.<endpoint host>`, or undefined when the endpoint has a path or the bucket isn't a DNS label. */
function virtualHostedBase(endpoint: string, bucket: string): string | undefined {
  if (!DNS_LABEL.test(bucket)) return undefined;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.pathname.replace(/\/+$/, "") !== "" || url.search || url.username) return undefined;
  return `https://${bucket}.${url.host}`;
}

/** The deployment's R2 client and bucket URL, or null when not set up. */
export function r2Config(): R2Config | null {
  const endpoint = process.env.R2_ENDPOINT;
  const bucket = process.env.R2_BUCKET;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
  const virtualBase = virtualHostedBase(endpoint, bucket);
  return {
    client,
    base: `${endpoint.replace(/\/+$/, "")}/${encodeURIComponent(bucket)}`,
    ...(virtualBase ? { virtualBase } : {}),
  };
}

function objectUrl(config: R2Config, key: string, expiresSeconds: number, hostStyle: R2HostStyle = "path"): string {
  const base = hostStyle === "virtual" ? config.virtualBase : config.base;
  if (!base) throw new Error("R2 has no virtual-hosted address for this bucket");
  const url = new URL(`${base}/${key.split("/").map(encodeURIComponent).join("/")}`);
  url.searchParams.set("X-Amz-Expires", String(expiresSeconds));
  return url.toString();
}

/**
 * A presigned PUT for one object. The content type and length are SIGNED,
 * so the browser can upload exactly that many bytes of that type and
 * nothing else; R2 refuses any other.
 *
 * `hostStyle: "virtual"` signs it on the bucket's own host (the same object);
 * it throws when the config has no `virtualBase`.
 */
export async function signedPutUrl(
  config: R2Config,
  key: string,
  contentType: string,
  bytes: number,
  expiresSeconds: number,
  hostStyle: R2HostStyle = "path",
): Promise<string> {
  const signed = await config.client.sign(objectUrl(config, key, expiresSeconds, hostStyle), {
    method: "PUT",
    headers: { "content-type": contentType, "content-length": String(bytes) },
    aws: { signQuery: true, allHeaders: true },
  });
  return signed.url;
}

/** A presigned GET for one object. */
export async function signedGetUrl(config: R2Config, key: string, expiresSeconds: number): Promise<string> {
  const signed = await config.client.sign(objectUrl(config, key, expiresSeconds), {
    method: "GET",
    aws: { signQuery: true },
  });
  return signed.url;
}

/**
 * NEO-592 — how long one HEAD, DELETE or GET may take before it is given up
 * on, and how many times it is tried. A collector waits on `finishUpload`'s
 * HEADs inside a 7 s "Saving..." budget, and a request that hangs has no limit
 * of its own: one hung for 30 s in CI, and a photo GET in a listing drain sat
 * 12 s. Two tries of 2.5 s keep the worst case at about 5 s, leaving room for
 * the rest of the call.
 */
export const R2_CALL_TIMEOUT_MS = 2_500;
export const R2_CALL_ATTEMPTS = 2;

/** What `boundedRequest` came back with: an answer (and what `readBody` made of it), or no answer in time. */
type Tried<T> = { kind: "answered"; res: Response; body: T | undefined } | { kind: "timeout" };

/**
 * One signed request with a time limit, tried again once when an attempt times
 * out or R2 answers with a server fault (5xx, 429).
 *
 * Signs and sends here instead of through `client.fetch`: aws4fetch's own
 * retry (ten tries, sleeping up to 25 s between them, on a sleep a signal can't
 * cut short) would break the bound. Anything else that goes wrong (a refusal,
 * a network error) is the caller's to see at once: it throws from here. The
 * last answer is returned when the tries run out; a try that never answered
 * comes back as `timeout`.
 *
 * `readBody` runs on an answer worth keeping (anything but a server fault),
 * INSIDE the try's timer, so a body that stalls mid-stream is cut off and
 * tried again like a request that never answered. `progress.attempts` is the
 * number of tries begun, kept up to date for a caller that logs a throw.
 *
 * The timer of every try is cleared when the try ends, so none outlives the call.
 */
async function boundedRequest<T>(
  config: R2Config,
  key: string,
  method: "HEAD" | "DELETE" | "GET",
  readBody: (res: Response) => Promise<T>,
  progress: { attempts: number } = { attempts: 0 },
): Promise<Tried<T>> {
  const url = `${config.base}/${key.split("/").map(encodeURIComponent).join("/")}`;
  let last: Response | null = null;
  for (let attempt = 1; attempt <= R2_CALL_ATTEMPTS; attempt++) {
    progress.attempts = attempt;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, R2_CALL_TIMEOUT_MS);
    try {
      const res = await fetch(await config.client.sign(url, { method, signal: controller.signal }));
      if (res.status < 500 && res.status !== 429) return { kind: "answered", res, body: await readBody(res) };
      // Tried again below: the answer we won't use gives its connection back.
      if (attempt < R2_CALL_ATTEMPTS) void res.body?.cancel().catch(() => {});
      last = res;
    } catch (error) {
      if (!timedOut) throw error;
      last = null;
    } finally {
      clearTimeout(timer);
    }
  }
  return last ? { kind: "answered", res: last, body: undefined } : { kind: "timeout" };
}

/**
 * A HEAD or DELETE, bounded. The last answer is returned when the tries run
 * out, so the caller's status handling and its `R2 <method> failed: <status>`
 * message are unchanged; a try that never answered fails as
 * `R2 <method> failed: timed out`.
 */
async function boundedFetch(config: R2Config, key: string, method: "HEAD" | "DELETE"): Promise<Response> {
  const tried = await boundedRequest(config, key, method, async () => undefined);
  if (tried.kind === "timeout") throw new Error(`R2 ${method} failed: timed out`);
  return tried.res;
}

/**
 * The most a `getObjectBytes` read holds in memory when its caller names no
 * limit of its own. Card photos are capped at 3 MiB (`MAX_COPY_PHOTO_BYTES`);
 * this only stops a stray large object from filling an action's memory.
 */
export const R2_GET_MAX_BYTES = 10 * 1024 * 1024;

/**
 * What `getObjectBytes` found. Never a throw: the caller picks what each means.
 * `missing` is a 404; `timeout` is every try going unanswered; `tooLarge` is
 * an object over the limit; `error` is any other answer (`status` set: a
 * refusal, or a server fault on the last try) or a network failure (`status`
 * null).
 */
export type R2GetResult =
  | { kind: "ok"; bytes: ArrayBuffer }
  | { kind: "missing" }
  | { kind: "timeout" }
  | { kind: "tooLarge" }
  | { kind: "error"; status: number | null };

/**
 * Read one object's bytes from here, bounded: each try has `R2_CALL_TIMEOUT_MS`
 * for the request AND the body, and a timeout or server fault is tried once
 * more (see `boundedRequest`). Worst case is `R2_CALL_ATTEMPTS` x the limit,
 * about 5 s.
 *
 * One structured line per call, whatever the outcome. It carries no key, URL
 * or bucket name.
 */
export async function getObjectBytes(
  config: R2Config,
  key: string,
  opts: { maxBytes?: number } = {},
): Promise<R2GetResult> {
  const maxBytes = opts.maxBytes ?? R2_GET_MAX_BYTES;
  const startedAt = Date.now();
  const progress = { attempts: 0 };
  let status: number | null = null;
  const result = await (async (): Promise<R2GetResult> => {
    try {
      const tried = await boundedRequest<R2GetResult>(
        config,
        key,
        "GET",
        async (res) => {
          status = res.status;
          if (!res.ok) {
            void res.body?.cancel().catch(() => {});
            return res.status === 404 ? { kind: "missing" } : { kind: "error", status: res.status };
          }
          // R2 states the length up front: an object over the limit is never read.
          const declared = Number(res.headers.get("content-length") ?? "-1");
          if (declared > maxBytes) {
            void res.body?.cancel().catch(() => {});
            return { kind: "tooLarge" };
          }
          const bytes = await res.arrayBuffer();
          return bytes.byteLength > maxBytes ? { kind: "tooLarge" } : { kind: "ok", bytes };
        },
        progress,
      );
      if (tried.kind === "timeout") return { kind: "timeout" };
      if (tried.body) return tried.body;
      // The tries ran out on a server fault.
      status = tried.res.status;
      void tried.res.body?.cancel().catch(() => {});
      return { kind: "error", status: tried.res.status };
    } catch {
      return { kind: "error", status };
    }
  })();
  console.log(
    JSON.stringify({
      msg: "r2_get",
      attempts: progress.attempts,
      status,
      durationMs: Date.now() - startedAt,
      outcome: result.kind,
    }),
  );
  return result;
}

/** An object's size and type, or null when it isn't there. */
export async function headObject(
  config: R2Config,
  key: string,
): Promise<{ bytes: number; contentType: string | null } | null> {
  const res = await boundedFetch(config, key, "HEAD");
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 HEAD failed: ${res.status}`);
  return { bytes: Number(res.headers.get("content-length") ?? "-1"), contentType: res.headers.get("content-type") };
}

/**
 * Write one object from here (a browser uses `signedPutUrl`). Unsigned payload,
 * so the signature does not bind these bytes; only the deployment holds the key.
 */
export async function putObject(
  config: R2Config,
  key: string,
  body: Uint8Array<ArrayBuffer>,
  contentType: string,
  timeoutMs: number,
): Promise<void> {
  const res = await config.client.fetch(`${config.base}/${key.split("/").map(encodeURIComponent).join("/")}`, {
    method: "PUT",
    headers: { "content-type": contentType },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    await res.text().catch(() => "");
    throw new Error(`R2 PUT failed: ${res.status}`);
  }
}

/** Delete one object. A missing one is fine (S3 answers 204 either way). */
export async function deleteObject(config: R2Config, key: string): Promise<void> {
  const res = await boundedFetch(config, key, "DELETE");
  if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE failed: ${res.status}`);
}
