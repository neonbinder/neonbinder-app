import crypto from "node:crypto";
import { Request, Response, Router } from "express";
import {
  BscEndpoints,
  FAKE_BSC_KEY_HEADER,
  FAKE_ID_TOKEN_HEADER,
  SERVERLESS_AUTH_HEADER,
  fakeBscCallerHeaders,
  resolveBscEndpoints,
} from "../bsc-endpoints";
import { shapeMap } from "../bsc-shape";
import { CanaryPauseDeps, shouldSkipCanary } from "../canary-pause";
import {
  EBAY_HOSTS,
  EBAY_READONLY_SCOPES,
  EBAY_SCOPES,
  EbayOAuthConfig,
  EbayOAuthError,
  EbayTokenResult,
  TOKEN_PATH,
  fetchApplicationToken,
  readEbayOAuthConfig,
  refreshAccessToken,
} from "../services/ebay-oauth";
import { SecretsManagerService } from "../services/secrets-manager";
import {
  EBAY_PROBE_ALLOWLIST,
  EbayProbeEntry,
  EbayProbeHashKind,
  EbayProbeHost,
  EbayProbeLeg,
  resolveProbeQueryValue,
} from "./ebay-probe-allowlist";

/**
 * NEO-555: `POST /probe/ebay`, the prod deploy gate's eBay leg and the daily
 * eBay drift source. Built like `/probe/bsc` (./bsc-probe.ts): same auth
 * (Cloud Run IAM only, no app-layer check), same global limiter plus its own
 * one-a-minute window, same value-free shapes.
 *
 * READ-ONLY BY CONSTRUCTION. In prod this reads a real seller account (eBay
 * offers no separate prod test seller), so:
 *   - the raw transport (global fetch, or the test's stub) is wrapped ONCE,
 *     by createProbeTransport, and only the wrapper is ever put in the
 *     context. The wrapper refuses every request but a GET of exactly one
 *     allowlist entry's URL on the target's base, or a POST of a
 *     client_credentials / refresh_token grant to the target's token URL,
 *     each carrying only its own header names (so no method-override
 *     header turns an allowlisted GET into a write at eBay). It
 *     does not care how it is called (`.call`, `Reflect.apply`, an alias) or
 *     how the method is spelt: anything but the exact "GET" or "POST" is
 *     refused, so a lowercase "delete" that fetch would upper-case is too;
 *   - every eBay read goes through `probeGet`, which refuses anything but a
 *     GET entry of EBAY_PROBE_ALLOWLIST (by reference) and takes no path,
 *     query or body of its own;
 *   - the only POST is `tokenGrant`: a refresh_token or client_credentials
 *     grant to eBay's token endpoint, through the existing refreshAccessToken
 *     / fetchApplicationToken. Its transport refuses any other URL, method or
 *     grant type (an authorization_code grant included);
 *   - the minted access token lives in this request's memory only. Nothing is
 *     written back: no Secret Manager write, no credential lock, no cache;
 *   - the user token is asked for with the read-only scopes first
 *     (EBAY_READONLY_SCOPES). Only when eBay answers `invalid_scope` does it
 *     ask again with the consented scopes, logged as
 *     `ebay_probe_scope_fallback`; any other refusal (invalid_grant: a revoked
 *     or expired token) is the account warning, with no second grant.
 * tests/ebay-probe.test.mjs fails on egress anywhere else in this file or the
 * allowlist file, on an aliased call (`.call`/`.apply`/`.bind`,
 * `Reflect.apply`), on a write-method literal in any case, on an import this
 * file did not have, and on any non-GET allowlist entry.
 *
 * TWO LEGS.
 *   - App leg (hard): a client_credentials token, then row 7 (the card
 *     category's item aspects). A failure here fails the probe: it is what
 *     every listing's aspect check depends on.
 *   - Account leg (warning): the seller's refresh token, refreshed in memory,
 *     then the account reads. Never connected, or a refresh eBay refuses, is a
 *     warning (`skipped_not_connected`, `refresh_failed`), not a failure.
 *
 * WHICH ACCOUNT.
 *   - Real target (prod only; the BSC target decides: no fake URL = real):
 *     the request body is IGNORED. The credential key is read from
 *     NEONBINDER_EBAY_PROBE_CREDENTIAL_KEY, an `ebay-credentials-<id>` secret
 *     key set on the prod deploy only. Unset = the account leg is skipped.
 *     The real probe outside prod answers 409 and contacts nobody.
 *   - Fake target (NEONBINDER_FAKE_BSC_URL set, never prod): the fake eBay
 *     under `<FAKE>/ebay/api` and `<FAKE>/ebay/apiz`, with the fake's fixed
 *     public client id and secret and the same caller key and ID token as the
 *     fake BSC. The body may carry `{refreshToken}` minted by the fake; without
 *     it the account leg is skipped.
 *
 * WHAT IT RETURNS. Statuses, timings, value-free shapes (key paths and types,
 * only the paths in each entry's `shapePaths`) and two digests (digestNames):
 * the shipping-service codes (row 5) and the aspect names (row 7). `shapes`,
 * `statuses` and `hashes` are keyed by the fake's endpoint names, so they are
 * the body of `/__fake/drift-compare {marketplace: "ebay"}` as they stand.
 * NEVER a value: no token, no key, no user id, no eBay message. `detail`
 * names a step and a class, nothing more.
 *
 * LIMITS. One probe a minute per process (429 + Retry-After). On the real
 * target the eBay pause flag (NEONBINDER_PAUSED_PLATFORMS, the canary's
 * lookup, site key "ebay") answers `outcome: "skipped_paused"` without
 * calling eBay. The lookup FAILS OPEN, like the canary's: a lookup that
 * cannot answer means "not paused", so the probe runs (shouldSkipCanary logs
 * `canary_pause_lookup_failed`; an injected lookup that throws is logged as
 * `ebay_probe_pause_lookup_failed`). The account leg stops at the first
 * 429/5xx/timeout.
 */

/** Env var naming the prod probe account's credential key (`ebay-credentials-<id>`). */
export const EBAY_PROBE_CREDENTIAL_KEY_ENV = "NEONBINDER_EBAY_PROBE_CREDENTIAL_KEY";
/** A real eBay credential key. The fake-session form is refused. */
export const EBAY_PROBE_CREDENTIAL_KEY_RE = /^ebay-credentials-(?!fake-)[A-Za-z0-9_-]{1,128}$/;

/**
 * The fake eBay's fixed PUBLIC client credentials (NEO-555 plan: "Fixed
 * public fake client id/secret"). Not secrets: they open nothing but the fake.
 * They must equal services/fake-bsc/src/ebay/tokens.ts; tests/ebay-probe.test.mjs
 * checks the two stay in step.
 */
export const FAKE_EBAY_CLIENT_ID = "NeonBind-FakeEbay-PRD-0fake000-00000000";
export const FAKE_EBAY_CLIENT_SECRET = "PRD-0fake0000000-fake-ebay-client-secret";
export const FAKE_EBAY_RU_NAME = "nb-fake-ebay-ru-name";

export const EBAY_PROBE_MIN_INTERVAL_MS = 60_000;
export const EBAY_PROBE_READ_TIMEOUT_MS = 15_000;
/** A read larger than this is not parsed (and counts as read_failed). */
export const EBAY_PROBE_MAX_BODY_CHARS = 5 * 1024 * 1024;
/** A fake-mode refresh token longer than this is refused (400). */
const MAX_FAKE_REFRESH_TOKEN_LENGTH = 4096;

export type EbayProbeTargetKind = "real" | "fake";

export type EbayProbeOutcome = "ok" | "account_warning" | "app_failed" | "skipped_paused";

export type AppLegOutcome = "ok" | "skipped_paused" | "not_configured" | "token_failed" | "ebay_unavailable" | "read_failed";

export type AccountLegOutcome =
  | "ok"
  | "skipped_paused"
  | "not_configured"
  | "skipped_not_connected"
  | "credential_read_failed"
  | "refresh_failed"
  | "ebay_unavailable"
  | "read_failed";

export interface EbayProbeStep {
  step: string;
  leg: EbayProbeLeg;
  /** NEO-555 eBay-surface row (14 for the token endpoint). */
  row: number;
  status: number;
  ms: number;
  parsed: boolean;
  failure?: "timeout" | "network" | "too_large" | "not_json" | "skipped";
}

export interface EbayProbeResponseBody {
  ebayTarget: EbayProbeTargetKind;
  outcome: EbayProbeOutcome;
  appLeg: { ok: boolean; outcome: AppLegOutcome; detail?: string };
  accountLeg: {
    ok: boolean;
    outcome: AccountLegOutcome;
    /** Which scope set the user token was minted with; null when none was. */
    scopes: "readonly" | "consented" | null;
    detail?: string;
  };
  /** endpoint name → {key.path: type}, for every entry that answered a JSON object. */
  shapes: Record<string, Record<string, string>>;
  /** endpoint name → the HTTP status it answered (0: no answer). Every read entry. */
  statuses: Record<string, number>;
  /** endpoint name → digest (rows 5 and 7 only, on a 200 with the list present). */
  hashes: Record<string, string>;
  steps: EbayProbeStep[];
  durationMs: number;
  detail?: string;
}

/** Where the probe sends requests. Built only by resolveEbayProbeTarget. */
export interface EbayProbeTarget {
  readonly kind: EbayProbeTargetKind;
  readonly bases: Readonly<Record<EbayProbeHost, string>>;
  /** The BSC endpoint resolution the fake pin and caller headers hang off. */
  readonly endpoints: BscEndpoints;
}

type Env = Record<string, string | undefined>;

/**
 * Real: eBay production's fixed hosts. Fake: the pinned fake origin (the same
 * NEONBINDER_FAKE_BSC_URL the fake BSC uses, refused in prod and on any host
 * but the fake's own) with eBay's host as the first path segment.
 */
export function resolveEbayProbeTarget(env: Env): EbayProbeTarget {
  const endpoints = resolveBscEndpoints(env);
  if (endpoints.target === "fake" && endpoints.fakeOrigin) {
    const origin = endpoints.fakeOrigin;
    return Object.freeze({
      kind: "fake" as const,
      bases: Object.freeze({ api: `${origin}/ebay/api`, apiz: `${origin}/ebay/apiz` }),
      endpoints,
    });
  }
  return Object.freeze({
    kind: "real" as const,
    bases: Object.freeze({ api: EBAY_HOSTS.production.api, apiz: EBAY_HOSTS.production.apiz }),
    endpoints,
  });
}

/** What probeGet and tokenGrant need. No URL, path or body travels in it. */
export interface EbayProbeContext {
  target: EbayProbeTarget;
  env: Env;
  /** In the route: ALWAYS the createProbeTransport wrapper, never a raw fetch. */
  fetchImpl: typeof fetch;
  now: () => number;
  timeoutMs: number;
  mintIdToken?: (audience: string) => Promise<string>;
  /**
   * The clock the allowlist's date-window queries resolve against (row 13).
   * The route fixes it at the start of a run so probeGet and the transport
   * wrapper build the same URL. Absent: `now()`.
   */
  queryTimeMs?: number;
}

/** The two grants the probe may make. Never authorization_code. */
const TOKEN_GRANT_TYPES: ReadonlySet<string> = new Set(["client_credentials", "refresh_token"]);

/**
 * The one URL an allowlist entry reads on `target`: the target's fixed base
 * for the entry's host, the entry's fixed path, its fixed query resolved
 * against `queryTimeMs`. probeGet and createProbeTransport both build it here,
 * so the two cannot disagree.
 */
export function probeEntryUrl(entry: EbayProbeEntry, target: EbayProbeTarget, queryTimeMs: number): string {
  const base = target.bases[entry.host];
  const url = new URL(`${base}${entry.path}`);
  for (const [k, v] of Object.entries(entry.query)) {
    url.searchParams.set(k, resolveProbeQueryValue(v, queryTimeMs));
  }
  if (!url.href.startsWith(`${base}/`)) {
    throw new Error("probeEntryUrl: refused a URL outside the target's base");
  }
  return url.href;
}

const TRANSPORT_REFUSED = "ebay probe transport: refused a request that is neither an allowlisted GET nor a token grant";

/**
 * The header names each request kind may carry, lower-case. Exactly what
 * probeGet (GET) and the eBay OAuth client's token grant (POST) send; on the
 * fake target, also fakeBscCallerHeaders' three. Anything else, a method
 * override (`X-HTTP-Method-Override`, `X-HTTP-Method`, `X-Method-Override`)
 * above all, is refused: an allowlisted GET must stay a GET at eBay too.
 */
const GET_HEADERS: readonly string[] = Object.freeze(["authorization", "accept", "accept-language", "x-ebay-c-marketplace-id"]);
const POST_HEADERS: readonly string[] = Object.freeze(["authorization", "accept", "content-type"]);
const FAKE_CALLER_HEADERS: readonly string[] = Object.freeze(
  [FAKE_BSC_KEY_HEADER, SERVERLESS_AUTH_HEADER, FAKE_ID_TOKEN_HEADER].map((h) => h.toLowerCase()),
);

/**
 * Check `headers` against `allowed` and return a fresh plain copy, read once,
 * which is what gets forwarded (a getter cannot answer the check one way and
 * fetch another). Absent headers are an empty copy. Refused: anything but a
 * plain object (a Headers instance or an array of pairs), a name off the list
 * in any case, the same name twice in different cases (fetch would join
 * them), a non-string value.
 */
function allowedHeaders(headers: unknown, allowed: ReadonlySet<string>): Record<string, string> {
  if (headers === undefined) return {};
  if (headers === null || typeof headers !== "object") throw new Error(TRANSPORT_REFUSED);
  const proto = Object.getPrototypeOf(headers);
  if (proto !== Object.prototype && proto !== null) throw new Error(TRANSPORT_REFUSED);
  const out: Record<string, string> = {};
  const seen = new Set<string>();
  for (const [name, value] of Object.entries(headers as Record<string, unknown>)) {
    const lower = name.toLowerCase();
    if (!allowed.has(lower) || seen.has(lower) || typeof value !== "string") throw new Error(TRANSPORT_REFUSED);
    seen.add(lower);
    out[name] = value;
  }
  return out;
}

/**
 * THE GUARD. Wraps the raw transport once per probe run; the route puts only
 * the result in the context, so every request the probe makes (probeGet, the
 * token grants, anything a later edit adds through `ctx.fetchImpl`) passes
 * through here, however it is invoked. It forwards exactly:
 *   - `GET <url>` where `<url>` is, character for character, one
 *     EBAY_PROBE_ALLOWLIST entry's probeEntryUrl on `target`, with no body;
 *   - `POST <target's token URL>` whose form body names exactly one
 *     grant_type, client_credentials or refresh_token, and no `code`.
 * The method must be the exact string "GET" or "POST": a lowercase or
 * missing method is refused (fetch would upper-case "delete" to DELETE). The
 * URL must be a string (a Request or URL object, which can carry its own
 * method and body, is refused). Headers must be a plain object naming only
 * the request kind's own headers (GET_HEADERS / POST_HEADERS, plus the fake
 * caller's on the fake target), so no method-override header rides on an
 * allowlisted GET. Redirects are always refused. A refusal throws before the
 * raw transport is touched.
 */
export function createProbeTransport(raw: typeof fetch, target: EbayProbeTarget, queryTimeMs: number): typeof fetch {
  const getUrls: ReadonlySet<string> = new Set(EBAY_PROBE_ALLOWLIST.map((e) => probeEntryUrl(e, target, queryTimeMs)));
  const tokenUrl = `${target.bases.api}${TOKEN_PATH}`;
  const caller = target.kind === "fake" ? FAKE_CALLER_HEADERS : [];
  const getHeaders: ReadonlySet<string> = new Set([...GET_HEADERS, ...caller]);
  const postHeaders: ReadonlySet<string> = new Set([...POST_HEADERS, ...caller]);
  const guarded = async (input: unknown, init?: RequestInit): Promise<globalThis.Response> => {
    if (typeof input !== "string" || !init) throw new Error(TRANSPORT_REFUSED);
    const method = init.method;
    let headers: Record<string, string>;
    if (method === "GET") {
      if (!getUrls.has(input) || (init.body !== undefined && init.body !== null)) throw new Error(TRANSPORT_REFUSED);
      headers = allowedHeaders(init.headers, getHeaders);
    } else if (method === "POST") {
      if (input !== tokenUrl || typeof init.body !== "string") throw new Error(TRANSPORT_REFUSED);
      const form = new URLSearchParams(init.body);
      const grants = form.getAll("grant_type");
      if (grants.length !== 1 || !TOKEN_GRANT_TYPES.has(grants[0]) || form.has("code")) throw new Error(TRANSPORT_REFUSED);
      headers = allowedHeaders(init.headers, postHeaders);
    } else {
      throw new Error(TRANSPORT_REFUSED);
    }
    return raw(input, { ...init, headers, redirect: "error" });
  };
  return Object.freeze(guarded) as typeof fetch;
}

export interface ProbeGetResult {
  status: number;
  /** Parsed JSON body, when it was JSON and under the size cap. */
  body?: unknown;
  failure?: EbayProbeStep["failure"];
}

/**
 * THE ONLY eBay read. Throws unless `entry` is one of EBAY_PROBE_ALLOWLIST's
 * own objects and a GET. The URL is the target's fixed base for the entry's
 * host plus the entry's fixed path and query; redirects are refused.
 *
 * SECURITY: `accessToken` goes into one Authorization header and nowhere
 * else. A network error is reduced to a class; its `cause` (which carries the
 * request) is dropped.
 */
export async function probeGet(
  entry: EbayProbeEntry,
  accessToken: string,
  ctx: EbayProbeContext,
): Promise<ProbeGetResult> {
  if (!EBAY_PROBE_ALLOWLIST.includes(entry) || entry.method !== "GET") {
    throw new Error("probeGet: refused a request that is not an allowlisted GET");
  }
  const href = probeEntryUrl(entry, ctx.target, ctx.queryTimeMs ?? ctx.now());
  let status = 0;
  try {
    // Fake only (empty for the real target). A missing caller key or a failed
    // ID-token mint is a network-class failure of this read, not a crash.
    const caller = await fakeBscCallerHeaders(ctx.target.endpoints, {
      env: ctx.env,
      mintIdToken: ctx.mintIdToken,
    });
    const res = await ctx.fetchImpl(href, {
      method: "GET",
      headers: {
        ...caller,
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Accept-Language": "en-US",
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
      redirect: "error",
      signal: AbortSignal.timeout(ctx.timeoutMs),
    });
    status = res.status;
    const text = await res.text();
    if (text.length > EBAY_PROBE_MAX_BODY_CHARS) return { status, failure: "too_large" };
    if (text.length === 0) return { status, failure: "not_json" };
    try {
      return { status, body: JSON.parse(text) as unknown };
    } catch {
      return { status, failure: "not_json" };
    }
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    return { status, failure: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
  }
}

/** The two grants the probe may make (TOKEN_GRANT_TYPES). */
export type ProbeGrant =
  | { grant: "client_credentials" }
  | { grant: "refresh_token"; refreshToken: string; scopes: readonly string[] };

/**
 * THE ONLY POST: one grant at eBay's token endpoint, through the existing
 * eBay OAuth client. Its transport refuses anything that is not a POST of a
 * client_credentials or refresh_token grant to eBay production's token URL,
 * and on the fake target re-points that one URL at `<FAKE>/ebay/api` and adds
 * the fake's caller headers. The result is returned to the caller and never
 * stored; a rotated refresh token, if eBay ever sent one, is dropped.
 */
export async function tokenGrant(
  config: EbayOAuthConfig,
  grant: ProbeGrant,
  ctx: EbayProbeContext,
): Promise<EbayTokenResult> {
  const realTokenUrl = `${EBAY_HOSTS.production.api}${TOKEN_PATH}`;
  const transport = (async (input: string | URL | globalThis.Request, init?: RequestInit): Promise<globalThis.Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const grantType = new URLSearchParams(typeof init?.body === "string" ? init.body : "").get("grant_type");
    if (init?.method !== "POST" || url !== realTokenUrl || !grantType || !TOKEN_GRANT_TYPES.has(grantType)) {
      throw new Error("tokenGrant: refused a request that is not a token grant");
    }
    if (ctx.target.kind === "real") return ctx.fetchImpl(url, init);
    const caller = await fakeBscCallerHeaders(ctx.target.endpoints, {
      env: ctx.env,
      mintIdToken: ctx.mintIdToken,
    });
    const headers = { ...(init.headers as Record<string, string>), ...caller };
    return ctx.fetchImpl(`${ctx.target.bases.api}${TOKEN_PATH}`, { ...init, headers });
  }) as typeof fetch;
  const deps = { fetchImpl: transport, now: ctx.now, timeoutMs: ctx.timeoutMs };
  const result =
    grant.grant === "client_credentials"
      ? await fetchApplicationToken(config, deps)
      : await refreshAccessToken(config, grant.refreshToken, deps, grant.scopes);
  return { accessToken: result.accessToken, expiresAt: result.expiresAt };
}

/**
 * The row 5 / row 7 digest, exactly the fake's `ebayCatalogueHash`
 * (services/fake-bsc/CONTRACT.md, "Drift"): non-empty strings only, made
 * unique, sorted with JavaScript's default sort, then lowercase hex
 * sha256 of the UTF-8 of `JSON.stringify(list)`.
 */
export function digestNames(names: readonly string[]): string {
  const list = [...new Set(names.filter((n) => typeof n === "string" && n.length > 0))].sort();
  return crypto.createHash("sha256").update(JSON.stringify(list), "utf8").digest("hex");
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** The names a hashed entry digests, or null when the body lacks the list. */
export function namesForDigest(kind: EbayProbeHashKind, body: unknown): string[] | null {
  if (!isRecord(body)) return null;
  if (kind === "shippingServiceCodes") {
    if (!Array.isArray(body.shippingServices)) return null;
    return body.shippingServices
      .map((s) => (isRecord(s) && typeof s.shippingService === "string" ? s.shippingService : null))
      .filter((s): s is string => s !== null);
  }
  if (!Array.isArray(body.aspects)) return null;
  return body.aspects
    .map((a) => (isRecord(a) && typeof a.localizedAspectName === "string" ? a.localizedAspectName : null))
    .filter((a): a is string => a !== null);
}

/** Fake-mode body: `{}` or `{refreshToken}`. Real mode never reads the body. */
function parseFakeBody(body: unknown): { ok: true; refreshToken?: string } | { ok: false } {
  if (body === undefined || body === null) return { ok: true };
  if (!isRecord(body)) return { ok: false };
  const rt = body.refreshToken;
  if (rt === undefined) return { ok: true };
  if (typeof rt !== "string" || rt.length === 0 || rt.length > MAX_FAKE_REFRESH_TOKEN_LENGTH) return { ok: false };
  if (!/^[\x21-\x7e]+$/.test(rt)) return { ok: false };
  return { ok: true, refreshToken: rt };
}

/** Outcome of reading the probe account's stored refresh token. */
export type ProbeCredentialRead =
  | { kind: "found"; refreshToken: string }
  | { kind: "absent" }
  | { kind: "failed" };

export interface EbayProbeDeps {
  env?: Env;
  now?: () => number;
  /** The RAW transport. Never put in the context: createProbeTransport wraps it. */
  fetchImpl?: typeof fetch;
  mintIdToken?: (audience: string) => Promise<string>;
  /** The eBay pause lookup. Default: shouldSkipCanary("ebay", pauseLookup). */
  isPaused?: () => Promise<boolean>;
  /** Deps for the default pause lookup (its own fetch, minter, site URL, log). */
  pauseLookup?: CanaryPauseDeps;
  /** Read the probe account's refresh token. Default: Secret Manager, read only. */
  readCredential?: (key: string) => Promise<ProbeCredentialRead>;
  minIntervalMs?: number;
  readTimeoutMs?: number;
  log?: (line: Record<string, unknown>) => void;
}

/** Default reader: getCredentials only (a read; no write, no lock). */
async function readCredentialFromSecretManager(key: string): Promise<ProbeCredentialRead> {
  try {
    const stored = await new SecretsManagerService().getCredentials(key);
    return stored.refreshToken ? { kind: "found", refreshToken: stored.refreshToken } : { kind: "absent" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("not found") || message.includes("No active version")) return { kind: "absent" };
    return { kind: "failed" };
  }
}

function defaultLog(line: Record<string, unknown>): void {
  try {
    console.log(JSON.stringify(line));
  } catch {
    console.log("ebay_probe (unserialisable line)");
  }
}

const unavailableStatus = (status: number): boolean => status === 429 || status >= 500;

/** A fixed-text description of a token-grant failure: kind, status, known OAuth code. */
function grantDetail(step: string, err: unknown): string {
  if (err instanceof EbayOAuthError) {
    const parts: string[] = [err.kind];
    if (err.upstreamStatus !== undefined) parts.push(`HTTP ${err.upstreamStatus}`);
    if (err.oauthError) parts.push(err.oauthError);
    return `${step}: ${parts.join(", ")}`;
  }
  return `${step}: failed`;
}

/** Express Router carrying POST /probe/ebay. One instance = one rate window. */
export function createEbayProbeRouter(deps: EbayProbeDeps = {}): Router {
  const router = Router();
  const now = deps.now ?? Date.now;
  const minInterval = deps.minIntervalMs ?? EBAY_PROBE_MIN_INTERVAL_MS;
  const readTimeoutMs = deps.readTimeoutMs ?? EBAY_PROBE_READ_TIMEOUT_MS;
  const log = deps.log ?? defaultLog;
  // The raw transport. It is handed to createProbeTransport and nowhere else.
  const rawFetch: typeof fetch = deps.fetchImpl ?? globalThis.fetch;
  let lastStartedAt: number | undefined;

  router.post("/probe/ebay", async (req: Request, res: Response) => {
    const env = deps.env ?? process.env;
    let target: EbayProbeTarget;
    try {
      target = resolveEbayProbeTarget(env);
    } catch {
      // A misconfigured fake URL; boot refuses this, so only a test sees it.
      res.status(500).json({ error: "eBay probe target is misconfigured" });
      return;
    }
    const isProd = (env.ENVIRONMENT ?? "").trim() === "prod";
    if (target.kind === "real" && !isProd) {
      res.status(409).json({
        error: "The real-eBay probe runs only in prod; point this revision at the fake",
        ebayTarget: target.kind,
      });
      return;
    }

    // Fake mode only: the body may carry a fake refresh token. Checked before
    // the rate window so a malformed call does not burn the minute.
    let fakeRefreshToken: string | undefined;
    if (target.kind === "fake") {
      const parsed = parseFakeBody(req.body);
      if (!parsed.ok) {
        res.status(400).json({ error: "Body must be {} or {refreshToken: string}", ebayTarget: target.kind });
        return;
      }
      fakeRefreshToken = parsed.refreshToken;
    }

    const started = now();
    if (lastStartedAt !== undefined && started - lastStartedAt < minInterval) {
      const retryAfterS = Math.ceil((minInterval - (started - lastStartedAt)) / 1000);
      res.setHeader("Retry-After", String(retryAfterS));
      res.status(429).json({ error: "The eBay probe runs at most once a minute", ebayTarget: target.kind });
      return;
    }
    lastStartedAt = started;

    const ctx: EbayProbeContext = {
      target,
      env,
      // Only the guard: every request of this run is checked against the
      // allowlist and the token grant, whoever makes it and however.
      fetchImpl: createProbeTransport(rawFetch, target, started),
      now,
      timeoutMs: readTimeoutMs,
      mintIdToken: deps.mintIdToken,
      queryTimeMs: started,
    };
    const body: EbayProbeResponseBody = {
      ebayTarget: target.kind,
      outcome: "ok",
      appLeg: { ok: false, outcome: "not_configured" },
      accountLeg: { ok: false, outcome: "not_configured", scopes: null },
      shapes: {},
      statuses: {},
      hashes: {},
      steps: [],
      durationMs: 0,
    };
    const finish = (): void => {
      body.durationMs = now() - started;
      log({
        msg: "ebay_probe",
        ebay_target: target.kind,
        outcome: body.outcome,
        app_leg: body.appLeg.outcome,
        account_leg: body.accountLeg.outcome,
        scopes: body.accountLeg.scopes,
        duration_ms: body.durationMs,
        steps: body.steps.map((s) => ({ step: s.step, status: s.status, ms: s.ms, parsed: s.parsed })),
      });
      res.status(200).json(body);
    };

    /**
     * Read one leg's entries in order. Returns the leg's failure, if any.
     * Stops at the first unavailable answer: eBay is throttling or down.
     */
    const readLeg = async (
      leg: EbayProbeLeg,
      accessToken: string,
    ): Promise<{ outcome: "ebay_unavailable" | "read_failed"; detail: string } | undefined> => {
      let first: { outcome: "ebay_unavailable" | "read_failed"; detail: string } | undefined;
      for (const entry of EBAY_PROBE_ALLOWLIST) {
        if (entry.leg !== leg) continue;
        if (first?.outcome === "ebay_unavailable") {
          body.steps.push({ step: entry.step, leg, row: entry.row, status: 0, ms: 0, parsed: false, failure: "skipped" });
          continue;
        }
        const t0 = now();
        const got = await probeGet(entry, accessToken, ctx);
        let parsed = false;
        body.statuses[entry.endpoint] = got.status;
        if (got.body !== undefined && isRecord(got.body)) {
          body.shapes[entry.endpoint] = shapeMap(got.body, { allow: entry.shapePaths });
          parsed = entry.okStatuses.includes(got.status);
          if (parsed && entry.hash && got.status === 200) {
            const names = namesForDigest(entry.hash, got.body);
            if (names === null) {
              parsed = false;
            } else {
              body.hashes[entry.endpoint] = digestNames(names);
            }
          }
        }
        const failure = got.failure;
        body.steps.push({
          step: entry.step,
          leg,
          row: entry.row,
          status: got.status,
          ms: now() - t0,
          parsed,
          ...(failure ? { failure } : {}),
        });
        if (first) continue;
        if (failure === "timeout" || failure === "network" || unavailableStatus(got.status)) {
          first = { outcome: "ebay_unavailable", detail: `${entry.step}: ${failure ?? `HTTP ${got.status}`}` };
        } else if (!entry.okStatuses.includes(got.status)) {
          first = { outcome: "read_failed", detail: `${entry.step}: HTTP ${got.status}` };
        } else if (!parsed) {
          first = { outcome: "read_failed", detail: `${entry.step}: ${failure ?? "unreadable body"}` };
        }
      }
      return first;
    };

    const grantStep = async (
      step: string,
      leg: EbayProbeLeg,
      config: EbayOAuthConfig,
      grant: ProbeGrant,
    ): Promise<{ token: string } | { error: unknown }> => {
      const t0 = now();
      try {
        const tokens = await tokenGrant(config, grant, ctx);
        body.steps.push({ step, leg, row: 14, status: 200, ms: now() - t0, parsed: true });
        return { token: tokens.accessToken };
      } catch (err) {
        const status = err instanceof EbayOAuthError ? (err.upstreamStatus ?? 0) : 0;
        body.steps.push({ step, leg, row: 14, status, ms: now() - t0, parsed: false });
        return { error: err };
      }
    };

    try {
      // --- Pause flag (real target only; the lookup is off outside prod) ---
      if (target.kind === "real") {
        // FAIL OPEN, like the canary: a lookup that cannot answer is "not
        // paused". shouldSkipCanary never throws (it logs its own failure);
        // an injected lookup that does is logged here and the probe runs.
        let paused = false;
        try {
          paused = (await (deps.isPaused ?? (() => shouldSkipCanary("ebay", deps.pauseLookup)))()) === true;
        } catch (err) {
          log({
            msg: "ebay_probe_pause_lookup_failed",
            ebay_target: target.kind,
            error_class: err instanceof Error ? err.name : "unknown",
          });
        }
        if (paused) {
          body.outcome = "skipped_paused";
          body.appLeg = { ok: false, outcome: "skipped_paused" };
          body.accountLeg = { ok: false, outcome: "skipped_paused", scopes: null };
          body.detail = "eBay is paused (NEONBINDER_PAUSED_PLATFORMS); no call was made";
          finish();
          return;
        }
      }

      // --- App configuration -------------------------------------------------
      let config: EbayOAuthConfig | null;
      if (target.kind === "fake") {
        config = {
          environment: "production",
          clientId: FAKE_EBAY_CLIENT_ID,
          clientSecret: FAKE_EBAY_CLIENT_SECRET,
          ruName: FAKE_EBAY_RU_NAME,
        };
      } else {
        const read = readEbayOAuthConfig(env as NodeJS.ProcessEnv);
        // The real probe reads production eBay only.
        config = read && read.environment === "production" ? read : null;
      }

      // --- App leg (hard) ------------------------------------------------------
      if (!config) {
        body.appLeg = { ok: false, outcome: "not_configured", detail: "eBay production app is not configured" };
      } else {
        const got = await grantStep("app.token", "app", config, { grant: "client_credentials" });
        if ("error" in got) {
          const unavailable = got.error instanceof EbayOAuthError && got.error.kind === "unavailable";
          body.appLeg = {
            ok: false,
            outcome: unavailable ? "ebay_unavailable" : "token_failed",
            detail: grantDetail("app.token", got.error),
          };
        } else {
          const failed = await readLeg("app", got.token);
          body.appLeg = failed ? { ok: false, ...failed } : { ok: true, outcome: "ok" };
        }
      }

      // --- Account leg (warning) -----------------------------------------------
      let refreshToken: string | undefined;
      if (!config) {
        body.accountLeg = { ok: false, outcome: "not_configured", scopes: null, detail: "eBay production app is not configured" };
      } else if (target.kind === "fake") {
        refreshToken = fakeRefreshToken;
        if (!refreshToken) {
          body.accountLeg = { ok: false, outcome: "skipped_not_connected", scopes: null, detail: "no fake refresh token in the request" };
        }
      } else {
        const key = (env[EBAY_PROBE_CREDENTIAL_KEY_ENV] ?? "").trim();
        if (!key) {
          body.accountLeg = { ok: false, outcome: "skipped_not_connected", scopes: null, detail: "no probe account is configured" };
        } else if (!EBAY_PROBE_CREDENTIAL_KEY_RE.test(key)) {
          body.accountLeg = { ok: false, outcome: "credential_read_failed", scopes: null, detail: "the probe account key is malformed" };
        } else {
          const stored = await (deps.readCredential ?? readCredentialFromSecretManager)(key);
          if (stored.kind === "found") {
            refreshToken = stored.refreshToken;
          } else if (stored.kind === "absent") {
            body.accountLeg = { ok: false, outcome: "skipped_not_connected", scopes: null, detail: "the probe account is not connected" };
          } else {
            body.accountLeg = { ok: false, outcome: "credential_read_failed", scopes: null, detail: "the probe account could not be read" };
          }
        }
      }

      if (config && refreshToken) {
        let scopes: "readonly" | "consented" = "readonly";
        let got = await grantStep("account.token_readonly", "account", config, {
          grant: "refresh_token",
          refreshToken,
          scopes: EBAY_READONLY_SCOPES,
        });
        // Fall back ONLY when eBay refused the scopes themselves. Any other
        // refusal (invalid_grant: the token is revoked or expired) would fail
        // the same way with the consented scopes, so a second grant would
        // only spend a call on the seller's token.
        if (
          "error" in got &&
          got.error instanceof EbayOAuthError &&
          got.error.kind === "rejected" &&
          got.error.oauthError === "invalid_scope"
        ) {
          log({
            msg: "ebay_probe_scope_fallback",
            ebay_target: target.kind,
            reason: "invalid_scope",
          });
          scopes = "consented";
          got = await grantStep("account.token_consented", "account", config, {
            grant: "refresh_token",
            refreshToken,
            scopes: EBAY_SCOPES,
          });
        }
        // Drop the reference as soon as the grant is done; it is never stored.
        refreshToken = undefined;
        if ("error" in got) {
          const unavailable = got.error instanceof EbayOAuthError && got.error.kind === "unavailable";
          body.accountLeg = {
            ok: false,
            outcome: unavailable ? "ebay_unavailable" : "refresh_failed",
            scopes: null,
            detail: grantDetail(`account.token_${scopes}`, got.error),
          };
        } else {
          const failed = await readLeg("account", got.token);
          body.accountLeg = failed ? { ok: false, scopes, ...failed } : { ok: true, outcome: "ok", scopes };
        }
      }

      // Steps for entries a leg never reached, so the drift side sees every row.
      for (const entry of EBAY_PROBE_ALLOWLIST) {
        if (!body.steps.some((s) => s.step === entry.step)) {
          body.steps.push({ step: entry.step, leg: entry.leg, row: entry.row, status: 0, ms: 0, parsed: false, failure: "skipped" });
        }
      }

      if (!body.appLeg.ok) {
        body.outcome = "app_failed";
        body.detail = body.appLeg.detail;
      } else if (!body.accountLeg.ok) {
        body.outcome = "account_warning";
        body.detail = body.accountLeg.detail;
      } else {
        body.outcome = "ok";
      }
      finish();
    } catch (err) {
      // Unreachable by construction (every leg catches); never the object.
      console.error("[eBay probe] unexpected failure:", err instanceof Error ? err.name : "unknown");
      if (!res.headersSent) {
        res.status(500).json({ error: "eBay probe failed", ebayTarget: target.kind });
      }
    }
  });

  return router;
}
