/**
 * Who may call the fake (CONTRACT.md, "Who may call it" and "Auth details").
 *
 *   1. Cloud Run IAM (outside this process).
 *   2. `x-nb-fake-bsc-key` equals FAKE_BSC_CALLER_KEY.
 *   3. The caller's Google identity is on FAKE_BSC_ALLOWED_CALLERS. It comes
 *      only from the signed Google ID token in `x-nb-fake-id-token`, whose
 *      signature this process verifies itself (audience FAKE_BSC_AUDIENCE).
 *      `X-Serverless-Authorization` is Cloud Run IAM's (rule 1) and is never
 *      read here: Cloud Run strips its signature, so its claims could be
 *      forged the day IAM stops checking it.
 *   4. Admin endpoints also need `x-nb-fake-bsc-admin-key` and a caller on
 *      FAKE_BSC_ADMIN_CALLERS.
 *
 * Fails closed: any doubt is a 401/403. Nothing here logs a token or a key.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import type { FakeConfig } from "./config";
import { log } from "./log";

export interface IdTokenClaims {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  email?: unknown;
  email_verified?: unknown;
}

/** Verifies a signed Google ID token; null when it does not verify. */
export type IdTokenVerifier = (token: string, audience: string) => Promise<IdTokenClaims | null>;

const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

export function googleIdTokenVerifier(): IdTokenVerifier {
  const client = new OAuth2Client();
  return async (token, audience) => {
    try {
      const ticket = await client.verifyIdToken({ idToken: token, audience });
      return (ticket.getPayload() as IdTokenClaims | undefined) ?? null;
    } catch {
      return null;
    }
  };
}

export function keysEqual(given: unknown, expected: string): boolean {
  if (typeof given !== "string" || given.length === 0) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export type IdentityOutcome = { ok: true; email: string } | { ok: false; reason: string };

/** The header carrying the caller's signed Google ID token (Cloud Run leaves it alone). */
export const ID_TOKEN_HEADER = "x-nb-fake-id-token";

/**
 * The caller's verified email, from the signed ID token in
 * `x-nb-fake-id-token` (a bare JWT, or `Bearer <jwt>`). The signature is
 * always verified here against FAKE_BSC_AUDIENCE; an unsigned token is
 * refused wherever the process runs. The claims are checked again after.
 */
export async function callerIdentity(
  header: string | undefined,
  config: Pick<FakeConfig, "audience">,
  verify: IdTokenVerifier,
  now: number = Date.now(),
): Promise<IdentityOutcome> {
  if (!header) return { ok: false, reason: "no_id_token" };
  if (header.length > 8192) return { ok: false, reason: "malformed_id_token" };
  const m = /^(?:Bearer\s+)?([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(header.trim());
  if (!m) return { ok: false, reason: "malformed_id_token" };
  if (!config.audience) return { ok: false, reason: "no_audience_configured" };
  const claims = await verify(`${m[1]}.${m[2]}.${m[3]}`, config.audience);
  if (!claims) return { ok: false, reason: "id_token_not_verified" };
  if (typeof claims.iss !== "string" || !GOOGLE_ISSUERS.has(claims.iss)) return { ok: false, reason: "bad_issuer" };
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return { ok: false, reason: "expired" };
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const wanted = config.audience.replace(/\/+$/, "");
  if (!auds.some((a) => typeof a === "string" && a.replace(/\/+$/, "") === wanted)) return { ok: false, reason: "bad_audience" };
  if (claims.email_verified !== true) return { ok: false, reason: "email_not_verified" };
  if (typeof claims.email !== "string" || claims.email.length > 320) return { ok: false, reason: "no_email" };
  return { ok: true, email: claims.email.toLowerCase() };
}

export interface Caller {
  email: string;
}

export function callerOf(res: Response): Caller | null {
  return (res.locals.caller as Caller | undefined) ?? null;
}

/** Rules 2 and 3. Sets `res.locals.caller`. */
export function requireCaller(config: FakeConfig, verify: IdTokenVerifier) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!keysEqual(req.get("x-nb-fake-bsc-key"), config.callerKey)) {
      log("auth_refused", { reason: "caller_key", path: req.path });
      res.status(401).json({ error: "unauthorised" });
      return;
    }
    if (config.localDevBypass) {
      res.locals.caller = { email: "local-dev" } satisfies Caller;
      next();
      return;
    }
    const id = await callerIdentity(req.get(ID_TOKEN_HEADER), config, verify);
    if (!id.ok) {
      log("auth_refused", { reason: id.reason, path: req.path });
      res.status(401).json({ error: "unauthorised" });
      return;
    }
    if (!config.allowedCallers.has(id.email)) {
      log("auth_refused", { reason: "caller_not_allowed", path: req.path });
      res.status(403).json({ error: "forbidden" });
      return;
    }
    res.locals.caller = { email: id.email } satisfies Caller;
    next();
  };
}

/** Rule 4. Runs after `requireCaller`. */
export function requireAdmin(config: FakeConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const caller = callerOf(res);
    if (!caller) {
      res.status(401).json({ error: "unauthorised" });
      return;
    }
    if (!keysEqual(req.get("x-nb-fake-bsc-admin-key"), config.adminKey)) {
      log("auth_refused", { reason: "admin_key", path: req.path });
      res.status(403).json({ error: "forbidden" });
      return;
    }
    if (!config.localDevBypass && !config.adminCallers.has(caller.email)) {
      log("auth_refused", { reason: "caller_not_admin", path: req.path });
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  };
}
