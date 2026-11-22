---
name: parallel-commit-chunks-defer-the-shared-flush
description: Running Convex mutations side by side from an action - hunt the one shared write (a ledger/counter flush on a parent row), move it to the caller, prove disjointness with a ctx.db recording Proxy, and keep ties in creation order sequential
metadata:
  type: reference
---

To parallelise sibling mutations (NEO-645, `commitCardChecklist` chunks): list every write AND every read of each. In the commit chunk the only shared write was `CardCountLedger.flush` (leaf row + ancestors); every other write was an insert or a patch of the chunk's own new cards. Fix: optional `deferCardCounts` arg (default = old behaviour, so direct-call tests stay valid), the chunk returns its inserted count, the action sums and lands it once in an internal mutation. Also look for range reads that a sibling's inserts invalidate (a `.collect()` of the whole set) and replace them with `db.get` by id plus a parent check.

Action side: `Promise.allSettled` waves (a transaction cannot be recalled), absorb results in chunk order, land counts for the chunks that DID commit even when a sibling failed, throw the first failure, start no later wave.

Order trap: `by_selector_option_and_sort` ends in `_creationTime`, so cards tying on `sortOrder` (same card number across chunks) read in creation order; parallel chunks would randomise it. Fall back to sequential when a sortOrder spans two chunks.

Testing: convex-test serialises transactions, so concurrency and OCC cannot be shown. Run the exported `_handler` in `t.run` with a recording `ctx.db` Proxy (return only plain arrays from `t.run`, never the proxy or a Set - "commit timestamp is unresolved"), assert "writes to pre-existing docs = none" and "no query on the shared table", and prove the recorder is live with the un-deferred call that DOES patch the parent. `vi.spyOn(fn, "_handler")` counts and fails chunks. Existing tests pin finalize page sequences (`['deletes','rows','review']`), so merging pages is a test-visible change.
