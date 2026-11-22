---
name: patterns-team-fill-career-tier-fixture
description: NEO-645 Q1-A team fill (career tier) on a per-attempt sport — make the filled card visible with a 70-char team, and why the negative's stints must both cover the set year (tile chips read the set year, the commit reads [year-1, year])
metadata:
  type: project
---

The Q1-A fill (`planCardFill` career tier, `careerTeamVerdict` "oneTeamInWindow") writes a team at
the commit onto a teamless card whose LINKED player has exactly one team in `[year-1, year]`. The
purple note "Team filled from the player's career" renders only in the walk, and a filled card has
no stop of its own.

- **Fixture that works:** per-attempt sport + pasted checklist with BLANK team cells (no claim);
  players and stints made in Players admin before the fetch (exact name in the sport = auto-link);
  each team born in the career editor's New Team dialog (`Add team` -> `Search teams` -> "No
  matches." -> Enter -> `Create team <name>`; several stints in one Save work, the picker resets).
- **Visible:** the filled team is a one-token name padded to 70 chars; the linked player's title
  then has to drop it -> blue "Listing title" To check. Team tile: group `Team <name>` (an unrowed
  team), the note is a sibling `role=note` in the tile, Save & next usable.
- **Negative trap:** the tile's chips (`suggestedTeamsForCard`) read the SET YEAR only and
  preselect every set-year team; the commit reads the two-year window. A stint ending at year-1
  makes the commit refuse (two in window) while the tile shows ONE chip, preselected. Give both
  negative stints the set year itself so tile and commit both see two teams.
- Assert chip presence by `^<team>( · .+)?$`; the suffix is " · <player> played here" when
  preselected, years otherwise.

**How to apply:** any Q1-A or pre-fill spec; read the tile's chip source before choosing stint years.
Related: [[patterns-set-history-link-with-no-walk-stop]], [[patterns-tidy-walk-spec-on-a-per-attempt-sport]].
