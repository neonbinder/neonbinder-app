import { Request, Response, Router } from "express";
import { CONTRACT_VERSION } from "../contract-version";
import { bscTarget } from "../bsc-endpoints";

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
 * talks to. Additive and informational: Convex does not act on it, so it does
 * not bump CONTRACT_VERSION (README, "Release contract"). CI's
 * bsc-probe-verdict.sh fails a prod revision that says "fake" and a preview
 * that says "real"; an older service without the field reads as neither.
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
    });
  });
  return router;
}
