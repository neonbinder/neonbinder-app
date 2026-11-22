---
name: patterns-team-apply-to-all-fixture
description: NEO-645 Team tile "Apply to all" — the client proposes, the server checks the career; which cards can be skipped ("N left as it was"), the one-leaf career trap, and the in-walk recipe (new player, inline team, + Add stint) on a per-attempt sport
metadata:
  type: project
---

`TeamTile` offers "Apply to all N other <player> cards" / "Apply to the other <player> card" once the
open card has ONE team and is not pink. Two filters:
- **Client (`proposesTeam`)**: same single player, no team, no pending team name, no listing team,
  no No-team stamp, no checklist claim (`teamCheckOutcome: "checklist"`), no teams disagreement.
  So a rule-8 card (its cell names another team) is NEVER offered: it changes the COUNT, never the
  "left as it was" line.
- **Server (`cardTakesTeamFill`)**: the same, plus `pendingPlayerNames` empty, plus
  `careerTeamVerdict` for the card's set year names exactly this team.
- **The skip line is reachable only through what the client does not check.** In one leaf every card
  has the same year, so the career check is all-or-nothing ("No cards changed." before the stint,
  all applied after). The partial skip comes from a two-name card (`P / Q`, Q still pending): offered,
  refused -> "Applied to 2 cards. 1 left as it was."
- The commit's Q1-A fill writes a career team at save time, so a player who EXISTS with that career
  makes no teamless cards at all. Mint him in the walk instead: "Add as new player" on #1 (fan-out),
  Team tile "+ New team" (group "New team: unnamed", textbox "New team name", "Create team <T>",
  chip pressed in "Teams you added", "Save team"), then Career tile group `Career <P>` ->
  `+ Add stint for <P>` -> combobox `Career team name for <P>` filled with the WHOLE name (the list
  steps aside for an exact name; no option click) -> spinbutton `From year for <P>` -> `Add career
  team for <P>`.
- Status: `getByText(<line>, { exact: true })` inside the Team tile; the button keeps its place
  after a press (it re-offers any card still proposed), so assert it by a regex, not a label.
- Proven able to fail with a spec-only counter-fixture (stint 2010-2011: "No cards changed.").

Related: [[patterns_tidy_walk_spec_on_a_per_attempt_sport]], [[patterns_career_tile_fixtures]].
