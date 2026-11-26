---
name: patterns-lookup-hold-on-a-real-insert-via-blank-team-cell-429
description: NEO-661 - show a card "still looking up teams" on a real insert fetch: blank one team cell in the uploaded checklist, 429 its card-listing read, pick a card no fill rule can reach; release by the operator, not the lane
metadata:
  type: pattern
---

To hold a real-set card in "Still looking up teams for 1 card." (`isAwaitingTeamLookup`):

- Upload the publisher's checklist with that card's team cell BLANK
  (`usePublishersChecklist(page, name, { teamCells: { [num]: "" } })`): a blank cell is no claim,
  so the fetch asks BSC for that one card. Then `bscFake.setFaults([bscFault.tooManyRequests(
  BSC_PATH.cardListing, { retryAfterS: 600, times: 5, ttlS: 900 })])` before Sync. The 429 fails
  the inline lookup, the commit enqueues the card on the lane, the lane defers to the gate's until
  (600 s is the gate's `RETRY_AFTER_MAX_MS` ceiling), so nothing answers during the spec.
- **Pick a card no fill rule can reach.** The save fills any CATALOGUE player with one team in the
  window (no note, no `teamCheckOutcome`), which ends the wait. On 2026 Bowman Anime every `BA-`
  player is in the Baseball catalogue (prospects too); only the football players are not. Choose a
  player with ONE card in the set (two cards = the same-player fill). Read the row with
  `npx convex data cardChecklist --format jsonLines` (teamOnCardIds, teamCheckDoneAt) on your own
  deployment when the line is missing.
- **Clear the gate before anything else reads BSC.** A parallel build that starts with the gate
  open reads "<parallel> — Blocked — we're pacing our calls to BSC…" (seen when the hold failed).
  `bscFake.clear()` clears rules and the worker's gate, but a lane item already pushed back keeps
  its `runAt`: clearing does not wake it.
- **Release by the operator** ("No Team for this card" in the card's drawer, "Saved No Team")
  when the set's card-listing answers are not recorded: a lane retry would 501. The client hold
  re-reads live rows, so any write that ends the wait releases it.
- A planted `parallelBuildHold` -> null reds the hold assert with the lookup line still up; it
  needs no `--expect` on a fresh-only spec (the tool re-seeds), read the error by hand.

**Why:** NEO-661 coverage gap, the lookup hold had no live proof (2026-11-24). **How to apply:** any
spec needing a real card held in the team lane. Related: [[fake-bsc-faults-and-the-call-gate]],
[[bsc-team-lane-is-shared-across-shards]], [[patterns-held-insert-parallel-build-on-a-hand-made-insert]].
