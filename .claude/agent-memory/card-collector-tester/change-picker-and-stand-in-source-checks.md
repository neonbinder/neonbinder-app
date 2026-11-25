---
name: change-picker-and-stand-in-source-checks
description: Checks for a "Change" control that reopens a pick-one list, and for sets where one parallel stands in for a missing Base (Pulse-type unlicensed sets)
metadata:
  type: feedback
---

When a stored pick can be changed by reopening the same list:
- The reopened list must show the current pick (checked or tagged "current"); a blank list on Change reads as "nothing was picked".
- Names-only lists hide the one fact a dealer needs on Change: which row actually has cards. Picking an empty sibling silently strands the synced one.
- Escape should cancel and return focus to Change; a half-picked radio must not survive a reopen.

When a parallel stands in for a missing Base (unlicensed sets often have only colour parallels, the cheapest/most common acting as "base"):
- Heading copy that says "the base set" when no Base row exists; prefer the set's own name.
- Mark the stand-in in the column list, not only in the panel, or a dealer opening a sibling cannot tell which row is the master.
- An enabled "Build N from X" while X still needs Tidy Up invites a run that ends in N held rows; say the hold before the click.
- The level label in "Attributes for X (Insert)" leaks the storage level on parallel rows (pre-existing, but louder when the row is the master).

**Why:** NEO-673 pass (2026-11-25) found these on the first walk of the chosen-source panel.
**How to apply:** any pick-one/stand-in feature: open Change, check current-marking, empty-choice guard, and the hold-before-click line.

Related: [[multi-landing-dialog-copy-follows-the-landing]]
