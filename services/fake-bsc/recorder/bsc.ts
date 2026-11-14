/**
 * The recorder's only route to real BuySportsCards. Sign-in, the API base and
 * the API headers all come from services/browser's compiled modules
 * (CONTRACT.md, "Recorder sign-in"), forced to the REAL target: this file
 * names no BSC host and never reads NEONBINDER_FAKE_BSC_URL.
 */
import path from "node:path";

export interface BscTokens {
  token: string;
  expiresAt: number;
}

export interface BrowserModules {
  signIn(username: string, password: string): Promise<BscTokens>;
  apiBase: string;
  apiHeaders(token: string, opts?: { json?: boolean }): Record<string, string>;
}

type SignInResult = { tokens: { token: string; expiresAt: number } } | { error: string; credentialRejected?: boolean };

interface SignInModule {
  bscPasswordSignIn(input: { username: string; password: string; fetchOptions?: { env?: Record<string, string | undefined> } }): Promise<SignInResult>;
}
interface EndpointsModule {
  resolveBscEndpoints(env?: Record<string, string | undefined>): { target: string; apiBase: string };
  bscApiHeaders(token: string, opts?: { json?: boolean }): Record<string, string>;
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
  if (typeof signInMod.bscPasswordSignIn !== "function" || typeof endpointsMod.resolveBscEndpoints !== "function" || typeof endpointsMod.bscApiHeaders !== "function") {
    throw new Error("services/browser/dist does not export bscPasswordSignIn / resolveBscEndpoints / bscApiHeaders");
  }
  // An empty env: the real target, whatever the operator's shell holds.
  const real = endpointsMod.resolveBscEndpoints({});
  if (real.target !== "real") throw new Error("could not resolve the real BSC endpoints");
  return {
    apiBase: real.apiBase,
    apiHeaders: (token, opts) => endpointsMod.bscApiHeaders(token, opts),
    async signIn(username, password) {
      const r = await signInMod.bscPasswordSignIn({ username, password, fetchOptions: { env: {} } });
      if ("tokens" in r) return { token: r.tokens.token, expiresAt: r.tokens.expiresAt };
      // The sign-in's own error is already sanitised; still, say only what kind.
      throw new Error(r.credentialRejected ? "BSC rejected the credentials" : "BSC sign-in failed");
    },
  };
}
