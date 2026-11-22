---
name: patterns-career-tile-fixtures
description: NEO-645 Career tile specs — a career gap is raised ONLY at commit for an already-existing player, so stage it on a hand-made Baseball set with a pre-made player; a new player's Wikidata career needs a recorded name with careers; probe catalogue membership read-only before choosing names
metadata:
  type: reference
---

Career tile (blue "To check", never pink) has two sources, both stored at write time:
- `careerGap`: written ONLY by the commit (`selectorOptions` insert path), for a one-player card
  whose player EXISTS before the sync and whose printed team resolves to a team his career does not
  cover by the set year. Nothing in the walk raises one later (a Team-tile answer does not).
  So: make the player first (Players admin, `addPlayerByHand` + one stint), then a hand-made leaf
  under REAL Baseball › 2024 › Topps (`drillToCustom`) with a pasted checklist naming him on
  catalogue teams. A covered card gets no walk card at all (purple "Linked for you" is not counted).
- `newPlayerCareer`: written by the Player tile's "Add as new player" on THAT card only. The lines
  come from the name row's enrichment, so the name must be a recorded Wikidata hit WITH careers.

Handles: group `Career <player>`; gap text `No <full team> in the career by <year>.`; list
`Career on file for <player>` (`<team> · 2020–2024`, open `2024–`); `Add to career`, `Keep as is`
(aria-pressed, writes nothing); new player: `Wikidata career for <player>` lines
`<team> · <years>` + `✓ in the career` / `✓ team in NB` / `team not in NB`, `+ New team <team>`,
`Not now <team>`, `Add stints to <player>`; inline form group `New team: <team>`, `Checking for
team details…`, `Create team <team> and add stint`; undated: `Add years for <team>` → group
`Years for <team>` → `Save years for <team>`. Player tile: group `Career teams to add:` with
`Include career team <team> (<from>–<to|present>)`. Admin career lines read `<from>–<to|present>`.

Choosing names: list recorded players with careers not on any fixture CSV/pool, then probe
read-only: `npx convex run players:resolveNamesForReview` (matchCount per sport) and
`teams:findManyByNameAndSport` (is the career team in NB). Only open the inline New team form for
a team whose `team|<qid>|<name>` lookup is recorded (else an error-level refusal log). Such specs
are fresh-only (global real-name rows).

Gotcha: Playwright wipes `--output` at each run start; give each run its own output dir or the
previous red's screenshot is gone before you read it.
