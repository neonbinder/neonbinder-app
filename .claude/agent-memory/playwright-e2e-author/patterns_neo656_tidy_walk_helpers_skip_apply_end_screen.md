---
name: neo656-tidy-walk-helpers-skip-apply-end-screen
description: NEO-656 tidy-walk.ts changes - no Keep as is (career "skip" default), applyNameToAll, end-screen verdict/tally, exact suggested-chip name
metadata:
  type: project
---

NEO-656 removed every stored Tidy Up answer, so the walk helpers changed (2026-11-24):

- **No "Keep as is".** Save & next with a Career tile on screen ADDS the default stint to the
  player. `walkAnsweringEverything` defaults to `career: "skip"`: nothing pink + a Career tile up
  means `skipCard`, counted in `WalkTally.careerSkipped`. A hand-written spec that must not write a
  stint uses `skipCard`, never Save & next.
  **Why:** the old "keep" path found 0 buttons silently and Save & next then wrote stints onto shared
  catalogue players. **How to apply:** any spec ending a card with a gap open; expect the end screen
  to count it "still to check" (blue stays until the data changes).
- **An answer links the open card only.** `applyNameToAll(page, "Player"|"Team", printed)` presses
  "Apply to all cards printing “X”". Its line sits in an unlabelled `role="status"` beside the button,
  so the helper diffs the tile's settled status texts before/after the press to find the new line
  (several Apply buttons can be on one tile, and an earlier line stays up).
- **End screen** = verdict status (pink skipped > blue still to check > "All tidy…", empty while team
  lookups are out) + tally "F cards fixed, S skipped[, C still to check].[ Totally rad.]", by each
  walked card's LIVE level. `expectTidyEndScreen` / `readTidyEndScreen`.
- **Preselected chip** name is "<team>, suggested[ · <why>]" from an sr-only span; BUG-2 padded it to
  "<team> , suggested". `suggestedTeamChip` matches the exact name; the generic finder is anchored with
  a non-space before the comma so the padded name does not pass.
- Open risk: after a Team answer the Career gap query re-runs with no perceivable pending state, so
  a gap can appear after the helper looked. See [[patterns-walk-helper-planted-breaks]].
