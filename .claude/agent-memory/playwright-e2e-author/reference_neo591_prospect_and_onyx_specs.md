---
name: reference_neo591_prospect_and_onyx_specs
description: NEO-591 handles - Prospect Card, "Prospect (X)" = printed team (Team tile row), in-memory edited upload, place team cells (Which team), preview rows, Match Cards unlink/relink, the only set with a team conflict
metadata:
  type: reference
---

- **Prospect Card** is a pressed toggle, not a checkbox: drawer "Card #N" → "Show features
  editor" → `getByRole("button", { name: "Value for Prospect Card", pressed: true })`. Rookie
  Card beside it IS a checkbox ("Value for Rookie Card").
- **Card No Team in the drawer**: `button "No Team for this card"` with aria-pressed; a team
  shows as `button "Remove team <name>"`.
- **"Prospect (X)" (final NEO-591 shape)**: X IS the card's printed team. No held line, no
  Remember box: an unknown X is a pink printed-name row on the Team tile (`group "Team X"`,
  `+ New team`, `Create team`) like any team; the card gets Prospect Card. A mixed cell "Team / Prospect (X)" shows as printed in the preview and Match
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
- **Reaching a named player step** in a checklist-only fetch: `skipUntil(page, <the Player row locator>)`
  (`support/tidy-walk.ts`); cards come in card order, so the target row is on a known card, and Skip writes
  nothing, so there is nothing to discard afterwards.
- **Leaf preview cells** print the claim as written ("Prospect (Oklahoma)", "Seattle"); mixed
  parts join with " / ". Rows are named "<n> <player> <cell>": `getByRole("row", { name, exact })`.
- **Place team cells** (set needs a league; a hand-made Baseball set gets MLB): a place with
  exactly ONE in-league team in ANY era settles at the commit. The reference catalogue holds
  past eras, so most big MLB places have several (Seattle = Mariners + 1969 Pilots, Chicago five,
  New York six): then the card's players' stints decide (a stint on one of them = silent; a link
  NeonBinder made is a purple note at most, never a walk stop), else the Team tile's row asks
  `Which team: <place>` with a list named `We've got N teams from <place>. Pick the one on this
  card.` of `Link to <team> · MLB|Major League Baseball` buttons and its `Remember “<place>” …` box
  UNTICKED. A fixture for "operator asked" needs a player with no stint at that place (Seiya Suzuki
  + New York). Answered `Not a team`, the one-career-team preselect appears, never written.
  Spec: `checklist-prospect-and-place-team-cells-ask-only-the-unsettled-on-the-team-tile.spec.ts`.
- **"Linked for you"** is a purple per-name note on the Player tile ("Linked for you: <why>", reasons in
  `tidy/parts/copy.ts`), never a walk stop; an exact single NB match gets no row at all.
- **Checking the catalogue's teams**: `npx convex data teams --limit 8000` is the CLI's ceiling
  (8192 refused); dump `--order asc` and the default desc and union them by `_id`.
- **A team conflict needs a marketplace team in the BULK answer**: with a checklist no card is
  looked up, so only Football 2014 Topps team-leader cards (BSC "<Team> TL") carry one. A mixed
  "<Team> / Prospect (X)" cell there: the checklist side of the Sources disagree tile reads "<Team> / X" (verify on a run). `usePublishersChecklist`'s
  `teamCells` rewrites cells of a captured file.
- **Match Cards with a checklist**: Unlink names read `Unlink card #N <card> from checklist row
  #N <player> · <team cell>`; relink = radio `Select #N … · <cell>` then `Link selected
  checklist row to #N <card>` (the BSC half may sit in Keeping, not BSC only).
Related: [[reference_hand_made_rows_cannot_reach_the_commit_path]], [[reference_neo335_teams_on_cards_section]]
