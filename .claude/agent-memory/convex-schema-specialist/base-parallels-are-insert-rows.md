---
name: base-parallels-are-insert-rows
description: A parallel of the BASE set is an `insert`-level row under a variantType titled Parallel(s); only an insert's sub-parallels are `parallel` level — any "per-parallel" field or backfill must cover both levels
metadata:
  type: reference
---

NB has two shapes of parallel (`parallelChecklistBuild.resolveBuildSource`,
NEO-321):

- `parallel`-level row: a sub-variant of an INSERT, built from that insert.
- `insert`-level row under a variantType whose title is "Parallel(s)"
  (`variantTypeKind`): a parallel of the set's Base, built from the Base.

**Why it matters:** a plan that says "the parallel row gets field X" and
writes or backfills only `level === "parallel"` silently skips every base-set
parallel, which is the common case. Found reviewing NEO-616 (2026-11-19).

**How to apply:** for a derived per-variant value, compute it for every
card-bearing level (`CARD_BEARING_LEVELS` in `cardCounts.ts`: variantType,
insert, parallel) from the row's own cards, with no level or name test; the
backfill walks all three like `backfillVariantCardCounts`. Related:
[[armed-backfill-models-have-no-cursor]], [[per-card-derived-state-hook-points]].
