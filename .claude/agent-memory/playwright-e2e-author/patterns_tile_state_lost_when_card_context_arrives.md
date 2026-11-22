---
name: patterns-tile-state-lost-when-card-context-arrives
description: NEO-645 walk - a control opened on a tile right after a card opens can vanish by itself when the card's context query lands (tile subtree remounts); how to tell it from timing and prove it
metadata:
  type: feedback
---

A walk tile that renders one tree while its context query is `undefined` and another once it
loads (e.g. the Team tile on a teamless card: lone `TeamFillChips` child, then the same component
inside a children array) REMOUNTS that subtree when the context arrives. Local state goes with it:
an "Other team…" search opened in that window closes by itself, chips chosen in it vanish.
`expectCardSettled` cannot see the window when no tile shows "Looking at this card" (a card with
no names has no skeleton), and nothing perceivable marks the context's arrival.

- **Signature:** the click and the fill pass, then the next step (an option in the search) is
  "not found", and the failure PNG shows the tile with its buttons back and no search box. The
  trace shows the open happened ~100 ms after the card opened. Intermittent (whether the query
  beats the click).
- **Prove it with a temporary probe, not a theory:** open the control, then
  `expect(box).toBeHidden({ timeout: 5000 })` inside try/catch and log the ms; open it again and
  check it stays. "Closed at 62 ms, second open stays" is the mechanism. Delete the probe.
- **Then:** it is a product bug (state lost on a data load), not timing. Keep the spec asserting
  the correct behaviour, report it (file, component, the two branches), and verify the rest of the
  spec with a temporary uncommitted copy that re-opens once; delete the copy.
- Look for the same shape in any tile with an `if (context === undefined) return <X/>` early branch.

**Why:** NEO-645 attention-walker rewrite, 2026-11-22; two of three runs red on the first pick.
**How to apply:** any walk spec that presses a tile control right after a card opens and finds the
control's panel gone. Related: [[patterns_tidy_walk_tiles_and_commit_first]].
