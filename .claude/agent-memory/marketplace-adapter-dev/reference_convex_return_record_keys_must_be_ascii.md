---
name: reference-convex-return-record-keys-must-be-ascii
description: A Convex return value (or stored doc) with a non-ASCII record key fails validation; return a {key, entry}[] array and rebuild the object off-box
metadata:
  type: reference
---

A `v.record(v.string(), ...)` return keyed by a normalised name (accented player or team names) throws at runtime: Convex field names must be ASCII. tsc stays green; only an accented name in real data trips it, so a fixture with ASCII names never shows it.

**How to apply:** return `{ key, entry }[]` (sorted) and keep the on-disk object format untouched; a one-line `jq 'map({(.key): .entry}) | add // {}'` rebuilds it. In-memory records keyed by accented strings are fine; only the Convex boundary refuses. Tests that did `Object.keys(out.x)` on such a return now see array indexes ("0","1"), which is the tell. Related: [[reference_convex_test_t_run_rejects_undefined]].
