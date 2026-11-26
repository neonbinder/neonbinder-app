---
name: inner-guard-covered-only-through-outer-guard
description: A guard re-applied in an inner helper (e.g. enqueueItem) is not covered by a test that enters through the outer function that already applies it; the re-entry path needs its own test
metadata:
  type: project
---

When a delta adds the same guard a second time deeper in the call chain
("re-checked here, not only at first queue"), the existing test that enters
through the outer function stays green with the new guard reverted, because
the outer guard already filtered the value. Seen on NEO-644: `queuedByForLane`
added in `enqueueItem`; the "real BSC writes no rows" test calls
`enqueueBscTeamChecks`, which already strips `queuedBy`.

**Why:** the only path the inner guard changes is the re-entry one (a
completion handler re-enqueueing a stored context), which no test drove.

**How to apply:** ask which callers reach the inner helper WITHOUT the outer
guard (grep the helper's call sites), and require a test on that path with a
stale value in the stored context (e.g. call the completion mutation directly
with `queuedBy` in context, target flipped to real, assert no row). Mentally
revert the inner guard and see whether any test goes red. See
[[teardown-hop-count-ignored]].
