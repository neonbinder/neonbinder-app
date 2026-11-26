---
name: patterns-team-era-specs-on-the-walk
description: NEO-602/NEO-307 team-era specs on the NEO-645 walk — how to get an auto-linked card's Team tile on screen, what the tile shows per rule branch, era fixtures in the career editor, and one-value counter-fixtures that prove each spec
metadata:
  type: project
---

**An auto-linked card never enters the walk** (no attention item), so its Team tile is unreadable.
Two honest ways to put it on screen:
- a second printed team in the pasted cell (`OLD / Ahx<token>`, split on "/"): the unknown name is
  pink and keeps the card in the walk; the era rule reads one printed name at a time. Answer the
  extra one "Not a team" so the card ends with only the era under test;
- a PRE-MADE player with no stints: the commit writes a blue careerGap on any card whose resolved
  team his career does not cover, so the card is in the walk for its Career tile.

**What the Team tile shows** (rows are groups `Team <printed>` inside the tile):
- players' era against the year (pickCardTeam via players, !agreesWithYear): answered row, the
  team's full name, a purple `note` starting "Linked for you", Change. Copy reads as a player
  sentence (careerTeam reason) — flagged, so assert `/^Linked for you/` only;
- year link (one row, past-era allowance, or players agreeing with the year): plain row, no note;
- several eras, no player evidence: pink, "Which team: <printed>", list "We've got N teams by that
  name…", buttons `Link to <full> · <era>` (newest first). The operator's pick shows no note.

**Fixtures:** `createTeamInCareerEditor` (support/players.ts) makes a team in the New Team dialog
and removes the chip (no stint); `aliasHeldBy` presses Create twice. Make the alias holder first.
Give eras DIFFERENT own names (one wears the printed name as an alias) so `teamChip` in the drawer
proves the era. A stint on a made team: search its token, pick `^Add <full>` in "Team typeahead
results". Walk order puts cards with pending team lookups last: branch on the first header once.

**Counter-fixtures (one value):** two-eras: move OLD's start past the stint (1968 -> 1985) -> no
support -> "Which team:" asked. Past-era: print the alias holder's own name instead -> one row ->
linked by itself, Team tile not pink. Run as `w<n>counter-*.spec.ts`, read error-context, `rm`.
Asked (no stints / stints on both): YEAR 2025 -> 2020 (newer era not born yet) -> linked by itself,
card only blue. Silent-abstains: give the silent player a stint on the past era -> players disagree
-> both cards pink, "2 cards left". The error-context of a toHaveAttribute red snapshots only the
element: read the PNG to confirm WHICH stop the counter hit.

**Silent link on the walk:** the silent card enters ONLY for its blue Career tile (group
`Career <player>`, "No career on file yet.", `Keep as is` is aria-pressed); its Team row shows the
team with no note and no "Which team:". The voter's card is not walked ("1 card left").
**Asked row handles:** "Which team: <printed>", "Printed on #1", list named by the whole intro
sentence ("We've got 2 teams by that name. Pick the one on this card."), combobox "Search all
teams", checkbox `Remember “<printed>” as a name for this team`. Stints: `addCareerStint`
(support/players.ts) after `createTeamInCareerEditor`.

Related: [[patterns_career_team_link_fixture_and_counter_fixture_proof]],
[[patterns_same_name_team_eras_unprovable_on_a_card]], [[patterns_tidy_walk_tiles_and_commit_first]].
