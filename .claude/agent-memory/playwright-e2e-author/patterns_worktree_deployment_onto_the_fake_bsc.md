---
name: patterns-worktree-deployment-onto-the-fake-bsc
description: NEO-552 — pointing a worktree Convex deployment at the fake BSC; the copied browser URL still reaches real BSC; reading the miss list without an ID token
metadata:
  type: reference
---

- `agent-convex.sh` copies shared dev's env, so the worktree deployment starts with the CANONICAL browser
  service URL (its 100%-traffic revision has no fake env, so a BSC sign-in through it would reach real BSC)
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
