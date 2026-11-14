/**
 * The recorder's only route to real BuySportsCards. Sign-in, the refresh
 * grant, the API base and the API headers all come from services/browser's
 * compiled modules
 * (CONTRACT.md, "Recorder sign-in"), forced to the REAL target: this file
 * names no BSC host and never reads NEONBINDER_FAKE_BSC_URL.
 */
import path from "node:path";
import type { RenewFailure, RenewResult } from "./record";

/**
 * A BSC token set, in memory only. SECURITY: `token` and `refreshToken` are
 * credentials: never logged, printed, written or uploaded.
 */
export interface BscTokens {
  token: string;
  expiresAt: number;
  refreshToken?: string;
  /** Absolute (from the password sign-in); past it only a new sign-in helps. */
  refreshExpiresAt?: number;
}

export type RefreshOutcome = { ok: true; tokens: BscTokens } | { ok: false; reason: RenewFailure };

export interface BrowserModules {
  signIn(username: string, password: string): Promise<BscTokens>;
  /** One B2C refresh grant against real BSC, never retried. */
  refresh(refreshToken: string): Promise<RefreshOutcome>;
  apiBase: string;
  apiHeaders(token: string, opts?: { json?: boolean }): Record<string, string>;
}

type Env = Record<string, string | undefined>;

interface TokenSetShape {
  token: string;
  expiresAt: number;
  refreshToken?: string;
  refreshExpiresAt?: number;
}
type SignInResult = { tokens: TokenSetShape } | { error: string; credentialRejected?: boolean };

/** services/browser's `bscRefreshGrant` answer (src/bsc-signin.ts). */
export type GrantResult =
  | { ok: true; tokens: TokenSetShape }
  | { ok: false; status: number; reason: "refused" | "rate_limited" | "server_error" | "unexpected_status" | "no_access_token"; reauthRequired: boolean };

interface SignInModule {
  bscPasswordSignIn(input: { username: string; password: string; fetchOptions?: { env?: Env } }): Promise<SignInResult>;
  bscRefreshGrant(input: { refreshToken: string; fetchOptions?: { env?: Env } }): Promise<GrantResult>;
}
interface EndpointsModule {
  resolveBscEndpoints(env?: Env): { target: string; apiBase: string };
  bscApiHeaders(token: string, opts?: { json?: boolean }): Record<string, string>;
}

/** Only the four fields the recorder keeps; drops SSO cookies and anything else. */
function keepTokens(t: TokenSetShape): BscTokens {
  return {
    token: t.token,
    expiresAt: t.expiresAt,
    ...(t.refreshToken ? { refreshToken: t.refreshToken } : {}),
    ...(t.refreshExpiresAt ? { refreshExpiresAt: t.refreshExpiresAt } : {}),
  };
}

/**
 * Runs services/browser's `bscRefreshGrant` once (the grant body lives there,
 * shared with the BSC adapter) and turns its answer into the recorder's fixed
 * reasons. Never retried. The grant lets a network failure or timeout throw;
 * that becomes `timeout` / `network` (`bad_body` for an unreadable 200).
 * Nothing here carries a token, a body or B2C's text.
 */
export async function runRefreshGrant(grant: () => Promise<GrantResult>): Promise<RefreshOutcome> {
  let r: GrantResult;
  try {
    r = await grant();
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") return { ok: false, reason: "timeout" };
    if (name === "SyntaxError") return { ok: false, reason: "bad_body" };
    return { ok: false, reason: "network" };
  }
  if (!r.ok) return { ok: false, reason: r.reason === "no_access_token" ? "bad_body" : r.reason };
  if (typeof r.tokens?.token !== "string" || !Number.isFinite(r.tokens.expiresAt)) return { ok: false, reason: "bad_body" };
  return { ok: true, tokens: keepTokens(r.tokens) };
}

/**
 * The session's tokens, held in memory: `token()` is what the next BSC call
 * sends, `renew()` runs one refresh grant and swaps in the new set (and the
 * rotated refresh token). It never retries; the recorder decides what a
 * failure means.
 */
export function bscSession(
  initial: BscTokens,
  refresh: (refreshToken: string) => Promise<RefreshOutcome>,
  now: () => number = Date.now,
): { token(): string; expiresAt(): number; renew(): Promise<RenewResult> } {
  let current: BscTokens = { ...initial };
  return {
    token: () => current.token,
    expiresAt: () => current.expiresAt,
    async renew() {
      const rt = current.refreshToken;
      if (!rt) return { ok: false, reason: "no_refresh_token" };
      if (current.refreshExpiresAt !== undefined && current.refreshExpiresAt <= now()) return { ok: false, reason: "refresh_expired" };
      const r = await refresh(rt);
      if (!r.ok) return r;
      current = {
        ...r.tokens,
        // B2C rotates it; keep the old one only if no new one came back.
        ...(r.tokens.refreshToken ? {} : { refreshToken: rt, ...(current.refreshExpiresAt !== undefined ? { refreshExpiresAt: current.refreshExpiresAt } : {}) }),
      };
      return { ok: true, expiresAt: current.expiresAt };
    },
  };
}

export function defaultBrowserDist(): string {
  // dist/recorder/bsc.js → services/browser/dist
  return path.resolve(__dirname, "..", "..", "..", "browser", "dist");
}

export function loadBrowserModules(distDir: string = defaultBrowserDist()): BrowserModules {
  let signInMod: SignInModule;
  let endpointsMod: EndpointsModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    signInMod = require(path.join(distDir, "bsc-signin.js")) as SignInModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    endpointsMod = require(path.join(distDir, "bsc-endpoints.js")) as EndpointsModule;
  } catch {
    throw new Error("services/browser is not built: run `npm ci && npm run build` in services/browser first");
  }
  if (
    typeof signInMod.bscPasswordSignIn !== "function" ||
    typeof signInMod.bscRefreshGrant !== "function" ||
    typeof endpointsMod.resolveBscEndpoints !== "function" ||
    typeof endpointsMod.bscApiHeaders !== "function"
  ) {
    throw new Error("services/browser/dist does not export bscPasswordSignIn / bscRefreshGrant / resolveBscEndpoints / bscApiHeaders (rebuild services/browser)");
  }
  // An empty env: the real target, whatever the operator's shell holds.
  const real = endpointsMod.resolveBscEndpoints({});
  if (real.target !== "real") throw new Error("could not resolve the real BSC endpoints");
  return {
    apiBase: real.apiBase,
    apiHeaders: (token, opts) => endpointsMod.bscApiHeaders(token, opts),
    async signIn(username, password) {
      const r = await signInMod.bscPasswordSignIn({ username, password, fetchOptions: { env: {} } });
      if ("tokens" in r) return keepTokens(r.tokens);
      // The sign-in's own error is already sanitised; still, say only what kind.
      throw new Error(r.credentialRejected ? "BSC rejected the credentials" : "BSC sign-in failed");
    },
    refresh(refreshToken) {
      // The same empty env: the grant goes to real BSC's authority.
      return runRefreshGrant(() => signInMod.bscRefreshGrant({ refreshToken, fetchOptions: { env: {} } }));
    },
  };
}
