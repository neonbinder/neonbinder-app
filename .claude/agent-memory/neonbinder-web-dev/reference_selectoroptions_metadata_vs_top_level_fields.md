---
name: selectoroptions-metadata-vs-top-level-fields
description: schema.ts has two field objects for selectorOptions; a brief saying "beside parallelsNameThemselves" points at the metadata object, not selectorOptionFields
metadata:
  type: reference
---

`schema.ts` holds `selectorOptionMetadataFields` (ends with
`parallelsNameThemselves`) and, below it, `selectorOptionFields` (the row's
top-level fields, `children` among them). A pointer that is read as
`row.field` and patched as `db.patch(id, { field })` belongs in
`selectorOptionFields` next to `children`, even if a brief says "beside
parallelsNameThemselves". Check how the reader and writer access it before
placing it. A new field in the required-return shape of a query (e.g.
`getParallelsForBuild.sourcePickable`) breaks existing `toEqual` pins on its
empty answers; update those one-liners.
