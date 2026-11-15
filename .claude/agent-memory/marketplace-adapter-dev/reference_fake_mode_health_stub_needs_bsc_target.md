---
name: fake-mode-health-stub-needs-bsc-target
description: In fake-BSC mode every BSC credential call is refused unless the stubbed browser /health says bscTarget "fake"; convex-test stubs must serve it, and credKey changes the BSC key shape there
metadata:
  type: reference
---

Since NEO-552, `browserFetch` and `loginWithRetry` in `convex/credentials.ts`
refuse (throw `FakeBscBrowserNotFakeError`, log `fake_bsc_browser_not_fake`)
any request naming a BSC credential (`/login/bsc`, or a path/body containing
`buysportscards-credentials-`) when `fakeBscMode()` is true and the cached
`/health` answer lacks `bscTarget: "fake"`. The check reads the contract cache
that `browserAuthHeaders()` fills, so it costs no call.

**Why:** a convex-test that arms fake mode (`NEONBINDER_BSC_API_BASE` on the
pinned fake host + `TESTING_RESET_SECRET`) but stubs `/health` with only
`contractVersion` now sees every BSC token read return null and every seed
fail with the "not set up for the test BuySportsCards" copy, which looks like
an unrelated regression.

**How to apply:** in a fake-mode stub serve
`{contractVersion: 1, bscTarget: "fake"}`; and expect BSC keys of the shape
`buysportscards-credentials-fake-<slug>-<userId>` (`fakeBscCredentialKeyFor`),
never the bare key, in path assertions. Real-mode tests are unaffected. A new
browser call that bypasses `browserFetch` must call
`assertBrowserTalksToFakeBsc` itself, as `loginWithRetry` does.
See [[convex-test-needs-the-modules-arg]].
