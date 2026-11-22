---
name: patterns_bulk_walk_busy_label_toBeHidden_is_vacuous
description: After pressing a bulk control ("Add N players" in the walk's Add all confirm) toBeHidden on its busy label passes before the label paints; wait for the positive counts status instead
metadata:
  type: feedback
---

`await expect(walk.getByRole("button", { name: "<busy label>" })).toBeHidden()` right after a bulk click is vacuous:
the tap returns, the label paints a render later (about 70 to 100 ms on the phone project), and the check passes
on the not-yet-painted state. The old step is still on screen, a following `isVisible()` branch picks it, and the
walk moves under the click (7 s timeout on a button that left). Found in the NEO-535 trace (old wizard's "Adding
players…"): click returned at +16.69 s, hidden check passed at +16.77 s, first painted frame at +16.76 s.

**Why:** a negative assert on a transient state proves nothing about the work having started (see
[[patterns_negative_asserts_pass_on_a_dead_page]]).

**How to apply on the walk:** the bulk control is "Add all N new players" (`addAllNewPlayersTrigger`,
`newPlayersToAdd`; confirm `Add N players` / `Cancel adding new players`). After the confirm click wait for the
POSITIVE end state, the house counts status beside the trigger: `walk.getByRole("status").filter({ hasText: /^Added
N players\.$/ })` (with skips: `Added N players. M left as they were.`), and only then read the Player tile
(`pinkTile(page, "Player")` gone). Spec: `tidy-up-add-all-new-players-adds-only-names-nothing-else-answers.spec.ts`.
