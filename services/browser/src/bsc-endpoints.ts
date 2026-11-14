import { GoogleAuth } from "google-auth-library";

/**
 * NEO-552: the ONE place in services/browser that names a BuySportsCards host.
 *
 * Everything that talks to BSC (the B2C sign-in, the profile read, the probe)
 * resolves its URLs here, so that a deployment can be pointed at the standing
 * fake BSC server instead of the real site with one env var:
 *
 *   NEONBINDER_FAKE_BSC_URL   the fake's origin (https://<service>.run.app).
 *                             Unset or blank: the real BSC hosts.
 *   NEONBINDER_FAKE_BSC_KEY   the caller secret the fake checks in the
 *                             `x-nb-fake-bsc-key` header. Sent ONLY to the
 *                             fake, never to BSC.
 *
 * In fake mode every request to the fake also carries this service's Google
 * ID token in `X-Serverless-Authorization` (audience = the fake's origin), so
 * Cloud Run IAM in front of the fake can admit it while the BSC-style
 * `Authorization: Bearer <bsc token>` header passes through untouched, and
 * again, bare, in `x-nb-fake-id-token` for the fake's own signature check.
 * The fake URL is pinned to the fake's Cloud Run host (or loopback).
 *
 * PROD NEVER TALKS TO THE FAKE. `assertBscTargetAllowed` refuses to boot a
 * process with the fake URL set while ENVIRONMENT=prod, and
 * `resolveBscEndpoints` refuses it again at call time.
 *
 * tests/bsc-endpoints.test.mjs greps src/ and fails on any BSC host literal
 * outside this file. Keep it that way: a hardcoded host elsewhere is a call
 * the fake seam cannot see, which is how a test run ends up hitting real BSC.
 */

export const FAKE_BSC_URL_ENV = "NEONBINDER_FAKE_BSC_URL";
export const FAKE_BSC_KEY_ENV = "NEONBINDER_FAKE_BSC_KEY";
/** Header the fake checks for the caller secret (CONTRACT.md, "Who may call it"). */
export const FAKE_BSC_KEY_HEADER = "x-nb-fake-bsc-key";
/** Header Cloud Run reads the invoker's Google ID token from when Authorization is taken. */
export const SERVERLESS_AUTH_HEADER = "X-Serverless-Authorization";
/**
 * The same Google ID token again, for the fake's own signature check
 * (independent of Cloud Run IAM; Cloud Run strips nothing from it). Bare
 * token, no `Bearer ` prefix.
 */
export const FAKE_ID_TOKEN_HEADER = "x-nb-fake-id-token";
/**
 * The fake's Cloud Run service name. A fake URL must be this service's
 * `*.run.app` host (either Cloud Run URL form; a tagged revision's `tag---`
 * URL is refused, as in Convex's bscHttp.ts), or loopback
 * for a fake run on the laptop and in tests.
 */
export const FAKE_BSC_SERVICE_NAME = "neonbinder-fake-bsc";
const FAKE_HOST_RE = /^neonbinder-fake-bsc-[a-z0-9-]+(?:\.[a-z0-9-]+)*\.run\.app$/;

/** The real BSC hosts. Public, not secrets. */
const REAL_IDENTITY_ORIGIN = "https://identity.buysportscards.com";
const REAL_AUTHORITY_PATH = "/identity.buysportscards.com/b2c_1a_signin";
const REAL_API_BASE = "https://api-prod.buysportscards.com";
const REAL_WWW_ORIGIN = "https://www.buysportscards.com";

/**
 * BSC's public B2C client configuration, extracted from the BSC SPA bundle and
 * the B2C OIDC metadata document. PUBLIC client configuration, not secrets.
 *
 * `offline_access` is listed for legibility of intent (NEO-140): the token
 * endpoint returns a refresh token under the base scope alone.
 * `refresh_token_expires_in` is ABSOLUTE from the password sign-in (NEO-278).
 */
export const BSC_B2C_CLIENT = Object.freeze({
  clientId: "9b4d7d82-6b2b-4c9e-9542-d94ee43bcac1",
  policy: "B2C_1A_signin",
  scope: "openid profile https://buysportscards.onmicrosoft.com/api/read offline_access",
  /**
   * The SPA's registered redirect URI. Only ever compared against a redirect
   * Location, never fetched (every sign-in request uses redirect: "manual"),
   * so it is the same string in fake mode: the fake echoes whatever
   * redirect_uri the authorize request carried.
   */
  redirectUri: `${REAL_WWW_ORIGIN}/`,
});

export type BscTarget = "real" | "fake";

export interface BscEndpoints {
  target: BscTarget;
  /** B2C authority: `<origin>/<tenant>/<policy>`, no trailing slash. */
  authority: string;
  /** BSC API base, no trailing slash (`<base>/marketplace/user/profile`). */
  apiBase: string;
  /** What BaseAdapter.getHomeUrl answers. */
  homeUrl: string;
  /** The fake's origin; set only when target is "fake". */
  fakeOrigin?: string;
}

type Env = Record<string, string | undefined>;

/** The configured fake URL, trimmed; undefined when unset or blank. */
function fakeUrlFrom(env: Env): string | undefined {
  const raw = env[FAKE_BSC_URL_ENV];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * True for a URL this service may treat as the fake: https on the fake's own
 * Cloud Run host (`neonbinder-fake-bsc-*.run.app`, default port, no
 * credentials in the URL), or http/https on loopback (a fake on the laptop,
 * and the tests). Pinning the host means a mistyped or hostile
 * NEONBINDER_FAKE_BSC_URL cannot route the caller key and an ID token to some
 * other service.
 */
function isAllowedFakeUrl(parsed: URL): boolean {
  if (parsed.username || parsed.password) return false;
  if (isLoopbackHost(parsed.hostname)) {
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  }
  return parsed.protocol === "https:" && parsed.port === "" && FAKE_HOST_RE.test(parsed.hostname);
}

/**
 * Parse and check the fake URL (see isAllowedFakeUrl). Anything else is a
 * misconfiguration and throws: a typo must never fall back to real BSC
 * silently, nor send the fake's credentials somewhere else.
 *
 * The error message never contains the URL itself (an internal address).
 */
function parseFakeOrigin(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${FAKE_BSC_URL_ENV} is not a valid URL`);
  }
  if (!isAllowedFakeUrl(parsed)) {
    throw new Error(
      `${FAKE_BSC_URL_ENV} must be the ${FAKE_BSC_SERVICE_NAME} Cloud Run https *.run.app origin (or http on localhost)`,
    );
  }
  return parsed.origin;
}

/**
 * Boot-time guard, called once from index.ts before the server listens.
 * Throws (and so stops the process) when:
 *   - the fake URL is set while ENVIRONMENT=prod, or
 *   - the fake URL is set but malformed.
 */
export function assertBscTargetAllowed(env: Env = process.env): void {
  const fake = fakeUrlFrom(env);
  if (!fake) return;
  if ((env.ENVIRONMENT ?? "").trim() === "prod") {
    throw new Error(
      `${FAKE_BSC_URL_ENV} is set while ENVIRONMENT=prod; refusing to boot. ` +
        `Production must only ever talk to real BuySportsCards.`,
    );
  }
  parseFakeOrigin(fake);
}

/**
 * Resolve where BSC lives for this process. Read per call (cheap), so a test
 * can flip the env between cases. Throws on the same conditions as
 * assertBscTargetAllowed: a prod process can never resolve the fake.
 */
export function resolveBscEndpoints(env: Env = process.env): BscEndpoints {
  const fake = fakeUrlFrom(env);
  if (!fake) {
    return {
      target: "real",
      authority: `${REAL_IDENTITY_ORIGIN}${REAL_AUTHORITY_PATH}`,
      apiBase: REAL_API_BASE,
      homeUrl: REAL_WWW_ORIGIN,
    };
  }
  assertBscTargetAllowed(env);
  const origin = parseFakeOrigin(fake);
  return {
    target: "fake",
    // CONTRACT.md: identity mirrors the real path shape under <FAKE>/identity.
    authority: `${origin}/identity${REAL_AUTHORITY_PATH}`,
    // CONTRACT.md: the API mirrors api-prod paths under <FAKE>/api.
    apiBase: `${origin}/api`,
    homeUrl: origin,
    fakeOrigin: origin,
  };
}

/** "real" or "fake", for /health. Never throws (a bad config reads "fake"). */
export function bscTarget(env: Env = process.env): BscTarget {
  return fakeUrlFrom(env) ? "fake" : "real";
}

/**
 * The browser-mimicking header set BSC's API insists on (CloudFront rejects a
 * bare request as bot traffic), the same set Convex sends
 * (apps/web/convex/lib/bscHttp.ts). Used by the probe's API reads, which must
 * look exactly like Convex's so the drift check compares like with like.
 *
 * SECURITY: the return value carries the bearer token. Never log it.
 */
export function bscApiHeaders(
  bearerToken: string,
  opts: { json?: boolean } = {},
): Record<string, string> {
  return {
    accept: "application/json, text/plain, */*",
    "accept-language": "en-US,en;q=0.9",
    assumedrole: "sellers",
    ...(opts.json === false ? {} : { "content-type": "application/json" }),
    origin: REAL_WWW_ORIGIN,
    referer: `${REAL_WWW_ORIGIN}/`,
    "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": "macOS",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
    authority: new URL(REAL_API_BASE).host,
    authorization: `Bearer ${bearerToken}`,
  };
}

// --- Fake-mode caller headers ------------------------------------------------

export interface FakeHeaderDeps {
  env?: Env;
  /** Mint a Google ID token for `audience` (bare token, no "Bearer "). */
  mintIdToken?: (audience: string) => Promise<string>;
  now?: () => number;
}

let googleAuth: GoogleAuth | undefined;

/** Default minter: ADC (the runtime SA via the metadata server on Cloud Run). */
async function mintIdTokenFromAdc(audience: string): Promise<string> {
  googleAuth ??= new GoogleAuth();
  const client = await googleAuth.getIdTokenClient(audience);
  return client.idTokenProvider.fetchIdToken(audience);
}

/** Google ID tokens live an hour; reuse one for 45 minutes. */
const ID_TOKEN_REUSE_MS = 45 * 60 * 1000;
const idTokenCache = new Map<string, { token: string; mintedAt: number }>();

/** Test hook: forget cached ID tokens. */
export function clearFakeIdTokenCache(): void {
  idTokenCache.clear();
}

/**
 * The extra headers a request to the fake carries. Empty for the real target.
 *
 *   - `x-nb-fake-bsc-key`: from NEONBINDER_FAKE_BSC_KEY. Missing key in fake
 *     mode throws: the fake would 401 anyway, and failing here says why.
 *   - `X-Serverless-Authorization: Bearer <id token>`: https only. A fake on
 *     http://localhost has no Cloud Run in front of it, and an ID token is
 *     never sent over plain http.
 *
 * SECURITY: both values are credentials. Never log the returned object.
 */
export async function fakeBscCallerHeaders(
  endpoints: BscEndpoints,
  deps: FakeHeaderDeps = {},
): Promise<Record<string, string>> {
  if (endpoints.target !== "fake" || !endpoints.fakeOrigin) return {};
  const env = deps.env ?? process.env;
  const key = (env[FAKE_BSC_KEY_ENV] ?? "").trim();
  if (!key) {
    throw new Error(`${FAKE_BSC_KEY_ENV} is not set; the fake BSC would refuse this call`);
  }
  const headers: Record<string, string> = { [FAKE_BSC_KEY_HEADER]: key };
  if (endpoints.fakeOrigin.startsWith("https:")) {
    const audience = endpoints.fakeOrigin;
    const now = (deps.now ?? Date.now)();
    const cached = deps.mintIdToken ? undefined : idTokenCache.get(audience);
    let token: string;
    if (cached && now - cached.mintedAt < ID_TOKEN_REUSE_MS) {
      token = cached.token;
    } else {
      token = await (deps.mintIdToken ?? mintIdTokenFromAdc)(audience);
      if (typeof token !== "string" || token.length === 0) {
        throw new Error("Could not mint an ID token for the fake BSC");
      }
      if (!deps.mintIdToken) idTokenCache.set(audience, { token, mintedAt: now });
    }
    headers[SERVERLESS_AUTH_HEADER] = `Bearer ${token}`;
    headers[FAKE_ID_TOKEN_HEADER] = token;
  }
  return headers;
}

/**
 * True when `url` points at the fake this process is configured for, and that
 * fake is on an allowed host (isAllowedFakeUrl). Only then does bscFetch add
 * the caller key and ID token.
 */
export function isFakeUrl(url: string | URL, endpoints: BscEndpoints): boolean {
  if (endpoints.target !== "fake" || !endpoints.fakeOrigin) return false;
  try {
    const parsed = new URL(String(url));
    return parsed.origin === endpoints.fakeOrigin && isAllowedFakeUrl(parsed);
  } catch {
    return false;
  }
}
