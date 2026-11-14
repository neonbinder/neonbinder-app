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
- Record-and-rerun loop traps: (1) the per-user reset (setup's sign-in hop, bootstrap) clears the namespace's
  miss list, so read `reportMisses` right after setup and BEFORE bootstrap; (2) setup is fresh-only and the
  per-user reset keeps selectorOptions, so a setup that got past Manufacturers leaves a custom Topps and the next
  run reds on "No manufacturers available" — re-run the per-worktree deployment script with `--seed` between rounds, then re-set the
  three env names (the script's env copy puts the canonical browser URL back); (3) one setup round unlocks one
  recording level (sports, years, manufacturers' sets, variant types, base results, base card-listing, insert
  filters, insert results, parallel filters...), about 7 min with the re-seed.
