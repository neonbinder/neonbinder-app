---
name: patterns-confirm-to-saved-chain-timing
description: Since NEO-645 commit-first, Match Cards' Confirm runs applyPublishedChecklistPairs, resolveChecklistEntities and commitCardChecklist back to back before "Saved N cards."; how to time that chain from the CI convex-logs artifact when the Saved line misses 7 s on a 500+ card real set
metadata:
  type: patterns
---

Signature: `settleWalkAfterCommit`'s `Saved N cards.` not visible in 7 s, failure PNG shows the
Sync button as "Saving..." (disabled) and the Cards heading already counting the set. Not a missed
Confirm (the dialog closed), not a failure: the chain was still running.

Before commit-first the operator stopped in the review wizard between `resolveChecklistEntities`
and the commit, so the last 7 s window held only the commit. Now one press carries all three:
`applyPublishedChecklistPairs` (~0.2 s) -> `resolveChecklistEntities` (~1.5 s on 554 cards) ->
`commitCardChecklist` (~4.9 s on 554 cards: 4 prelude, 5 serial ~0.65 s chunks of ~340 writes,
4 finalize). About 7.2 s server-side from the click, so it misses by a hair.

How to time it: take the Confirm `Click` and the `Saved` expect's start/end from the blob
`report.jsonl` (onStepBegin times, UTC ms), then in `convex-logs-desktop-<n>.jsonl.gz` group by
`requestId` and print `timestamp - executionTime` as each call's start. The action's own
`executionTime` covers its children; the gaps between actions are client round trips. Prove the
request is the spec's by its log lines (`setYear`, `pairs`/`conflicts` counts, chunk writes).

Verdict shape: our own write over the 7 s budget is a product performance finding to report with
these numbers; never raise the budget (GUIDE hard rule 3 needs the owner's sign-off).

Related: [[patterns_action_stall_between_child_calls]], [[patterns_window_vs_rest_exec_medians]].
