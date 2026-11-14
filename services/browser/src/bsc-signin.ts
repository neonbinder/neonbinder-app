import crypto from "node:crypto";
import {
  BSC_B2C_CLIENT,
  FAKE_ONLY_ACCOUNT_ERROR,
  refuseNonFakeAccount,
  resolveBscEndpoints,
} from "./bsc-endpoints";
import { BscFetchOptions, bscFetch } from "./bsc-fetch";
import { ShapeSignature, shapeSignature } from "./bsc-shape";
import { summarizeFetchError } from "./observability";
import {
  buildLoginDiagnostic,
  DiagnosticSecrets,
  LoginDiagnostic,
} from "./services/login-diagnostic";

/**
 * BSC's Azure AD B2C sign-in, over plain fetch, with no persistence.
 *
 * NEO-552: lifted out of BSCAdapter so three callers share one implementation:
 *   - BSCAdapter (the /login/bsc route), which persists the token set itself;
 *   - the probe (POST /probe/bsc), which signs in and throws the tokens away;
 *   - the fake BSC's local recorder, which keeps the token in memory only.
 *
 * Nothing in this module reads or writes Secret Manager, logs a credential, or
 * returns one in an error. The ONLY place a token leaves is the `tokens`
 * field of a successful result, which the caller owns.
 *
 * The flow (BSC's custom policy B2C_1A_signin presents no CAPTCHA):
 *   1. GET  <authority>/oauth2/v2.0/authorize → self-asserted HTML carrying
 *        `var SETTINGS = {csrf, transId, api}` + x-ms-cpim-* cookies
 *   2. POST <authority>/SelfAsserted → {"status":"200"} accept,
 *        {"status":"400","message":...} reject (both HTTP 200)
 *   3. GET  <authority>/api/<api>/confirmed → 302 redirectUri#code=...
 *   4. POST <authority>/oauth2/v2.0/token → access + rotating refresh token
 */

/** A desktop UA so B2C serves the standard self-asserted HTML page. */
export const BSC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Fallback access-token lifetime, used ONLY when the token endpoint omits
 * `expires_in` (BSC returns 3600 today, and the real value is preferred).
 */
export const TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * NEO-552: limit on one B2C request, headers and body. Each B2C step is sent
 * once (never retried), so a sign-in is bounded at four of these.
 */
export const BSC_B2C_STEP_TIMEOUT_MS = 15_000;

/**
 * Prefix of the B2C "Keep me signed in" SSO cookie(s), observed as
 * `x-ms-cpim-sso:<tenant>_0` (NEO-278). Matched by PREFIX because the tenant
 * suffix is B2C's to change.
 */
export const BSC_SSO_COOKIE_PREFIX = "x-ms-cpim-sso";

/**
 * The fields read off the B2C token endpoint, for both grants. Observed live
 * 2026-08-11: expires_in=3600, refresh_token_expires_in=86400 (absolute from
 * the password sign-in), and the refresh grant rotating the refresh token.
 */
export interface BscTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
}

/**
 * A normalized token set with absolute expiries.
 *
 * SECURITY: every field except the expiries is credential material. Never log
 * an instance or return one to a caller of this service.
 */
export interface BscTokenSet {
  token: string;
  expiresAt: number;
  refreshToken?: string;
  refreshExpiresAt?: number;
  /** NEO-278: the SSO cookies observed on the exchange that minted this set. */
  ssoCookies?: Record<string, string>;
  ssoExpiresAt?: number;
}

/** Epoch ms for cookies that carry no expiry attribute at all. */
type CookieExpiry = number | undefined;

/**
 * Minimal in-flight cookie jar for one B2C exchange. node's fetch does not
 * persist cookies, so Set-Cookie is collected here. Host/path are ignored: the
 * jar lives for one sign-in and talks to the single B2C host.
 *
 * A Set-Cookie that CLEARS a cookie (empty value, or an expiry in the past)
 * removes it, so a cleared cookie is never persisted (NEO-278).
 *
 * SECURITY: cookie VALUES are anti-forgery tokens and, for the SSO cookies,
 * the user's BSC session. Only cookie NAMES may be logged.
 */
export class B2CCookieJar {
  private cookies = new Map<string, string>();
  private expiries = new Map<string, CookieExpiry>();

  ingest(response: Response): void {
    const setCookies =
      typeof response.headers?.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [];
    const now = Date.now();
    for (const sc of setCookies) {
      const [nameValue, ...attributes] = sc.split(";");
      const eq = nameValue.indexOf("=");
      if (eq <= 0) continue;
      const name = nameValue.slice(0, eq).trim();
      const value = nameValue.slice(eq + 1).trim();
      const expiry = B2CCookieJar.parseExpiry(attributes, now);
      if (value.length === 0 || (expiry !== undefined && expiry <= now)) {
        this.cookies.delete(name);
        this.expiries.delete(name);
        continue;
      }
      this.cookies.set(name, value);
      this.expiries.set(name, expiry);
    }
  }

  /** `Max-Age` wins over `Expires` (RFC 6265 §5.3 step 5). */
  private static parseExpiry(attributes: string[], now: number): CookieExpiry {
    let expires: CookieExpiry;
    for (const raw of attributes) {
      const attribute = raw.trim();
      const eq = attribute.indexOf("=");
      if (eq <= 0) continue;
      const key = attribute.slice(0, eq).trim().toLowerCase();
      const val = attribute.slice(eq + 1).trim();
      if (key === "max-age") {
        const seconds = Number(val);
        if (Number.isFinite(seconds)) return now + seconds * 1000;
      } else if (key === "expires") {
        const parsed = Date.parse(val);
        if (Number.isFinite(parsed)) expires = parsed;
      }
    }
    return expires;
  }

  header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  /**
   * The SSO cookie(s) in the jar, or undefined. `expiresAt` is the earliest
   * expiry among them (undefined when none carried one).
   */
  ssoCookies(): { cookies: Record<string, string>; expiresAt?: number } | undefined {
    const cookies: Record<string, string> = {};
    let expiresAt: CookieExpiry;
    let count = 0;
    for (const [name, value] of this.cookies) {
      if (!name.startsWith(BSC_SSO_COOKIE_PREFIX)) continue;
      cookies[name] = value;
      count++;
      const expiry = this.expiries.get(name);
      if (expiry !== undefined && (expiresAt === undefined || expiry < expiresAt)) {
        expiresAt = expiry;
      }
    }
    if (count === 0) return undefined;
    return expiresAt === undefined ? { cookies } : { cookies, expiresAt };
  }
}

/** Serialise a stored cookie map into a Cookie request header. */
export function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/** base64url-encode a Buffer (no padding) for PKCE/state/nonce values. */
function base64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** The SETTINGS fields the flow uses. */
export interface B2CSettings {
  csrf?: string;
  transId?: string;
  api?: string;
}

/** The whole inline `SETTINGS` object, or undefined. Never logged. */
function parseSettingsBlob(html: string): Record<string, unknown> | undefined {
  const match =
    html.match(/var SETTINGS\s*=\s*(\{.*?\});/s) || html.match(/SETTINGS\s*=\s*(\{.*?\});/s);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[1]) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Parse the `SETTINGS` blob the self-asserted page embeds. Undefined when it
 * is absent. Only csrf/transId/api are read; the HTML is never logged.
 */
export function parseB2CSettings(html: string): B2CSettings | undefined {
  const parsed = parseSettingsBlob(html);
  if (!parsed) return undefined;
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  return { csrf: str(parsed.csrf), transId: str(parsed.transId), api: str(parsed.api) };
}

/**
 * The authorization `code` from a redirect Location (fragment or query).
 * Undefined if absent, if `error` is present, if the Location does not target
 * the registered redirect URI, or if the echoed `state` is not the one sent.
 */
export function extractAuthCode(
  location: string | null,
  expectedState: string,
): string | undefined {
  if (!location || !location.startsWith(BSC_B2C_CLIENT.redirectUri)) return undefined;
  const params = redirectParams(location);
  if (!params) return undefined;
  if (params.get("error")) return undefined;
  if (params.get("state") !== expectedState) return undefined;
  return params.get("code") ?? undefined;
}

function redirectParams(location: string): URLSearchParams | undefined {
  const hashIndex = location.indexOf("#");
  const queryIndex = location.indexOf("?");
  const splitIndex = hashIndex >= 0 ? hashIndex : queryIndex;
  if (splitIndex < 0) return undefined;
  return new URLSearchParams(location.slice(splitIndex + 1));
}

/** The short OAuth `error` code from a redirect Location. Never the description. */
export function extractAuthError(location: string | null): string | undefined {
  if (!location) return undefined;
  return redirectParams(location)?.get("error") ?? undefined;
}

/**
 * Strip HTML tags to approximate visible text for the failure diagnostic, so
 * inline <script> token material never reaches the snippet. The end-tag
 * pattern tolerates every spelling CodeQL js/bad-tag-filter flags
 * (`</script >`, `</script\n>`, `</script foo="bar">`) and drops an
 * unterminated block running to EOF.
 */
export function stripTags(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?(?:<\/script[^>]*>|$)/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?(?:<\/style[^>]*>|$)/gi, " ")
    .replace(/<[^>]*>/g, " ");
}

/**
 * Build the /authorize request: fresh PKCE verifier + S256 challenge, state,
 * nonce. The verifier never leaves this process. `prompt` is sent by the
 * password sign-in (`select_account` forces the form) and omitted by the
 * silent SSO re-authorize so B2C may honour the SSO cookie.
 */
export function buildAuthorizeRequest(options: { prompt?: string; authority?: string }): {
  codeVerifier: string;
  state: string;
  authorizeUrl: URL;
} {
  const authority = options.authority ?? resolveBscEndpoints().authority;
  const codeVerifier = base64Url(crypto.randomBytes(32));
  const codeChallenge = base64Url(crypto.createHash("sha256").update(codeVerifier).digest());
  const state = base64Url(crypto.randomBytes(16));
  const nonce = base64Url(crypto.randomBytes(16));

  const params = new URLSearchParams({
    client_id: BSC_B2C_CLIENT.clientId,
    redirect_uri: BSC_B2C_CLIENT.redirectUri,
    response_type: "code",
    scope: BSC_B2C_CLIENT.scope,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    nonce,
    response_mode: "fragment",
  });
  if (options.prompt) params.set("prompt", options.prompt);

  const authorizeUrl = new URL(`${authority}/oauth2/v2.0/authorize`);
  authorizeUrl.search = params.toString();
  return { codeVerifier, state, authorizeUrl };
}

/**
 * Normalize a token-endpoint response into absolute expiries. Undefined when
 * there is no access token. SECURITY: reads values, logs none of them.
 */
export function toTokenSet(json: BscTokenResponse): BscTokenSet | undefined {
  if (typeof json?.access_token !== "string" || json.access_token.length === 0) {
    return undefined;
  }
  const now = Date.now();
  const tokens: BscTokenSet = {
    token: json.access_token,
    expiresAt:
      typeof json.expires_in === "number" && json.expires_in > 0
        ? now + json.expires_in * 1000
        : now + TOKEN_TTL_MS,
  };
  if (typeof json.refresh_token === "string" && json.refresh_token.length > 0) {
    tokens.refreshToken = json.refresh_token;
    if (typeof json.refresh_token_expires_in === "number" && json.refresh_token_expires_in > 0) {
      tokens.refreshExpiresAt = now + json.refresh_token_expires_in * 1000;
    }
  }
  return tokens;
}

/** Copy the SSO cookie(s) an exchange produced onto its token set. */
export function attachSsoCookies(tokens: BscTokenSet, jar: B2CCookieJar): void {
  const sso = jar.ssoCookies();
  if (!sso) return;
  tokens.ssoCookies = sso.cookies;
  if (sso.expiresAt !== undefined) tokens.ssoExpiresAt = sso.expiresAt;
}

/** One B2C step as the probe sees it. Never a value. */
export interface BscSignInStep {
  step: "authorize" | "self_asserted" | "confirmed" | "token";
  /** HTTP status; 0 when the request threw or timed out. */
  status: number;
  ms: number;
  /** Whether our parser accepted the answer (SETTINGS, envelope, code, tokens). */
  parsed: boolean;
  /** Value-free shape of the parsed body, where there is one. */
  shape?: ShapeSignature;
  /** Set when the request threw: "timeout" or "network". */
  failure?: "timeout" | "network";
}

export interface BscB2CRequestOptions {
  /** B2C authority override; default resolveBscEndpoints().authority. */
  authority?: string;
  /** Passed to bscFetch (breaker scope, fake-mode header deps). */
  fetchOptions?: BscFetchOptions;
  /** Per-request limit; default BSC_B2C_STEP_TIMEOUT_MS. */
  stepTimeoutMs?: number;
}

/**
 * Step 4: trade an auth code (+ its PKCE verifier) for a token set. Shared by
 * the password sign-in and the silent SSO re-authorize. Undefined on any
 * failure, after logging status + B2C's short `error` code only.
 */
export async function exchangeAuthCode(
  code: string,
  codeVerifier: string,
  opts: BscB2CRequestOptions & { onResult?: (r: { status: number; body?: unknown }) => void } = {},
): Promise<BscTokenSet | undefined> {
  const authority = opts.authority ?? resolveBscEndpoints(opts.fetchOptions?.env).authority;
  console.log(`[BSC Adapter] B2C step 4: POST /token`);
  const tokenResponse = await bscFetch(
    `${authority}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: {
        "User-Agent": BSC_UA,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: BSC_B2C_CLIENT.clientId,
        grant_type: "authorization_code",
        code,
        redirect_uri: BSC_B2C_CLIENT.redirectUri,
        code_verifier: codeVerifier,
        scope: BSC_B2C_CLIENT.scope,
      }).toString(),
      signal: AbortSignal.timeout(opts.stepTimeoutMs ?? BSC_B2C_STEP_TIMEOUT_MS),
    },
    opts.fetchOptions,
  );

  if (!tokenResponse.ok) {
    let tokenError = "(unparseable)";
    let body: unknown;
    try {
      body = await tokenResponse.json();
      tokenError = (body as { error?: string })?.error ?? "(none)";
    } catch {
      /* ignore */
    }
    opts.onResult?.({ status: tokenResponse.status, body });
    console.warn(
      `[BSC Adapter] B2C token exchange failed (status=${tokenResponse.status}, error=${tokenError}).`,
    );
    return undefined;
  }

  const json = (await tokenResponse.json()) as BscTokenResponse;
  opts.onResult?.({ status: tokenResponse.status, body: json });
  const tokens = toTokenSet(json);
  if (!tokens) {
    console.warn(`[BSC Adapter] B2C token response had no access_token.`);
  }
  return tokens;
}

/** Why a refresh grant failed: fixed words, never a token or B2C's text. */
export type BscRefreshFailure =
  | "refused"
  | "rate_limited"
  | "server_error"
  | "unexpected_status"
  | "no_access_token";

export type BscRefreshGrantResult =
  | { ok: true; tokens: BscTokenSet }
  | {
      ok: false;
      /** HTTP status of the token endpoint's answer. */
      status: number;
      reason: BscRefreshFailure;
      /**
       * True only when B2C refused the grant itself (a 4xx other than 429):
       * expired, revoked, already rotated, or another client's. Only a fresh
       * sign-in fixes that. A 429, a 5xx or a missing access token is BSC
       * being unwell and must stay pageable, never "sign in again" (NEO-278).
       */
      reauthRequired: boolean;
    };

/**
 * One B2C refresh grant: a stored refresh token for a fresh access token
 * (NEO-141's replacement for keeping the password). Shared by the BSC adapter
 * and the fake-BSC recorder (NEO-552), which loads it from dist.
 *
 * The body is exactly what BSC's public B2C client accepts: client_id,
 * grant_type, refresh_token, scope. No client secret (public client), no PKCE
 * verifier (that belongs to the auth-code grant only). Sent once, never
 * retried. A throw from the request (network, timeout) propagates.
 *
 * THE RESPONSE ROTATES THE REFRESH TOKEN. B2C returns a new refresh_token
 * and invalidates the one presented, so the caller must keep the new one
 * before relying on the new access token.
 *
 * SECURITY: neither the presented nor the returned refresh token is ever
 * logged; only the HTTP status and B2C's short `error` code.
 */
export async function bscRefreshGrant(
  input: BscB2CRequestOptions & { refreshToken: string },
): Promise<BscRefreshGrantResult> {
  const authority = input.authority ?? resolveBscEndpoints(input.fetchOptions?.env).authority;
  console.log(`[BSC Adapter] B2C refresh grant: POST /token`);
  const response = await bscFetch(
    `${authority}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: {
        "User-Agent": BSC_UA,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: BSC_B2C_CLIENT.clientId,
        grant_type: "refresh_token",
        refresh_token: input.refreshToken,
        scope: BSC_B2C_CLIENT.scope,
      }).toString(),
      signal: AbortSignal.timeout(input.stepTimeoutMs ?? BSC_B2C_STEP_TIMEOUT_MS),
    },
    input.fetchOptions,
  );

  if (!response.ok) {
    let errorCode = "(unparseable)";
    try {
      errorCode = ((await response.json()) as { error?: string }).error ?? "(none)";
    } catch {
      /* ignore — never surface the raw body */
    }
    // NEO-278: 429 is carved out of the 4xx bucket: it is B2C throttling us,
    // not a verdict on the grant.
    const reauthRequired =
      response.status >= 400 && response.status < 500 && response.status !== 429;
    console.warn(
      `[BSC Adapter] B2C refresh grant failed (status=${response.status}, ` +
        `error=${errorCode}, reauth_required=${reauthRequired}).`,
    );
    const reason: BscRefreshFailure =
      response.status === 429
        ? "rate_limited"
        : reauthRequired
          ? "refused"
          : response.status >= 500
            ? "server_error"
            : "unexpected_status";
    return { ok: false, status: response.status, reason, reauthRequired };
  }

  const tokens = toTokenSet((await response.json()) as BscTokenResponse);
  if (!tokens) {
    console.warn(`[BSC Adapter] B2C refresh grant returned no access_token.`);
    return { ok: false, status: response.status, reason: "no_access_token", reauthRequired: false };
  }
  console.log(
    `[BSC Adapter] B2C refresh grant succeeded ` +
      `(rotated_refresh_token=${!!tokens.refreshToken}).`,
  );
  return { ok: true, tokens };
}

export interface BscPasswordSignInInput {
  username: string;
  password: string;
  /**
   * B2C authority (`<origin>/<tenant>/<policy>`). Default: this process's
   * resolved target (real BSC, or the fake when NEONBINDER_FAKE_BSC_URL is
   * set). An explicit authority that is not the configured fake gets no fake
   * caller headers.
   */
  authority?: string;
  /** Observer for each B2C step (the probe). Receives no values. */
  onStep?: (step: BscSignInStep) => void;
  /** Passed to bscFetch; `scope` defaults to the username (fake-mode breaker). */
  fetchOptions?: BscFetchOptions;
  /** Per-request limit; default BSC_B2C_STEP_TIMEOUT_MS. */
  stepTimeoutMs?: number;
}

export type BscPasswordSignInResult =
  | { tokens: BscTokenSet }
  | { error: string; diagnostic?: LoginDiagnostic; credentialRejected?: boolean };

/**
 * One full B2C password sign-in. Persistence-free: it never touches Secret
 * Manager, and the password is used for this exchange only.
 *
 * Never throws. A network throw or timeout is a generic failure. Failures
 * carry a sanitized diagnostic (buildLoginDiagnostic redacts the typed
 * username/password and any token/cookie-shaped material).
 *
 * `credentialRejected` is true ONLY when /SelfAsserted parsed as B2C's own
 * `{"status":"<non-200>"}` envelope and no challenge page was detected: BSC
 * judged the credentials and said no (NEO-98). Every other failure is an
 * integration fault and must stay pageable.
 *
 * SECURITY: the username, password, x-ms-cpim-* cookie values, csrf token,
 * auth code, PKCE verifier and tokens are never logged or put in an error.
 */
export async function bscPasswordSignIn(
  input: BscPasswordSignInInput,
): Promise<BscPasswordSignInResult> {
  const { username, password, onStep } = input;
  const secrets: DiagnosticSecrets = { email: username, password };
  const fetchOptions: BscFetchOptions = { scope: username, ...input.fetchOptions };
  // NEO-552, defence in depth behind the adapter and the probe: when THIS
  // call resolves to the fake, a real account is refused before any network
  // call. Keyed on the call's own env, so the recorder (fetchOptions.env = {},
  // forced real) is never affected.
  if (refuseNonFakeAccount(username, fetchOptions.env)) {
    return { error: FAKE_ONLY_ACCOUNT_ERROR, credentialRejected: true };
  }
  const authority = input.authority ?? resolveBscEndpoints(fetchOptions.env).authority;
  const stepTimeoutMs = input.stepTimeoutMs ?? BSC_B2C_STEP_TIMEOUT_MS;
  const jar = new B2CCookieJar();

  const report = (step: BscSignInStep): void => {
    if (!onStep) return;
    try {
      onStep(step);
    } catch {
      // An observer must never break a sign-in.
    }
  };

  /** Run one step, timing it; a throw is reported and rethrown. */
  const timed = async <T>(
    step: BscSignInStep["step"],
    run: () => Promise<T>,
  ): Promise<{ value: T; ms: number }> => {
    const started = Date.now();
    try {
      const value = await run();
      return { value, ms: Date.now() - started };
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      report({
        step,
        status: 0,
        ms: Date.now() - started,
        parsed: false,
        failure: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network",
      });
      throw error;
    }
  };

  try {
    // --- Step 1: GET /authorize ------------------------------------------
    const { codeVerifier, state, authorizeUrl } = buildAuthorizeRequest({
      prompt: "select_account",
      authority,
    });
    console.log(`[BSC Adapter] B2C step 1: GET /authorize`);
    const authorize = await timed("authorize", async () => {
      const res = await bscFetch(
        authorizeUrl,
        {
          headers: { "User-Agent": BSC_UA },
          redirect: "manual",
          signal: AbortSignal.timeout(stepTimeoutMs),
        },
        fetchOptions,
      );
      jar.ingest(res);
      return { res, html: await res.text() };
    });
    const settingsBlob = parseSettingsBlob(authorize.value.html);
    const settings = parseB2CSettings(authorize.value.html);
    const formOk = !!(settings?.csrf && settings.transId && settings.api);
    report({
      step: "authorize",
      status: authorize.value.res.status,
      ms: authorize.ms,
      parsed: formOk,
      ...(settingsBlob ? { shape: shapeSignature(settingsBlob) } : {}),
    });
    if (!settings || !formOk) {
      console.warn(
        `[BSC Adapter] B2C /authorize did not yield a sign-in form (status=${authorize.value.res.status}).`,
      );
      const diagnostic = buildLoginDiagnostic(
        {
          url: `${authorizeUrl.origin}${authorizeUrl.pathname}`,
          rawText: stripTags(authorize.value.html),
        },
        secrets,
      );
      return { error: `Authentication failed`, diagnostic };
    }
    const csrf = settings.csrf as string;
    const transId = settings.transId as string;
    const api = settings.api as string;

    // --- Step 2: POST /SelfAsserted --------------------------------------
    const selfAssertedUrl = new URL(`${authority}/SelfAsserted`);
    selfAssertedUrl.search = new URLSearchParams({
      tx: transId,
      p: BSC_B2C_CLIENT.policy,
    }).toString();

    console.log(`[BSC Adapter] B2C step 2: POST /SelfAsserted`);
    const selfAsserted = await timed("self_asserted", async () => {
      const res = await bscFetch(
        selfAssertedUrl,
        {
          method: "POST",
          headers: {
            "User-Agent": BSC_UA,
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-CSRF-TOKEN": csrf,
            "X-Requested-With": "XMLHttpRequest",
            "Cookie": jar.header(),
            "Referer": authorizeUrl.toString(),
          },
          body: new URLSearchParams({
            request_type: "RESPONSE",
            signInName: username,
            password,
          }).toString(),
          redirect: "manual",
          signal: AbortSignal.timeout(stepTimeoutMs),
        },
        fetchOptions,
      );
      jar.ingest(res);
      return { res, body: await res.text() };
    });

    // B2C answers {"status":"200"} on accept or {"status":"400","message":...}
    // on rejection, both as HTTP 200. The message can echo the typed
    // identifier, so it only ever feeds the sanitized diagnostic.
    let envelope: unknown;
    let selfAssertedStatus: string | undefined;
    try {
      envelope = JSON.parse(selfAsserted.value.body);
      const s = (envelope as { status?: unknown })?.status;
      selfAssertedStatus = typeof s === "string" ? s : undefined;
    } catch {
      selfAssertedStatus = undefined;
    }
    report({
      step: "self_asserted",
      status: selfAsserted.value.res.status,
      ms: selfAsserted.ms,
      parsed: selfAssertedStatus !== undefined,
      ...(envelope !== undefined ? { shape: shapeSignature(envelope) } : {}),
    });
    if (selfAssertedStatus !== "200") {
      console.warn(
        `[BSC Adapter] B2C SelfAsserted rejected credentials (status field=${selfAssertedStatus ?? "(unparseable)"}).`,
      );
      const diagnostic = buildLoginDiagnostic(
        {
          url: `${selfAssertedUrl.origin}${selfAssertedUrl.pathname}`,
          rawText: selfAsserted.value.body,
        },
        secrets,
      );
      // NEO-98: the one branch where BSC demonstrably judged the credentials.
      // An unparseable body is B2C answering something unexpected, and a
      // challenge page means we were blocked before the password was judged:
      // neither counts.
      const credentialRejected =
        selfAssertedStatus !== undefined && diagnostic.challengeDetected !== true;
      return { error: `Authentication failed`, diagnostic, credentialRejected };
    }

    // --- Step 3: GET /api/<api>/confirmed → 302 with #code= ---------------
    // rememberMe=true is "Keep me signed in": the /confirmed answer sets the
    // long-lived x-ms-cpim-sso:* cookie the silent re-authorize presents.
    const confirmedUrl = new URL(`${authority}/api/${encodeURIComponent(api)}/confirmed`);
    confirmedUrl.search = new URLSearchParams({
      rememberMe: "true",
      csrf_token: csrf,
      tx: transId,
      p: BSC_B2C_CLIENT.policy,
    }).toString();

    console.log(`[BSC Adapter] B2C step 3: GET /api/${api}/confirmed`);
    const confirmed = await timed("confirmed", async () => {
      const res = await bscFetch(
        confirmedUrl,
        {
          headers: {
            "User-Agent": BSC_UA,
            "Cookie": jar.header(),
            "Referer": authorizeUrl.toString(),
          },
          redirect: "manual",
          signal: AbortSignal.timeout(stepTimeoutMs),
        },
        fetchOptions,
      );
      jar.ingest(res);
      // Drain the body so the socket is freed; it is never read for content.
      try {
        await res.body?.cancel();
      } catch {
        /* best effort */
      }
      return res;
    });
    const location = confirmed.value.headers?.get?.("location") ?? null;
    const code = extractAuthCode(location, state);
    const redirect = location ? redirectParams(location) : undefined;
    report({
      step: "confirmed",
      status: confirmed.value.status,
      ms: confirmed.ms,
      parsed: !!code,
      ...(redirect ? { shape: shapeSignature(Object.fromEntries(redirect.entries())) } : {}),
    });
    if (!code) {
      console.warn(
        `[BSC Adapter] B2C /confirmed did not return an auth code (status=${confirmed.value.status}).`,
      );
      const diagnostic = buildLoginDiagnostic(
        { url: confirmedUrl.origin + confirmedUrl.pathname },
        secrets,
      );
      return { error: `Authentication failed`, diagnostic };
    }

    // --- Step 4: POST /token (code + PKCE verifier) ----------------------
    let tokenResult: { status: number; body?: unknown } | undefined;
    const exchanged = await timed("token", () =>
      exchangeAuthCode(code, codeVerifier, {
        authority,
        fetchOptions,
        stepTimeoutMs,
        onResult: (r) => {
          tokenResult = r;
        },
      }),
    );
    const tokens = exchanged.value;
    report({
      step: "token",
      status: tokenResult?.status ?? 0,
      ms: exchanged.ms,
      parsed: !!tokens,
      ...(tokenResult?.body !== undefined ? { shape: shapeSignature(tokenResult.body) } : {}),
    });
    if (!tokens) {
      return { error: `Authentication failed` };
    }

    attachSsoCookies(tokens, jar);
    // Metadata only: booleans and a count.
    console.log(
      `[BSC Adapter] B2C sign-in complete; access token acquired ` +
        `(refresh_token_present=${!!tokens.refreshToken}, ` +
        `sso_cookies=${Object.keys(tokens.ssoCookies ?? {}).length}).`,
    );
    return { tokens };
  } catch (error) {
    // Network error, timeout or unexpected throw. Name + message with quoted
    // segments elided, never the error object; a generic message out.
    console.error(`[BSC Adapter] Error during B2C sign-in:`, summarizeFetchError(error));
    return { error: `Authentication failed` };
  }
}
