/**
 * NEO-552: a synthesised copy of BuySportsCards' Azure AD B2C sign-in, enough
 * for services/browser's real sign-in code (bscPasswordSignIn, the refresh
 * grant and the silent SSO re-authorize) to run unchanged against it.
 *
 * Served under `<FAKE>/identity/<tenant>/<policy>/...`, the same path shape as
 * the real identity host (CONTRACT.md, "Paths"); this module sees the path
 * after the `/identity` mount:
 *
 *   GET  /<tenant>/<policy>/oauth2/v2.0/authorize   sign-in page with the
 *        `var SETTINGS = {...}` blob, or a silent 302 #code= when the request
 *        carries no forcing `prompt` and a live SSO cookie
 *   POST /<tenant>/<policy>/SelfAsserted?tx=&p=      {"status":"200"} or B2C's
 *        rejected-credentials envelope {"status":"400","message":...} (HTTP 200)
 *   GET  /<tenant>/<policy>/api/<api>/confirmed      302 redirect_uri#state=&code=
 *        plus the "Keep me signed in" SSO cookie when rememberMe=true
 *   POST /<tenant>/<policy>/oauth2/v2.0/token        authorization_code (PKCE
 *        S256 verified) and refresh_token (rotating) grants
 *
 * ACCOUNTS. The username names the namespace (`nb+<ns>@fake.invalid`, read by
 * the injected `namespaceFromUsername`, the server's own src/namespace.ts).
 * `fake-bsc-password` signs in; anything else, `wrong-password` included, gets
 * the rejected-credentials answer.
 *
 * TOKENS ARE STATELESS (the fake runs min 0 / max 1 and restarts after every
 * idle gap). Access tokens, refresh tokens, auth codes and SSO cookies are
 * sealed payloads `{k: kind, ns, exp, iat, rot?, ...}`: AES-256-GCM, whose
 * auth tag is the MAC, under a key derived (HKDF) from `tokenSecret`, which
 * the server sets from FAKE_BSC_ADMIN_KEY. Verifying = decrypting with a valid
 * tag; nothing is looked up, so a token minted before a restart validates
 * after it. GCM rather than a bare HMAC keeps them opaque to callers
 * (CONTRACT.md: "Tokens are opaque"). Refresh rotation is lenient: any
 * unexpired, validly sealed refresh token for the client works, and each
 * grant mints a new one with `rot` + 1 (replay protection is not a goal).
 * Lifetimes match real BSC: access 3600 s, refresh window 86400 s ABSOLUTE from
 * the sign-in that opened it (rotation never extends it), SSO cookie ~62 days
 * and re-issued (sliding) on every silent authorize. Auth codes, sign-in
 * Only the sign-in page's transaction (minutes long), a best-effort spent-code
 * set and resetIdentity's revocations are in memory, and bounded.
 *
 * Pure: node builtins only, no Express, no relative imports, and only
 * erasable TypeScript, so services/browser's contract test can load this file
 * with Node's type stripping and drive it with its real sign-in code.
 *
 * SECURITY: nothing here logs a password, token, code, csrf value or cookie.
 * The injected `log` receives an operation name and an outcome, plus the
 * namespace (a test-run label, not a secret).
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export const FAKE_BSC_PASSWORD = "fake-bsc-password";
export const FAKE_BSC_WRONG_PASSWORD = "wrong-password";

/** Real BSC: `expires_in` on both grants. */
export const ACCESS_TOKEN_TTL_S = 3600;
/** Real BSC: `refresh_token_expires_in` at sign-in; absolute, never extended. */
export const REFRESH_WINDOW_S = 86400;
/** Real BSC's "Keep me signed in" cookie, about 62 days. */
export const SSO_COOKIE_TTL_S = 62 * 86400;
/** An auth code must be redeemed within this. */
export const AUTH_CODE_TTL_S = 300;
/** A sign-in page's transaction lives this long. */
export const TRANSACTION_TTL_S = 900;

/** Prefix the browser's cookie jar keys on (`x-ms-cpim-sso`). */
export const SSO_COOKIE_NAME = "x-ms-cpim-sso:fake-bsc_0";
const CSRF_COOKIE = "x-ms-cpim-csrf";
const TRANS_COOKIE = "x-ms-cpim-trans";

const MAX_TRANSACTIONS = 5000;
const MAX_SPENT_CODES = 20000;
const MAX_BODY_BYTES = 16 * 1024;

/** B2C's answer to a password it rejected. Never echoes the username. */
export const REJECTED_CREDENTIALS_BODY = {
  status: "400",
  message: "Your password is incorrect.",
};

export interface FakeIdentityOptions {
  /** Seals tokens; tokens survive restarts while this is stable. Default random. */
  tokenSecret?: string;
  /** The server's namespace parser (src/namespace.ts). Null = not a fake account. */
  namespaceFromUsername: (username: string) => string | null;
  now?: () => number;
  log?: (operation: string, fields: Record<string, string | number | boolean | null>) => void;
}

export interface FakeIdentity {
  /** Node/Express handler. Calls `next()` (or answers 404) for a path it does not serve. */
  handle: (
    req: IncomingMessage & { body?: unknown },
    res: ServerResponse,
    next?: (err?: unknown) => void,
  ) => void;
  /** The namespace a live access token belongs to; null for anything else. */
  namespaceForToken: (token: string | null | undefined) => string | null;
  /**
   * Drop sessions and tokens for the selected namespaces (`{}` = all): every
   * token, refresh token and SSO cookie issued to them before now stops
   * working (auth codes included), and their sign-in pages are forgotten. For
   * `/__fake/reset-all` only. Revocations are in memory (a restart forgets
   * them; tokens then expire on their own clocks).
   */
  reset: (sel?: { ns?: string; prefix?: string }) => void;
}

interface Transaction {
  transId: string;
  transCookie: string;
  csrf: string;
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string | null;
  scope: string;
  expiresAt: number;
  ns: string | null;
}

interface AuthCodeInput {
  ns: string;
  clientId: string;
  redirectUri: string;
  challenge: string;
  scope: string;
  /** Absolute end of the refresh window this code opens. */
  windowEnd: number;
}

type TokenKind = "at" | "rt" | "id" | "sso" | "code";

interface SealedPayload {
  k: TokenKind;
  ns: string;
  /** Expiry, epoch ms. */
  exp: number;
  /** Issued at, epoch ms (revocation by resetIdentity). */
  iat: number;
  /** Rotation counter: 0 at sign-in, +1 per refresh grant (refresh tokens). */
  rot?: number;
  /** Client id a refresh token or code was issued to. */
  cid?: string;
  /** Scope a refresh token or code was issued for. */
  scp?: string;
  /** Code only: the redirect_uri it is bound to. */
  ru?: string;
  /** Code only: the PKCE S256 challenge it is bound to. */
  ch?: string;
  /** Code only: the refresh window end the exchange opens (epoch ms). */
  win?: number;
}

function base64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function pruneOldest<V>(map: Map<string, V>, max: number): void {
  while (map.size > max) {
    const first = map.keys().next().value;
    if (first === undefined) return;
    map.delete(first);
  }
}

function parseCookies(header: string | string[] | undefined): Map<string, string> {
  const out = new Map<string, string>();
  const raw = Array.isArray(header) ? header.join("; ") : header ?? "";
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    out.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  return out;
}

function htmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

/** JSON safe to drop inside a <script> block (no `</script>`, no `};` inside strings). */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/;/g, "\\u003b");
}

function readBody(req: IncomingMessage & { body?: unknown }): Promise<URLSearchParams> {
  const pre = req.body;
  if (pre !== undefined && pre !== null) {
    if (typeof pre === "string") return Promise.resolve(new URLSearchParams(pre));
    if (Buffer.isBuffer(pre)) return Promise.resolve(new URLSearchParams(pre.toString("utf8")));
    if (typeof pre === "object") {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(pre as Record<string, unknown>)) {
        if (typeof v === "string") params.set(k, v);
      }
      // An upstream parser that found nothing leaves `{}`: fall through to the stream.
      if ([...params.keys()].length > 0 || req.readableEnded) return Promise.resolve(params);
    }
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(new URLSearchParams(Buffer.concat(chunks).toString("utf8"))));
    req.on("error", reject);
  });
}

const PKCE_VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
const PKCE_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

export function createFakeIdentity(opts: FakeIdentityOptions): FakeIdentity {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? (() => {});
  const secret = opts.tokenSecret && opts.tokenSecret.length > 0 ? opts.tokenSecret : base64Url(randomBytes(32));
  const key = Buffer.from(
    hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.from("neo-552-fake-bsc"), Buffer.from("identity-token-v2"), 32),
  );

  const transactions = new Map<string, Transaction>();
  /** Best effort, per instance: a code is single-use until a restart. */
  const spentCodes = new Map<string, number>();
  /** resetIdentity revocations: a token issued at or before `at` is dead. */
  let revokedAllAt = 0;
  const revokedNsAt = new Map<string, number>();
  const revokedPrefixAt = new Map<string, number>();
  const MAX_REVOCATIONS = 5000;
  const revoked = (ns: string, iat: number): boolean => {
    if (iat <= revokedAllAt) return true;
    const exact = revokedNsAt.get(ns);
    if (exact !== undefined && iat <= exact) return true;
    for (const [prefix, at] of revokedPrefixAt) if (ns.startsWith(prefix) && iat <= at) return true;
    return false;
  };

  const seal = (unstamped: Omit<SealedPayload, "iat">): string => {
    const payload: SealedPayload = { ...unstamped, iat: now() };
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
    return base64Url(Buffer.concat([iv, ct, cipher.getAuthTag()]));
  };

  const unseal = (token: string, kind: TokenKind): SealedPayload | null => {
    const raw = fromBase64Url(token);
    if (!raw || raw.length < 12 + 16 + 2) return null;
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(raw.length - 16));
      const pt = Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]);
      const payload = JSON.parse(pt.toString("utf8")) as SealedPayload;
      if (payload.k !== kind || typeof payload.ns !== "string" || typeof payload.exp !== "number") return null;
      if (payload.exp <= now()) return null;
      if (typeof payload.iat !== "number" || revoked(payload.ns, payload.iat)) return null;
      return payload;
    } catch {
      return null;
    }
  };

  const pruneExpired = (): void => {
    const t = now();
    for (const [id, tx] of transactions) if (tx.expiresAt <= t) transactions.delete(id);
    for (const [id, exp] of spentCodes) if (exp <= t) spentCodes.delete(id);
  };

  const cookie = (name: string, value: string, maxAgeS: number): string =>
    `${name}=${value}; Max-Age=${maxAgeS}; Path=/; Secure; HttpOnly; SameSite=None`;
  const clearCookie = (name: string): string =>
    `${name}=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Secure; HttpOnly; SameSite=None`;

  const redirectWith = (
    res: ServerResponse,
    redirectUri: string,
    params: Record<string, string>,
    setCookies: string[] = [],
  ): void => {
    const fragment = new URLSearchParams(params).toString();
    res.statusCode = 302;
    res.setHeader("Location", `${redirectUri}#${fragment}`);
    res.setHeader("Cache-Control", "no-store");
    if (setCookies.length > 0) res.setHeader("Set-Cookie", setCookies);
    res.end();
  };

  const sendJson = (res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
    res.end(JSON.stringify(body));
  };

  const sendText = (res: ServerResponse, status: number, text: string): void => {
    res.statusCode = status;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(text);
  };

  const issueCode = (input: AuthCodeInput): string =>
    seal({
      k: "code",
      ns: input.ns,
      exp: now() + AUTH_CODE_TTL_S * 1000,
      cid: input.clientId,
      ru: input.redirectUri,
      ch: input.challenge,
      scp: input.scope,
      win: input.windowEnd,
    });

  const tokenResponse = (
    ns: string,
    clientId: string,
    scope: string,
    windowEnd: number,
    rotation: number,
  ): Record<string, unknown> => {
    const t = now();
    const nowS = Math.floor(t / 1000);
    const accessToken = seal({ k: "at", ns, exp: t + ACCESS_TOKEN_TTL_S * 1000 });
    const idToken = seal({ k: "id", ns, exp: t + ACCESS_TOKEN_TTL_S * 1000 });
    const refreshToken = seal({ k: "rt", ns, exp: windowEnd, rot: rotation, cid: clientId, scp: scope });
    return {
      access_token: accessToken,
      id_token: idToken,
      token_type: "Bearer",
      not_before: nowS,
      expires_in: ACCESS_TOKEN_TTL_S,
      expires_on: nowS + ACCESS_TOKEN_TTL_S,
      id_token_expires_in: ACCESS_TOKEN_TTL_S,
      scope,
      refresh_token: refreshToken,
      refresh_token_expires_in: Math.max(0, Math.floor((windowEnd - t) / 1000)),
    };
  };

  // --- GET .../oauth2/v2.0/authorize --------------------------------------
  const authorize = (req: IncomingMessage, res: ServerResponse, base: string, query: URLSearchParams): void => {
    const clientId = query.get("client_id") ?? "";
    const redirectUri = query.get("redirect_uri") ?? "";
    const responseType = query.get("response_type") ?? "";
    const challenge = query.get("code_challenge") ?? "";
    const method = query.get("code_challenge_method") ?? "";
    const state = query.get("state");
    const prompt = query.get("prompt");
    const scope = query.get("scope") ?? "";

    let redirectOk = false;
    try {
      const u = new URL(redirectUri);
      redirectOk = u.protocol === "https:" || u.protocol === "http:";
    } catch {
      redirectOk = false;
    }
    if (!clientId || !redirectOk) {
      log("identity_authorize", { outcome: "invalid_request" });
      sendText(res, 400, "AADB2C90079: invalid client_id or redirect_uri");
      return;
    }
    const errorParams = (error: string): Record<string, string> =>
      state === null ? { error } : { error, state };
    if (responseType !== "code" || method !== "S256" || !PKCE_CHALLENGE_RE.test(challenge)) {
      log("identity_authorize", { outcome: "invalid_request" });
      redirectWith(res, redirectUri, errorParams("invalid_request"));
      return;
    }

    // Silent path: no forcing prompt and a live SSO cookie.
    const forcing = prompt === "login" || prompt === "select_account";
    const sso = parseCookies(req.headers.cookie).get(SSO_COOKIE_NAME);
    const session = !forcing && sso ? unseal(sso, "sso") : null;
    if (session) {
      const code = issueCode({
        ns: session.ns,
        clientId,
        redirectUri,
        challenge,
        scope,
        windowEnd: now() + REFRESH_WINDOW_S * 1000,
      });
      log("identity_authorize", { outcome: "silent_code", ns: session.ns });
      const params: Record<string, string> = state === null ? { code } : { state, code };
      redirectWith(res, redirectUri, params, [
        cookie(SSO_COOKIE_NAME, seal({ k: "sso", ns: session.ns, exp: now() + SSO_COOKIE_TTL_S * 1000 }), SSO_COOKIE_TTL_S),
        clearCookie(TRANS_COOKIE),
      ]);
      return;
    }
    if (prompt === "none") {
      log("identity_authorize", { outcome: "interaction_required" });
      redirectWith(res, redirectUri, errorParams("interaction_required"));
      return;
    }

    // The sign-in page.
    pruneExpired();
    const transCookie = base64Url(randomBytes(24));
    const transId = `StateProperties=${base64Url(randomBytes(24))}`;
    const csrf = base64Url(randomBytes(32));
    transactions.set(transId, {
      transId,
      transCookie,
      csrf,
      clientId,
      redirectUri,
      challenge,
      state,
      scope,
      expiresAt: now() + TRANSACTION_TTL_S * 1000,
      ns: null,
    });
    pruneOldest(transactions, MAX_TRANSACTIONS);

    const tenantPolicy = base;
    const policy = base.split("/").filter(Boolean)[1] ?? "";
    const settings = {
      remoteResource: `${tenantPolicy}/fake-page/signin`,
      retryLimit: 3,
      trimSpacesInPassword: true,
      api: "SelfAsserted",
      csrf,
      transId,
      pageViewId: base64Url(randomBytes(16)),
      suppressElementCss: false,
      isPageViewIdSentWithHeader: false,
      allowAutoFocusOnPasswordField: true,
      pageMode: 0,
      config: { showSignupLink: "False", forgotPasswordLinkLocation: "AfterLabel", enableRememberMe: "True" },
      hosts: { tenant: tenantPolicy, policy, static: "/identity/static/" },
      locale: { lang: "en" },
    };
    const html =
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sign in</title></head><body>` +
      `<form id="localAccountForm"><label for="signInName">Email Address</label>` +
      `<input type="email" id="signInName" name="signInName">` +
      `<label for="password">Password</label><input type="password" id="password" name="password">` +
      `<button id="next" type="submit">Sign in</button></form>` +
      `<script>var SETTINGS = ${scriptJson(settings)};</script>` +
      `<!-- fake BSC identity: ${htmlEscape(policy)} --></body></html>`;
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Set-Cookie", [cookie(CSRF_COOKIE, csrf, TRANSACTION_TTL_S), cookie(TRANS_COOKIE, transCookie, TRANSACTION_TTL_S)]);
    log("identity_authorize", { outcome: "form" });
    res.end(html);
  };

  /** The transaction a SelfAsserted/confirmed request names, with its cookies checked. */
  const transactionFor = (req: IncomingMessage, tx: string | null, csrf: string | null): Transaction | null => {
    if (!tx || !csrf) return null;
    const t = transactions.get(tx);
    if (!t || t.expiresAt <= now()) return null;
    const cookies = parseCookies(req.headers.cookie);
    if (!safeEqual(csrf, t.csrf)) return null;
    if (!safeEqual(cookies.get(CSRF_COOKIE) ?? "", t.csrf)) return null;
    if (!safeEqual(cookies.get(TRANS_COOKIE) ?? "", t.transCookie)) return null;
    return t;
  };

  // --- POST .../SelfAsserted ----------------------------------------------
  const selfAsserted = async (req: IncomingMessage & { body?: unknown }, res: ServerResponse, query: URLSearchParams): Promise<void> => {
    const csrfHeader = req.headers["x-csrf-token"];
    const t = transactionFor(req, query.get("tx"), typeof csrfHeader === "string" ? csrfHeader : null);
    if (!t) {
      // Not B2C's envelope on purpose: a lost or forged transaction is an
      // integration fault, which the client must not read as "wrong password".
      log("identity_self_asserted", { outcome: "bad_transaction" });
      sendText(res, 400, "AADB2C90118: the sign-in transaction is not valid");
      return;
    }
    const form = await readBody(req);
    if (form.get("request_type") !== "RESPONSE") {
      log("identity_self_asserted", { outcome: "bad_request_type" });
      sendText(res, 400, "AADB2C: unsupported request_type");
      return;
    }
    const username = form.get("signInName") ?? "";
    const password = form.get("password") ?? "";
    const ns = opts.namespaceFromUsername(username);
    if (!ns || !safeEqual(password, FAKE_BSC_PASSWORD)) {
      log("identity_self_asserted", {
        outcome: "rejected",
        reason: !ns ? "not_a_fake_account" : password === FAKE_BSC_WRONG_PASSWORD ? "wrong_password" : "bad_password",
      });
      sendJson(res, 200, REJECTED_CREDENTIALS_BODY);
      return;
    }
    t.ns = ns;
    log("identity_self_asserted", { outcome: "accepted", ns });
    sendJson(res, 200, { status: "200" });
  };

  // --- GET .../api/<api>/confirmed ----------------------------------------
  const confirmed = (req: IncomingMessage, res: ServerResponse, query: URLSearchParams): void => {
    const t = transactionFor(req, query.get("tx"), query.get("csrf_token"));
    if (!t) {
      log("identity_confirmed", { outcome: "bad_transaction" });
      sendText(res, 400, "AADB2C90118: the sign-in transaction is not valid");
      return;
    }
    transactions.delete(t.transId);
    if (!t.ns) {
      log("identity_confirmed", { outcome: "not_signed_in" });
      redirectWith(res, t.redirectUri, t.state === null ? { error: "access_denied" } : { error: "access_denied", state: t.state });
      return;
    }
    const code = issueCode({
      ns: t.ns,
      clientId: t.clientId,
      redirectUri: t.redirectUri,
      challenge: t.challenge,
      scope: t.scope,
      windowEnd: now() + REFRESH_WINDOW_S * 1000,
    });
    const setCookies = [clearCookie(TRANS_COOKIE)];
    if (query.get("rememberMe") === "true") {
      setCookies.push(cookie(SSO_COOKIE_NAME, seal({ k: "sso", ns: t.ns, exp: now() + SSO_COOKIE_TTL_S * 1000 }), SSO_COOKIE_TTL_S));
    }
    log("identity_confirmed", { outcome: "code", ns: t.ns, remember_me: query.get("rememberMe") === "true" });
    redirectWith(res, t.redirectUri, t.state === null ? { code } : { state: t.state, code }, setCookies);
  };

  // --- POST .../oauth2/v2.0/token -----------------------------------------
  const token = async (req: IncomingMessage & { body?: unknown }, res: ServerResponse): Promise<void> => {
    const form = await readBody(req);
    const grant = form.get("grant_type");
    const clientId = form.get("client_id") ?? "";
    const invalidGrant = (description: string, reason: string): void => {
      log("identity_token", { outcome: "invalid_grant", grant: grant ?? "(none)", reason });
      sendJson(res, 400, { error: "invalid_grant", error_description: description });
    };
    if (!clientId) {
      log("identity_token", { outcome: "invalid_request", grant: grant ?? "(none)" });
      sendJson(res, 400, { error: "invalid_request", error_description: "AADB2C90058: client_id is missing." });
      return;
    }

    if (grant === "authorization_code") {
      const codeValue = form.get("code") ?? "";
      const code = unseal(codeValue, "code");
      if (!code || typeof code.win !== "number") return invalidGrant("AADB2C90080: The provided grant has expired.", "code");
      // Best-effort single use: spent whether or not the rest checks out.
      const codeId = createHash("sha256").update(codeValue).digest("hex");
      if (spentCodes.has(codeId)) return invalidGrant("AADB2C90080: The provided grant has expired.", "code_spent");
      pruneExpired();
      spentCodes.set(codeId, code.exp);
      pruneOldest(spentCodes, MAX_SPENT_CODES);
      if (code.cid !== clientId) return invalidGrant("AADB2C90088: The provided grant was not issued for this client.", "client");
      if ((form.get("redirect_uri") ?? "") !== code.ru) {
        return invalidGrant("AADB2C90006: The redirect URI does not match.", "redirect_uri");
      }
      const verifier = form.get("code_verifier") ?? "";
      const computed = PKCE_VERIFIER_RE.test(verifier)
        ? base64Url(createHash("sha256").update(verifier).digest())
        : "";
      if (!computed || !safeEqual(computed, code.ch ?? "")) {
        return invalidGrant("AADB2C90183: The supplied code_verifier is invalid.", "pkce");
      }
      log("identity_token", { outcome: "issued", grant, ns: code.ns });
      sendJson(res, 200, tokenResponse(code.ns, clientId, form.get("scope") ?? code.scp ?? "", code.win, 0));
      return;
    }

    if (grant === "refresh_token") {
      const presented = unseal(form.get("refresh_token") ?? "", "rt");
      if (!presented) return invalidGrant("AADB2C90080: The provided grant has expired.", "refresh_token");
      if (presented.cid !== clientId) return invalidGrant("AADB2C90088: The provided grant was not issued for this client.", "client");
      // Lenient rotation: a fresh refresh token every time (rot + 1, same
      // absolute window), but an earlier one is not refused.
      const rotation = (typeof presented.rot === "number" ? presented.rot : 0) + 1;
      log("identity_token", { outcome: "issued", grant, ns: presented.ns, rotation });
      sendJson(res, 200, tokenResponse(presented.ns, clientId, form.get("scope") ?? presented.scp ?? "", presented.exp, rotation));
      return;
    }

    log("identity_token", { outcome: "unsupported_grant_type" });
    sendJson(res, 400, { error: "unsupported_grant_type", error_description: "AADB2C90086: The supplied grant_type is not supported." });
  };

  const ROUTE = /^(\/[^/]+\/[^/]+)\/(oauth2\/v2\.0\/authorize|oauth2\/v2\.0\/token|SelfAsserted|api\/([^/]+)\/confirmed)$/i;

  const handle: FakeIdentity["handle"] = (req, res, next) => {
    const notMine = (): void => {
      if (next) next();
      else sendText(res, 404, "not found");
    };
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://fake.invalid");
    } catch {
      notMine();
      return;
    }
    const m = ROUTE.exec(url.pathname);
    if (!m) {
      notMine();
      return;
    }
    const base = m[1];
    const which = m[2].toLowerCase();
    const method = (req.method ?? "GET").toUpperCase();
    // `p` names the policy the same way the path does (case-insensitive).
    const p = url.searchParams.get("p");
    const pathPolicy = base.split("/").filter(Boolean)[1] ?? "";
    if (p !== null && p.toLowerCase() !== pathPolicy.toLowerCase()) {
      sendText(res, 400, "AADB2C90091: policy mismatch");
      return;
    }

    const run = async (): Promise<void> => {
      if (which === "oauth2/v2.0/authorize" && method === "GET") return authorize(req, res, base, url.searchParams);
      if (which === "selfasserted" && method === "POST") return selfAsserted(req, res, url.searchParams);
      if (which.startsWith("api/") && method === "GET") return confirmed(req, res, url.searchParams);
      if (which === "oauth2/v2.0/token" && method === "POST") return token(req, res);
      sendText(res, 405, "method not allowed");
    };
    run().catch(() => {
      log("identity_error", { outcome: "exception" });
      if (!res.headersSent) sendText(res, 400, "bad request");
      else res.end();
    });
  };

  const namespaceForToken: FakeIdentity["namespaceForToken"] = (raw) => {
    if (typeof raw !== "string") return null;
    const bare = raw.replace(/^\s*Bearer\s+/i, "").trim();
    if (!bare) return null;
    return unseal(bare, "at")?.ns ?? null;
  };

  const reset: FakeIdentity["reset"] = (sel = {}) => {
    const t = now();
    const selected = (ns: string | null): boolean =>
      ns !== null &&
      (sel.ns !== undefined ? ns === sel.ns : sel.prefix !== undefined ? ns.startsWith(sel.prefix) : true);
    if (sel.ns === undefined && sel.prefix === undefined) {
      revokedAllAt = t;
      revokedNsAt.clear();
      revokedPrefixAt.clear();
      transactions.clear();
      spentCodes.clear();
    } else {
      if (sel.ns !== undefined) revokedNsAt.set(sel.ns, t);
      else if (sel.prefix !== undefined) revokedPrefixAt.set(sel.prefix, t);
      pruneOldest(revokedNsAt, MAX_REVOCATIONS);
      pruneOldest(revokedPrefixAt, MAX_REVOCATIONS);
      for (const [id, tx] of transactions) if (selected(tx.ns)) transactions.delete(id);
    }
    log("identity_reset", { scope: sel.ns !== undefined ? "ns" : sel.prefix !== undefined ? "prefix" : "all" });
  };

  return { handle, namespaceForToken, reset };
}
