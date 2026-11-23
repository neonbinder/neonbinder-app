---
name: pattern-walk-focus-is-one-owed-rule
description: Tidy Up walk focus: one placeFocus rule for arrival, answers and the lost-focus repair; hand focus to combobox via focusWithoutOpening; a pink tile's controls can arrive after the card
metadata:
  type: feedback
---

In the Tidy Up walk every focus move goes through one `placeFocus` (first control of the first `[data-tidy-level="fix"]` tile, else Save & next, typing field left alone). Arrival, Save/Skip/Back, a tile answer and the MutationObserver repair all call it; nothing focuses the card header any more except the end screen.

**Why:** two rAF paths (observer repair and answer tick) used to race and each had its own rule; a plain `.focus()` on a combobox opens its list and, with `selectOnFocus`, selects its text (a "preselected name box"). Pink tiles such as Team/Player render no controls until `cardContext` loads, so "nothing pink in the DOM" is not "nothing pink": gate Save & next on the derived pink count, park focus on the header and let the observer pay the owed focus once the control mounts (only while focus is still parked there).

**How to apply:** any new programmatic focus that can land on a combobox goes through `focusWithoutOpening` (primitives/Autocomplete). A button owns Enter, so a test that "presses Enter" on a focused Save & next must click it, not keyDown the dialog. Holding Enter (auto-repeat) on a focused native button still clicks it repeatedly; that carry-over is not guarded.
