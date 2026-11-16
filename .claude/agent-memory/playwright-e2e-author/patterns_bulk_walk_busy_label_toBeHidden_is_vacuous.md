---
name: bulk-walk-busy-label-tobehidden-is-vacuous
description: After pressing "Add remaining players as new", toBeHidden on "Adding players…" passes before the label paints; wait for a positive finished sign instead
metadata:
  type: feedback
---

`await expect(wizard.getByRole("button", { name: "Adding players…" })).toBeHidden()` right after the
bulk click is vacuous: the tap returns, the label paints a render later (about 70 to 100 ms on the
phone project), and the check passes on the not-yet-painted state. The old step (its "Add as New
Player" button) is still on screen, a following `isVisible()` branch picks it, and the walk moves the
wizard to the next step under the click (7 s timeout on a button that left). Found in the NEO-535
trace: click returned at +16.69 s, hidden check passed at +16.77 s, screencast frame at +16.76 s
first shows "Adding players…", the step decides at +16.8 s.

**Why:** a negative assert on a transient state proves nothing about the walk having started (see
[[patterns_negative_asserts_pass_on_a_dead_page]]).

**How to apply:** after the bulk click wait for a POSITIVE end state: the link reading
`Add remaining players as new (0)` (a team/league name still undecided) OR Next / Confirm & Save
(every name decided; the links are unmounted then). `expectBulkWalkDone` in the
inserts-1996-score spec is the shape. The count in the link is `remainingPlayers` (players only).
`setup.spec.ts` and `inventory-bsc-listing-2026-bowman-chrome-prefix.spec.ts` click the link and
move on without this gate, which is fine there because nothing branches on the stale step.
