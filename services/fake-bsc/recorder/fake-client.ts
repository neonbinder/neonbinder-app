/**
 * The recorder's client for the fake, as the loader SA: a Google ID token
 * (ADC, impersonating the loader SA) in `X-Serverless-Authorization` for
 * Cloud Run IAM and again in `x-nb-fake-id-token` for the fake's own check,
 * the caller key, and the admin key for uploads.
 */
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
