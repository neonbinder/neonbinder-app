---
name: fixed-table-layout-counts-a-hidden-column-in-a-colspan
description: A heading row's colSpan larger than the visible column count is harmless in an auto table but adds an empty column in `table-fixed`, stealing a share of the width; count the visible columns, and use flex + `min-w-0 truncate` spans (not text-overflow on the td) to clip one line with chips kept
metadata:
  type: reference
---

Seen in NEO-598 (Pick List Condensed rows, one line each). Switching a table to
`md:table-fixed` so every cell clips (`overflow-hidden whitespace-nowrap`) made
the data rows stop short of the group headings: `colSpan={columns}` counted a
phone-only `md:hidden` column, and a fixed layout gives a phantom column its
share of the free width. Auto layout had hidden the same over-count for years.

**How to apply:**
- In a `table-fixed` table, make section-head `colSpan` equal the columns visible at the fixed breakpoint.
- Fixed layout reads widths from the first row (the header). A percentage plus
  several fixed widths can starve the one unsized column to ~0 at the 1024 CI
  viewport (the demo/binder content is ~758-806px there): leave the long text
  columns unsized so they split the remainder, and screenshot at 1024.
- To clip with an ellipsis yet keep chips (variant, markers) visible, put a
  `flex min-w-0` row in the td and give only the text spans `min-w-0 truncate`
  (and a `title` with the full text); chips are `shrink-0`. `text-overflow` on
  the td itself does not reach flex children. Inline lists (orders joined by
  commas) can instead be `md:block md:truncate` on one wrapper.
- A 24px control (WCAG 2.2 AA floor) sets the row height: 24 + `py-0.5` + 1px rule = 29px
  against a 20px text-sm line, so "one line" assertions use ~1.5x line-height.

Related: [[demo-content-column-is-806px-at-e2e-width]], [[unlayered-text-wrap-beats-truncate]].
