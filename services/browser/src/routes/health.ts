import { Request, Response, Router } from "express";
import { CONTRACT_VERSION } from "../contract-version";
import { bscTarget } from "../bsc-endpoints";
import { readEbayOAuthConfig, resolveFakeEbayTarget } from "../services/ebay-oauth";

/**
 * GET /health. Moved out of index.ts (NEO-552) so a test can mount it: index.ts
 * calls app.listen() at import time.
 *
 * `contractVersion` (NEO-143) is what Convex reads before it commits to a
 * request shape; a missing field reads as version 0 and fails every credential
 * operation loudly. Do not remove or rename it without updating
 * apps/web/convex/credentials.ts.
 *
 * `bscTarget` (NEO-552) is "real" or "fake": which BuySportsCards this process
 * talks to. Additive, so it does not bump CONTRACT_VERSION (README, "Release
 * contract"). A fake-mode Convex deployment refuses every BSC credential call
 * unless this says "fake" (credentials.ts `assertBrowserTalksToFakeBsc`). CI's
 * bsc-probe-verdict.sh fails a prod revision that says "fake" and a preview
 * that says "real"; an older service without the field reads as neither.
 *
 * `ebayFake` and `ebayTarget` (NEO-555) say which eBays this process can reach.
 * Additive, so no CONTRACT_VERSION bump: Convex reads `contractVersion` and
 * (in fake mode) `bscTarget` only, and an older peer ignores fields it does
 * not know (src/contract-version.ts, "Do NOT bump for additive fields").
 *   - `ebayFake`: true when this process would honour a fake eBay key, i.e. it
 *     has a valid fake URL and the caller key and is not prod. Exactly the
 *     condition a fake key needs (`resolveFakeEbayTarget`), so a fake-mode Convex
 *     deployment can check it before sending one. Never true in prod.
 *   - `ebayTarget`: the environment a BARE key uses, "production" or
 *     "sandbox", or null when the process has no eBay app configured. It does
 *     not describe fake keys, so dev can serve sandbox and fake side by side.
 * Neither carries a value from the eBay config beyond its environment name.
 *
 * Deliberately does NOT report the Cloud Run revision name: nothing needs it.
 * Every route, this one included, is IAM-gated.
 */
export function createHealthRouter(env: Record<string, string | undefined> = process.env): Router {
  const router = Router();
  const environment = env.ENVIRONMENT || "dev";
  router.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      environment,
      contractVersion: CONTRACT_VERSION,
      bscTarget: bscTarget(env),
      ebayFake: resolveFakeEbayTarget(env).ok,
      ebayTarget: readEbayOAuthConfig(env)?.environment ?? null,
    });
  });
  return router;
}
