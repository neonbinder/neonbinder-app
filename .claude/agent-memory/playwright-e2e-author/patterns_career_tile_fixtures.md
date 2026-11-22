---
name: patterns-career-tile-fixtures
description: NEO-645 Career tile specs (also what survived from the retired Career check step) — a career gap is raised ONLY at commit for an already-existing player, so stage it on a hand-made Baseball set with a pre-made player; a new player's Wikidata career needs a recorded name with careers; probe catalogue membership read-only before choosing names
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

## Carried over from the retired Career check step (NEO-574, gone in NEO-645)

- Checklist-only rows stage a career gap without a second player: `usePublishersChecklist(..., { extraRows })`
  appends rows (numbers the marketplace does not list) naming the spec's own player, and
  `confirmChecklistMatchCards({ keepChecklistOnly: n })` keeps them all in Match Cards (heading
  `Checklist only (n)`). The sync's saved line then counts them: `Teams from your checklist: N of M cards`.
  Both marketplace and uploaded-checklist sides are career-checked, so an upload that names a player or team
  another spec gives a career to can raise a gap on a sole-writer set it never meant to touch.
- Re-synced cards are existing and never gap-checked again: a career spec on a real set is fresh-only.
- Rule 6b needs a stint that BEGAN by the set year and ended within 2 years before it:
  [[patterns_career_team_link_fixture_and_counter_fixture_proof]].
- Career team entry (`CareerTeamEntry`): a team's WHOLE name shows no suggestion list (it would only echo the
  box), so type it and press Add directly; a partial name shows "Existing team suggestions" below the field.
  Prove Add is not covered with `click({ trial: true })` (runs the hit test, adds nothing). Each entry mounts
  its own `role="status"`, so never call an unfiltered `getByRole("status")` on the walk.
- `container.getByRole("listitem").filter({ has: X })` matches X INSIDE each item: build X from `page`, not from
  a helper rooted at the walk/dialog (that matches nothing inside a list item).
- Players admin's filter is FUZZY ("10+ matches" for one name): find same-name rows by `^<name> Baseball\b`
  and tell them apart by the row's team nod, not the counter.
- A "Remember" alias lives on a per-worker TEAM, and teams are a reference-seed table, so
  `reset --except-reference-seed` keeps it: the next run's checklist team resolves by alias and the Team tile
  never asks; the per-worker player survives too ("That player already exists — opened it."). A rerun needs the
  full seed or another worker.
- A stint write must land on a per-worker player, never a catalogue player; and a sweep helper needs its
  postcondition read by its callers (a no-op "Keep as is" sweep left every spec green).
