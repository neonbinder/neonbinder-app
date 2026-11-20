---
name: preprocess-route-merge-opens-an-e2e-window
description: A merge that adds a services/preprocess route makes every other PR's E2E red at that step until release.yml promotes dev; recognise the bare FastAPI 404 and rerun; no guard wanted
metadata:
  type: project
---

A PR that changes nothing under `services/preprocess` skips `wire-preprocess-url`,
so its Convex preview calls the traffic-bearing **dev** preprocess revision.
`release.yml` only promotes dev to main's HEAD ~25-30 min after a merge (lint
+ image build + deploy + smoke). In that window any PR whose E2E reaches a
step that needs the newly merged route gets a bare FastAPI 404
(`{"detail":"Not Found"}`), which the adapter classifies as a generic
"error", not "route missing" (NEO-427 merge, 2026-11-04: 26 min window,
two specs red on an unrelated PR).

**Why:** the pipeline guards the `pr-<N>` revision's `PREVIEW_SHA` against the
PR head, but not the dev revision against `origin/main`. Jason, 2026-11-04: no
guard for this. A new preprocess route almost never happens, so it is not worth
the extra pipeline.

**How to apply:** when a plan adds a preprocess route (or any
Convex-to-service contract step), say in the plan that other PRs' E2E will be
red at that step until the release lane promotes dev, and that the fix is a
full workflow rerun, never a longer wait or a spec change. In triage, the
signature is `adapter_sync_call ... status_code:404` with a sub-200 ms
duration (an old warm revision answering) and a release run with a
"Promote dev" job still pending or just finished.
