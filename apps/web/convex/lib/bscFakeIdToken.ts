"use node";

/**
 * NEO-552 — the Google ID token a fake-mode BSC call carries in
 * `X-Serverless-Authorization`, minted exactly as the browser-service calls
 * mint theirs (`cloudRunAuth.buildAuthHeaders`, the `neonbinder-convex` SA),
 * with the fake's origin as the audience. Node only (google-auth-library), so
 * the default runtime reaches it through `internal.fakeBsc.idToken`.
 */
import { buildAuthHeaders } from "./cloudRunAuth";
import { BSC_API_BASE_ENV, type BscIdTokenSource } from "./bscHttp";

/** The ID token alone, from the `Authorization: Bearer` header the client builds. */
export const nodeBscIdToken: BscIdTokenSource = async (audience) => {
  const headers = await buildAuthHeaders(audience, BSC_API_BASE_ENV);
  const match = /^Bearer\s+(\S+)$/i.exec(headers.authorization ?? "");
  if (!match) throw new Error("No ID token for the fake BSC audience");
  return match[1];
};

/** The token's `exp` in epoch ms, or `fallbackMs` when it cannot be read. */
export function idTokenExpiresAt(token: string, fallbackMs: number): number {
  const payload = token.split(".")[1];
  if (!payload) return fallbackMs;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: unknown;
    };
    return typeof decoded.exp === "number" && Number.isFinite(decoded.exp)
      ? decoded.exp * 1000
      : fallbackMs;
  } catch {
    return fallbackMs;
  }
}
