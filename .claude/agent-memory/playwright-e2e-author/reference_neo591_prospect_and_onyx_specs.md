---
name: reference_neo591_prospect_and_onyx_specs
description: NEO-591 handles — Prospect Card in the drawer, the held "Prospect (X)" teams line, set-checklist preview rows, and reaching one named player step in a big checklist-only wizard
metadata:
  type: reference
---

- **Prospect Card** is a pressed toggle, not a checkbox: drawer "Card #N" → "Show features
  editor" → `getByRole("button", { name: "Value for Prospect Card", pressed: true })`. Rookie
  Card beside it IS a checkbox ("Value for Rookie Card").
- **Card No Team in the drawer**: `button "No Team for this card"` with aria-pressed; a team
  shows as `button "Remove team <name>"`.
- **Held "Prospect (X)" on the teams step**: one listitem, text `#<n> · <player>` and
  `Listed as: <X>`; radiogroup `Team for <player>` with only `No team on this card — <player>`
  and `Leave for later — <player>` (checked) when no minor/college team answers X. Count the
  radios to prove no pre-fill and no big-league choice. Bare Prospect (No Team) and a settled X
  never reach the step.
- **Checklist row text** is spans with no spaces between name and team: `getByText` on
  "#1 Name No Team" fails. Match the team part only (`#<n>[^#]*<team>`) and read the player
  off `Edit card <n>, <player>`.
- **Set-checklist preview rows**: row named by rowheader; `row.getByRole("cell")` is
  `[count, numbers]` ("NNO only"); skipped-line reasons are summaries like
  `Above the column headings (1)`.
- **Reaching a named player step** in a checklist-only wizard: `walkToPlayerRow` (skips team
  steps), then a loop bounded by the section's row count: break on
  `heading level 3 name exact`, else `personSkip` + `expectStepLeft`. Players come in batch
  order, not file order. Then `cancelAndDiscard` (the skips are decisions).
- Leaf official-checklist preview reads a `Prospect (X)` cell as "We'll look it up" (reported
  NEO-591 as misleading copy; do not pin it until the product decides).
Related: [[reference_hand_made_rows_cannot_reach_the_commit_path]], [[reference_neo335_teams_on_cards_section]]
