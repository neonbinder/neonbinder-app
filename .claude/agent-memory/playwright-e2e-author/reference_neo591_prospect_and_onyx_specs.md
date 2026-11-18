---
name: reference_neo591_prospect_and_onyx_specs
description: NEO-591 handles — Prospect Card, held "Prospect (X)" line and its Remember box, place team cells, preview rows, Match Cards unlink/relink, the only set with a team conflict, a named player step
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
- **Leaf preview cells** print the claim as written ("Prospect (Oklahoma)", "Seattle"); mixed
  parts join with " / ". Rows are named "<n> <player> <cell>": `getByRole("row", { name, exact })`.
- **Place team cells** (set needs a league; a hand-made Baseball set gets MLB): a place with
  exactly one league team settles before the wizard (no step, no Teams line); an ambiguous one
  is a NAME step "New Team: <place>" whose Remember box settles enabled+unticked. Skipping it
  drops it from "Listed as" on the Teams step (skipped = the operator's ruling).
- **Held line's Remember box** enables only once one existing team is picked: "Other team… —
  <player>" → combobox "Team name to find" → option `+ New team “<minted>”…` → dialog
  `New team: <minted>` → "Create team <minted>". Mint the team (an alias on a catalogue team
  would settle the next attempt's X), read it on /admin/teams, then clear "Also known as" + Save.
- **A team conflict needs a marketplace team in the BULK answer**: with a checklist no card is
  looked up, so only Football 2014 Topps team-leader cards (BSC "<Team> TL") carry one. Held X
  there shows X on the checklist side of "Disagreement on #N". `usePublishersChecklist`'s
  `teamCells` rewrites cells of a captured file.
- **Match Cards with a checklist**: Unlink names read `Unlink card #N <card> from checklist row
  #N <player> · <team cell>`; relink = radio `Select #N … · <cell>` then `Link selected
  checklist row to #N <card>` (the BSC half may sit in Keeping, not BSC only).
Related: [[reference_hand_made_rows_cannot_reach_the_commit_path]], [[reference_neo335_teams_on_cards_section]]
