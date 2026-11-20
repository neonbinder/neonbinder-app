---
name: latch-a-conditionally-shown-control-by-row-id
description: A control shown only while a count/flag holds unmounts under its own focus when the condition ends; latch "shown for this row id" in state, no reset step needed
metadata:
  type: reference
---

A panel control gated on live data (e.g. "switch on OR >=1 child") unmounts while focused when the last child goes or the switch is turned off (WCAG 2.4.3). Keep `useState<Id | null>` = the row id it was last wanted for, set during render when the condition holds (lint accepts it), and show while `wanted || latched === currentId`. Keying by id means a row change resets it for free. Test: focus the button, rerender with the condition false using a FRESH element, assert the cell and `document.activeElement`; mutate the latch off to prove the test bites.

A preview line under such a control: call the real builder (`assessNewCardListing` with a placeholder player, leaf-first `titleChainFacts` incl. the leaf row) rather than re-deriving words; fixtures must name the set row as the hobby does ("Chrome"), or the title repeats year + maker.
