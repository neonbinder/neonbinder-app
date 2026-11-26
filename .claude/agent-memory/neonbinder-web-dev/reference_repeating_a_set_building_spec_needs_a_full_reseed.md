---
name: repeating-a-set-building-spec-needs-a-full-reseed
description: Re-running a spec that builds a set (to time a server path 3 times) finds the tree already built and skips the fetch; a partial reset breaks the setup project, so each repeat is a full reseed
metadata:
  type: reference
---

A spec that builds a real set through the Set Builder ("a rerun on the same seed
finds it") does not repeat the checklist fetch on its second run, so timing the
review gate (or any fetch-time action) over N runs needs a fresh state each time.

- `e2e-baseline.sh reset --except-reference-seed` is NOT enough: it keeps the
  years and brands the reference bundle carries, and the `setup` project then
  fails on its "Years notice" assertion (nothing left to sync).
- What works is the full per-worktree recipe each time: `agent-convex.sh --seed`
  (it also pushes the current branch code, ~3 min), then `setup`, `bootstrap`,
  then the spec. About 7 minutes a run.
- Consequence for before/after timing: the push in `agent-convex.sh` happens in
  its first minute, so do not edit `convex/` while a baseline cycle is still
  early, or the "unchanged" run measures your edit.
- `setup` itself runs the review gate three or four times (2024 Topps Chrome
  base, insert, parallel), so every cycle yields more gate samples than the spec.
- Timing source: `npx convex logs --success --jsonl` (stream it to a file before
  the run). Rows are `kind: Completion` with `executionTime`, `parentExecutionId`
  and `usageStats.databaseReadDocuments`; the CLI rows have `timestamp` only (no
  `executionTimestamp`), so a CI-artifact analysis script needs adapting.
