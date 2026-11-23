---
name: reference_team_tile_on_a_hand_added_card
description: Reaching the walk's Team tile honestly - a hand-added card on a real set, whole-career fallback chips with nothing preselected, the one-team legend exception; replaces the retired missing-team fixer
metadata:
  type: reference
---

The old needs-a-team fixer (card walker) is gone; the Team tile of the Tidy up walk replaces it. Specs:
`tidy-up-team-tile-offers-the-whole-career-unpicked-when-no-stint-covers-the-year.spec.ts`,
`tidy-up-team-tile-preselects-a-lone-set-year-team-never-a-tie-or-under-a-no-team-set.spec.ts`.

**The honest route is a hand-added card.** Quick-add on a per-attempt hand-made set under the REAL
`Baseball › 2024 › Topps` (`Add a player to the new card` > textbox `Find a player for the new card` > option
`Add <player>`, then `Card name`), a reference-catalogue player, Team left empty. No marketplace ref = no automatic
team source, so the row is badged `Card <n>, … needs attention: no team on this card yet` at once and the pill
reads `N need you, N to fix` ([[reference_neo335_teams_on_cards_section]]). The pill opens the walk on that card.

**Whole-career fallback.** A player whose career has NO stint covering the set year, across 2+ teams, gets a Team
tile that is pink with chips `<team> · <player> <from>–<to>` (a pressed chip reads `… played here`), NOTHING
preselected, no `Save team`, and Save & next held; a chip press is a choice, not a write, and `Save team` writes it.
**Exception: the one-team legend rule** (`oneTeamCareerInLeague`, `convex/lib/teamFill.ts`): a retired player with
ONE career team in the set's league IS preselected under `Suggested from career history.` as
`<team> · <player> played here` (e.g. the catalogue's one-stint George Brett). So a "nothing preselected" claim needs
a multi-team career (Ozzie Smith), and the one-team player on the same set is the positive control: without it a
tile that never preselected anything passes. Linking writes the CARD only; catalogue rows are never mutated.

**No card surface prints an era**, so which era was picked is proved at the pick (the option's era line) and the
link's arrival by the row/drawer chip name: [[patterns_same_name_team_eras_unprovable_on_a_card]],
[[patterns_team_era_specs_on_the_walk]].
