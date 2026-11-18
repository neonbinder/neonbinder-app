/**
 * The worker account's reset: the one route that puts a worker's main test account
 * back to its bootstrapped state. Two callers, one implementation:
 *
 * - the `bootstrap` project (`tests/profile/worker-bootstrap.spec.ts`), once per
 *   shard per pass, before any spec;
 * - the failure reset (`resetAfterFailure` in ./fixtures.ts, NEO-592), after a spec
 *   on `e2e` or `e2e-mobile` ends red, so the worker's next test (or the CI retry)
 *   starts from that same state and not from what the red spec left half done.
 *
 * The chain is `/testing/sign-in` -> `/testing/reset` (`api.testing.resetMyTestState`:
 * the caller's own per-user rows and their fake BuySportsCards namespace, nothing
 * shared) -> `/testing/seed-credentials` (BSC, SportLots unless paused, the EasyPost
 * key) -> `/profile/credentials`. It touches only the signed-in account, never a
 * catalogue row, another worker or a sole-writer set (R7, R7a).
 */
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import type { FlowEnv } from "./env";
import { expectStepWithSportLots } from "./marketplace-wait";

/** The redirect the sign-in hop is given: reset, then the credential seed, then Credentials. */
export const WORKER_RESET_REDIRECT = "/testing/reset?redirect=/testing/seed-credentials?redirect=/profile/credentials";

/**
 * Where the chain stops when one of its steps refuses: each hop prints its outcome
 * as one status line ("[testing] Error: ...", "[testing-reset] Error: ...",
 * "[testing-seed] Seed failed (...)").
 */
const CHAIN_REFUSED = /^\[testing(-reset|-seed)?\] (Error: |Seed failed )/;

/** While SportLots is live the seed signs in to SportLots for real (30-65 s). */
const LIVE_SEED_MS = 90_000;
/**
 * Paused, the chain is the fake BuySportsCards' sign-in alone: the longest run measured
 * 6.4 s on the #487 merge-group run (GUIDE) (the fake's cold first token), so
 * ceil(6.4 + 7) = 14 s.
 */
const PAUSED_SEED_MS = 14_000;

/**
 * Waits, from the moment the sign-in hop was opened, for the chain to land on
 * Credentials. Fails at once, naming the step, when a hop prints its refusal.
 *
 * Contract: ENTRY `page` was sent to `signInUrl(WORKER_RESET_REDIRECT, ...)`.
 * EXIT the account is reset and seeded, and the page is on /profile/credentials.
 */
export async function expectWorkerReset(page: Page, env: Pick<FlowEnv, "SL_PAUSED">): Promise<void> {
  const landed = page.getByRole("heading", { name: "Profile Settings" });
  const refused = page.getByText(CHAIN_REFUSED);
  // One wait covers the whole redirect chain; a refusal ends it early, by name.
  await expectStepWithSportLots(page, landed.or(refused), env, {
    liveMs: LIVE_SEED_MS,
    pausedMs: PAUSED_SEED_MS,
    statusLine: false,
    what: "the worker account's reset and credential seed",
  });
  await expect(refused, "the reset chain refused a step").toHaveCount(0);
  await expect(landed).toBeVisible();
  // The chain ends on the credentials page.
  await expect(page).toHaveURL(/\/profile\/credentials/);
}

/** How long the failure reset may take in all: the live seed, plus the sign-in hop's launch. */
export const WORKER_RESET_CAP_MS = LIVE_SEED_MS + 45_000;
