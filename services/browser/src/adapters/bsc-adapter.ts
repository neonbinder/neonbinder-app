import { Page } from "puppeteer";
import {
  BaseAdapter,
  AdapterResponse,
  LoginOptions,
  REAUTH_REQUIRED_ERROR,
  isCanaryKey,
  summarizeFetchError,
} from "./base-adapter";
import { Credentials, SecretsManagerService } from "../services/secrets-manager";
import { resolveBscEndpoints } from "../bsc-endpoints";
import { bscFetch } from "../bsc-fetch";
import {
  B2CCookieJar,
  BSC_B2C_STEP_TIMEOUT_MS,
  BSC_UA,
  BscTokenSet,
  attachSsoCookies,
  bscPasswordSignIn,
  bscRefreshGrant,
  buildAuthorizeRequest,
  cookieHeader,
  exchangeAuthCode,
  extractAuthCode,
  extractAuthError,
  parseB2CSettings,
} from "../bsc-signin";

interface BscSellerProfile {
  // Confirmed live from /marketplace/user/profile: `sellerId` is the
  // canonical field. Other identifiers in the response (userId, sellerEmailId,
  // sellerStoreName) serve different purposes and are NOT what
  // /search/seller/results expects in its `sellerId` body field.
  sellerId?: string;
  sellerStoreName?: string;
}

interface BscProfileResponse {
  sellerProfile?: BscSellerProfile;
}

// --- Azure AD B2C sign-in ----------------------------------------------------
//
// BSC authenticates through an Azure AD B2C tenant using a CUSTOM policy
// (B2C_1A_signin) with no CAPTCHA/JS challenge, so the whole OAuth2
// auth-code-+-PKCE exchange runs over plain fetch, no Chromium. NEO-552: the
// protocol (client config, PKCE, the cookie jar, the four steps) lives in
// ../bsc-signin.ts and the hosts in ../bsc-endpoints.ts, so the probe and the
// fake BSC's recorder share it. This adapter owns the login LADDER (cache,
// refresh, silent SSO, password) and the Secret Manager write-back.

// NEO-445: BSC's profile call usually answers in a couple of seconds and can
// stall for 30s before a 503. One attempt gets 5s, headers and body together, and
// a failed attempt is retried once at once. Worst case about 10s on any path. On
// dev about 1.5% of valid answers take longer than one attempt allows (NEO-443).
const BSC_PROFILE_ATTEMPT_TIMEOUT_MS = 5_000;
const BSC_PROFILE_MAX_ATTEMPTS = 2;

// NEO-483: Convex treats an access token in its last 5 minutes as due for
// renewal (`siteTokenFor`'s leeway) and calls login again. Serving the cached
// token there handed back the same expiry, so every call inside the window
// re-validated against BSC. A token this close to expiry with a way to renew
// goes to the refresh grant instead. Keep in step with Convex's leeway.
const BSC_RENEWAL_LEEWAY_MS = 5 * 60 * 1000;

/**
 * NEO-483: what one profile read amounted to.
 *
 *   - `profile`: BSC answered 200 with a body we could parse. The seller
 *     fields are optional: a 200 with no `sellerProfile` is still an answer.
 *   - `refused`: BSC answered 401 or 403, the only statuses that say the
 *     token itself is no good.
 *   - `unavailable`: no verdict on the token. A timeout, a throw or a 5xx
 *     after its one retry, or a 429 or any other 4xx (not retried).
 */
type SellerProfileOutcome =
  | { kind: "profile"; storeName?: string; sellerId?: string }
  | { kind: "refused" }
  | { kind: "unavailable" };

/**
 * NEO-483: the BSC route's login options. `tokenRefused` is BSC-only, so it
 * lives here rather than on the shared LoginOptions.
 */
export interface BscLoginOptions extends LoginOptions {
  /**
   * True when BSC has just answered 401 to the caller's use of the stored
   * access token. login() then skips the cached-token branch: a profile read
   * that stalls would otherwise serve the refused token straight back. Only a
   * strict boolean `true` counts; the route coerces with `=== true`.
   */
  tokenRefused?: boolean;
}

export interface BSCAdapterOptions {
  /** Limit on one profile attempt, headers and body. Default 5s. */
  profileAttemptTimeoutMs?: number;
}

export class BSCAdapter extends BaseAdapter {
  private readonly profileAttemptTimeoutMs: number;
  /**
   * NEO-552: the fake-mode 429 breaker scope (the credential key), set at the
   * top of login(). Ignored against real BSC, where the breaker is global.
   */
  private breakerScope?: string;

  constructor(page?: Page, opts: BSCAdapterOptions = {}) {
    super(page, "BuySportsCards (BSC)");
    this.profileAttemptTimeoutMs = opts.profileAttemptTimeoutMs ?? BSC_PROFILE_ATTEMPT_TIMEOUT_MS;
  }

  getHomeUrl(): string {
    return resolveBscEndpoints().homeUrl;
  }

  /**
   * Fetch the authenticated BSC user's marketplace profile. Used to validate
   * a cached token (the cached branch of login()) and to capture the seller
   * fields after a password sign-in. NEO-483: the refresh and silent
   * re-authorize paths no longer call it.
   *
   * NEO-445: never throws. A timeout, a throw or a 5xx is retried once, at
   * once. NEO-483: three outcomes (see SellerProfileOutcome). Only a 401 or
   * 403 is `refused`; a 429 or any other 4xx is `unavailable` with no retry,
   * and so is a timeout, throw or 5xx once its retry has failed too.
   *
   * Callers holding a just-issued token must persist it BEFORE calling this,
   * so the stored token never depends on BSC answering here.
   */
  private async fetchSellerProfile(token: string): Promise<SellerProfileOutcome> {
    for (let attempt = 1; attempt <= BSC_PROFILE_MAX_ATTEMPTS; attempt++) {
      const outcome = await this.attemptSellerProfile(token, attempt);
      if (outcome !== "retry") return outcome;
    }
    return { kind: "unavailable" };
  }

  /**
   * One profile attempt under profileAttemptTimeoutMs, headers and body, which
   * logs one line with its status or how it failed.
   *
   * SECURITY: these lines never carry the token, the Authorization header, the
   * response body or a seller id. summarizeFetchError because a fetch error
   * can quote the Authorization header, which is the token.
   */
  private async attemptSellerProfile(
    token: string,
    attempt: number,
  ): Promise<SellerProfileOutcome | "retry"> {
    const label = `[BSC Adapter] /marketplace/user/profile attempt ${attempt}/${BSC_PROFILE_MAX_ATTEMPTS}`;
    const startedAt = Date.now();
    const signal = AbortSignal.timeout(this.profileAttemptTimeoutMs);
    let status: number | undefined;
    try {
      const response = await bscFetch(
        `${resolveBscEndpoints().apiBase}/marketplace/user/profile`,
        {
          headers: { "Authorization": `Bearer ${token}` },
          signal,
        },
        { scope: this.breakerScope },
      );
      status = response.status;
      if (!response.ok) {
        console.warn(`${label} answered ${status} in ${Date.now() - startedAt}ms`);
        if (status >= 500) return "retry";
        // NEO-483: only 401 and 403 are a verdict on the token. A 429 is BSC
        // throttling us and any other 4xx says nothing about the token, so
        // neither is retried and neither throws the token away.
        if (status === 401 || status === 403) return { kind: "refused" };
        return { kind: "unavailable" };
      }
      // Logged after the body is read, so a stalled body logs one timed-out
      // line rather than an "answered 200" followed by it.
      const profile = (await response.json()) as BscProfileResponse;
      console.log(`${label} answered ${status} in ${Date.now() - startedAt}ms`);
      const sellerProfile = profile?.sellerProfile;
      if (!sellerProfile) {
        console.warn(`[BSC Adapter] /marketplace/user/profile returned no sellerProfile. Top-level keys:`, Object.keys(profile ?? {}));
        return { kind: "profile" };
      }
      return {
        kind: "profile",
        storeName: sellerProfile.sellerStoreName,
        sellerId: sellerProfile.sellerId,
      };
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      if (signal.aborted) {
        console.warn(
          `${label} timed out: limit ${this.profileAttemptTimeoutMs}ms, elapsed ${elapsedMs}ms, ` +
            (status === undefined ? "no response headers" : `status ${status}, body stalled`),
        );
      } else {
        console.warn(
          `${label} threw after ${elapsedMs}ms` +
            `${status === undefined ? "" : `, status ${status}`}: ${summarizeFetchError(error)}`,
        );
      }
      return "retry";
    }
  }

  /**
   * NEO-278: silent re-authorize with the stored "Keep me signed in" cookie.
   *
   * A bare GET /authorize with a NEW PKCE pair, the same params as the
   * password path's step 1 but NO `prompt`, and the SSO cookie(s) in the
   * Cookie header. When B2C still honours the SSO session it answers 302 to
   * the redirect URI with `#code=` — no password, no SelfAsserted step — and
   * the ordinary step-4 exchange then yields an access token AND a refresh
   * token with a fresh 24h window. The 302 also re-issues the SSO cookie with
   * a new expiry (it slides), which the returned token set carries so the
   * caller persists the rotated cookie, not the one it presented.
   *
   * Outcomes other than a code — the sign-in form served as a 200, an
   * `error=` in the redirect, or a failed exchange — are reported as a
   * generic failure after a metadata-only warning; the caller falls through
   * to the password / reauth_required logic. A network throw is caught here
   * for the same reason: a silent attempt must never turn a lapsed session
   * into a 500.
   *
   * SECURITY: the cookie values are the user's BSC session. They are sent to
   * the B2C host and nowhere else; only cookie NAMES and counts are logged.
   */
  private async silentReauthorize(
    ssoCookies: Record<string, string>,
  ): Promise<{ tokens: BscTokenSet } | { error: string }> {
    const jar = new B2CCookieJar();
    const { codeVerifier, state, authorizeUrl } = buildAuthorizeRequest({});

    console.log(
      `[BSC Adapter] B2C silent re-authorize: GET /authorize ` +
        `(sso_cookie_names=${Object.keys(ssoCookies).join(",")})`,
    );
    try {
      const authorizeResponse = await bscFetch(
        authorizeUrl,
        {
          headers: {
            "User-Agent": BSC_UA,
            "Cookie": cookieHeader(ssoCookies),
          },
          redirect: "manual",
          signal: AbortSignal.timeout(BSC_B2C_STEP_TIMEOUT_MS),
        },
        { scope: this.breakerScope },
      );
      jar.ingest(authorizeResponse);

      const location = authorizeResponse.headers.get("location");
      const code = extractAuthCode(location, state);
      if (!code) {
        // Three shapes, all "B2C did not honour the SSO session": a 200 with
        // the sign-in form (SETTINGS blob present), a 302 carrying `error=`,
        // or something else entirely. Log which, and nothing from the body.
        let outcome = `status=${authorizeResponse.status}`;
        if (authorizeResponse.status === 200) {
          const html = await authorizeResponse.text();
          outcome += parseB2CSettings(html)
            ? ", sign-in form served"
            : ", no sign-in form";
        } else {
          outcome += `, error=${extractAuthError(location) ?? "(none)"}`;
        }
        console.warn(
          `[BSC Adapter] B2C silent re-authorize did not yield an auth code (${outcome}); ` +
            `SSO session not honoured.`,
        );
        return { error: `Authentication failed` };
      }

      const tokens = await exchangeAuthCode(code, codeVerifier, {
        fetchOptions: { scope: this.breakerScope },
      });
      if (!tokens) {
        return { error: `Authentication failed` };
      }
      attachSsoCookies(tokens, jar);

      console.log(
        `[BSC Adapter] B2C silent re-authorize succeeded ` +
          `(refresh_token_present=${!!tokens.refreshToken}, ` +
          `sso_cookie_reissued=${!!tokens.ssoCookies}).`,
      );
      return { tokens };
    } catch (error) {
      // summarizeFetchError: the Cookie header on this request IS the
      // stored SSO session; never let a header-validation error echo it.
      console.warn(
        `[BSC Adapter] B2C silent re-authorize threw:`,
        summarizeFetchError(error),
      );
      return { error: `Authentication failed` };
    }
  }

  /**
   * Exchange a stored refresh token for a fresh access token — the NEO-141
   * replacement for "keep the user's password and re-login". The grant itself
   * (body, logging, status classification) is `bscRefreshGrant`, shared with
   * the fake-BSC recorder.
   *
   * THE RESPONSE ROTATES THE REFRESH TOKEN. B2C returns a new refresh_token
   * and invalidates the one presented, so the caller MUST durably persist the
   * new one before relying on the new access token — see login().
   *
   * @returns the new token set, or a failure that says whether it is the
   *   user's problem (`reauthRequired`: the grant was refused, so the chain is
   *   broken and only a fresh sign-in can fix it) or ours (an unreachable or
   *   misbehaving token endpoint, which must stay pageable). A 5xx or a 429
   *   must NOT be reported as reauth_required, or a BSC outage would present
   *   to every user as "your session expired, sign in again" (NEO-278).
   *
   * SECURITY: neither the presented nor the returned refresh token is ever
   * logged; only the HTTP status and B2C's short `error` code.
   */
  private async refreshAccessToken(
    refreshToken: string,
  ): Promise<{ tokens: BscTokenSet } | { error: string; reauthRequired: boolean }> {
    const r = await bscRefreshGrant({ refreshToken, fetchOptions: { scope: this.breakerScope } });
    if (r.ok) return { tokens: r.tokens };
    return {
      error: r.reauthRequired ? REAUTH_REQUIRED_ERROR : `Authentication failed`,
      reauthRequired: r.reauthRequired,
    };
  }

  /**
   * Write a token set to Secret Manager as the COMPLETE user payload.
   *
   * NEO-141: the field list is explicit and deliberately omits `password`.
   * This used to be `{...credentials, token, expiresAt}`, and that spread is
   * what silently re-persisted the user's password on every hourly token
   * refresh — the secret could never shed it, no matter what the intake path
   * did. An explicit list means adding a field is a decision, not an accident.
   *
   * `username` is the only durable field; everything else is session state.
   *
   * NEO-141 hardening: the canary-KEY guard lives here rather than at the
   * call sites so that "a canary secret is never written back" is a property of
   * the write itself. A canary-keyed request that omitted `canary: true` would
   * otherwise reach this method from the password, refresh or silent-SSO path,
   * persist a payload with no password in it, and — via keep-1 pruning —
   * destroy the canary's password unrecoverably. See isCanaryKey for why that
   * failure is worse than it sounds (silently dead login alerting).
   *
   * NEO-278: `updateCredentials` REPLACES the payload, so a token set that
   * carries no SSO cookies (the refresh grant never touches /authorize) would
   * silently drop the stored ones — and with them the only way past the 24h
   * refresh window. `previous` is the secret as read at the top of login();
   * its SSO cookies are carried forward whenever the new token set has none.
   */
  private async persistTokens(
    secretsManager: SecretsManagerService,
    key: string,
    username: string,
    tokens: BscTokenSet,
    previous?: Credentials,
  ): Promise<void> {
    if (isCanaryKey(key)) {
      console.log(
        `[BSC Adapter] canary key — refusing token write-back to protect the stored password`,
      );
      return;
    }
    const payload: Credentials = {
      username,
      token: tokens.token,
      expiresAt: tokens.expiresAt,
    };
    if (tokens.refreshToken) payload.refreshToken = tokens.refreshToken;
    if (tokens.refreshExpiresAt) payload.refreshExpiresAt = tokens.refreshExpiresAt;
    const ssoCookies = tokens.ssoCookies ?? previous?.ssoCookies;
    const ssoExpiresAt = tokens.ssoCookies ? tokens.ssoExpiresAt : previous?.ssoExpiresAt;
    if (ssoCookies) payload.ssoCookies = ssoCookies;
    if (ssoCookies && ssoExpiresAt !== undefined) payload.ssoExpiresAt = ssoExpiresAt;
    await secretsManager.updateCredentials(key, payload);
  }

  /**
   * Authenticate against BSC, in descending order of cost.
   *
   *   0. transient credentials in the request body → fresh sign-in (bootstrap
   *      or explicit re-auth). Never consults the stored secret.
   *   1. cached access token that BSC does not refuse → free. NEO-483: skipped
   *      when the caller says BSC just refused it (`tokenRefused`), and when
   *      it is inside the renewal leeway with a refresh token or SSO session
   *      to renew it. A profile read with no verdict serves it unvalidated.
   *   2. live refresh token → one POST /token. NEO-141: this is what replaced
   *      keeping the user's password on disk.
   *   3. live "Keep me signed in" SSO cookie → silent GET /authorize + POST
   *      /token. NEO-278: this is what gets past the ABSOLUTE 24h refresh
   *      window — it mints a new code, and with it a fresh refresh window,
   *      with no password. Tried when the refresh token is expired, missing,
   *      or REFUSED (a 5xx from the token endpoint is BSC being unwell and
   *      stays a pageable failure without trying further).
   *   4. a stored password → full B2C sign-in. Reachable only by the NEO-43
   *      canary secrets and by legacy user secrets not yet migrated.
   *   5. nothing left → `reauthRequired`, the signal Convex turns into "sign
   *      in again".
   *
   * The canary skips 1, 2 and 3 outright and lands on 4 every time — that is
   * the entire point of the probe, and both Cloud Scheduler jobs depend on it.
   */
  async login(key: string, opts?: BscLoginOptions): Promise<AdapterResponse> {
    this.breakerScope = key;
    const secretsManager = new SecretsManagerService();
    const canary = opts?.canary === true;
    const transient = opts?.transientCredentials;
    // Strict, like `canary`: only a real boolean true skips the cache.
    const tokenRefused = opts?.tokenRefused === true;

    // --- Step 0: transient credentials --------------------------------------
    //
    // Deliberately does NOT read the secret first: this is also the path that
    // bootstraps a key that does not exist yet. The password is used here and
    // nowhere else, and persistTokens never writes it.
    if (transient) {
      console.log(`[BSC Adapter] request supplied credentials; fresh sign-in for ${this.siteName}`);
      return this.passwordLogin(
        secretsManager,
        key,
        transient.username,
        transient.password,
        canary,
      );
    }

    const credentials = await secretsManager.getCredentials(key);

    // --- Cache-hit path: validate the stored token, never touch a browser --
    //
    // BSC stores the bare token (no "Bearer " prefix); fetchSellerProfile
    // prepends "Bearer " on the validation request. A still-valid cached token
    // short-circuits the whole B2C exchange.
    //
    // NEO-43: the canary skips this entirely. A cache hit costs ~1.1s and
    // proves only that a previously-issued token is still accepted — it does
    // NOT exercise the B2C authorize/SelfAsserted/confirmed/token exchange,
    // which is the part that actually breaks. A canary that short-circuits
    // here would report green straight through a real outage.
    const now = Date.now();
    const cachedTokenUnexpired =
      !!credentials.token && !!credentials.expiresAt && credentials.expiresAt > now;
    // NEO-483: inside Convex's renewal leeway, a token we can renew is renewed
    // rather than validated and handed back with the same expiry (which only
    // brings Convex straight back on its next call).
    const renewInLeeway =
      cachedTokenUnexpired &&
      (credentials.expiresAt as number) <= now + BSC_RENEWAL_LEEWAY_MS &&
      (this.refreshTokenIsLive(credentials) || this.ssoSessionIsLive(credentials));

    if (!canary && cachedTokenUnexpired && (tokenRefused || renewInLeeway)) {
      console.log(
        `[BSC Adapter] Skipping the cached token for ${this.siteName} ` +
          `(caller_reported_refusal=${tokenRefused}, renewal_leeway=${renewInLeeway}).`,
      );
    }

    if (!canary && cachedTokenUnexpired && !tokenRefused && !renewInLeeway) {
      console.log(`[BSC Adapter] Validating cached token for ${this.siteName}...`);
      // NEO-278: a network failure here (DNS, timeout, ECONNRESET) must never
      // turn into a failed login.
      //
      // NEO-483 (Jason, 2026-11-13) reverses NEO-445's call of 2026-11-05.
      // NEO-445 sent a token that could not be validated to the refresh grant,
      // which rotated a token that was probably fine and wrote a Secret
      // Manager version (NEO-115) every time BSC stalled. Now only BSC's own
      // verdict (401 or 403) discards the token. When the read gives no
      // verdict (timeout, throw, 5xx after its retry, 429, any other 4xx) the
      // cached token is served as is, without the optional seller fields. If
      // BSC does refuse it later, the caller says so with `tokenRefused` and
      // this branch is skipped.
      const profile = await this.fetchSellerProfile(credentials.token as string);
      if (profile.kind === "profile") {
        // Log a 4-char prefix only — sellerId is a per-user BSC identifier
        // and full values in Cloud Logging would let log-readers correlate
        // Clerk users to BSC seller accounts.
        const sellerIdPrefix = profile.sellerId ? `${profile.sellerId.slice(0, 4)}…` : "(unknown)";
        console.log(`[BSC Adapter] Cached token valid. Store: ${profile.storeName} sellerId: ${sellerIdPrefix}`);
        return {
          success: true,
          message: `Used cached token for ${this.siteName}`,
          storeName: profile.storeName,
          sellerId: profile.sellerId,
          expiresAt: credentials.expiresAt,
        };
      }
      if (profile.kind === "unavailable") {
        console.warn(
          `[BSC Adapter] Cached token not validated (no verdict from /marketplace/user/profile); ` +
            `serving it without storeName + sellerId.`,
        );
        return {
          success: true,
          message: `Used cached token for ${this.siteName}`,
          expiresAt: credentials.expiresAt,
        };
      }
      // Refused (401/403). Fall through to the refresh grant.
      //
      // NEO-115: we deliberately do NOT write a token-cleared version here.
      // That write burned a whole Secret Manager version (billed forever, at
      // TOKEN_TTL_MS = 1h cadence) purely to blank a field that the
      // fresh-login write-back below overwrites seconds later — it doubled
      // BSC's version rate for no durable benefit. The dead token simply
      // stays in the secret until the fresh login replaces it; it is never
      // served again, because BSC refuses it on every later read and a caller
      // that sees it refused sends `tokenRefused`.
      console.log(`[BSC Adapter] Cached token refused by BSC, re-authenticating...`);
    }

    // NEO-483: what to fall back on if a leeway renewal cannot reach BSC. The
    // cached token is still unexpired and nothing has refused it, so it beats
    // a failed login; its expiry keeps it inside Convex's leeway, so the next
    // call tries the renewal again.
    const leewayFallback: AdapterResponse | undefined =
      !canary && renewInLeeway && !tokenRefused
        ? {
            success: true,
            message: `Used cached token for ${this.siteName}`,
            expiresAt: credentials.expiresAt,
          }
        : undefined;

    // --- Refresh-grant path: NEO-141's replacement for a stored password ---
    //
    // The canary skips this for the same reason it skips the cache: a refresh
    // grant does not exercise the authorize/SelfAsserted/confirmed exchange,
    // which is the part that actually breaks. (It also never has a refresh
    // token to use, since it never writes back.)
    if (!canary && this.refreshTokenIsLive(credentials)) {
      const refreshed = await this.refreshAccessToken(credentials.refreshToken as string);

      if ("tokens" in refreshed) {
        // ATOMIC, NOT BEST-EFFORT. B2C has already invalidated the refresh
        // token we just presented, so the rotated one in `refreshed` is now
        // the ONLY way back in. Returning success without durably storing it
        // would strand the user on a token that expires in an hour with no
        // way to renew — the exact failure NEO-141 exists to remove. A write
        // failure therefore fails the login (502, pages) instead of being
        // swallowed.
        try {
          // NEO-278: `credentials` carries the stored SSO cookies forward —
          // the refresh grant never sees /authorize, so its token set has
          // none, and a replace-write without them would drop the only way
          // past the 24h refresh window.
          await this.persistTokens(
            secretsManager,
            key,
            credentials.username,
            refreshed.tokens,
            credentials,
          );
        } catch (error) {
          console.error(
            `[BSC Adapter] Refresh succeeded but persisting the rotated token FAILED — ` +
              `the refresh chain is broken for this key:`,
            error instanceof Error ? `${error.name}: ${error.message}` : String(error),
          );
          return { success: false, error: `Authentication failed` };
        }

        // NEO-483: no profile read here. Convex fetches the seller account on
        // its own schedule, so a renewal never waits on BSC's profile endpoint
        // and the response carries no storeName or sellerId.
        console.log(`[BSC Adapter] Refreshed token for ${this.siteName}; no profile read.`);
        return {
          success: true,
          message: `Refreshed token for ${this.siteName}`,
          expiresAt: refreshed.tokens.expiresAt,
        };
      }

      // Refresh failed. A 5xx / unreachable token endpoint is BSC being
      // unwell: with no password it stays a pageable 502 right here, and the
      // silent SSO path (which needs the same token endpoint) is NOT tried —
      // it would only turn an outage into a misleading "sign in again". A
      // REFUSED grant (4xx) is the case NEO-278 exists for: fall through to
      // the SSO re-authorize below, then to a password if one is stored.
      if (!credentials.password && !refreshed.reauthRequired) {
        if (leewayFallback) {
          console.warn(
            `[BSC Adapter] Leeway renewal failed (token endpoint unavailable); ` +
              `serving the unexpired cached token.`,
          );
          return leewayFallback;
        }
        return {
          success: false,
          error: refreshed.error,
          reauthRequired: false,
        };
      }
      console.log(
        `[BSC Adapter] refresh grant failed (refused=${refreshed.reauthRequired}); ` +
          `trying the remaining paths`,
      );
    }

    // --- Silent SSO re-authorize: NEO-278's way past the 24h refresh window --
    //
    // The canary skips this for the same reason it skips the cache and the
    // refresh grant: a silent re-authorize does not exercise the
    // SelfAsserted step, which is where a broken password login shows up.
    // (It also never has an SSO cookie, since it never writes back.)
    if (!canary && this.ssoSessionIsLive(credentials)) {
      const silent = await this.silentReauthorize(
        credentials.ssoCookies as Record<string, string>,
      );

      if ("tokens" in silent) {
        // Same posture as the refresh path: the rotated SSO cookie and the
        // new refresh token are the durable session now, so a write failure
        // fails the login (502, pages) rather than being swallowed.
        try {
          await this.persistTokens(
            secretsManager,
            key,
            credentials.username,
            silent.tokens,
            credentials,
          );
        } catch (error) {
          console.error(
            `[BSC Adapter] Silent re-authorize succeeded but persisting the tokens FAILED:`,
            error instanceof Error ? `${error.name}: ${error.message}` : String(error),
          );
          return { success: false, error: `Authentication failed` };
        }

        // NEO-483: no profile read here either; see the refresh path.
        console.log(`[BSC Adapter] Silently re-authenticated ${this.siteName}; no profile read.`);
        return {
          success: true,
          message: `Silently re-authenticated with ${this.siteName}`,
          expiresAt: silent.tokens.expiresAt,
        };
      }
      // silentReauthorize already logged why. Fall through: a password if one
      // is stored, otherwise the user has to sign in again.
    }

    // --- Password sign-in: the canary path, and legacy un-migrated secrets --
    if (!credentials.password) {
      // NEO-141: no cached token, no usable refresh token, no SSO session,
      // and no password to sign in with — which is the CORRECT steady state
      // for a user secret whose session has fully lapsed, not a corrupt one.
      // Say so precisely so Convex can prompt a re-login instead of guessing
      // from a status code.
      if (leewayFallback) {
        // NEO-483: the renewal failed, but the cached token is unexpired and
        // nothing refused it. Serve it; once it expires, the next call lands
        // here without a fallback and reports reauthRequired.
        console.warn(
          `[BSC Adapter] Leeway renewal failed; serving the unexpired cached token.`,
        );
        return leewayFallback;
      }
      console.log(
        `[BSC Adapter] no cached token, no live refresh token, no SSO session, no password — re-auth required`,
      );
      return { success: false, error: REAUTH_REQUIRED_ERROR, reauthRequired: true };
    }

    return this.passwordLogin(
      secretsManager,
      key,
      credentials.username,
      credentials.password,
      canary,
    );
  }

  /** True when the secret holds a refresh token that has not visibly expired. */
  private refreshTokenIsLive(credentials: Credentials): boolean {
    if (!credentials.refreshToken) return false;
    // An absent refreshExpiresAt is treated as live rather than dead: BSC does
    // return refresh_token_expires_in today, but if it ever stops, the right
    // move is to TRY the grant and let B2C answer — a refused grant is one
    // cheap round trip, whereas assuming "dead" would silently downgrade every
    // user to a password login they no longer have a password for.
    return (
      credentials.refreshExpiresAt === undefined || credentials.refreshExpiresAt > Date.now()
    );
  }

  /**
   * NEO-278: true when the secret holds SSO cookie(s) that have not visibly
   * expired. Same posture as refreshTokenIsLive: an absent expiry means TRY
   * it and let B2C answer — a refused silent authorize is one cheap round
   * trip, and the fall-through is exactly what would have happened anyway.
   */
  private ssoSessionIsLive(credentials: Credentials): boolean {
    if (!credentials.ssoCookies || Object.keys(credentials.ssoCookies).length === 0) {
      return false;
    }
    return credentials.ssoExpiresAt === undefined || credentials.ssoExpiresAt > Date.now();
  }

  /**
   * Full browser-free B2C sign-in with a username+password, followed by the
   * token write-back.
   *
   * `password` is transient in every caller: it comes either from the request
   * body (a user signing in) or from one of the two canary secrets. It is
   * passed to httpLogin, which hands it to buildLoginDiagnostic for exact-value
   * redaction, and is never persisted — persistTokens writes an explicit field
   * list with no `password` in it.
   */
  private async passwordLogin(
    secretsManager: SecretsManagerService,
    key: string,
    username: string,
    password: string,
    canary: boolean,
  ): Promise<AdapterResponse> {
    console.log(`[BSC Adapter] Starting browser-free login for ${this.siteName}`);
    if (!username || !password) {
      console.error(
        `[BSC Adapter] Missing credentials: email=${!!username}, password=${!!password}`,
      );
      return {
        success: false,
        error: `Missing credentials for ${this.siteName}`,
        // NEO-98: BSC never gets asked. Not a marketplace verdict, but
        // unambiguously a caller-data problem rather than a service fault —
        // 422, and it must not page.
        credentialRejected: true,
      };
    }

    try {
      const result = await bscPasswordSignIn({
        username,
        password,
        fetchOptions: { scope: this.breakerScope },
      });
      if ("error" in result) {
        return {
          success: false,
          error: result.error,
          diagnostic: result.diagnostic,
          credentialRejected: result.credentialRejected,
        };
      }

      const tokens = result.tokens;

      // NEO-43: the canary must NOT write back. Every write adds a new,
      // permanently-enabled Secret Manager version ($0.06/version/month) —
      // at canary cadence that is thousands of versions a month, costing more
      // than the rest of this infrastructure combined. Skipping it also means
      // no token is ever cached on the canary key, so the cache-skip above is
      // structurally guaranteed rather than merely flag-dependent.
      if (canary) {
        console.log(`[BSC Adapter] canary run — skipping token write-back for ${this.siteName}`);
      } else {
        await this.persistTokens(secretsManager, key, username, tokens);
        console.log(`[BSC Adapter] Stored token in Secret Manager for ${this.siteName}`);
      }

      // Capture sellerId/storeName in the same response shape as the cached
      // path. Profile failure here is non-fatal — we already have a valid
      // token; the caller just won't get a sellerId this round. NEO-483: this
      // (Connect) is the one renewal-free path that still reads the profile;
      // when it does not answer, Convex fetches the seller account later.
      const profile = await this.fetchSellerProfile(tokens.token);
      this.logProfile("Fresh login", profile);

      return {
        success: true,
        message: `Successfully logged into ${this.siteName}`,
        expiresAt: tokens.expiresAt,
        storeName: profile.kind === "profile" ? profile.storeName : undefined,
        sellerId: profile.kind === "profile" ? profile.sellerId : undefined,
      };
    } catch (error) {
      // Network error or unexpected throw during the B2C exchange. The error
      // object can carry a request URL with B2C params but not the user's
      // secret; we still never return it raw — log name+message server-side,
      // return a generic message to the caller.
      console.error(
        `[BSC Adapter] Error during login process:`,
        summarizeFetchError(error),
      );
      return {
        success: false,
        error: `Authentication failed`,
      };
    }
  }

  /**
   * Log the outcome of a profile fetch.
   *
   * sellerId is truncated to a 4-char prefix: it is a per-user BSC identifier,
   * and full values in Cloud Logging would let a log reader correlate Clerk
   * users to BSC seller accounts.
   */
  private logProfile(context: string, profile: SellerProfileOutcome): void {
    if (profile.kind !== "profile") {
      console.warn(
        `[BSC Adapter] ${context}: no usable /marketplace/user/profile answer ` +
          `(${profile.kind}); storeName + sellerId omitted.`,
      );
      return;
    }
    const sellerIdPrefix = profile.sellerId ? `${profile.sellerId.slice(0, 4)}…` : "(unknown)";
    console.log(
      `[BSC Adapter] ${context} profile. Store: ${profile.storeName} sellerId: ${sellerIdPrefix}`,
    );
  }
}
