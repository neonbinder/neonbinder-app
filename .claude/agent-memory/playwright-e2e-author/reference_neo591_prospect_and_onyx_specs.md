---
name: reference_neo591_prospect_and_onyx_specs
description: NEO-591 handles — Prospect Card, "Prospect (X)" = printed team (New Team step), in-memory edited upload, place team cells, preview rows, Match Cards unlink/relink, the only set with a team conflict
metadata:
  type: reference
---

- **Prospect Card** is a pressed toggle, not a checkbox: drawer "Card #N" → "Show features
  editor" → `getByRole("button", { name: "Value for Prospect Card", pressed: true })`. Rookie
  Card beside it IS a checkbox ("Value for Rookie Card").
- **Card No Team in the drawer**: `button "No Team for this card"` with aria-pressed; a team
  shows as `button "Remove team <name>"`.
- **"Prospect (X)" (final NEO-591 shape)**: X IS the card's printed team. No held line, no
  Remember box: an unknown X is a Names-gate "New Team: X" step like any team; the card gets
  Prospect Card. A mixed cell "Team / Prospect (X)" shows as printed in the preview and Match
  Cards (never "Prospect (Team / X)"). Mint X per attempt (`Dbp<token>`) and create it on the
  step: a fixed X would exist after the first run and never raise the step again.
- **Edit a committed CSV in memory, never on disk**: `lib/checklists` golden snapshot pins every
  fixture CSV, so read it, rewrite the rows (throw unless exactly the rows meant changed), and
  `setInputFiles({ name, mimeType: "text/csv", buffer })`.
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
  exactly ONE in-league team in ANY era settles before the wizard. The reference catalogue holds
  past eras, so most big MLB places have several (Seattle = Mariners + 1969 Pilots, Chicago five,
  New York six): then the card's players' stints decide (a stint on the year's team = silent; on
  a team the year would not pick = a decided "N name(s) linked for you" row and the wizard opens
  on Step 2), else a candidate step `heading "Which team: <place>"` listing every era as
  `button "Link to <team> · <from>–<to|present> · Major League Baseball"` (list named "We've got
  N teams by that name. Pick the one on these cards."), Remember box enabled+unticked. A fixture
  for "operator asked" needs a player with no stint at that place (Seiya Suzuki + New York).
  Skipping it drops it from "Listed as" on the Teams step (skipped = the operator's ruling).
- **Checking the catalogue's teams**: `npx convex data teams --limit 8000` is the CLI's ceiling
  (8192 refused); dump `--order asc` and the default desc and union them by `_id`.
- **A team conflict needs a marketplace team in the BULK answer**: with a checklist no card is
  looked up, so only Football 2014 Topps team-leader cards (BSC "<Team> TL") carry one. A mixed
  "<Team> / Prospect (X)" cell there: the checklist side of "Disagreement on #N" reads "<Team> / X" (verify on a run). `usePublishersChecklist`'s
  `teamCells` rewrites cells of a captured file.
- **Match Cards with a checklist**: Unlink names read `Unlink card #N <card> from checklist row
  #N <player> · <team cell>`; relink = radio `Select #N … · <cell>` then `Link selected
  checklist row to #N <card>` (the BSC half may sit in Keeping, not BSC only).
Related: [[reference_hand_made_rows_cannot_reach_the_commit_path]], [[reference_neo335_teams_on_cards_section]]
