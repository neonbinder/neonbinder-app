---
name: listing-specs-race-the-sales-poll
description: A Sync press inside the 60 s throttle after a sales-poll drain toasts "already in the works", not "Nothing new to send"; use pressSync and hold the throttled branch to the poll's run's hard end state
metadata:
  type: feedback
---

A press inside the 60 s throttle (`RESYNC_THROTTLE_MS`) after a poll drain gives
the "<title> is already in the works. Give it a minute, then Sync again." toast,
not a run ending "Nothing new to send". The product is right: with the set's
last press under a minute old and no outbox row left queued (the 15-minute
`listingSales:pollAll` cron's drain took them), `syncOnePlatform` returns
`throttled` and runs nothing.

**Why:** on the fakes (NEO-552, NEO-555) the steps between a listing spec's
presses take seconds, so every press after the first lands inside the minute.
A spec that expected only "Syncing <title> now." went red whenever the cron's
drain landed between a box write and the next press (NEO-555, Future Stars
step 6).

**How to apply:**
- Every press after a spec's first goes through `pressSync(page, sync, title)`
  (support/collection.ts), which returns "ran" | "throttled".
- On "throttled", walk to rest as usual (`followRunToRest` + `queueSettled`) and
  assert HARD that the poll's run did the press's work: its sending step done
  and the count line ("2 taken to 0"). Never a "nothing sent" fallback there.
- Go to Sync status by the tab: "See what's syncing" shows only while a run is
  under way.
- A wrong refusal (cards still queued) stays queued until the cron, so the walk
  goes red on it: the NEO-432 regression is still caught.
- To prove which trigger ran on a red, read the deployment's Convex logs: a
  `pollAll` with caller `Cron` just before the press is the poll's drain.

Related: [[patterns_marketplace_listing_spec_shape]], [[patterns_negative_asserts_pass_on_a_dead_page]].
