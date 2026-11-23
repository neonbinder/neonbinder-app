---
name: reference_swap_a_storage_layer_with_a_pseudo_row_adapter
description: Swapping the table a big prelude reads (queue rows -> name rows): read the new rows through one adapter in the OLD shape, and shim the old test seeds the same way
metadata:
  type: reference
---

When a 2,000-line decision machinery (the commit prelude) was written against
one table's row shape and the answers move to another table, do not fork it:
write ONE pure adapter (`convex/lib/tidyAnswerDecisions.ts`, new row -> old
shape) and read through it, so every existing rule keeps its code path.

- Tests follow the same way: a shim in `lib/testing` that takes the OLD seed
  shape and inserts the new row (`tidy-review-row.ts`), and a `queueRowsOf`
  helper that reads the new rows back in the old shape. Convert a test file's
  seeds WHOLESALE only if none of its tests call the old module's own
  functions (`recordDecision` etc.); otherwise convert test by test, or the
  tests that pin the old module break instead.
- Make the shim THROW on a shape the new design retired (a `create` decision,
  a staged `source` row): a test that still needs one then fails loudly rather
  than passing on nothing.
- A bulk "delete the failing retired tests" script is refused by the
  permission layer here: list the retired tests with the design row that
  retires them and let the coordinator approve the deletion.
