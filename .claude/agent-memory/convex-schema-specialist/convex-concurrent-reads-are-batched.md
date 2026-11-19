---
name: convex-concurrent-reads-are-batched
description: Inside one query/mutation, concurrently awaited db.get / query reads are sent to storage as one batch per round (OSS default 16 per batch); sequential awaits pay one storage round trip each, and the "too many system operations" error is a syscall wall-time budget
metadata:
  type: reference
---

Inside a single Convex query or mutation, `Promise.all` over `ctx.db.get` and
indexed `.first()`/`.take()` really does overlap storage round trips. It is not
serialised.

Evidence (checked 2026-11-17 against convex 1.49 and the open-source backend):
- Docs, "Reading data", the join example: "by using Promise.all, the user
  documents will be fetched from the database in parallel, making join patterns
  like this very fast."
- convex-backend `crates/isolate/src/environment/udf/async_syscall.rs`:
  `AsyncSyscallBatch::Reads` groups pending `1.0/get` and `1.0/queryStreamNext`
  syscalls. The batch runs as one `query_batch` call, which leads to one
  `index_range_batch` per round. Results reach JS together ("execute in a batch
  for determinism").
- `crates/common/src/knobs.rs`: `MAX_SYSCALL_BATCH_SIZE` defaults to 16, so a
  pool wider than 16 runs as several back-to-back batches. Convex Cloud may tune
  this knob.
- `.take(n)` in JS is `limit(n).collect()`, which issues one `queryStreamNext`
  syscall per row. The backend prefetches pages, so IO costs a few range reads,
  not n.

**The "too many system operations" error is a wall-time budget.** The knob
`DATABASE_UDF_SYSTEM_TIMEOUT` is 15 s of "system time ... i.e. syscalls". Its
comment says 4096 queries x 1.6 ms is 6.4 s when run in sequence. The repo's
"~900 ops comfortable / ~4,000 failing" calibration
([[convex-two-transaction-limits]]) is really about sequential latency, so
storage slow-downs push it lower and concurrency pushes it higher. Do not raise
a slice cap on that basis without a measurement.

**How to apply:**
- Estimate a query's latency in batch rounds: ceil(reads / 16) per dependent
  step.
- Pick a pool size of 16 or more. Below 16 leaves batch slots empty.
- A bounded-concurrency helper must settle every worker before it rethrows, so
  no promise is left dangling.
- When per-item memo caches (`Map<id, value>`) go concurrent, turn them into
  promise memos, or the dedupe is lost.
- Concurrency in a public query leaves its read set and invalidation unchanged.
  Only latency changes.
