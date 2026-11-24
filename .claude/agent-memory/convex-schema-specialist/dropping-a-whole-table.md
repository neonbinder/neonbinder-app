---
name: dropping-a-whole-table
description: Removing a whole table from schema.ts ships in one PR (rows outside the schema are never validated); the real hazard is the CLI large-index-deletion check, which fails a non-TTY deploy when a dropped index's table holds 100k+ docs
metadata:
  type: project
---

Dropping a TABLE is not the field-removal hazard. Convex validates only the
tables listed in the schema ("You can still create and modify documents in
other tables (they just won't be validated)"). Leftover rows on previews, dev
and prod become an unvalidated table and never reject a push. Stop reading,
stop writing and delete the schema block in ONE PR. With
`strictTableNameTypes` (the default), typecheck flags every leftover reader.

**The hazard that does apply** (convex CLI 1.49, `checkForLargeIndexDeletion`):
- Dropping a table drops its indexes.
- When any dropped index's table has at least 100,000 docs
  (`MIN_DOCUMENTS_FOR_INDEX_DELETE_WARNING`, env-overridable by
  `CONVEX_MIN_DOCUMENTS_FOR_INDEX_DELETE_WARNING`), the push needs a TTY
  "yes".
- Without a TTY it exits 1 unless `--skip-large-indexes-check` is passed.
- This repo's `vercel.json` buildCommand passes no such flag and runs
  non-TTY (preview and release).
- The check runs before the push commits, so a trip changes nothing; it
  only fails the build.

**Why:** found sizing NEO-656 (drop `tidyNames`, `cardPrintedNames`,
`entityReviewSkips`, maybe `entityReviewQueue`), 2026-11-23.

**How to apply:**
- Read the prod row count of each dropped table before merge. If one is
  over 100k, add the flag in the same PR. Never drain the table to dodge
  the check.
- Field changes on tables that STAY in the PR still follow the three-step
  rule ([[preview-schema-rejects-stale-rows-after-field-removal]] in the
  wrapper memory).
- Never re-add a table under a dropped name without clearing it first.
  The old rows would then be validated against the new shape.
- Unwire the [[transient-side-table-checklist]] in reverse. Two pins fail
  loudly on a dropped table left behind:
  - the wipe-graph pin (graph key not in schema);
  - the reference-seed `cli.test.mjs`.

  See [[schema-pins-text-scan-vs-export-walk]].
- Workpool 0.4.15 catches a missing onComplete (`complete.js`), so queued
  pool items whose functions were deleted fail once and drain.
