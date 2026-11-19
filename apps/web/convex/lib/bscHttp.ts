/**
 * The one definition of how NeonBinder addresses BuySportsCards' API: where it
 * lives, the request headers it insists on, and `bscFetch`, the only way any
 * Convex code sends a request to it (NEO-552). Runtime-free, so both the Node
 * adapter (`adapters/buysportscards.ts`) and the default-runtime seller client
 * (`adapters/bscSeller.ts`, NEO-370) use it. No other Convex file may name a
 * BSC host or call `fetch` for BSC; `bscHttpSeam.test.ts` enforces that.
 *
 * NEO-552 — the fake BSC. A test deployment (dev, previews, worktree
 * deployments: the ones with `TESTING_RESET_SECRET`) can point every BSC call
 * at the standing fake (`services/fake-bsc`, see its CONTRACT.md) by setting
 * `NEONBINDER_BSC_API_BASE` to the fake's https `*.run.app` URL. A production
 * deployment has no `TESTING_RESET_SECRET`, so the variable is ignored there
 * and every call goes to BSC. The environment is read on every call, never at
 * module scope, so a changed variable takes effect without a redeploy.
 *
 * Fake mode adds two headers to every request: the caller secret
 * (`x-nb-fake-bsc-key`) and a Google ID token for the fake's origin in
 * `X-Serverless-Authorization` (Cloud Run IAM reads it there because BSC's own
 * `Authorization: Bearer` header is already taken by the BSC token). The ID
 * token comes from the caller (`BscIdTokenSource`), because minting one needs
 * google-auth-library, which only the Node runtime has: Node callers pass
 * `nodeBscIdToken` (`lib/bscFakeIdToken.ts`), default-runtime callers pass
 * `actionBscIdTokenSource` over `internal.fakeBsc.idToken`.
 *
 * Wire vocabulary and transport only; no adapter logic lives here.
 */
import {
  classifyBscAnswer,
  type BscGateOutcome,
  type BscGateRefusalReason,
} from "./bscCallGatePolicy";
import {
  FAKE_BSC_ID_TOKEN_HEADER,
  FAKE_BSC_KEY_HEADER,
  FAKE_BSC_NS_HEADER,
  FAKE_BSC_SIGNED_ID_TOKEN_HEADER,
  isFakeServiceHost,
  signForFake,
  type FakeIdTokenSource,
} from "./fakeMarketplace";

// The fake's header names are defined once, in `fakeMarketplace.ts` (NEO-555),
// and re-exported here so BSC callers and tests keep importing them from the BSC door.
export {
  FAKE_BSC_ID_TOKEN_HEADER,
  FAKE_BSC_KEY_HEADER,
  FAKE_BSC_NS_HEADER,
  FAKE_BSC_SIGNED_ID_TOKEN_HEADER,
};

/** BSC's API host. (The www host serves pages, not the API: CloudFront 403s.) */
const REAL_API_BASE = "https://api-prod.buysportscards.com";
const REAL_API_HOST = "api-prod.buysportscards.com";
const REAL_SITE_ORIGIN = "https://www.buysportscards.com";

/** The fake's root URL (no path). Honoured only beside `TESTING_RESET_SECRET`. */
export const BSC_API_BASE_ENV = "NEONBINDER_BSC_API_BASE";
/** The caller secret the fake checks on every request. */
export const FAKE_BSC_KEY_ENV = "NEONBINDER_FAKE_BSC_KEY";
/** The deployment-is-a-test-deployment marker (never set in production). */
const TEST_DEPLOYMENT_ENV = "TESTING_RESET_SECRET";


/** Marks an answer `bscFetch` gave itself because the gate refused (nothing was sent). */
export const BSC_BREAKER_HEADER = "x-nb-bsc-breaker";

export type BscEnv = Readonly<Record<string, string | undefined>>;

/**
 * Where BSC calls go.
 *  - `real`: BuySportsCards. `overrideIgnored` is true when
 *    `NEONBINDER_BSC_API_BASE` is set on a deployment that is not a test
 *    deployment (production): the variable is ignored, never obeyed.
 *  - `fake`: the fake at `origin`; API paths live under `${origin}/api`.
 *  - `misconfigured`: a test deployment asked for the fake but the URL or the
 *    key is unusable. Nothing is sent: falling back to the real host here
 *    would send a test deployment's traffic to BuySportsCards.
 */
export type BscTarget =
  | { mode: "real"; apiBase: string; overrideIgnored: boolean }
  | { mode: "fake"; origin: string; apiBase: string; callerKey: string }
  | { mode: "misconfigured"; reason: string };

/** Where this deployment's BSC calls go. Pure; reads only `env`. */
export function resolveBscTarget(env: BscEnv = process.env): BscTarget {
  const raw = env[BSC_API_BASE_ENV]?.trim();
  if (!raw) return { mode: "real", apiBase: REAL_API_BASE, overrideIgnored: false };
  if (!env[TEST_DEPLOYMENT_ENV]) {
    return { mode: "real", apiBase: REAL_API_BASE, overrideIgnored: true };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { mode: "misconfigured", reason: `${BSC_API_BASE_ENV} is not a URL` };
  }
  if (url.protocol !== "https:") {
    return { mode: "misconfigured", reason: `${BSC_API_BASE_ENV} must be https` };
  }
  if (url.username || url.password || url.port) {
    return {
      mode: "misconfigured",
      reason: `${BSC_API_BASE_ENV} must not carry credentials or a port`,
    };
  }
  if (!isFakeServiceHost(url.hostname)) {
    return {
      mode: "misconfigured",
      reason: `${BSC_API_BASE_ENV} must be the neonbinder-fake-bsc-*.run.app service`,
    };
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    return {
      mode: "misconfigured",
      reason: `${BSC_API_BASE_ENV} must be the fake's root URL, with no path or query`,
    };
  }
  const callerKey = env[FAKE_BSC_KEY_ENV]?.trim();
  if (!callerKey) {
    return { mode: "misconfigured", reason: `${FAKE_BSC_KEY_ENV} is not set` };
  }
  return { mode: "fake", origin: url.origin, apiBase: `${url.origin}/api`, callerKey };
}

/** A test deployment's fake-BSC settings are unusable; nothing was sent. */
export class BscConfigError extends Error {
  constructor(reason: string) {
    super(`BuySportsCards target misconfigured: ${reason}`);
    this.name = "BscConfigError";
  }
}

/** The API base every BSC call is sent to. Throws `BscConfigError` when misconfigured. */
export function bscApiBase(env: BscEnv = process.env): string {
  const target = resolveBscTarget(env);
  if (target.mode === "misconfigured") throw new BscConfigError(target.reason);
  return target.apiBase;
}

/**
 * Browser-mimicking headers BSC requires (without them CloudFront rejects the
 * request as bot traffic). `assumedrole: sellers` is mandatory and scopes the
 * session to a seller context.
 *
 * `json: false` leaves out the JSON content type, for a multipart upload whose
 * boundary the runtime's `FormData` sets itself.
 */
export function bscHeaders(
  bearerToken: string,
  opts: { json?: boolean } = {},
): Record<string, string> {
  return {
    accept: "application/json, text/plain, */*",
    "accept-language": "en-US,en;q=0.9",
    assumedrole: "sellers",
    ...(opts.json === false ? {} : { "content-type": "application/json" }),
    origin: REAL_SITE_ORIGIN,
    referer: `${REAL_SITE_ORIGIN}/`,
    "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": "macOS",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
    authority: REAL_API_HOST,
    authorization: `Bearer ${bearerToken}`,
  };
}

/**
 * Mints a Google ID token whose audience is `audience` (the fake's origin).
 * Called only in fake mode; a real-mode call never reaches it.
 */
export type BscIdTokenSource = FakeIdTokenSource;

/** A grant from the call gate: the calls made under it report against it. */
export type BscGrant = { grantedAt: number; reportOutcome: boolean; probe: boolean };

/** Why the gate let nothing through; `gate_unavailable` is the gate failing closed. */
export type BscGateRefusal = {
  ok: false;
  reason: BscGateRefusalReason | "gate_unavailable";
  retryAt: number;
};

/**
 * The deployment-wide call gate (`bscCallGate.ts`, `bscCallGateFor(ctx)`).
 * Kept as an interface so this module stays runtime-free and testable.
 */
export interface BscCallGate {
  /**
   * Asks for `count` calls (one wave). Resolves when they may be sent (any
   * wait already slept), with how many were granted: a half-open gate grants
   * one probe. Never throws: a gate that cannot be asked refuses.
   */
  acquire(count: number): Promise<{ ok: true; granted: number; grant: BscGrant } | BscGateRefusal>;
  /** Reports one call's outcome (may throw; `bscFetch` swallows it). */
  record(grant: BscGrant, outcome: BscGateOutcome, retryAfterMs?: number): Promise<void>;
  /**
   * Hands back a probe grant's lease when the call reported nothing (a
   * neutral answer, or a throw before it was sent). A no-op for any other
   * grant. May throw; `bscFetch` swallows it.
   */
  release(grant: BscGrant): Promise<void>;
  /**
   * Whether a success under `grant` is worth reporting: the grant says the
   * gate is recovering, or this caller has reported a failure since its last
   * reported success (so a success ends the failure run it fed). Otherwise a
   * success costs no write.
   */
  wantsSuccess(grant: BscGrant): boolean;
  /** Until when no call may be asked (open, or a live probe), or null. */
  blockedUntil(): Promise<number | null>;
}

export interface BscFetchOptions {
  /** The ID-token minter for fake mode. Required so no call site can forget it. */
  idToken: BscIdTokenSource;
  /**
   * The path with its ids replaced (`marketplace/card/:id/card-listing`), for
   * the gate's classification. A literal at every call site, never the raw path.
   */
  pathTemplate: string;
  /** The deployment-wide breaker and token bucket. Required: no call bypasses it. */
  gate: BscCallGate;
  /**
   * A grant a wave caller already holds (`gate.acquire(chunk.length)`). Without
   * one, `bscFetch` acquires a single call itself.
   */
  grant?: BscGrant;
  /**
   * Fake mode only: the caller's run on the fake, sent as `x-nb-fake-ns` when
   * the request carries no BSC token. The caller's namespace when it knows
   * its user, else this deployment's prefix. Ignored in real mode.
   */
  fakeNs?: string;
  /** Tests only; defaults to `process.env`, read on every call. */
  env?: BscEnv;
}

/**
 * A BSC API path, relative (`search/bulk-upload/filters`, `seller/order/1?x=y`).
 * A leading slash is accepted. Refused: anything that could leave the API base
 * (a scheme, `//`, a backslash, a `.` or `..` segment) and control characters.
 */
export function normaliseBscPath(path: string): string {
  const rel = path.startsWith("/") ? path.slice(1) : path;
  const pathPart = rel.split("?")[0];
  if (
    rel.length === 0 ||
    rel.length > 2048 ||
    rel.startsWith("/") ||
    rel.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(rel) ||
    /^[a-z][a-z0-9+.-]*:/i.test(rel) ||
    pathPart.split("/").some((seg) => seg === "." || seg === ".." || seg === "")
  ) {
    throw new TypeError("BSC path refused");
  }
  return rel;
}

/**
 * The answer `bscFetch` gives, unsent, when the gate refuses: a 429 with
 * `Retry-After` while the breaker is open, probing or throttled (every caller
 * already treats a 429 as "stop, never retry"), and a 503 when the gate
 * itself could not be asked, so that lands in the callers' failed/retry paths.
 * Both carry `x-nb-bsc-breaker: <reason>`.
 */
export function bscGateRefusalResponse(refusal: BscGateRefusal, now: number): Response {
  const seconds = Math.max(1, Math.ceil((refusal.retryAt - now) / 1000));
  if (refusal.reason === "gate_unavailable") {
    return new Response(null, { status: 503, headers: { [BSC_BREAKER_HEADER]: refusal.reason } });
  }
  return new Response(null, {
    status: 429,
    headers: { "retry-after": String(seconds), [BSC_BREAKER_HEADER]: refusal.reason },
  });
}

/** True when `res` is `bscFetch`'s own refusal (no request was sent). */
export function isBscBreakerRefusal(res: Response): boolean {
  return res.headers.get(BSC_BREAKER_HEADER) !== null;
}

/** The fake-mode request: caller secret, ID token, and never a redirect (`signForFake`). */
async function fakeInit(
  target: Extract<BscTarget, { mode: "fake" }>,
  init: RequestInit,
  idToken: BscIdTokenSource,
  fakeNs?: string,
): Promise<RequestInit> {
  return await signForFake(target, init, idToken, fakeNs);
}

/**
 * Sends one request to the BSC API (or, in fake mode, to the fake). The only
 * way Convex code calls BSC.
 *
 * Every call goes through the gate: under the caller's wave grant, or a grant
 * of one acquired here. A refusal sends nothing and answers with
 * `bscGateRefusalResponse`. A sent call reports a 429 or a failure (5xx,
 * timeout, network, a catalogue 403) to the gate, and a success only when it
 * can change something (`wantsSuccess`). In real mode `init` reaches
 * `fetch` unchanged.
 *
 * Throws what `fetch` throws (a timeout, a network error), `BscConfigError` for
 * an unusable fake configuration, and `TypeError` for a refused path: none of
 * these has sent anything except the first.
 */
export async function bscFetch(
  path: string,
  init: RequestInit,
  opts: BscFetchOptions,
): Promise<Response> {
  const target = resolveBscTarget(opts.env ?? process.env);
  if (target.mode === "misconfigured") throw new BscConfigError(target.reason);
  const url = `${target.apiBase}/${normaliseBscPath(path)}`;

  let grant = opts.grant;
  if (!grant) {
    let acquired: Awaited<ReturnType<BscCallGate["acquire"]>>;
    try {
      acquired = await opts.gate.acquire(1);
    } catch {
      acquired = { ok: false, reason: "gate_unavailable", retryAt: Date.now() };
    }
    if (!acquired.ok) {
      logGateRefusal(opts.pathTemplate, acquired);
      return bscGateRefusalResponse(acquired, Date.now());
    }
    grant = acquired.grant;
  }
  // A probe that ends without an outcome (a neutral answer, or a throw
  // before anything was sent, such as an ID-token mint failure) must hand
  // its lease back, or every caller waits the lease out for nothing.
  let reported = false;
  const report = async (outcome: BscGateOutcome, retryAfterMs?: number): Promise<void> => {
    reported = true;
    await reportOutcome(opts.gate, grant, opts.pathTemplate, outcome, retryAfterMs);
  };
  try {
    const sendInit =
      target.mode === "fake" ? await fakeInit(target, init, opts.idToken, opts.fakeNs) : init;
    let res: Response;
    try {
      res = await fetch(url, sendInit);
    } catch (err) {
      await report("failure");
      throw err;
    }
    const answer = classifyBscAnswer(
      res.status,
      (name) => res.headers.get(name),
      opts.pathTemplate,
      Date.now(),
    );
    if (answer.kind === "rateLimited") {
      await report("rateLimited", answer.retryAfterMs);
    } else if (answer.kind === "failure") {
      await report("failure");
    } else if (answer.kind === "success" && opts.gate.wantsSuccess(grant)) {
      await report("success");
    }
    return res;
  } finally {
    if (!reported && grant.probe) await releaseProbe(opts.gate, grant, opts.pathTemplate);
  }
}

/** A gate that cannot release must never fail the call; the lease then expires on its own. */
async function releaseProbe(gate: BscCallGate, grant: BscGrant, pathTemplate: string): Promise<void> {
  try {
    await gate.release(grant);
  } catch (error) {
    console.warn(
      JSON.stringify({
        msg: "bsc_gate_release_failed",
        platform: "bsc",
        operation: pathTemplate,
        error: error instanceof Error ? error.name : "unknown",
      }),
    );
  }
}

/** Platform, operation and timing only. */
function logGateRefusal(pathTemplate: string, refusal: BscGateRefusal): void {
  console.warn(
    JSON.stringify({
      msg: "bsc_gate_refused",
      platform: "bsc",
      operation: pathTemplate,
      reason: refusal.reason,
      retryInMs: Math.max(0, refusal.retryAt - Date.now()),
    }),
  );
}

/** A gate that cannot record must never fail the call it reports on. */
async function reportOutcome(
  gate: BscCallGate,
  grant: BscGrant,
  pathTemplate: string,
  outcome: BscGateOutcome,
  retryAfterMs?: number,
): Promise<void> {
  try {
    await gate.record(grant, outcome, retryAfterMs);
  } catch (error) {
    console.warn(
      JSON.stringify({
        msg: "bsc_gate_record_failed",
        platform: "bsc",
        operation: pathTemplate,
        outcome,
        error: error instanceof Error ? error.name : "unknown",
      }),
    );
  }
}

/**
 * A request to the fake's test-control API (`__fake/...`, health included):
 * reset, faults, orders, misses, write-capture status. Returns null, sending nothing, unless this deployment is in
 * fake mode. Never touches the breaker.
 */
export async function fakeBscControlFetch(
  path: string,
  init: RequestInit,
  opts: { idToken: BscIdTokenSource; env?: BscEnv },
): Promise<Response | null> {
  const target = resolveBscTarget(opts.env ?? process.env);
  if (target.mode === "real") return null;
  if (target.mode === "misconfigured") throw new BscConfigError(target.reason);
  const rel = normaliseBscPath(path);
  if (!rel.startsWith("__fake/")) throw new TypeError("fake-BSC control path refused");
  return await fetch(`${target.origin}/${rel}`, await fakeInit(target, init, opts.idToken));
}

/** What `internal.fakeBsc.idToken` returns: a token for `audience`, or null outside fake mode. */
export type MintedBscIdToken = { audience: string; token: string; expiresAt: number };

/** Re-mint this long before the token's own expiry. */
const ID_TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;
const idTokenCache = new Map<string, MintedBscIdToken>();

/**
 * An ID-token source for the default runtime, which cannot load
 * google-auth-library: `mint` runs the Node action that does
 * (`internal.fakeBsc.idToken`). The token is cached per audience in the
 * module until five minutes before it expires, so a run of calls costs one
 * action call. Refuses a token minted for any other audience.
 */
export function actionBscIdTokenSource(
  mint: () => Promise<MintedBscIdToken | null>,
): BscIdTokenSource {
  return async (audience) => {
    const cached = idTokenCache.get(audience);
    if (cached && cached.expiresAt - ID_TOKEN_REFRESH_MARGIN_MS > Date.now()) {
      return cached.token;
    }
    const minted = await mint();
    if (!minted || minted.audience !== audience || !minted.token) {
      throw new BscConfigError("no ID token for the fake's origin");
    }
    idTokenCache.set(audience, minted);
    return minted.token;
  };
}

/** Tests only: module caches otherwise leak across test cases. */
export function __resetBscIdTokenCache(): void {
  idTokenCache.clear();
}
