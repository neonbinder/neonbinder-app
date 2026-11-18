---
name: reference_new_checklist_row_field_has_three_copy_sites
description: A new optional field on PublishedChecklistRow must be added to three copy sites or it silently vanishes in set mode / at the server
metadata:
  type: reference
---

A new optional `PublishedChecklistRow` field (variationName, prospect...) is set by the parser but
copied field-by-field elsewhere, so it drops without an error:

- `lib/checklists/checklist-sections.ts` `withoutSubset` (set mode / sections) and its `ChecklistSectionRow` type.
- `convex/lib/publishedChecklistCheck.ts` `publishedChecklistRowValidator` (v.object rejects unknown keys) AND the stored-row validator, plus the re-check's returned object.
- `lib/checklists/apply-published-row.ts` row input type, where the client rebuilds a row.

The golden snapshot proves nothing here when no fixture holds the new shape: it stays green with or
without the copy. Prove the copy with a unit test on the sections path. The server does NOT re-parse
rows; it validates what the client sent, so "re-derive identically" never applies there.
