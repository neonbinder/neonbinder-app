---
name: reference_lead_in_p_names_its_list_and_cached_status_needs_a_tick
description: Name a list by its visible lead-in with aria-labelledby (specs then query the lead-in's words); a keyed child's live region mounts pre-filled from a cache, so fill it a timer tick after mount
metadata:
  type: reference
---

A list whose visible lead-in `<p>` ("Printed on 2 cards") already says what it is takes `aria-labelledby={useId()}` on the `ul` and the id on the `<p>`, not a second `aria-label`. The list's accessible name is then the lead-in's words, so Playwright and unit queries use those (a regexp when a count varies: `/^Printed on [0-9]+ cards?$/`), and the wizard's other tests that asked for the old label must change with it.

A step component the wizard keys by row remounts on every step; with the Convex answer already cached, a `role="status"` inside it is born holding its text and may not be announced. `setState` in an effect body is a lint error (`react-hooks/set-state-in-effect`), but `setState` inside a `setTimeout` callback in that effect is fine: store the text once it has been the answer for a tick and return `text && settled === text ? text : ""`. Unit tests then use `waitFor`/`findBy` for the line; the mount itself is asserted empty.

An empty always-mounted status in a `space-y-*` stack: keep it OUT of the spaced stack and give it its own `mb-3` only while it carries text (see [[reference_always_mounted_live_region_in_space_y]]).

Related: [[reference_live_region_text_via_ref_not_state]].
