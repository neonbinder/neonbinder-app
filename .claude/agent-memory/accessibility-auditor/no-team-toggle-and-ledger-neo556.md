---
name: no-team-toggle-and-ledger-neo556
description: NEO-556 No Team toggle on TeamPicker and NoTeamCardsControl ledger - what held up and the recurring gaps (global querySelector focus restore, describedby not forwarded, silent count result, hint naming an unreachable control)
metadata:
  type: project
---

TeamPicker's aria-pressed "No Team" toggle reuses the "+ Add team" trigger's px-2 py-0.5 text-xs box (about 20px tall): passes 2.5.8 only through the spacing exception, same as the existing trigger.

Held up: the three toggle names are pairwise non-containing and start with the visible words (2.5.3); NoTeamCardsControl parks focus (ledger after Yes, offer after Cancel, ledger on run end); Stop uses aria-disabled; the scroll group is named.

Recurring gaps: a new focus restore done with `document.querySelector(aria-label)` instead of a row ref (wrong panel when two are open, and a natively disabled target swallows .focus()); `ariaDescribedBy` forwarded to the trigger but not to the new sibling toggle; a one-shot count whose RESULT (an offer appearing) is never announced after "Counting cards..." clears; operator hints naming "Set details" when the control reads "Edit attributes".

**How to apply:** on any new control added beside an existing picker trigger, check describedby forwarding, focus-restore scoping, and whether the hint copy names a control that exists.
