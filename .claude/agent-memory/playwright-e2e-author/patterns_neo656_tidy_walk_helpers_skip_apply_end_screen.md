---
name: neo656-tidy-walk-helpers-skip-apply-end-screen
description: NEO-656 tidy-walk.ts changes - no Keep as is (career "skip" default), applyNameToAll (button stays disabled), end-screen verdict/tally, exact chip name, walk-memory answer after Back
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
- **Blue end screen (B20):** a saved blue card ends `{ fixed: F, stillToCheck: 1 }` and the button is
  "Check the card still to check" (pink wins: "Review the skipped card"). Pressing it pushes to the
  first passed-and-flagged card; Back returns to the end screen. Checklist keeps the blue mark and the
  pill reads "1 needs you". Plant (outside tidy/ UI files): `attention.level === "check"` to
  `"never"` in `walk-order.ts` `cardsStillToCheck`; `--expect "end screen's verdict"`.
- **Preselected chip** name is "<team>, suggested[ · <why>]" from an sr-only span; BUG-2 padded it to
  "<team> , suggested". `suggestedTeamChip` matches the exact name; the generic finder is anchored with
  a non-space before the comma so the padded name does not pass.
- **Live career gaps move pill counts.** A team written onto a card whose single player has no
  stint with it (a line apply, a new club, a gate-linked catalogue player) is BLUE until a stint
  covers it, so "N need you" grows (old "16 need you, 16 to fix" became "18 need you, 16 to fix").
  Save & next over the gap writes the stint and clears sibling cards, but `advance` reads the
  pre-save `order`, so it can land on a card the same save just cleared (reported 2026-11-24).
- **Where-the-pick-lives check:** a tile's "while the card is open" state lives in `walk-memory`
  (`keepPick`, `rememberAnswer`); a write path that skips it (the cameo shortcut, 2026-11-24)
  makes the tile vanish. Grep the handler for `memory.` before blaming the spec.
- Open risk: after a Team answer the Career gap query re-runs with no perceivable pending state, so
  a gap can appear after the helper looked. See [[patterns-walk-helper-planted-breaks]].
- **A pressed Apply to all stays, disabled,** beside its "Cleared/Linked N more card(s)." line once
  no other card waits: assert `toBeDisabled()`, not `toHaveCount(0)`.
- **"Not a player" is held in walk memory only while the card is open** (`leaveCard`). After Back to
  the card, a `toHaveCount(0)` on "<name> is not a player." passed even with leaveCard planted to keep
  it: the Player tile draws a beat after the header. Anchor first on the Team tile's own line (e.g.
  "No team on this card.") from the same card read, then assert the Player tile is absent. Plant
  `leaveCard` to prove it.
