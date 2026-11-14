/**
 * One recording session (CONTRACT.md, "Recorder"): walk the fake's miss list,
 * fetch ONLY the three catalogue endpoints from real BSC, serially, at most
 * one request a second and `maxRequests` (300) a session, and stop on the
 * first 429, 5xx, timeout, network error or 401/403, with no retry. Every
 * answer is sanitised with the shared allowlist before it is uploaded.
 *
 * Every dependency is injected so the loop is unit-tested against a mocked
 * BSC; nothing here reaches the network on its own.
 */
import { canonicalRequest, requestKey, type CanonicalRequest } from "../src/requestKey";
import { SANITISE_ALLOWLIST_VERSION, catalogueEndpointFor, sanitiseCatalogue } from "../src/sanitise";
import type { MissEntry } from "./fake-client";

export const MAX_REQUESTS_PER_SESSION = 300;
export const MIN_INTERVAL_MS = 1000;
export const BSC_TIMEOUT_MS = 30_000;
/** Stop rather than send with a token this close to expiry (a 401 would stop us anyway). */
export const TOKEN_MARGIN_MS = 2 * 60 * 1000;

export type BscAnswer =
  | { kind: "response"; status: number; body: unknown }
  | { kind: "timeout" }
  | { kind: "network" };

export type StopReason =
  | "done"
  | "cap"
  | "rate_limited"
  | "server_error"
  | "timeout"
  | "network"
  | "unauthorised"
  | "unexpected_status"
  | "bad_body"
  | "upload_refused"
  | "token_expiring"
  | "interrupted";

export interface RecordDeps {
  prefix: string;
  watch: boolean;
  fake: {
    misses(prefix: string): Promise<MissEntry[]>;
    uploadRecording(recording: unknown): Promise<unknown>;
  };
  /** One catalogue request to real BSC. Must not retry. */
  bsc(req: CanonicalRequest): Promise<BscAnswer>;
  tokenExpiresAt: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  maxRequests?: number;
  minIntervalMs?: number;
  pollMs?: number;
  /** True once the operator interrupted (Ctrl-C). */
  stopped?: () => boolean;
  report?: (line: string) => void;
}

export interface RecordResult {
  sent: number;
  recorded: number;
  stopReason: StopReason;
  /** Misses the fake has no model for: method + template, for a human. */
  needsModel: string[];
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The miss's request, only if it is a catalogue request whose key recomputes. */
export function fetchableRequest(m: MissEntry): CanonicalRequest | null {
  if (m.kind !== "catalogue" || !m.request) return null;
  const r = m.request;
  if (typeof r.method !== "string" || typeof r.path !== "string") return null;
  const req = canonicalRequest({ method: r.method, path: r.path, query: Array.isArray(r.query) ? r.query : [], body: r.body });
  if (!catalogueEndpointFor(req.method, req.path)) return null;
  if (requestKey(req) !== m.key) return null;
  return req;
}

export async function runRecordSession(deps: RecordDeps): Promise<RecordResult> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const max = Math.min(deps.maxRequests ?? MAX_REQUESTS_PER_SESSION, MAX_REQUESTS_PER_SESSION);
  const interval = Math.max(deps.minIntervalMs ?? MIN_INTERVAL_MS, MIN_INTERVAL_MS);
  const pollMs = deps.pollMs ?? 3000;
  const report = deps.report ?? (() => undefined);
  const stopped = deps.stopped ?? (() => false);

  const done = new Set<string>();
  const needsModel = new Set<string>();
  let sent = 0;
  let recorded = 0;
  let lastSentAt = -Infinity;
  const finish = (stopReason: StopReason): RecordResult => ({ sent, recorded, stopReason, needsModel: [...needsModel].sort() });

  for (;;) {
    if (stopped()) return finish("interrupted");
    const misses = await deps.fake.misses(deps.prefix);
    const todo: Array<{ key: string; req: CanonicalRequest }> = [];
    for (const m of misses) {
      if (m.kind === "needs-model") {
        needsModel.add(`${m.method} ${m.path}`);
        continue;
      }
      if (done.has(m.key)) continue;
      const req = fetchableRequest(m);
      if (!req) {
        needsModel.add(`${m.method} ${m.path} (not a fetchable catalogue request)`);
        done.add(m.key);
        continue;
      }
      todo.push({ key: m.key, req });
    }

    for (const { key, req } of todo) {
      if (stopped()) return finish("interrupted");
      if (sent >= max) return finish("cap");
      if (deps.tokenExpiresAt - now() < TOKEN_MARGIN_MS) return finish("token_expiring");
      const wait = lastSentAt + interval - now();
      if (wait > 0) await sleep(wait);
      lastSentAt = now();
      sent += 1;
      const endpoint = catalogueEndpointFor(req.method, req.path)!;
      const started = now();
      const answer = await deps.bsc(req);
      if (answer.kind === "timeout") return finish("timeout");
      if (answer.kind === "network") return finish("network");
      const ms = now() - started;
      report(`${endpoint} ${answer.status} ${ms}ms`);
      if (answer.status === 429) return finish("rate_limited");
      if (answer.status >= 500) return finish("server_error");
      if (answer.status === 401 || answer.status === 403) return finish("unauthorised");
      if (answer.status !== 200 && answer.status !== 404) return finish("unexpected_status");

      let body: unknown = null;
      if (answer.status === 200) {
        const s = sanitiseCatalogue(endpoint, answer.body);
        if (s.value === undefined) return finish("bad_body");
        if (s.dropped.length) report(`${endpoint} sanitised: ${s.dropped.length} field path(s) dropped`);
        body = s.value;
      }
      try {
        await deps.fake.uploadRecording({
          key,
          allowlistVersion: SANITISE_ALLOWLIST_VERSION,
          request: { method: req.method, path: req.path, query: req.query, body: req.body },
          response: { status: answer.status, body },
          recordedAt: new Date(now()).toISOString(),
        });
      } catch {
        return finish("upload_refused");
      }
      done.add(key);
      recorded += 1;
    }

    if (!deps.watch) return finish("done");
    await sleep(pollMs);
  }
}

/**
 * The real BSC call for one catalogue request: no retry, a 30 s limit for
 * headers and body together. card-listing is public and goes without the
 * token, as Convex sends it.
 */
export function bscCaller(opts: {
  apiBase: string;
  token: string;
  headers: (token: string) => Record<string, string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): (req: CanonicalRequest) => Promise<BscAnswer> {
  const f = opts.fetchImpl ?? fetch;
  return async (req) => {
    const endpoint = catalogueEndpointFor(req.method, req.path);
    if (!endpoint) throw new Error("refusing a non-catalogue request");
    const q = req.query.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    const url = `${opts.apiBase}/${req.path}${q ? `?${q}` : ""}`;
    const signal = AbortSignal.timeout(opts.timeoutMs ?? BSC_TIMEOUT_MS);
    try {
      const res = await f(url, {
        method: req.method,
        headers: endpoint === "cardListing" ? { Accept: "application/json" } : opts.headers(opts.token),
        body: req.method === "GET" || req.body === undefined ? undefined : JSON.stringify(req.body),
        signal,
        redirect: "error",
      });
      if (res.status !== 200) {
        await res.body?.cancel().catch(() => undefined);
        return { kind: "response", status: res.status, body: null };
      }
      try {
        return { kind: "response", status: 200, body: await res.json() };
      } catch {
        if (signal.aborted) return { kind: "timeout" };
        return { kind: "response", status: 200, body: undefined };
      }
    } catch {
      return signal.aborted ? { kind: "timeout" } : { kind: "network" };
    }
  };
}
