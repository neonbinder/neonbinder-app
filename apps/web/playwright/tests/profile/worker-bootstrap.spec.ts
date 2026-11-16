// Origin: .maestro/flows/profile/worker-bootstrap.yaml (Maestro suite retired in NEO-341; see git history)
// Not a test flow (Maestro tags it `util`): the per-shard Phase-0 bootstrap,
// run by the `bootstrap` project that `e2e` depends on. Signs the shard's
// account in, resets its per-user state, seeds BSC + SportLots credentials
// server-side, then warms both marketplace sessions (best effort).
import { test, expect } from "../../support/fixtures";
import { loginToBsc, loginToSportLots } from "../../support/credentials";
import { expectStepWithSportLots } from "../../support/marketplace-wait";

test(
  "Worker bootstrap — sign in as TEST_EMAIL_${WORKER_INDEX}, reset state, and seed BSC + SL creds",
  { tag: ["@util"] },
  async ({ page, signIn, env }) => {
    await signIn(
      "/testing/reset?redirect=/testing/seed-credentials?redirect=/profile/credentials",
    );
    // One wait covers the whole redirect chain. While SportLots is live the seed performs a real
    // SportLots sign-in (30-65 s), hence the flow's 90 s. Paused, the chain is the fake
    // BuySportsCards' sign-in alone: the longest run measured 6.4 s (the fake's cold first
    // token), so ceil(6.4 + 7) = 14 s.
    await expectStepWithSportLots(page, page.getByRole("heading", { name: "Profile Settings" }), env, {
      liveMs: 90_000,
      pausedMs: 14_000,
      statusLine: false,
      what: "the bootstrap's reset and credential seed",
    });
    // The chain ends on the credentials page.
    await expect(page).toHaveURL(/\/profile\/credentials/);

    // The warm-ups are an optimisation (`optional: true` in the flow): a
    // failure is logged, never fatal. The steps above stay mandatory. The BSC
    // warm-up is a live BuySportsCards sign-in through the browser service, so
    // it is made once per run, by worker 0, and not by every shard at the same
    // moment (BSC pushes back on bursts, and no spec reads what the warm-up
    // leaves: the specs that need a session sign in or press Test themselves).
    if (env.WORKER_INDEX === "0") {
      await loginToBsc(page).catch((e: Error) =>
        console.warn(`bootstrap: BSC warm-up skipped: ${e.message.split("\n")[0]}`),
      );
    }
    await loginToSportLots(page, env).catch((e: Error) =>
      console.warn(`bootstrap: SportLots warm-up skipped: ${e.message.split("\n")[0]}`),
    );
  },
);
