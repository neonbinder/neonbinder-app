/**
 * Row 14: `POST ebay/api/identity/v1/oauth2/token` (CONTRACT.md, "Tokens").
 * A pure function of the Basic header and the form, so tests and the write
 * captures' synthesis call it without HTTP. Refusals are RFC 6749 bodies
 * (`{error, error_description}`), which is all NB reads of them.
 */
import { FAKE_EBAY_CLIENT_ID, FAKE_EBAY_CLIENT_SECRET, ACCESS_TOKEN_TTL_S, APP_TOKEN_TTL_S, REFRESH_TOKEN_TTL_S, type EbayTokens } from "./tokens";
import type { EbayAnswer } from "./synth";

const SCOPE_BASE = "https://api.ebay.com/oauth/api_scope";
/** NB's consented scopes (services/browser EBAY_SCOPES) and their read-only forms. */
export const ALLOWED_USER_SCOPES: ReadonlySet<string> = new Set([
  SCOPE_BASE,
  ...["sell.inventory", "sell.account", "sell.fulfillment"].flatMap((s) => [`${SCOPE_BASE}/${s}`, `${SCOPE_BASE}/${s}.readonly`]),
  `${SCOPE_BASE}/commerce.identity.readonly`,
]);
export const APP_SCOPE = SCOPE_BASE;

const refuse = (status: number, error: string, description: string): EbayAnswer => ({
  status,
  body: { error, error_description: description },
  headers: { "cache-control": "no-store" },
});

function basicPair(header: string | undefined): { id: string; secret: string } | null {
  if (!header) return null;
  const m = /^Basic\s+([A-Za-z0-9+/=]{1,1024})$/i.exec(header.trim());
  if (!m) return null;
  const raw = Buffer.from(m[1], "base64").toString("utf8");
  const i = raw.indexOf(":");
  return i < 0 ? null : { id: raw.slice(0, i), secret: raw.slice(i + 1) };
}

function scopesOk(raw: unknown, allowed: ReadonlySet<string>): boolean {
  if (raw === undefined) return true;
  if (typeof raw !== "string" || raw.length > 2000) return false;
  const list = raw.split(/\s+/).filter((s) => s.length > 0);
  return list.length > 0 && list.every((s) => allowed.has(s));
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 && v.length <= 4096 ? v : null);

export function tokenAnswer(tokens: EbayTokens, authorization: string | undefined, form: unknown): EbayAnswer {
  const pair = basicPair(authorization);
  if (!pair || pair.id !== FAKE_EBAY_CLIENT_ID || pair.secret !== FAKE_EBAY_CLIENT_SECRET) {
    return refuse(401, "invalid_client", "client authentication failed");
  }
  if (!form || typeof form !== "object" || Array.isArray(form)) return refuse(400, "invalid_request", "request is missing a required parameter");
  const f = form as Record<string, unknown>;
  const ok = (body: Record<string, unknown>): EbayAnswer => ({ status: 200, body, headers: { "cache-control": "no-store" } });
  switch (f.grant_type) {
    case "authorization_code": {
      const code = str(f.code);
      if (!code || !str(f.redirect_uri)) return refuse(400, "invalid_request", "request is missing a required parameter");
      const user = tokens.redeemCode(code);
      if (!user) return refuse(400, "invalid_grant", "the provided authorization grant code is invalid or was issued to another client");
      const t = tokens.mintUserTokens(user);
      return ok({
        access_token: t.accessToken,
        expires_in: ACCESS_TOKEN_TTL_S,
        refresh_token: t.refreshToken,
        refresh_token_expires_in: REFRESH_TOKEN_TTL_S,
        token_type: "User Access Token",
      });
    }
    case "refresh_token": {
      const rt = str(f.refresh_token);
      if (!rt) return refuse(400, "invalid_request", "request is missing a required parameter");
      if (!scopesOk(f.scope, ALLOWED_USER_SCOPES)) return refuse(400, "invalid_scope", "the requested scope is invalid, unknown, malformed, or exceeds the scope granted to the client");
      const user = tokens.userForRefresh(rt);
      if (!user) return refuse(400, "invalid_grant", "the provided authorization grant or refresh token is invalid, expired, revoked");
      return ok({ access_token: tokens.mintAccess(user), expires_in: ACCESS_TOKEN_TTL_S, token_type: "User Access Token" });
    }
    case "client_credentials": {
      if (!scopesOk(f.scope, new Set([APP_SCOPE]))) return refuse(400, "invalid_scope", "the requested scope is invalid, unknown, malformed, or exceeds the scope granted to the client");
      return ok({ access_token: tokens.mintApp(), expires_in: APP_TOKEN_TTL_S, token_type: "Application Access Token" });
    }
    case undefined:
      return refuse(400, "invalid_request", "request is missing a required parameter");
    default:
      return refuse(400, "unsupported_grant_type", "the authorization grant type is not supported");
  }
}
