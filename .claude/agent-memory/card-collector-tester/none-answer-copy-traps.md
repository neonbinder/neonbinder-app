---
name: none-answer-copy-traps
description: Copy and state traps for "none" answers (No Team, No Player) set at set level and per card — dealer reading of "listed", inherited-state display, one-way toggles
metadata:
  type: feedback
---

Checks for any "No X" answer that can come from a set default or a per-card toggle:

- **"Listed" means for sale to a dealer.** Never say a card "is listed with a team" for checklist/source data; say the card's checklist or the incoming data "names a team".
- **"Every new card gets No X" overclaims** when cards whose data names an X are skipped. Say "every new card with nothing naming a team".
- **Accessible names must not overclaim either**: a set-level toggle named "for every card here" while existing cards are untouched is wrong; "for new cards here".
- **Inherited state must show where the card is made.** A quick-add form whose toggle sits un-pressed while the server will apply the set's No X anyway lies; show the inherited answer with "from the set" and let picking a team override.
- **One-way toggles** (pressed state cannot be un-pressed, only replaced by picking a value) need the same behaviour and words on every surface.
- **Name the control the operator can see.** Hints pointing at "Set details" when the visible control says "Edit attributes" send them hunting.
- **Unlicensed sets (Leaf, some Panini)** show no logos, yet dealers still put the player's team in titles for search; a set-wide No X should make clear what it does to titles.

**Why:** NEO-556 review (2026-11-14) found each of these in one feature.
**How to apply:** run through this list on any set-default + per-card answer feature. Related: [[twin-names-copy-review]], [[multi-landing-dialog-copy-follows-the-landing]].
