---
name: patterns-both-projects-locally-worker-index-vs-reseed
description: Running a spec batch on e2e then e2e-mobile on one per-worktree deployment — when a different WORKER_INDEX is enough and when only a re-seed works (sole-writer set specs)
metadata:
  type: feedback
---

A spec whose only fresh-only state is a `recordedNoMatchPlayer(env, pool)` name
(keyed by `WORKER_INDEX`) and per-attempt minted teams can run a second time
without a re-seed: pass a different `WORKER_INDEX` (8 desktop, 9 mobile, 10/11 for
a planted-break or recheck run). Locally 3-11 all fall back to `TEST_EMAIL`, so it
is the same user; run `bootstrap` for the new index first.

A spec that commits a SHARED registry set (e.g. `tidy-up-team-link-remembers-the-name`,
via `fetchOneMarketplaceSetChecklistToTidyWalk`) does NOT separate by worker: its
second run fails at `No cards in this checklist yet.` (the precondition, by
name). That red is the documented "re-seed first", not a product bug: re-run
`agent-convex.sh --seed`, then `setup` and `bootstrap`, then the mobile run.

**Through `e2e-run.mjs` the swap is not free (NEO-645, 2026-11-23):** `run`/`plant
--worker N` for an index not bootstrapped since the seed runs the `setup` project
again, and `setup` asserts a cold Manufacturers column, so on a warmed seed it reds
("No manufacturers" / sync error at 45 s) before the spec starts: a plant reports
`PLANT ERROR: a setup/bootstrap phase failed`. The seed's recorded setup stays green
and other authors' runs are unaffected, but nothing of yours ran. So with e2e-run a
second fresh-only run (mobile, or a plant) needs a fresh seed: hand it back as
"needs fresh run" when you may not reseed.

**Why:** NEO-617 batch run, 2026-11-19 — 7/8 mobile specs passed on a fresh
WORKER_INDEX, the sole-writer one failed on its precondition.
**How to apply:** before a two-project local batch, sort the specs: player-name-only
ones take a worker swap; any spec in SET-REGISTRY's sole-writer list needs the re-seed,
so run those first on mobile after a re-seed, or budget the ~6 min re-seed.
Related: [[patterns_rerun_a_fresh_only_spec_without_a_reseed]].
