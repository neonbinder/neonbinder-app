---
name: patterns_note_under_a_toggle_and_ebay_aspects
description: Prove a line under a pressed toggle is ITS description with toHaveAccessibleDescription; eBay item aspects have no perceivable E2E surface (no hop read op, no NB UI)
metadata:
  type: reference
---

**A note line under a toggle (NEO-619 sample title).** Locate the line by its own
visible lead (`getByText(new RegExp("^<lead>"))`), assert its text (positive name
first, then `not.toHaveText(/\b<other>\b/)`), then prove the link with
`expect(toggle).toHaveAccessibleDescription(await note.innerText())` (read the
text only after a web-first toHaveText settled it). When the note goes, assert
`toHaveCount(0)` AND `toHaveAccessibleDescription("")` after a positive
`aria-pressed` check, so a dead page cannot pass ([[patterns_negative_asserts_pass_on_a_dead_page]]).
A client-only plant (drop the note's condition; strip the row's metadata before
the builder) goes red through Vite HMR with no backend push.

**eBay item aspects ("Insert Set", "Parallel/Variety") cannot be asserted in E2E.**
The `/testing/ebay-fake` hop has only `seller`, `order` and `poll` ops, and no NB
screen shows a listed item's aspects. A request to prove an aspect drop live
needs a product read surface (a hop op) first: report it as a gap; the unit test
on `ebayCardFacts` is the cover. Never inspect the fake's wire to dodge it.
