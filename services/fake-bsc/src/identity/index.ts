import { Router } from "express";
import { log } from "../log";
import { namespaceFromUsername } from "../namespace";
import { createFakeIdentity, FakeIdentity, FakeIdentityOptions } from "./b2c";

/**
 * NEO-552: the fake BSC's Azure B2C identity endpoints as an Express Router.
 * See ./b2c.ts for the protocol and CONTRACT.md ("Identity") for the interface.
 *
 * Mount it AFTER the caller check, at `/identity`:
 *
 *   app.use("/identity", requireCaller(config, verify), identityRouter);
 *
 * It parses its own urlencoded bodies (it reads the stream when no upstream
 * parser has), so it needs no body parser in front of it.
 *
 * Access tokens, refresh tokens, auth codes and SSO cookies are stateless,
 * sealed with a key derived from FAKE_BSC_ADMIN_KEY, so stored sessions
 * survive a scale-to-zero restart. The admin key, not the caller key: Convex
 * and the browser service hold the caller key and must not be able to mint
 * tokens. Without it (local tests) a random per-process key is used. Call
 * `configureIdentity` to pass the secret explicitly (and in tests to inject a
 * clock).
 */

export {
  ACCESS_TOKEN_TTL_S,
  FAKE_BSC_PASSWORD,
  FAKE_BSC_WRONG_PASSWORD,
  REFRESH_WINDOW_S,
  REJECTED_CREDENTIALS_BODY,
  SSO_COOKIE_NAME,
  SSO_COOKIE_TTL_S,
  createFakeIdentity,
} from "./b2c";
export type { FakeIdentity, FakeIdentityOptions } from "./b2c";

let current: FakeIdentity | undefined;

function identity(): FakeIdentity {
  current ??= createFakeIdentity({
    tokenSecret: process.env.FAKE_BSC_ADMIN_KEY,
    namespaceFromUsername,
    log,
  });
  return current;
}

/**
 * Replace the identity singleton (dropping its in-memory sign-in state).
 * `namespaceFromUsername` and `log` default to the server's own.
 */
export function configureIdentity(
  opts: Partial<FakeIdentityOptions> = {},
): void {
  current = createFakeIdentity({
    tokenSecret: opts.tokenSecret ?? process.env.FAKE_BSC_ADMIN_KEY,
    namespaceFromUsername: opts.namespaceFromUsername ?? namespaceFromUsername,
    log: opts.log ?? log,
    ...(opts.now ? { now: opts.now } : {}),
  });
}

/** The Router: authorize, SelfAsserted, confirmed, token. Other paths fall through. */
export const identityRouter: Router = Router();
identityRouter.use((req, res, next) => identity().handle(req, res, next));

/**
 * The namespace a live fake access token belongs to, or null. Accepts the bare
 * token or a whole `Bearer <token>` header value. Used by the API endpoints to
 * scope state to the signed-in fake account.
 */
export function namespaceForToken(token: string | null | undefined): string | null {
  return identity().namespaceForToken(token);
}

/**
 * Drop sessions and tokens for `{ns}`, `{prefix}` or `{}` (all). For
 * `/__fake/reset-all` only; `/__fake/reset` leaves sign-ins alone.
 */
export function resetIdentity(sel: { ns?: string; prefix?: string } = {}): void {
  identity().reset(sel);
}
