/**
 * The recorder's client for the fake, as the loader SA: a Google ID token
 * (ADC, impersonating the loader SA) in `X-Serverless-Authorization` for
 * Cloud Run IAM and again in `x-nb-fake-id-token` for the fake's own check,
 * the caller key, and the admin key for uploads.
 */
import { readFile, stat } from "node:fs/promises";
import { GoogleAuth, Impersonated } from "google-auth-library";

export interface MissEntry {
  ns: string | null;
  /** Set when the miss came from a deployment prefix (the background lane). */
  prefix?: string;
  key: string;
  kind: "catalogue" | "needs-model";
  method: string;
  path: string;
  endpoint?: string;
  request?: { method: string; path: string; query: Array<[string, string]>; body?: unknown };
  count: number;
}

export interface FakeClientOptions {
  baseUrl: string;
  callerKey: string;
  adminKey: string;
  /** Mints an ID token for the fake's audience; null for a loopback fake with the local bypass. */
  idToken: (() => Promise<string>) | null;
  fetchImpl?: typeof fetch;
}

/** What `adcIdTokenMinter` needs of GoogleAuth (injectable for tests). */
export interface IdTokenAuth {
  getClient(): Promise<unknown>;
  getIdTokenClient(audience: string): Promise<{ idTokenProvider: { fetchIdToken(audience: string): Promise<string> } }>;
}

/**
 * Mints an ID token for the fake from ADC. Impersonated ADC (the loader SA,
 * as the README sets it up) leaves `email` out of the token unless asked, and
 * the fake's caller allowlist needs it: `includeEmail: true`. A service
 * account key or the metadata server include it already.
 */
export function adcIdTokenMinter(audience: string, auth: IdTokenAuth = new GoogleAuth()): () => Promise<string> {
  return async () => {
    const client = await auth.getClient();
    if (client instanceof Impersonated) return client.fetchIdToken(audience, { includeEmail: true });
    const idClient = await auth.getIdTokenClient(audience);
    return idClient.idTokenProvider.fetchIdToken(audience);
  };
}

const COMPACT_JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MAX_TOKEN_FILE_BYTES = 16 * 1024;

/**
 * The fake's ID token. When `FAKE_BSC_ID_TOKEN_FILE` is set (even to ""), the
 * token is read from that file on EVERY call (a watch session outlives a
 * one-hour token, so whatever refreshes the file is picked up), trimmed, and
 * checked before any header is built: a regular file under 16 KB; one compact
 * JWS (a stray CR/LF/NUL would make the HTTP client echo the whole token in
 * its error); `aud` equal to this fake's audience; `exp` in the future (the
 * payload is decoded, not verified: the fake verifies the signature). Errors
 * name the variable and never print the token, the audience or the path's
 * contents. A file readable by group or others only warns once. Nothing falls
 * back to ADC once the variable is set. Only an unset variable (`undefined`)
 * uses the ADC minter, unchanged.
 */
export function idTokenSource(
  audience: string,
  env: NodeJS.ProcessEnv = process.env,
  adc: (audience: string) => () => Promise<string> = adcIdTokenMinter,
  now: () => number = Date.now,
  warn: (line: string) => void = (l) => process.stderr.write(`${l}\n`),
): () => Promise<string> {
  const file = env.FAKE_BSC_ID_TOKEN_FILE;
  if (file === undefined) return adc(audience);
  let warned = false;
  return async () => {
    if (file === "") throw new Error("FAKE_BSC_ID_TOKEN_FILE is set but empty; unset it to use ADC");
    let raw: string;
    try {
      const st = await stat(file);
      if (!st.isFile()) throw new Error("not a regular file");
      if (st.size > MAX_TOKEN_FILE_BYTES) throw new Error("too large");
      if (!warned && (st.mode & 0o077) !== 0) {
        warned = true;
        warn("warning: FAKE_BSC_ID_TOKEN_FILE is readable by group or others; use mode 600");
      }
      raw = await readFile(file, "utf8");
    } catch {
      throw new Error("FAKE_BSC_ID_TOKEN_FILE is set but is not a readable regular file under 16 KB");
    }
    const token = raw.trim();
    if (!token) throw new Error("FAKE_BSC_ID_TOKEN_FILE is set but the file is empty");
    if (!COMPACT_JWS.test(token)) throw new Error("FAKE_BSC_ID_TOKEN_FILE does not hold a single ID token");
    let claims: { aud?: unknown; exp?: unknown };
    try {
      claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    } catch {
      throw new Error("FAKE_BSC_ID_TOKEN_FILE does not hold a single ID token");
    }
    if (claims === null || typeof claims !== "object" || claims.aud !== audience) {
      throw new Error("FAKE_BSC_ID_TOKEN_FILE holds a token for a different audience");
    }
    if (typeof claims.exp !== "number" || claims.exp * 1000 <= now()) {
      throw new Error("FAKE_BSC_ID_TOKEN_FILE holds an expired token");
    }
    return token;
  };
}

/**
 * The only https host the recorder will talk to: the fake's own Cloud Run
 * service, the same rule as the app side (CONTRACT.md "App seams"). Loopback
 * is allowed for a local fake. Anything else throws.
 */
const FAKE_BSC_HOST =
  /^neonbinder-fake-bsc-(?:[a-z0-9-]{0,42}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.run\.app$/;
export function assertFakeUrl(raw: string): void {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("--fake is not a URL"); }
  if (isLoopback(raw)) return;
  if (u.protocol !== "https:" || u.username || u.password || u.port || !FAKE_BSC_HOST.test(u.hostname)) {
    throw new Error("--fake must be the fake's own Cloud Run service (https, neonbinder-fake-bsc-*.run.app) or localhost");
  }
}

export function isLoopback(url: string): boolean {
  const h = new URL(url).hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

export class FakeClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: FakeClientOptions) {
    const u = new URL(opts.baseUrl);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && isLoopback(opts.baseUrl))) {
      throw new Error("the fake URL must be https (http only on localhost)");
    }
    this.base = u.origin;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async headers(admin: boolean): Promise<Record<string, string>> {
    const h: Record<string, string> = { "x-nb-fake-bsc-key": this.opts.callerKey, accept: "application/json" };
    if (admin) h["x-nb-fake-bsc-admin-key"] = this.opts.adminKey;
    if (this.opts.idToken) {
      const t = await this.opts.idToken();
      h["X-Serverless-Authorization"] = `Bearer ${t}`;
      h["x-nb-fake-id-token"] = t;
    }
    return h;
  }

  private async call(method: string, path: string, admin: boolean, body?: unknown): Promise<unknown> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: { ...(await this.headers(admin)), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const err = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
      // The fake's own error fields: reasons and paths, never values.
      throw new FakeCallError(res.status, typeof err.error === "string" ? err.error : "error", err);
    }
    return json;
  }

  async misses(prefix: string): Promise<MissEntry[]> {
    const out = (await this.call("GET", `/__fake/misses?prefix=${encodeURIComponent(prefix)}`, false)) as { misses?: unknown };
    return Array.isArray(out?.misses) ? (out.misses as MissEntry[]) : [];
  }

  /**
   * Every owner's misses (`GET /__fake/misses?all=1`, admin only), for a
   * session whose preview is gone (CONTRACT.md, "Durable misses").
   */
  async allMisses(): Promise<MissEntry[]> {
    return (await this.allMissesPage()).misses;
  }

  /**
   * `allMisses` with the fake's `truncated` flag: true when the fake had more
   * than it answers (its cap, oldest first). Recording some and reading again
   * reaches the rest.
   */
  async allMissesPage(): Promise<{ misses: MissEntry[]; truncated: boolean }> {
    const out = (await this.call("GET", "/__fake/misses?all=1", true)) as { misses?: unknown; truncated?: unknown };
    return { misses: Array.isArray(out?.misses) ? (out.misses as MissEntry[]) : [], truncated: out?.truncated === true };
  }

  async uploadRecording(recording: unknown): Promise<{ manifestVersion: number }> {
    return (await this.call("POST", "/__fake/recordings", true, { recordings: [recording] })) as { manifestVersion: number };
  }

  async uploadCapture(capture: unknown): Promise<{ verdict: string; paths: string[] }> {
    return (await this.call("POST", "/__fake/write-captures", true, capture)) as { verdict: string; paths: string[] };
  }
}

export class FakeCallError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    readonly detail: Record<string, unknown>,
  ) {
    super(`fake answered ${status}: ${reason}`);
  }
}
