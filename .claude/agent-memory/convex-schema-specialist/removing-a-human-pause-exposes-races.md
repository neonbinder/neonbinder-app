---
name: removing-a-human-pause-exposes-races
description: When a redesign deletes a human-paced step (a wizard) between a self-continuing staging mutation and its consumer, the runAfter(0) continuation and background lookups now race the consumer; drive pages from the action and enqueue lookups after the consumer
metadata:
  type: feedback
---

A staging mutation that pages itself with `ctx.scheduler.runAfter(0, sameFn,
{...args, continueBatchId})` (the NEO-294 `entityReviewQueue.startBatch` shape)
is only safe while a HUMAN sits between it and the code that reads its rows.
Its own doc said so: "No operator clears several hundred rows in the
milliseconds a runAfter(0) takes." Remove the wizard (NEO-645: gate, then
commit at once) and two races appear:

1. **Continuation vs consumer.** The commit prelude can read the stored answers
   before the continuation has written the rest. A missing auto-link answer
   is not a no-op: the prelude falls through to the exactly-one fast path and
   links the WRONG namesake (the NEO-424 D5 "Bo Jackson" case).
   Fix: the action drives the pages (`await runMutation(page)` until done)
   before it starts the consumer.
2. **Background patchers vs consumer's read set.** A lookup pool (Wikidata,
   5-wide) patching the same rows the consumer reads by range rolls the
   consumer back (the NEO-189/NEO-236 storm). Fix: enqueue the lookups AFTER
   the consumer finishes, not at insert; nobody needs them before then.

**How to apply:** when a plan deletes a review step, a dialog or any "user
confirms" pause, list every scheduled continuation and background enqueue
that used to run during the pause and say what now orders it against the
next transaction. Related: [[convex-occ-read-set-is-the-third-budget]],
[[workpool-cancel-does-not-stop-running-work]].
