import {
  BscEndpoints,
  FakeHeaderDeps,
  fakeBscCallerHeaders,
  isFakeUrl,
  resolveBscEndpoints,
} from "./bsc-endpoints";

/**
 * NEO-552: every request services/browser sends to BSC (identity or API) goes
 * through `bscFetch`. It does two things:
 *
 * 1. FAKE-MODE HEADERS. When the URL is the configured fake, it adds the
 *    caller secret and the Google ID token (see fakeBscCallerHeaders). A real
 *    BSC URL never gets them.
 *
 * 2. A 429 BREAKER. NEO-552's lockout came from retry storms: hundreds of
 *    failing calls a minute, escalating. Every BSC call on this side already
 *    has a fixed attempt count (one per B2C step, one refresh grant, one
 *    silent re-authorize, at most two profile reads, and a 429 is never
 *    retried), but N concurrent logins each making their one attempt is still
 *    a storm when BSC has told us to stop. So a 429 from BSC opens a breaker
 *    for its Retry-After (default 60 s, clamped 1 s to 15 min). While it is
 *    open no request is sent at all: bscFetch answers a synthetic 429 with
 *    header `x-nb-bsc-breaker: open`, which every caller already handles as
 *    "BSC is throttling us" (profile: no verdict; refresh: not reauth_required;
 *    sign-in: a pageable failure). The existing per-key express limiter in
 *    index.ts stays as it is; this sits behind it.
 *
 *    Scope: against real BSC the breaker is process-wide, because BSC
 *    throttles us, not a user. Against the fake it is per `scope` (the caller
 *    passes the credential key or sign-in username), because the fake's 429s
 *    are injected per test namespace and must not stall every other parallel
 *    test on the same revision.
 *
 * Calls `fetch` through the global at call time, so tests can stub it.
 */

/** Cooldown when a 429 carries no usable Retry-After. */
export const BSC_429_DEFAULT_COOLDOWN_MS = 60_000;
/** Bounds on a Retry-After we honour. */
export const BSC_429_MIN_COOLDOWN_MS = 1_000;
export const BSC_429_MAX_COOLDOWN_MS = 15 * 60_000;
/** Header on the synthetic answer while the breaker is open. */
export const BSC_BREAKER_HEADER = "x-nb-bsc-breaker";

const openUntil = new Map<string, number>();

/** Test hook: close every breaker. */
export function resetBscBreaker(): void {
  openUntil.clear();
}

export interface BscFetchOptions extends FakeHeaderDeps {
  /**
   * Breaker scope in fake mode (credential key, sign-in username, "probe").
   * Ignored against real BSC, where the breaker is process-wide.
   */
  scope?: string;
  /** Pre-resolved endpoints; default resolveBscEndpoints(env). */
  endpoints?: BscEndpoints;
}

function breakerKey(endpoints: BscEndpoints, scope: string | undefined): string {
  return endpoints.target === "real" ? "real" : `fake:${scope ?? "shared"}`;
}

/** Retry-After in ms (delta-seconds or HTTP-date), clamped; default when absent. */
export function retryAfterMs(header: string | null, now: number): number {
  let ms = BSC_429_DEFAULT_COOLDOWN_MS;
  if (header) {
    const trimmed = header.trim();
    if (/^\d+$/.test(trimmed)) {
      ms = Number(trimmed) * 1000;
    } else {
      const at = Date.parse(trimmed);
      if (Number.isFinite(at)) ms = at - now;
    }
  }
  return Math.min(BSC_429_MAX_COOLDOWN_MS, Math.max(BSC_429_MIN_COOLDOWN_MS, ms));
}

/** Milliseconds until the breaker for this scope closes; 0 when closed. */
export function bscBreakerRemainingMs(opts: BscFetchOptions = {}): number {
  const endpoints = opts.endpoints ?? resolveBscEndpoints(opts.env);
  const until = openUntil.get(breakerKey(endpoints, opts.scope));
  const now = (opts.now ?? Date.now)();
  return until !== undefined && until > now ? until - now : 0;
}

function mergeHeaders(
  base: RequestInit["headers"],
  extra: Record<string, string>,
): Headers {
  const headers = new Headers(base);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return headers;
}

export async function bscFetch(
  url: string | URL,
  init: RequestInit = {},
  opts: BscFetchOptions = {},
): Promise<Response> {
  const endpoints = opts.endpoints ?? resolveBscEndpoints(opts.env);
  const now = opts.now ?? Date.now;
  const key = breakerKey(endpoints, opts.scope);

  const until = openUntil.get(key);
  if (until !== undefined) {
    const remaining = until - now();
    if (remaining > 0) {
      const seconds = Math.ceil(remaining / 1000);
      // Path only: a query string here can carry B2C transaction state.
      let path = "(unparseable url)";
      try {
        path = new URL(String(url)).pathname;
      } catch {
        /* keep the placeholder */
      }
      console.warn(
        `[BSC] 429 breaker open (${endpoints.target}); not sending ${path}, ${seconds}s left`,
      );
      return new Response(null, {
        status: 429,
        headers: { "retry-after": String(seconds), [BSC_BREAKER_HEADER]: "open" },
      });
    }
    openUntil.delete(key);
  }

  let finalInit = init;
  if (isFakeUrl(url, endpoints)) {
    const extra = await fakeBscCallerHeaders(endpoints, opts);
    finalInit = { ...init, headers: mergeHeaders(init.headers, extra) };
  }

  const response = await fetch(url, finalInit);
  if (response.status === 429) {
    const cooldown = retryAfterMs(response.headers?.get?.("retry-after") ?? null, now());
    openUntil.set(key, now() + cooldown);
    console.warn(
      `[BSC] answered 429 (${endpoints.target}); breaker open for ${Math.ceil(cooldown / 1000)}s`,
    );
  }
  return response;
}
