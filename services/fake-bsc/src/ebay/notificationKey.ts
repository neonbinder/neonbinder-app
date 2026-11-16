/**
 * The fake eBay's notification signing key (row 16, CONTRACT.md "Identity,
 * public key"): one P-256 keypair derived from FAKE_BSC_ADMIN_KEY, so the
 * public key the fake serves is the same after every restart, and a test can
 * sign a notification body the way eBay does (`X-EBAY-SIGNATURE`: base64 of
 * `{alg, kid, signature (base64 DER), digest}`, ECDSA over SHA-1 of the body,
 * as services/browser `ebay-notification.ts` verifies).
 */
import { createECDH, createHash, createPrivateKey, createPublicKey, createSign, hkdfSync, randomBytes, type KeyObject } from "node:crypto";

export const FAKE_EBAY_PUBLIC_KEY_ID = "fa4e0000-0000-4000-8000-00000000eb01";

/** P-256's group order: a private scalar must be in [1, n-1]. */
const P256_N = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");

export interface NotificationKey {
  kid: string;
  /** `-----BEGIN PUBLIC KEY-----` PEM (SPKI). */
  publicPem: string;
  /** The `X-EBAY-SIGNATURE` header value for a body. */
  signatureHeader(body: string): string;
}

export function notificationKey(secret?: string): NotificationKey {
  const seed = secret && secret.length > 0 ? secret : randomBytes(32).toString("base64url");
  // Derive a scalar, reduce it into [1, n-1].
  const raw = Buffer.from(hkdfSync("sha256", Buffer.from(seed, "utf8"), Buffer.from("neo-555-fake-ebay"), Buffer.from("notification-key-v1"), 48));
  const d = (BigInt(`0x${raw.toString("hex")}`) % (P256_N - BigInt(1))) + BigInt(1);
  const dBuf = Buffer.from(d.toString(16).padStart(64, "0"), "hex");
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(dBuf);
  const pub = ecdh.getPublicKey(); // 0x04 || x || y
  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: dBuf.toString("base64url"),
    x: pub.subarray(1, 33).toString("base64url"),
    y: pub.subarray(33, 65).toString("base64url"),
  };
  const privateKey: KeyObject = createPrivateKey({ key: jwk, format: "jwk" });
  const publicPem = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  return {
    kid: FAKE_EBAY_PUBLIC_KEY_ID,
    publicPem,
    signatureHeader(body: string): string {
      const signer = createSign("SHA1");
      signer.update(body);
      const signature = signer.sign(privateKey).toString("base64");
      return Buffer.from(JSON.stringify({ alg: "ecdsa", kid: FAKE_EBAY_PUBLIC_KEY_ID, signature, digest: "SHA1" })).toString("base64");
    },
  };
}

/** Test helper: a stable fingerprint of the served key, never the key itself. */
export function keyFingerprint(k: NotificationKey): string {
  return createHash("sha256").update(k.publicPem).digest("hex").slice(0, 16);
}
