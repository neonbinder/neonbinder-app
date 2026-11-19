---
name: patterns-neo555-fake-ebay-cutover
description: Cutting a real-marketplace test lane over to a standing fake - the two-gate resolver, request-keyed key naming, strict echo, merge-semantics deploys, and the credentials a retired lane leaves outside the diff
metadata:
  type: project
---

NEO-555 B2 moved every test deployment's eBay from the real sandbox to the standing fake (`EBAY_ENVIRONMENT=fake`). Durable audit rules for any "test mode for marketplace X" switch:

1. **Gate at the one resolver, with two independent conditions.** `ebayConfig()` grants fake mode only beside the test-deployment marker (`TESTING_RESET_SECRET`) AND a fake target that passed the shared host pin (`resolveBscTarget` = fake). Every consumer (adapter base URL, authorize URL, public test controls, crons) then inherits it. Check the "unusable" branch returns null (not configured), never falls through to the sandbox/production branch below it.
2. **Key naming keyed on the REQUEST for fake, not on config validity**, so an unusable fake setup is refused rather than reading a bare (real) key. Corollary: a mistaken flip on prod fails closed as an OUTAGE (every user's session key renames, eBay reads "not configured"); look for a prod-side check that would notice, since only a throttled log fires.
3. **Echo guards compare to the deployment's own config with `!==`**, tested both ways (fake deployment refuses non-fake echo; real deployment refuses a fake echo).
4. **Public test controls**: ns/owner derived from the verified subject only (no arg), lock order = marker, auth, mode; registry entries for each, plus the per-platform branch of any `platform` arg (a "bsc" branch gated on a looser predicate like `mode !== "real"` is acceptable only if the misconfigured target sends nothing).
5. **A "poll now" control that calls the cron body directly runs concurrently with the cron.** Safe only if the per-line apply is idempotent inside one mutation (an `applied` flag checked in-transaction), not because of a lease; verify that, cursor last-writer-wins is then integrity-only.
6. **Cloud Run deploy actions MERGE env and secrets onto the service template**, and tagged previews on a shared service mutate that template, so dropping a var needs `--remove-env-vars`/`--remove-secrets` on every lane that shares the service, and other open PRs on older main re-add it until they rebase.
7. **A retired real-account lane leaves credentials where the diff cannot show them**: project preview-default env (copied into every preview and per-worktree deployment), shared dev env, Secret Manager sessions under the old key form, the client secret's accessor/viewer IAM. List every place the old env names were ever written and make removal plus revocation a rollout condition.

Related: [[patterns-neo552-fake-upstream-and-recorder]], [[patterns-fake-target-environment-label]], [[patterns-testing-endpoint-gate]].
