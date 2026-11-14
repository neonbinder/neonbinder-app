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
import { replayRefusal } from "./replay-allowlist";

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
  | "interrupted"
  | "declined";

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
  /**
   * Asked before any request not yet confirmed goes to BSC, with one line per
   * new request (`describeRequest`). In `--watch` every new batch is asked
   * again. Missing or false: nothing is sent ("declined"). The CLI answers it
   * with an interactive "yes" on the terminal, or `--yes`.
   */
  confirm?: (items: string[]) => Promise<boolean>;
  /** Keys the operator already confirmed (the CLI's plan, shown before sign-in). */
  confirmedKeys?: ReadonlySet<string>;
  /** Replay misses with no namespace and no prefix too (`--include-anon`). Off by default. */
  includeAnon?: boolean;
  report?: (line: string) => void;
}

export interface RecordResult {
  sent: number;
  recorded: number;
  stopReason: StopReason;
  /** Misses the fake has no model for: method + template, for a human. */
  needsModel: string[];
  /** Misses refused by the replay allowlist: `<reason> <endpoint> <key prefix>`, never a value. */
  refused: string[];
  /** Anonymous misses left alone (no `--include-anon`). */
  anonSkipped: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Why a miss may not be replayed, or its request. Reasons never carry a value. */
export function replayable(m: MissEntry): { ok: true; req: CanonicalRequest } | { ok: false; reason: string } {
  if (m.kind !== "catalogue" || !m.request) return { ok: false, reason: "not_a_catalogue_miss" };
  const r = m.request;
  if (typeof r.method !== "string" || typeof r.path !== "string") return { ok: false, reason: "malformed" };
  let req: CanonicalRequest;
  try {
    req = canonicalRequest({ method: r.method, path: r.path, query: Array.isArray(r.query) ? r.query : [], body: r.body });
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!catalogueEndpointFor(req.method, req.path)) return { ok: false, reason: "not_a_catalogue_request" };
  if (requestKey(req) !== m.key) return { ok: false, reason: "key_mismatch" };
  const refusal = replayRefusal(req);
  if (refusal) return { ok: false, reason: refusal };
  return { ok: true, req };
}

/** The miss's request, only if it may be replayed. */
export function fetchableRequest(m: MissEntry): CanonicalRequest | null {
  const r = replayable(m);
  return r.ok ? r.req : null;
}

/**
 * One line for the operator, per request: the endpoint and the facet slugs,
 * or the card id. Only for requests that passed the allowlist, so every
 * printed value is a slug or hex (no control characters reach the terminal).
 */
export function describeRequest(req: CanonicalRequest): string {
  const endpoint = catalogueEndpointFor(req.method, req.path);
  if (endpoint === "cardListing") return `cardListing ${req.path.split("/")[2]}`;
  const body = (req.body ?? {}) as { filters?: Record<string, string[]> };
  const facets = Object.entries(body.filters ?? {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v.join(",")}`);
  return `${endpoint ?? "?"} ${facets.length ? facets.join(" ") : "(no filters)"}`;
}

/** A miss is anonymous when it names neither a namespace nor a deployment prefix. */
export function isAnonymous(m: MissEntry): boolean {
  return m.ns === null && !m.prefix;
}

/** A label safe to print: only fixed words and hex, never text from the miss. */
function label(m: MissEntry, reason: string): string {
  const endpoint = m.request && typeof m.request.method === "string" && typeof m.request.path === "string" ? catalogueEndpointFor(m.request.method, m.request.path.replace(/^\/+/, "")) : null;
  const key = typeof m.key === "string" && /^[0-9a-f]{12}/.test(m.key) ? m.key.slice(0, 12) : "?";
  return `${reason} ${endpoint ?? (m.kind === "needs-model" ? "needs-model" : "other")} ${key}`;
}

export interface MissPlan {
  todo: Array<{ key: string; req: CanonicalRequest }>;
  refused: Array<{ key: string; label: string }>;
  needsModel: string[];
  anonSkipped: number;
}

/** Sorts a miss list into what may be sent, what is refused and what is left alone. */
export function planMisses(misses: MissEntry[], opts: { includeAnon?: boolean; done?: ReadonlySet<string> } = {}): MissPlan {
  const plan: MissPlan = { todo: [], refused: [], needsModel: [], anonSkipped: 0 };
  const seen = new Set<string>();
  for (const m of misses) {
    if (opts.done?.has(m.key) || seen.has(m.key)) continue;
    seen.add(m.key);
    if (m.kind === "needs-model") {
      const p = typeof m.path === "string" && /^[A-Za-z0-9_:/.-]{1,200}$/.test(m.path) ? m.path : "?";
      const meth = typeof m.method === "string" && /^[A-Z]{1,10}$/.test(m.method) ? m.method : "?";
      plan.needsModel.push(`${meth} ${p}`);
      continue;
    }
    if (isAnonymous(m) && !opts.includeAnon) {
      plan.anonSkipped += 1;
      continue;
    }
    const r = replayable(m);
    if (r.ok) plan.todo.push({ key: m.key, req: r.req });
    else plan.refused.push({ key: m.key, label: label(m, r.reason) });
  }
  return plan;
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
  const refused = new Set<string>();
  const anonKeys = new Set<string>();
  const confirmed = new Set<string>(deps.confirmedKeys ?? []);
  let sent = 0;
  let recorded = 0;
  let lastSentAt = -Infinity;
  const finish = (stopReason: StopReason): RecordResult => ({
    sent,
    recorded,
    stopReason,
    needsModel: [...needsModel].sort(),
    refused: [...refused].sort(),
    anonSkipped: anonKeys.size,
  });

  for (;;) {
    if (stopped()) return finish("interrupted");
    const misses = await deps.fake.misses(deps.prefix);
    const plan = planMisses(misses, { includeAnon: deps.includeAnon, done });
    for (const n of plan.needsModel) needsModel.add(n);
    for (const r of plan.refused) {
      refused.add(r.label);
      done.add(r.key);
    }
    for (const m of misses) if (isAnonymous(m) && !deps.includeAnon && m.kind !== "needs-model") anonKeys.add(m.key);
    const todo = plan.todo;

    // Nothing goes out that the operator has not seen: a request missing
    // from the confirmed set (added since the plan, or by --watch) is asked
    // about again, as a batch, before anything in this pass is sent.
    const fresh = todo.filter((t) => !confirmed.has(t.key));
    if (fresh.length > 0) {
      report(`${fresh.length} new request(s) to send to real BSC (at most ${max} this session):`);
      if (!deps.confirm || !(await deps.confirm(fresh.map((t) => describeRequest(t.req))))) return finish("declined");
      for (const t of fresh) confirmed.add(t.key);
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
