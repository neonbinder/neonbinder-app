---
name: reference_grid_autofit_stops_last_row_stretching
description: flex-wrap + grow makes a short last row stretch across; use grid auto-fit minmax(min(9rem,100%),1fr) so every card keeps the same size
metadata:
  type: reference
---

`flex flex-wrap` with `grow basis-*` children stretches a wrapped last row to the full width. For equal cards use `grid grid-cols-[repeat(auto-fit,minmax(min(9rem,100%),1fr))]`: a single short row still fills (empty tracks collapse), a wrapped last row keeps the others' width. Fixed in `ModeRadioGroup` (NEO-673), shared by every caller; a test can only pin the class names (happy-dom has no layout). See [[reference_unlayered_css_beats_tailwind_utilities]].
