// Origin: .maestro/flows/profile/worker-bootstrap.yaml (Maestro suite retired in NEO-341; see git history)
// Not a test flow (Maestro tags it `util`): the per-shard Phase-0 bootstrap,
// run by the `bootstrap` project that `e2e` depends on. Signs the shard's
// account in, resets its per-user state, seeds BSC + SportLots credentials
// server-side, then warms both marketplace sessions (best effort).
import { test, expect } from "../../support/fixtures";
import { loginToBsc, loginToSportLots } from "../../support/credentials";
import { expectWorkerReset, WORKER_RESET_REDIRECT } from "../../support/worker-reset";

test(
  "Worker bootstrap — sign in as TEST_EMAIL_${WORKER_INDEX}, reset state, and seed BSC + SL creds",
  { tag: ["@util"] },
  async ({ page, signIn, env }) => {
    // The reset chain is shared with the failure reset (support/worker-reset.ts): one
    // wait covers sign-in, reset and credential seed, with the flow's 90 s while
    // SportLots is live and the fake BuySportsCards' measured 14 s while it is paused.
    await signIn(WORKER_RESET_REDIRECT);
    await expectWorkerReset(page, env);
    // The account is seeded: the chain ended on Credentials (the helper's own exit, said here too).
    await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible();

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
