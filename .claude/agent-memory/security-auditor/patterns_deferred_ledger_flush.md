---
name: patterns-deferred-ledger-flush
description: Moving a counter/ledger flush out of the writing transaction into a later "landing" mutation (to parallelise chunks) breaks atomicity; delta landing never heals on re-run because adopted rows carry delta 0
metadata:
  type: project
---

NEO-645 parallel commit chunks: each chunk skips its `CardCountLedger.flush` (`deferCardCounts`)
and the action lands the summed delta once in an internal mutation. Audit shape that held:
new mutation internal + pinned in `publicFunctionAuth.test.ts`; new chunk arg optional with the
old behaviour as default; the old whole-set `.collect()` became `db.get(existingId)` plus a
`row.selectorOptionId === args.selectorOptionId` check, so a foreign id still misses (pin that test).

**The trap:** once the delta leaves the inserting transaction, any failure between insert and
landing leaves counts permanently low. A re-run adopts the landed rows as UPDATES (delta 0), so a
delta-based landing never heals; only a recount or the armed backfill does. Counts here gate
collector visibility (exact zero hidden) and bulk "is this row empty" shortcuts, so it is
silent integrity drift, not exposure (the commit is admin-only, the data is shared catalog).

**How to apply:** when a diff defers a shared write out of a transaction, ask "what heals it if
the landing never runs?" The fix is an idempotent landing (recount, or a dirty marker the next
flush recounts), not a delta. A `test.fails` pin of the gap is a tracked bug, not a fix.
Also check `deltaFor(leaf)` is the ledger's ONLY row: a future ledger write to another row would
be dropped silently in deferred mode. Related: [[patterns-neo219-sanctioned-delete]] (actions escape OCC).
