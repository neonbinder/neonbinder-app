---
name: patterns-team-apply-to-all-fixture
description: NEO-645 Team tile "Apply to all" — the client proposes (two-name and claimed cards never offered), the server checks the career; the skip tail is unreachable from the UI; in-walk recipe (new player, inline team, + Add stint) on a per-attempt sport
metadata:
  type: project
---

`TeamTile` offers "Apply to all N other <player> cards" / "Apply to the other <player> card" once the
open card has ONE team and is not pink. Two filters:
- **Client (`proposesTeam`)**: same single player, no pending second player name, no team, no
  pending team name, no listing team, no No-team stamp, no checklist claim (`teamCheckOutcome:
  "checklist"`), no teams disagreement. A rule-8 card (its cell names another team) and a two-name
  card (`P / Q`, Q unanswered) are NEVER offered: they change the COUNT, never the skip line.
- **Server (`cardTakesTeamFill`)**: the same, plus the set's No Team default, plus
  `careerTeamVerdict` for the card's set year names exactly this team.
- **The "M left as it was" tail is not reachable from the UI** (decision 28, "honest Apply to all",
  NEO-645 collector pass): the client mirrors every server test but the career, and in one leaf the
  career is all-or-nothing ("No cards changed." before the stint, "Applied to N cards." after). Only
  a card that changes between offer and press reaches the tail; the TeamTile unit test holds it.
  A spec written before that change expected the two-name card in the count and the tail line, and
  went red with "Apply to all 2" where it asked for 3.
- The commit's Q1-A fill writes a career team at save time, so a player who EXISTS with that career
  makes no teamless cards at all. Mint him in the walk instead: "Add as new player" on #1 (fan-out),
  Team tile "+ New team" (group "New team: unnamed", textbox "New team name", "Create team <T>",
  chip pressed in "Teams you added", "Save team"), then Career tile group `Career <P>` ->
  `+ Add stint for <P>` -> combobox `Career team name for <P>` filled with the WHOLE name (the list
  steps aside for an exact name; no option click) -> spinbutton `From year for <P>` -> `Add career
  team for <P>`.
- Status: `getByText(<line>, { exact: true })` inside the Team tile; the button keeps its place
  after a press (it re-offers any card still proposed), so assert it by a regex, not a label.
- Proven able to fail with spec-only counter-fixtures: stint 2010-2011 ("No cards changed."), and #5 as
  a single-name card (the offer reads 3, not 2).

Related: [[patterns_tidy_walk_spec_on_a_per_attempt_sport]], [[patterns_career_tile_fixtures]].
