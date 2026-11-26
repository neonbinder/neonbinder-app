---
name: patterns-team-apply-to-all-fixture
description: NEO-645 Team tile "Apply to all" — main's line rule (same leaf, player set and claim, still teamless), NO career check; two-name and claimed cards never offered; the skip tail is unreachable from the UI; in-walk recipe on a per-attempt sport
metadata:
  type: project
---

`TeamTile` offers "Apply to all N other <player> cards" / "Apply to the other <player> card" once the
open card has ONE team and is not pink.
- **Line rule (`convex/lib/teamLine.ts`, client and server alike)**: a card takes the answer when it
  is under the same checklist, on the same LINE (`teamLineKey`: player-id set plus claim key, a
  listing team name or `teamCheckOutcome: "checklist"`) and `isTeamlessOnLine` (no pending player
  name, no team, no pending team name, no No-team stamp, no teams disagreement). Server side is
  `cardTakesLineTeams` in `convex/tidyCards.ts`.
- **There is NO career check any more** (commit 210ef3cb brought it back to main's wizard rule). An
  earlier spec version pressed first, expected "No cards changed.", added a career stint and pressed
  again; that premise is gone: the first press reads "Applied to N cards.".
- A rule-8 card (its cell names another team: a different claim, so a different line) and a
  two-name card (`P / Q`, Q unanswered: pending name) are NEVER offered; they change the COUNT.
- **The "M left as it was" tail is not reachable from the UI**: the client proposes exactly what the
  server accepts, so only a card that changes between offer and press reaches it; the TeamTile unit
  test (`applyOutcomeText`) holds it.
- Mint the player in the walk: "Add as new player" on #1 (fan-out), Team tile "+ New team" (group
  "New team: unnamed", textbox "New team name", "Create team <T>", chip pressed, "Save team").
- Status: `getByText(<line>, { exact: true })` inside the Team tile; the button keeps its place
  after a press (aria-disabled, its pressed label), so assert it by a regex, not a label.
- Plant that proves it: append `&& false` to `cardTakesLineTeams`; the page then shows "No cards
  changed." and the spec goes red at the "Applied to 2 cards." line.

Related: [[patterns_tidy_walk_spec_on_a_per_attempt_sport]], [[patterns_career_tile_fixtures]].
