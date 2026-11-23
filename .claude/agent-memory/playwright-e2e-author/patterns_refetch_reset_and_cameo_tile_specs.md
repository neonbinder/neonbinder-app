---
name: patterns-refetch-reset-and-cameo-tile-specs
description: NEO-645 — how to prove "a re-fetch starts the names over" (set-history note, not "asked again"), the Review Changes dialog a re-sync of saved cards opens, and the Player tile cameo handles plus the focus race after Remove cameo
metadata:
  type: feedback
---

**Re-fetch reset (A17, `tidyNames.resetForRefetch`).**
- A second Sync of a hand-made, checklist-only set whose saved cards now differ from the
  checklist opens the dialog `Review Changes — Base` first. Its button
  `Skip reviewing changes and continue` applies nothing and goes on to the gate and the save
  ("Saved N cards." again).
- An answered name is NOT asked again after a re-fetch when a card the walk linked still carries
  the link: set history (rule A) re-links it. The proof that the answer was reset is the row's
  purple `note` "Linked for you: another card in this set is already linked to them". The
  operator's own link shows no note. Link a different spelling by hand ("Link to existing…") to a
  player made on an earlier card. A plain "Add as new player" answer cannot tell the two apart,
  because the exact match links it either way.
- A "Not a player" ruling survives: it is the paired positive (the walk count leaves it out).
- Plant: in `resetForRefetch`, make the loop `continue` on every row with a condition that does not
  narrow `row` (`if (page.page.length > 0) continue;`). `if (row) continue;` and `for(;false;)`
  fail the convex typecheck, and the plant tool then exits 2 with "0 passed".

**Cameo on the Player tile.** "+ Cameo" shows only once no Player row is open. Its search uses the
same handles as Link to existing (`Search existing players`, option `Link to <name>`). The row is
group `Cameo <name>` with `Edit cameo <name>`, and the editor holds `Remove cameo <name>`. On a
player card the title reads `<player> & <cameo> #N`. A plant must leave out `regenerateListing`,
not set it to false: the validator is `v.literal(true)`, so false is refused and the cameo is never
saved.

**Focus after Remove cameo raced in 1 run of about 6.** `closeSearch` reads `cameoRef` in a
requestAnimationFrame that is scheduled after an awaited mutation. If that frame comes before
React commits, both add buttons are still unmounted. Keep asserting `toBeFocused()` on "+ Cameo"
and report the race; do not loosen the assert.

**Why:** NEO-645 coverage job C1 (2026-11-22). **How to apply:** any spec about re-fetch or
answer durability, or about tile focus after an async inline write.
