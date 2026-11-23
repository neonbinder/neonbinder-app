---
name: removed-button-absence-and-described-field
description: Proving a removed control stays gone (plant every client gate at once) and a refused field's describedby/focus (toHaveAccessibleDescription, toBeFocused)
metadata:
  type: feedback
---

A control removed by a ticket ("Apply to all" on a Team tile for a card with no player, NEO-645) is
proved absent by the exact condition the OLD code offered it on: check the old gate in `git show`
and look for an existing fixture that already reaches it before adding cards (the team-card spec's
"Checklist" row was a second teamless no-player card already). Assert
`getByRole("button", { name: /^Apply to/ })` count 0 inside the tile, paired (R2) with the sibling
control that renders in the same block ("+ Another team").

**Why:** the new code had two redundant client gates (`who !== ""` and `hasTeamLine(lineKey)`);
reverting one alone stays green and looks like a vacuous spec.

**How to apply:** the plant removes every gate in one `find` (keep imports referenced so the
bundle still builds), with `--expect` on the assertion's message.

A field whose refusal is an `aria-describedby` alert: `toHaveAccessibleDescription("")` before,
`toHaveAccessibleDescription(<refusal>)` after, and `toBeFocused()` after a button-press refusal
(the product refocuses the field). A tile group and its textbox can share a name ("Card name"):
scope the textbox to the group with `exact: true`. See [[walk-helper-planted-breaks]].
