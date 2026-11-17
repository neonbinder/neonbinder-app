---
name: late-scheduled-jobs-cross-convex-test-instances
description: An earlier test's un-drained runAfter(0) job can fire during a LATER test and land in that test's module-level spy (captureBscTeamLane); convex-test ids repeat across instances, so the stray looks like your own card
metadata:
  type: reference
---

A module-level spy (e.g. `captureBscTeamLane()` spying `bscTeamPool.enqueueAction`)
sees calls from EVERY convex-test instance in the file, not just the one the
current test built. A previous test that scheduled `enqueueBscTeamChecks` (or any
job) without draining it lets that job fire during the next test's awaits, and
its item lands in the new test's list.

The trap: convex-test ids are per-instance counters
(`0000000000000010008cardChecklist`), so the stray item can carry the SAME id
string as a card in your test. Seen in NEO-556: an exact `toEqual([one._id])`
on the lane got three entries, two of them identical-looking.

**How to apply:**
- Assert the enqueue on the instance's own `_scheduled_functions` rows
  (instance-scoped), and on a spy only with `.some(...)`/filtering.
- In a file whose own helper builds/commits, `drainScheduled(t)` right after
  the action, so no job outlives its test (the noTeam build helper does this).
- To exercise the lane end to end: spy in `beforeEach`, drain, then switch to
  `vi.useFakeTimers({ shouldAdvanceTime: true })` only for `runBscTeamLane`
  (the 1.7 s pacing pause), and `vi.useRealTimers()` in `afterEach`.

Related: [[convex-components-unregistered-in-convex-test]], [[teardown-leak-attribution]].
