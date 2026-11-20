---
name: post-name-next-held-then-gone
description: A wizard post-name step can hold Next aria-disabled while it settles ("Checking careers…", NEO-574) and then vanish straight onto Save; press only a usable Next (disabled:false) after waiting for Next-usable OR Save OR autograph tiles
metadata:
  type: feedback
---

The Tidy up wizard's Career check (NEO-574) shows "Checking careers…" with Next
aria-disabled, and when nothing needs a look the step drops out with no gap, straight
to the next step or "Ready to save". A loop that waits for `Next.or(Save)` and then
clicks Next catches the held Next, the click waits for enabled, the element detaches
and the click times out at 7 s (seen on mobile only; desktop missed the race).

**Why:** a held control that may disappear is two states, not one; waiting on "on
screen" instead of "usable" races the step change (NEO-602 follow-up).

**How to apply:** in `support/wizard.ts` the walkers (`advanceToSave`,
`walkToAutographStep`, `passCareerCheck`, `passCareerAndTeamsSteps`) share
`expectPostNameStepSettled` (usable Next, Confirm & Save, or the autograph tiles, whose
Next stays held until a tile is picked; `.first()` because a pre-answered autograph
step shows tiles AND a usable Next) and press `usableNextButton`. Read a subtitle only
after that settle. Any new walker reuses them. Related:
[[aria-disabled-refusal-by-keyboard]].
