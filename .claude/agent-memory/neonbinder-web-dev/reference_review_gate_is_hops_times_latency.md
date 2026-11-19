---
name: review-gate-is-hops-times-latency
description: resolveChecklistEntities wall time is action-to-query hops plus sequential db reads times storage latency; the fix pattern is one prelude query, positional batch queries, mapBounded inside queries, settleAll at action level
metadata:
  type: reference
---

The review gate's time was never compute (userExecutionTime ~20 ms a query); it
was ~46 sequential `ctx.runQuery` hops and ~660 sequential `db.get`s. House
pattern since NEO-592:

- Independent reads inside ONE query go through `convex/lib/boundedConcurrency.ts`
  `mapBounded` (16 wide = Convex's storage batch width, order kept, settles every
  worker before rethrowing). Dependent steps stay sequential.
- Action-level fan-out uses `settleAll` (allSettled, then throw) and stays at 8
  runQuery in flight (players 4 + teams 3 + history scan 1).
- A positional batch query (`findManyByNameAndSport`, `resolveNamesForReview`)
  must be the single-name helper mapped, so it cannot answer differently.
- Per-item `Map` caches become promise memos (`memoizeAsync`) once reads overlap.
- `review_gate_timing` (ids, counts, hops, per-phase ms) is the log line to read.
- Not fixed, still sequential by nature: `historyNodes` / `historyCardBatch`
  (cursor walk), which becomes the critical path on a set with committed cards.
