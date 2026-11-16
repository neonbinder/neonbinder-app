---
name: patterns-worktree-deployment-onto-the-fake-bsc
description: NEO-552 — pointing a worktree Convex deployment at the fake BSC; the copied browser URL still reaches real BSC; reading the miss list without an ID token
metadata:
  type: reference
---

- The per-worktree deployment script copies shared dev's env, so the worktree deployment starts with the CANONICAL browser
  service URL (its 100%-traffic revision has no fake env; since the per-deployment login change a fake-mode
  deployment refuses BSC credential calls through it with `fake_bsc_browser_not_fake`)
  and no fake settings. Set three names by hand, key piped from Secret Manager via stdin to
  `npx convex env set NAME`: `NEONBINDER_BSC_API_BASE` (bare fake origin), `NEONBINDER_FAKE_BSC_KEY`,
  and `NEONBINDER_BROWSER_URL` (the fake-aware TAGGED browser revision URL, `<tag>---neonbinder-browser-...`).
  `TESTING_RESET_SECRET` is already copied and is what makes the override live (`resolveBscTarget`).
- Prove it: `npx convex run fakeBsc:writeCaptureStatus '{}'` logs `fake_bsc_control health 200` and
  returns `skipped:false`. Prove the browser revision is fake-aware from `gcloud run revisions describe`
  (env NAMES: `NEONBINDER_FAKE_BSC_URL`/`_KEY` present), not by minting a token.
- Read the namespace's misses with `npx convex run fakeBsc:reportMisses` (no ID token needed). It returns
  method + path only (no nearMiss/diffPaths, no bodies); the fake's own `/__fake/misses` needs a Google ID
  token carrying an email, which a user account cannot mint with `--audiences`.
- With no recordings the misses arrive in LEVELS: setup dies on its first `search/bulk-upload/filters`
  read, so no results/card-listing read is ever asked for. Expect several record-and-rerun rounds.
- Prefix is `<convexSlug>-` (the deployment name); the spec user's namespace adds a 12-hex user tag.
- Record-and-rerun loop traps: (1) BEFORE the fix in 8019d2be/fake revision 4 the per-user reset cleared the namespace's miss list (read
  `reportMisses` right after setup); since then catalogue misses survive resets until recorded; (2) setup is fresh-only and the
  per-user reset keeps selectorOptions, so a setup that got past Manufacturers leaves a custom Topps and the next
  run reds on "No manufacturers available" — re-run the per-worktree deployment script with `--seed` between rounds, then re-set the
  three env names (the script's env copy puts the canonical browser URL back); (3) one setup round unlocks one
  recording level (sports, years, manufacturers' sets, variant types, base results, base card-listing, insert
  filters, insert results, parallel filters...), about 7 min with the re-seed.
- Fake-mode BSC sessions are keyed per deployment AND user since 8019d2be (a stale shared-login session
  gave `fake_bsc_namespace_clash` "No BSC token" reds that looked like sync failures); re-run bootstrap once on
  a deployment after that change. A column "Couldn't sync" alert is not proof of a 501: read the Convex log line.
- A page scroll a reader does is `page.mouse.move(<left margin>)` + `page.mouse.wheel(0, n)`; the old
  `evaluate(scrollIntoView)` could leave the page unmoved, and `scrollIntoViewIfNeeded` on a row would move the
  list and void a list-scroll proof (column-reexpand spec).
- A PR's tagged browser revision (`<tag>---neonbinder-browser-...`) is removed when its PR merges. After the fake landed on main
  the CANONICAL browser service's 100% revision is itself fake-aware (check env NAMES with `gcloud run revisions describe`), so
  set `NEONBINDER_BROWSER_URL` to the service's own `status.url`. A stale tag URL reds as "Browser service health check failed
  (404)" in the Convex log and every BSC read says "No BSC token available" (a `sync failed` that is not a 501).
- With the recorder running live (watch mode) a first unrecorded read FAILS once (a column "Couldn't sync", a fetch "BSC answered
  with an error"), is recorded within seconds, and the miss list is empty again by the time you read it. Retry the product's own
  button (`Sync Variant Types`, `Retry`, `Sync card checklist`) instead of re-seeding. A column that failed stays failed in the
  server's state until retried: re-running the same drill sees the old failure, not the new recording.
- One reseed round trip (script `--seed`, re-set the three env names, `setup`, `bootstrap`) is about 7 min; script it once
  (re-seed -> set env -> setup -> bootstrap -> spec) and run it in the background. Fresh-only specs need one per run per project.
- Real-set specs on the fake: write them FETCH-OR-ADOPT (branch on `No cards in this checklist yet.` vs
  `Cards (N)`), and keep `fake-bsc.sh record <slug>- --yes` running in the background. Each rerun then
  unlocks one more level (year filters, set filters, base results, insert sync, parallel filters, a
  parallel's results) without a reseed between rounds. A miss shows as a column "Couldn't sync" or a
  one-marketplace wait failing with "BSC held it 0.0 s"; read the recorder log, rerun, don't touch budgets.
  Upload a publisher's checklist so no per-card `card-listing` level is needed.
