---
name: gate-flags-need-a-full-union
description: A wire-only fact that decides whether an operator dialog opens should be a union stamped on every row, so absence reads "unknown, open it", not the skip-looking default
metadata:
  type: feedback
---

When a new optional field on a transient table (e.g. `checklistCandidates`) feeds a
client predicate that decides whether an operator review opens or is SKIPPED, do not
add `v.optional(v.literal("risky"))`. Stamp a union on every row of the bucket it
describes (`"number" | "name" | ...`) and have the predicate treat absence as
"unknown → open".

**Why:** with a single literal, absence means "safe", so rows written before the
Convex deploy, a frontend deployed ahead of the backend, a second writer path that
forgets the stamp, or a `getReadyCandidates`-style query whose handler maps fields
explicitly (no spread) and drops the new one all fail SILENT: the review is skipped
and the data commits unreviewed. The union makes every one of those fail safe (the
dialog opens). Cost is a few bytes per row on a ~900-row batch.

**How to apply:** at the writer, derive the value where the decision is made (turn an
`a || b || c` fallback chain into one that records which branch answered). Add it to
schema, the insert-args validator, the query's `returns` AND its explicit row map, and
pin it through the public query in a convex-test (the map omission is invisible to
typecheck). Keep it off any strict commit-path validator; leave it on the wire type
only. Related: [[strict-returns-drift-is-invisible-to-typecheck]].
