---
name: drawer-toast-lost-to-a-build-hold
description: A save in the card drawer that releases a parallel build loses its toast (~80 ms); prove it by the drawer's read-back after the build, and expect the Card titles door to say "waiting"
metadata:
  type: feedback
---

A field save in the card drawer (CardDetailPanel) whose write is the last thing holding a
parallel build (NEO-661) shows its field toast ("Saved No Team", ...) for only ~80 ms: the build
starts, `editsHeld` unmounts the drawer (CardChecklist, NEO-312) and the toast state goes with it.
The drawer remounts when the build ends (selectedCardId kept), with no toast. Asserting the toast
is a race the spec wins only when a poll lands in that window (NEO-562).

**Why:** a test must prove the save, not a transient that the product correctly throws away.

**How to apply:**
- After the click: assert what the save causes (the hold line `toHaveCount(0)`, the build line
  visible), then wait for the drawer back with the control in its saved state, scoped to the
  drawer dialog (`getByRole("dialog", { name: "Card #<n>" })`, button `pressed: true`), through
  `expectAfterMarketplace` (the build reads BSC; ~4 s on the fake, none of it BSC's). Asserting the
  build line first guarantees the pressed state you then see is the remounted, stored one.
- The remounted drawer is `aria-modal`, so the Card titles door's self-open is held back
  (`anotherDialogOpen`): expect "Card titles are waiting. Press Fix N card titles..." and close the
  drawer before pressing the door's button.
- Plant: make the drawer ignore the stored stamp (`card.teamNoneConfirmedAt === -1`); the row
  still reads "No Team" but the drawer toggle is unpressed, red at the read-back.
