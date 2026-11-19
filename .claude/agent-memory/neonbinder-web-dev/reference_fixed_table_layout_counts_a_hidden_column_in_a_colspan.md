---
name: fixed-table-layout-counts-a-hidden-column-in-a-colspan
description: Dense one-line table rows (NEO-598): wrap atomic pieces with nowrap instead of clipping; auto layout plus `w-1` on the short columns sizes by content; a colSpan over the visible column count is harmless in auto but a phantom column in `table-fixed`
metadata:
  type: reference
---

Seen in NEO-598 (Pick List Condensed rows). The first build used `table-fixed`
plus `min-w-0 truncate` spans so each row stayed on one line; the owner then
chose "wrap, never clip". Final shape: auto layout, nothing truncated.

**How to apply:**
- Keep atomic pieces whole with `whitespace-nowrap` (number, chips, serial, grade
  plus cert, each order, the team); let the long free text wrap. A flex-wrap
  line (`flex flex-wrap gap-x-* gap-y-*`) holds name + team + chips so it breaks
  between pieces, not inside them.
- In auto layout the browser divides the width by content, which starves the
  short columns and over-feeds long text. `w-1` (min-content width) on the
  number, condition and qty heads makes them shrink to fit and gives the width
  back to the text columns. Measure with a row-height scan at 1024/1280/1440/1920.
- `colSpan` larger than the visible columns is harmless in auto layout but adds
  an empty column in `table-fixed`; if you ever fix the layout, count the
  visible columns at that breakpoint. Fixed layout reads widths from the header
  row and can starve an unsized column at the ~758px 1024 content width.
- No-clip proof in E2E: for every element in the text cells,
  `scrollWidth <= clientWidth` (skip 1px sr-only spans and button cells whose
  hit-area pseudo-elements reach out), and table width <= region width. Plant
  `max-w-[8ch] truncate` on the name to see it go red.
- A 24px control (WCAG 2.2 AA floor) sets the row height: 24 + `py-0.5` + 1px rule = 29px
  against a 20px text-sm line, so "one line" assertions use ~1.5x line-height.

Related: [[demo-content-column-is-806px-at-e2e-width]], [[unlayered-text-wrap-beats-truncate]].
