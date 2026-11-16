/**
 * The eBay recorder's one door to real eBay (CONTRACT.md, "Recorder: eBay").
 *
 *   - Tokens: the refresh grant only (one user token per run) and one
 *     client-credentials token. Never the authorization-code grant, never
 *     the developer portal, never a consent page.
 *   - Paced: at most one call a second; at most `MAX_EBAY_CALLS` a run.
 *   - No retries. The first 401, 429, 5xx, timeout or network error stops the
 *     run (`EbayStop`). Only the production capture's cleanup may try again
 *     (`attempt`), at most three times, with one refresh grant on a 401.
 *   - Credentials and tokens live in this object only; nothing here logs,
 *     and an error carries a status and eBay's error ids, never a value.
 */

export type EbayEnv = "sandbox" | "production";
export type EbayHost = "api" | "apiz" | "apim";

export const EBAY_RECORDER_HOSTS: Readonly<Record<EbayEnv, Readonly<Record<EbayHost, string>>>> = Object.freeze({
  sandbox: Object.freeze({ api: "https://api.sandbox.ebay.com", apiz: "https://apiz.sandbox.ebay.com", apim: "https://apim.sandbox.ebay.com" }),
  production: Object.freeze({ api: "https://api.ebay.com", apiz: "https://apiz.ebay.com", apim: "https://apim.ebay.com" }),
});

/** NB's consented scopes (services/browser EBAY_SCOPES); the refresh grant asks for exactly these. */
export const EBAY_SCOPES: readonly string[] = Object.freeze([
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
]);
export const EBAY_APP_SCOPE = "https://api.ebay.com/oauth/api_scope";

export const MAX_EBAY_CALLS = 300;
export const MIN_EBAY_INTERVAL_MS = 1000;
export const EBAY_CALL_TIMEOUT_MS = 30_000;
/** Row 7's answer can be large; nothing else comes near. */
export const MAX_EBAY_BODY_BYTES = 32 * 1024 * 1024;

export interface EbayAppCredentials {
  clientId: string;
  certId: string;
  refreshToken: string;
}

export interface EbayResponse {
  status: number;
  /** Parsed JSON, or null (empty, or not JSON). */
  body: unknown;
  /** `Location`, when the answer carries one (media upload). */
  location: string | null;
}

export type StopReason = "unauthorized" | "rate_limited" | "server_error" | "timeout" | "network" | "too_large" | "cap" | "token_refused" | "token_malformed";

/** Ends the run. Carries only the call's label, status and eBay's error ids. */
export class EbayStop extends Error {
  constructor(
    readonly reason: StopReason,
    readonly label: string,
    readonly status: number,
    readonly errorIds: number[] = [],
  ) {
    super(`${label}: stopped (${reason}${status ? `, HTTP ${status}` : ""}${errorIds.length ? `, errorIds ${errorIds.join(",")}` : ""})`);
    this.name = "EbayStop";
  }
}

export interface EbayCall {
  /** Shown in the plan and in errors: method and path with no SKU or id values beyond the capture's own. */
  label: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  host: EbayHost;
  path: string;
  query?: Record<string, string>;
  json?: unknown;
  multipart?: { field: string; filename: string; contentType: string; bytes: Buffer };
  token: "user" | "app";
}

export interface EbayApiDeps {
  env: EbayEnv;
  creds: EbayAppCredentials;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  maxCalls?: number;
}

/** eBay's error ids from an error body (never anything else of it). */
export function errorIdsOf(body: unknown): number[] {
  const errs = body && typeof body === "object" ? (body as { errors?: unknown }).errors : undefined;
  if (!Array.isArray(errs)) return [];
  return errs.map((e) => (e && typeof e === "object" ? (e as { errorId?: unknown }).errorId : undefined)).filter((n): n is number => typeof n === "number").slice(0, 10);
}

function stopFor(status: number): StopReason | null {
  if (status === 401) return "unauthorized";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return null;
}

export class EbayApi {
  readonly env: EbayEnv;
  private readonly creds: EbayAppCredentials;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxCalls: number;
  private userToken: string | null = null;
  private appToken: string | null = null;
  private lastCallAt = -Infinity;
  private refreshGrants = 0;
  /** Calls made this run, token grants included. */
  calls = 0;

  constructor(deps: EbayApiDeps) {
    this.env = deps.env;
    this.creds = deps.creds;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxCalls = Math.min(deps.maxCalls ?? MAX_EBAY_CALLS, MAX_EBAY_CALLS);
  }

  /** Drops every credential and token this object holds. */
  forget(): void {
    this.creds.certId = "";
    this.creds.refreshToken = "";
    this.userToken = null;
    this.appToken = null;
  }

  private async pace(label: string): Promise<void> {
    if (this.calls >= this.maxCalls) throw new EbayStop("cap", label, 0);
    const wait = this.lastCallAt + MIN_EBAY_INTERVAL_MS - this.now();
    if (wait > 0) await this.sleep(wait);
    this.lastCallAt = this.now();
    this.calls += 1;
  }

  private async send(label: string, url: string, init: RequestInit): Promise<EbayResponse> {
    await this.pace(label);
    let res: Response;
    let buf: Buffer;
    try {
      res = await this.fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(EBAY_CALL_TIMEOUT_MS) });
      // Reading the body can fail or time out too (the deadline covers it).
      buf = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      // The cause carries the request (headers included): dropped.
      const name = err instanceof Error ? err.name : "";
      throw new EbayStop(name === "TimeoutError" || name === "AbortError" ? "timeout" : "network", label, 0);
    }
    if (buf.length > MAX_EBAY_BODY_BYTES) throw new EbayStop("too_large", label, res.status);
    let body: unknown = null;
    if (buf.length > 0) {
      try {
        body = JSON.parse(buf.toString("utf8"));
      } catch {
        body = null;
      }
    }
    return { status: res.status, body, location: res.headers.get("location") };
  }

  private async grant(label: string, form: Record<string, string>): Promise<string> {
    const basic = Buffer.from(`${this.creds.clientId}:${this.creds.certId}`).toString("base64");
    const r = await this.send(label, `${EBAY_RECORDER_HOSTS[this.env].api}/identity/v1/oauth2/token`, {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(form).toString(),
    });
    this.lastGrant = r;
    const stop = stopFor(r.status);
    if (stop) throw new EbayStop(stop, label, r.status);
    if (r.status !== 200) throw new EbayStop("token_refused", label, r.status);
    const t = r.body && typeof r.body === "object" ? (r.body as { access_token?: unknown }).access_token : undefined;
    if (typeof t !== "string" || t.length === 0 || t.length > 8192) throw new EbayStop("token_malformed", label, r.status);
    return t;
  }

  /** The last token answer, for its shape only (`ebay-capture` stores key paths, never values). */
  lastGrant: EbayResponse | null = null;

  /** The run's user token, by the refresh grant. A second grant is refused unless `regrant` allows it. */
  async grantUser(opts: { regrant?: boolean } = {}): Promise<EbayResponse> {
    if (this.refreshGrants >= (opts.regrant ? 2 : 1)) throw new Error("one refresh grant per run (two with the cleanup's single re-grant)");
    this.refreshGrants += 1;
    this.userToken = await this.grant("POST identity/v1/oauth2/token (refresh_token)", {
      grant_type: "refresh_token",
      refresh_token: this.creds.refreshToken,
      scope: EBAY_SCOPES.join(" "),
    });
    return this.lastGrant!;
  }

  async grantApp(): Promise<EbayResponse> {
    if (this.appToken) throw new Error("one app token per run");
    this.appToken = await this.grant("POST identity/v1/oauth2/token (client_credentials)", { grant_type: "client_credentials", scope: EBAY_APP_SCOPE });
    return this.lastGrant!;
  }

  /** One call, any status returned; still paced and capped. Network failures stop the run. */
  async attempt(call: EbayCall): Promise<EbayResponse> {
    const token = call.token === "user" ? this.userToken : this.appToken;
    if (!token) throw new Error(`${call.label}: no ${call.token} token (grant first)`);
    const url = new URL(`${EBAY_RECORDER_HOSTS[this.env][call.host]}${call.path}`);
    for (const [k, v] of Object.entries(call.query ?? {})) url.searchParams.set(k, v);
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "accept-language": "en-US",
      "content-language": "en-US",
      "x-ebay-c-marketplace-id": "EBAY_US",
    };
    let body: BodyInit | undefined;
    if (call.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(call.json);
    } else if (call.multipart) {
      const form = new FormData();
      form.append(call.multipart.field, new Blob([new Uint8Array(call.multipart.bytes)], { type: call.multipart.contentType }), call.multipart.filename);
      body = form;
    }
    return this.send(call.label, url.href, { method: call.method, headers, body });
  }

  /** One call; the first 401, 429 or 5xx stops the run. */
  async call(call: EbayCall): Promise<EbayResponse> {
    const r = await this.attempt(call);
    const stop = stopFor(r.status);
    if (stop) throw new EbayStop(stop, call.label, r.status, errorIdsOf(r.body));
    return r;
  }
}
