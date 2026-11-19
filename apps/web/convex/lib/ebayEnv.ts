/**
 * NEO-415 — whether this deployment is wired to eBay, and which eBay.
 *
 * Read from Convex env on every call (cheap; env can change without a
 * deploy). Convex holds no eBay client secret: the browser service holds it
 * and does every token exchange (`/oauth/ebay/connect`, `/oauth/ebay/refresh`).
 * Convex needs only what builds the consent URL and picks the API hosts:
 *
 *   EBAY_CLIENT_ID    the app's client id (public: it rides in the consent URL)
 *   EBAY_RU_NAME      the RuName eBay redirects consent to (public, ditto)
 *   EBAY_ENVIRONMENT  "sandbox" | "production" | "fake"
 *
 * Any of the three unset (or an unknown environment) means eBay is NOT
 * configured: Connect is refused, and the drain and the order poll skip eBay
 * without error (`ebayConfig()` null). Safe to import from any runtime.
 *
 * NEO-555 — `fake` points every eBay call at the standing fake
 * (`services/fake-bsc`, CONTRACT.md "Fake eBay"), the same service the fake
 * BSC lives on. It needs no `EBAY_CLIENT_ID` / `EBAY_RU_NAME` (both are
 * ignored; the fake's public constants are used) but is valid ONLY beside
 * `TESTING_RESET_SECRET` and a fake BSC target (`resolveBscTarget` says
 * `fake`: the one host pin and caller key). Anything else is "not
 * configured", logged loudly; it NEVER falls back to the sandbox or to
 * production, whatever else is set.
 */
import { resolveBscTarget, type BscEnv } from "./bscHttp";

export type EbayEnvironment = "sandbox" | "production" | "fake";

/** The fake eBay's public app constants (services/fake-bsc/src/ebay/tokens.ts, browser ebay-probe.ts). Not secrets. */
export const FAKE_EBAY_CLIENT_ID = "NeonBind-FakeEbay-PRD-0fake000-00000000";
export const FAKE_EBAY_RU_NAME = "nb-fake-ebay-ru-name";
/** Where the fake consent page lives in the SPA (a relative URL: it is this deployment's own page). */
export const FAKE_EBAY_AUTHORIZE_PATH = "/testing/fake-ebay/authorize";

export interface EbayConfig {
  clientId: string;
  ruName: string;
  environment: EbayEnvironment;
  /** REST API host, e.g. `https://api.ebay.com`. */
  apiBase: string;
  /** Media API host (`apim.`), `createImageFromFile` lives there. */
  mediaBase: string;
  /** Consent (authorize) page host. */
  authBase: string;
  /** Seller-facing web host, for links the web builds. */
  webBase: string;
}

/**
 * The scopes NB asks for at consent. Must equal the browser service's list
 * exactly (it refreshes with the scopes the consent granted).
 * https://developer.ebay.com/api-docs/static/oauth-scopes.html
 */
export const EBAY_SCOPES: readonly string[] = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
];

function envValue(name: string, env: BscEnv = process.env): string | null {
  const raw = env[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * True when this deployment ASKED for the fake eBay (`EBAY_ENVIRONMENT=fake`),
 * whether or not the ask is usable. Key naming and the end-of-run cleanup read
 * this, not `ebayConfig()`: a test deployment whose fake settings are unusable
 * must still use fake keys (and be refused), never a bare per-user key.
 */
export function fakeEbayRequested(env: BscEnv = process.env): boolean {
  return envValue("EBAY_ENVIRONMENT", env) === "fake";
}

/** Logged at most once a minute per reason: `ebayConfig()` runs on every call and every subscribed query. */
const FAKE_MISCONFIG_LOG_EVERY_MS = 60_000;
const fakeMisconfigLoggedAt = new Map<string, number>();

/** Tests only: the throttle otherwise leaks across cases. */
export function __resetEbayFakeLogThrottle(): void {
  fakeMisconfigLoggedAt.clear();
}

function logFakeMisconfigured(reason: string): void {
  const now = Date.now();
  const last = fakeMisconfigLoggedAt.get(reason);
  if (last !== undefined && now - last < FAKE_MISCONFIG_LOG_EVERY_MS) return;
  fakeMisconfigLoggedAt.set(reason, now);
  // Platform and reason only: no env value, URL or key.
  console.error(
    JSON.stringify({ msg: "ebay_fake_misconfigured", platform: "ebay", reason, outcome: "not_configured" }),
  );
}

/**
 * The fake eBay config, or null (logged) when `EBAY_ENVIRONMENT=fake` is not
 * beside everything it needs. The fake lives under the fake BSC's origin:
 * `<origin>/ebay/api` (REST, token) and `<origin>/ebay/apim` (Media).
 */
function fakeEbayConfig(env: BscEnv): EbayConfig | null {
  if (!envValue("TESTING_RESET_SECRET", env)) {
    logFakeMisconfigured("not_a_test_deployment");
    return null;
  }
  const target = resolveBscTarget(env);
  if (target.mode !== "fake") {
    logFakeMisconfigured(target.mode === "misconfigured" ? "fake_target_misconfigured" : "bsc_target_not_fake");
    return null;
  }
  return {
    clientId: FAKE_EBAY_CLIENT_ID,
    ruName: FAKE_EBAY_RU_NAME,
    environment: "fake",
    apiBase: `${target.origin}/ebay/api`,
    mediaBase: `${target.origin}/ebay/apim`,
    // The consent page is the SPA's own testing route (`ebayAuthorizeUrl`).
    authBase: "",
    // Links the web builds use production hosts in fake mode.
    webBase: "https://www.ebay.com",
  };
}

/** The deployment's eBay wiring, or null when it is not configured. */
export function ebayConfig(env: BscEnv = process.env): EbayConfig | null {
  const environment = envValue("EBAY_ENVIRONMENT", env);
  if (environment === "fake") return fakeEbayConfig(env);
  const clientId = envValue("EBAY_CLIENT_ID", env);
  const ruName = envValue("EBAY_RU_NAME", env);
  if (!clientId || !ruName) return null;
  if (environment !== "sandbox" && environment !== "production") return null;
  const sandbox = environment === "sandbox";
  return {
    clientId,
    ruName,
    environment,
    apiBase: sandbox ? "https://api.sandbox.ebay.com" : "https://api.ebay.com",
    mediaBase: sandbox ? "https://apim.sandbox.ebay.com" : "https://apim.ebay.com",
    authBase: sandbox ? "https://auth.sandbox.ebay.com" : "https://auth.ebay.com",
    webBase: sandbox ? "https://www.sandbox.ebay.com" : "https://www.ebay.com",
  };
}

/** What `fakeBsc.ebayTarget` reports, for CI and wrapper checks. */
export type EbayTargetMode = "fake" | "sandbox" | "production" | "unconfigured";

/** Which eBay this deployment's calls reach, or "unconfigured" (none: nothing is sent). */
export function ebayTargetMode(env: BscEnv = process.env): EbayTargetMode {
  return ebayConfig(env)?.environment ?? "unconfigured";
}

/**
 * eBay's sandbox has no picture upload. The Media API reference says it
 * under Input on both upload methods, createImageFromFile and
 * createImageFromUrl: "This method is not supported in Sandbox environment."
 * (https://developer.ebay.com/develop/api/sell/media_api). Every well-formed
 * upload there answers 500 / errorId 190000, so a drain that tried would
 * never list a card.
 *
 * On the sandbox the eBay drain therefore uploads nothing and sends each
 * item with NB's fixed sandbox test picture instead
 * (`EBAY_SANDBOX_TEST_PICTURE_URL`). NB's own rule does not move: a card
 * whose copy has no photo is still held back (`noPhoto`) on both
 * environments; only the hand-off of that photo to eBay is skipped.
 * Production always uploads, and so does the fake (NEO-555: its Media API
 * works, there is no sandbox quirk to model). Read in one place, the drain's
 * photos step (`listingDrainEbay`).
 */
export function ebayHasPictureUpload(config: EbayConfig): boolean {
  return config.environment !== "sandbox";
}

/**
 * The one picture every item carries on eBay's SANDBOX, never production.
 * The sandbox has no picture upload (above), yet its Inventory API refuses
 * an item with no picture: `bulkCreateOrReplaceInventoryItem` answers
 * errorId 25717 "imageUrls cannot be null or empty." eBay's Inventory spec
 * lets `product.imageUrls` be self-hosted by the seller (HTTPS), so the
 * sandbox items point at this public NB-hosted image. It is a fictional
 * test card, never real NB data: nothing stores it as a card's picture
 * (the link's `images` stay empty) and it plays no part in the item's
 * content fingerprint. Production never reads it; it uploads the copy's
 * own photos. Read only where `ebayHasPictureUpload` is false.
 */
export const EBAY_SANDBOX_TEST_PICTURE_URL = "https://www.neonbinder.io/placeholder-fixtures/01-vorkle-front.jpg";

/** True when the deployment is wired to eBay. */
export function ebayConfigured(): boolean {
  return ebayConfig() !== null;
}

/**
 * eBay's consent URL for one Connect press. `state` is the server-minted
 * nonce `ebayConnect.completeConnect` checks. Shape per eBay's
 * authorization-code grant guide:
 * https://developer.ebay.com/api-docs/static/oauth-consent-request.html
 */
export function ebayAuthorizeUrl(config: EbayConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.ruName,
    response_type: "code",
    scope: EBAY_SCOPES.join(" "),
    state,
  });
  // Fake mode: the consent is this deployment's own testing page (relative,
  // same params, same bare-nonce state); it never leaves for an eBay host.
  if (config.environment === "fake") return `${FAKE_EBAY_AUTHORIZE_PATH}?${params.toString()}`;
  return `${config.authBase}/oauth2/authorize?${params.toString()}`;
}

/**
 * Seller conflicts (one NB owner per eBay account) are enforced everywhere
 * except a TESTING deployment on the eBay sandbox: the sandbox's identity
 * call can answer the same mock user for every sandbox seller, so there two
 * suite accounts would lock each other out for no real reason. Production
 * always enforces, and so does the fake: it gives every namespace and each of
 * its two sellers a distinct eBay account, so enforcement is the real rule.
 */
export function ebaySellerConflictsEnforced(): boolean {
  const config = ebayConfig();
  if (config?.environment === "sandbox" && process.env.TESTING_RESET_SECRET) return false;
  return true;
}
