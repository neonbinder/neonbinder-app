---
name: pointer-field-reverified-on-read
description: An optional v.id pointer on a selectorOptions row (e.g. a type's chosen child) needs no clear-on-delete if every read re-verifies it; what still must learn about it
metadata:
  type: feedback
---

An optional `v.id("selectorOptions")` field on `selectorOptionFields` that points
at another row (a type's chosen child) is safe to leave dangling when the
single reader re-verifies it on every read (row exists, expected `level`,
`parentId === owner`) and treats anything else as absent.

**Why:** Convex validates an id's table, not the document's existence, so a
dangling id never trips the schema or the preview push; Convex ids are never
reused, so a stale pointer can never come to mean a different row. Moves
(Make insert of / Make parallel of / Promote to set) re-parent or recreate
rows, so delete-time clearing would not catch those anyway — only the
read-time check does.

**How to apply:**
- Whole-row `returns` pick it up through `selectorOptionDocValidator`
  (spread of `selectorOptionFields`); the other whole-row validators in
  convex/ are field-by-field picks and need nothing.
- The subtree-wipe pin (`wipeVariantTypeSubtree.test.ts`, "reference graph
  covers every table") is table-level: a new field on an already-listed table
  does not fail it. Add the field to `SUBTREE_REFERENCE_GRAPH.selectorOptions`
  by hand and clear it in `finalizeVariantType` next to `children`
  (write-if-changed; do not widen its `returns`).
- Reference seed carries sport rows only; a field meaningful below sport
  needs no seed change.
- `selectorOptionDocValidator.test.ts` FULLY_POPULATED is not exhaustive
  (no id-typed fields); patch the id onto the seeded type row after its child
  exists if you want the returns pin to cover it.
- Once any row carries the field, roll forward only.

Related: [[cached-lookup-answer-must-reverify-membership]], [[schema-pins-text-scan-vs-export-walk]], [[strict-returns-drift-is-invisible-to-typecheck]].
