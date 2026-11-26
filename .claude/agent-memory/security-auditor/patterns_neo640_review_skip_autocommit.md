---
name: neo640-review-skip-autocommit
description: Auditing a client that skips an operator review and auto-commits: what made NEO-640's Match Cards skip safe, and the edges to re-check
metadata:
  type: project
---

A client-side "skip the review, commit what streamed" adds no server surface when
the commit mutation already takes client-carried cards (admin-gated): the question
is only whether the client commits rows the operator would have been shown.

What held in NEO-640 (check the same on any future skip):
- The commit reads the subscription only after `streamRowsArrived` matches the
  server-returned `candidateBatchId` (fence), not merely "differs from the previous
  batch". A stale or foreign batch cannot be committed.
- The feed query (`getReadyCandidates`) is admin-gated AND scoped to
  `createdByUserId`, so cross-user rows never reach the predicate.
- The predicate fails open: a new gate field is a union stamped on every matched
  row and absence means "open the dialog" (old rows, deploy-window skew, a dropped
  field in the query's explicit row map). Monotonic per row (later patches touch
  teams only), so an early open is never taken back.
- `abandoned()` (generation + variant ref) is checked after every await before the
  commit; the timeout path discards, never commits.

Edges worth a line in the report, not a block:
- The early-open check can only compare against the PREVIOUS batch id (the run's
  own id is unknown until the action returns), so a same-user second tab's batch
  can open the dialog. Fails toward opening; harmless.
- No unmount guard: a run whose rows all landed still commits after the operator
  navigates away. Before the skip, a multi-source run left mid-fetch committed
  nothing. Same operator, additive commit: note.
- A score of 1 is the whole skip criterion, so whatever the pairing core scores 1
  (e.g. a number-only pair where one side has no name key) now commits unseen.
  Route that to the product/collector auditor; it is not a trust-boundary issue.

Related: [[patterns_held_client_store_autosend]], [[patterns_neo591_names_first_pairing]].
