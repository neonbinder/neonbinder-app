---
name: planted-break-collides-with-a-sibling-plant
description: When parallel builders prove their tests red by planting in the same product file, a baseline red and a "byte-exact" backup can both be the sibling's plant; restore from HEAD, not a cp
metadata:
  type: feedback
---

A unit-test author and an E2E author often both prove "can fail" by planting the SAME
break in the same product component, in the same worktree, at the same time. Seen on
NEO-590: my unplanted baseline went red with the exact planted-break numbers, then green
on the next run, and my `cp` backup of the product file turned out to be the sibling's
planted state (restoring it would have shipped the break).

**Why:** the working tree is shared; a sibling's plant/restore window can cover your
baseline run and your backup copy. "Byte-exact restore" against a polluted backup is wrong.

**How to apply:**
- Before the baseline and before planting, `git diff --exit-code <product file>`; if it
  differs from HEAD and the diff is not yours, a sibling is mid-plant: wait or tell the
  coordinator, do not run.
- Restore by reversing your own one-line edit (sed back) or compare to
  `git show HEAD:<path> | shasum`, never by copying back a working-tree snapshot.
- Shasum the product file before and after each green run, so a sibling plant during the
  run is visible rather than read as a flake (see never diagnose timing first (GUIDE) in the agent rules).
- A one-off red that matches your own planted numbers exactly, with no plant of yours in
  place, is this mechanism until shown otherwise.
