---
name: patterns-rerun-a-fresh-only-spec-without-a-reseed
description: Re-run a fresh-only/sole-writer spec several times on a per-worktree deployment when gcloud is expired (no catalogue bundle): restore recipe, and why a product break must be PUSHED to prove a commit-time assertion
metadata:
  type: reference
---

When `gcloud` is expired the reference bundle cannot be fetched, so a full re-seed
is out (a plain `reset` would wipe the catalogue). A fresh-only spec that commits
can still be re-run on your own deployment:

1. Undo what the spec wrote to reference-table rows with a throwaway restore spec
   (delete it before you hand back): rename the row back, clear any stored
   "Set name in titles" (attributes panel, `Value for Set name in titles`).
2. `E2E_BASELINE_CONFIRM=1 CONVEX_NAME=<own name> ./e2e-baseline.sh reset --except-reference-seed`
   drains the non-reference tables (the committed cards, per-user state) and keeps
   the catalogue and set rows; then re-run the `bootstrap` project for the worker.
3. Names/players the earlier run created persist, so a later run skips the wizard's
   name steps: write the name loop so it accepts both (Add as New or straight to
   Next/Confirm), and say in the report which run exercised the names.

A red BEFORE the commit needs only step 1 (the rename persists, nothing else).

**A break that must reach the server is pushed.** Title text the commit writes is
built by `convex/features/generateListing.ts` on the server, while the wizard's
Card titles preview runs the same file in Vite. Breaking the file locally reds only
the step; to prove an assertion on a STORED card, push the break
(`npx convex dev --once`), run, restore the file byte-exact and push again.
A local-only break left a stored-title assertion green (it proved nothing).
