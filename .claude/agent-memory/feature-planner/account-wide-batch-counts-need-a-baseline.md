---
name: account-wide-batch-counts-need-a-baseline
description: A spec asserting an absolute count of "running" placeholder batches reads account-wide state; earlier specs on the worker (the dashboard hopper seed) leave collecting jobs, so the spec must clear leftovers itself
metadata:
  type: project
---

"Recent runs" on /print/placeholders lists every placeholderJobs row of the
account, and the 2-batch cap counts every collecting job. The dashboard hopper
seed (`seedMyTestHopperRun`) inserts a `collecting` placeholderJob and its spec
leaves it "for the idle sweep", so any later spec on that worker sees one extra
"running" row and one cap slot gone. NEO-529's join-and-refusal spec went red
on mobile only because the shard plan put the hopper spec ahead of it on the
same account (desktop had them on different shards).

**Why:** shard placement is rebuilt from timings each run, so a cross-spec leak
reds whichever project happens to co-locate them; it reads as a product
double-create ("received 2") but is not one.

**How to apply:** a count assertion on account-wide rows needs a baseline the
spec establishes itself (discard leftovers through the screen after its own run
exists, keeping its own id), never "exactly N" from a clean account. To prove a
leak, list the Recent runs ids from error-context.md and trace each id in the
shard's convex-logs: a seeded job has no processEntryWorker lines. Related:
[[per-user-e2e-tables-reset-in-bootstrap-not-the-global-reset]],
[[leftover-copy-red-is-an-unconfirmed-final-remove]].
