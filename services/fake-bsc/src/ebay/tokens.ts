/**
 * The fake eBay's OAuth tokens (CONTRACT.md, "Fake eBay", "Tokens"). Stateless,
 * like the BSC identity: every token is a sealed payload, AES-256-GCM under a
 * key derived (HKDF, its own label) from FAKE_BSC_ADMIN_KEY, so a session
 * stored in Convex and the browser service survives the fake's scale-to-zero
 * restarts. The admin key, not the caller key: every caller holds the caller
 * key and must not be able to mint an eBay token.
 *
 *   user access token   2 h          {k:"eat", ns, s, exp, iat}
 *   user refresh token  18 months    {k:"ert", ns, s, exp, iat}
 *   authorization code  5 min        {k:"ecode", ns, s, exp, iat}
 *   app access token    2 h          {k:"eapp", exp, iat}
 *
 * `s` is the seller: "main", or "alt" (a second eBay account for the same NB
 * user, for the account-switch case). Only `/__fake/reset-all` revokes
 * anything (in memory, like the identity's revocations).
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

export type EbaySeller = "main" | "alt";
export const EBAY_SELLERS: readonly EbaySeller[] = ["main", "alt"];

/** The fake's eBay app. Public on purpose: the caller key and IAM guard the fake, not these. */
export const FAKE_EBAY_CLIENT_ID = "NeonBind-FakeEbay-PRD-0fake000-00000000";
export const FAKE_EBAY_CLIENT_SECRET = "PRD-0fake0000000-fake-ebay-client-secret";

/** eBay's user access token life (`expires_in: 7200`). */
export const ACCESS_TOKEN_TTL_S = 7200;
/** eBay's user refresh token life: about 18 months (`refresh_token_expires_in: 47304000`). */
export const REFRESH_TOKEN_TTL_S = 47_304_000;
export const AUTH_CODE_TTL_S = 300;
export const APP_TOKEN_TTL_S = 7200;

type Kind = "eat" | "ert" | "ecode" | "eapp";

interface Payload {
  k: Kind;
  ns?: string;
  s?: EbaySeller;
  exp: number;
  iat: number;
  /** Random, so two codes minted in the same millisecond differ (single use is per value). */
  n?: string;
}

export interface EbayUser {
  ns: string;
  seller: EbaySeller;
}

export interface EbayTokens {
  mintCode(user: EbayUser): { code: string; expiresAt: number };
  /** The user an unexpired, unrevoked, unspent code names; marks it spent. */
  redeemCode(code: string): EbayUser | null;
  mintUserTokens(user: EbayUser): { accessToken: string; refreshToken: string };
  mintAccess(user: EbayUser): string;
  mintApp(): string;
  /** The user of a live user access token (also takes `Bearer <token>`). */
  userForAccess(token: string | null | undefined): EbayUser | null;
  userForRefresh(token: string): EbayUser | null;
  /** True for a live app (client-credentials) token. */
  isApp(token: string | null | undefined): boolean;
  /** `/__fake/reset-all`: every token issued so far stops working. */
  revokeAll(): void;
}

function b64u(buf: Buffer): string {
  return buf.toString("base64url");
}

/** Every seller value a token may name. */
export function isSeller(v: unknown): v is EbaySeller {
  return v === "main" || v === "alt";
}

export function createEbayTokens(opts: { secret?: string; now?: () => number } = {}): EbayTokens {
  const now = opts.now ?? Date.now;
  const secret = opts.secret && opts.secret.length > 0 ? opts.secret : b64u(randomBytes(32));
  const key = Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.from("neo-555-fake-ebay"), Buffer.from("ebay-token-v1"), 32));
  let revokedAt = 0;
  const spent = new Map<string, number>();
  const MAX_SPENT = 10_000;

  const seal = (p: Omit<Payload, "iat">): string => {
    // Never at or before the last revocation, even on a frozen clock.
    const payload: Payload = { ...p, iat: Math.max(now(), revokedAt + 1) };
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
    // eBay's tokens are long opaque strings starting `v^1.1#`; NB treats them as opaque.
    return `v^1.1#fake#${b64u(Buffer.concat([iv, ct, cipher.getAuthTag()]))}`;
  };

  const unseal = (raw: string | null | undefined, kind: Kind): Payload | null => {
    if (typeof raw !== "string") return null;
    const bare = raw.replace(/^\s*Bearer\s+/i, "").trim();
    if (!bare.startsWith("v^1.1#fake#") || bare.length > 4096) return null;
    let buf: Buffer;
    try {
      buf = Buffer.from(bare.slice("v^1.1#fake#".length), "base64url");
    } catch {
      return null;
    }
    if (buf.length < 12 + 16 + 2) return null;
    try {
      const d = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
      d.setAuthTag(buf.subarray(buf.length - 16));
      const pt = Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]);
      const p = JSON.parse(pt.toString("utf8")) as Payload;
      if (p.k !== kind || typeof p.exp !== "number" || typeof p.iat !== "number") return null;
      if (p.exp <= now() || p.iat <= revokedAt) return null;
      if (kind !== "eapp" && (typeof p.ns !== "string" || !isSeller(p.s))) return null;
      return p;
    } catch {
      return null;
    }
  };

  const user = (p: Payload | null): EbayUser | null => (p && p.ns !== undefined && p.s !== undefined ? { ns: p.ns, seller: p.s } : null);

  return {
    mintCode(u) {
      const expiresAt = now() + AUTH_CODE_TTL_S * 1000;
      return { code: seal({ k: "ecode", ns: u.ns, s: u.seller, exp: expiresAt, n: b64u(randomBytes(9)) }), expiresAt };
    },
    redeemCode(code) {
      const p = unseal(code, "ecode");
      if (!p) return null;
      const t = now();
      for (const [c, exp] of spent) if (exp <= t) spent.delete(c);
      if (spent.has(code)) return null;
      if (spent.size >= MAX_SPENT) {
        const first = spent.keys().next().value;
        if (first !== undefined) spent.delete(first);
      }
      spent.set(code, p.exp);
      return user(p);
    },
    mintUserTokens(u) {
      return {
        accessToken: seal({ k: "eat", ns: u.ns, s: u.seller, exp: now() + ACCESS_TOKEN_TTL_S * 1000 }),
        refreshToken: seal({ k: "ert", ns: u.ns, s: u.seller, exp: now() + REFRESH_TOKEN_TTL_S * 1000 }),
      };
    },
    mintAccess(u) {
      return seal({ k: "eat", ns: u.ns, s: u.seller, exp: now() + ACCESS_TOKEN_TTL_S * 1000 });
    },
    mintApp() {
      return seal({ k: "eapp", exp: now() + APP_TOKEN_TTL_S * 1000 });
    },
    userForAccess: (t) => user(unseal(t, "eat")),
    userForRefresh: (t) => user(unseal(t, "ert")),
    isApp: (t) => unseal(t, "eapp") !== null,
    revokeAll() {
      revokedAt = now();
      spent.clear();
    },
  };
}
