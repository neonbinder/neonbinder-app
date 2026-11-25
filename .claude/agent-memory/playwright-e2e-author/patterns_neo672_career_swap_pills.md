---
name: neo672-career-swap-pills
description: NEO-672 Team tile "Swap for" pills on a career gap — handles, years text, announcement, plant that proves the write
metadata:
  type: project
---

Team tile "Swap for" pills (NEO-672) on a Tidy Up card with a career gap.

- Scope: `tidyTile(page, "Team").getByRole("group", { name: "Team <gap team>", exact: true })`, then
  `getByRole("list", { name: "Swap for", exact: true }).getByRole("button")` for the exact count.
- Pill name: `Swap <gap team> for <team> · <years>`; years are `stintYearsText` of the covering stints
  (en dash, "2020–2024"; one season "2024"). Visible text has no separator between team and years
  (two spans), so assert by accessible name, not `toHaveText` on the list items.
- Covering = `stintCoversWindow` (set year and the year before). A covering team already on the
  card is offered too (d3190f2a). Pills are gone while Edit's search is open (assert count 0 next to
  the visible "Search existing teams" box, R2 pairing).
- Any swap (pill or Edit search) announces "Swapped <old> for <new>." in the walk's sr-only
  `role="status"`: `walk.getByRole("status").filter({ hasText })`. The announcement fires even if
  the write is a no-op, so prove the card's team group changed too.
- Career unchanged after a swap: the Career tile vanishes with the gap, so read "Career on file"
  on the NEXT gap card, plus the Players admin read-back.
- Plant that proves the write: pill `swapTeam(team.teamId, team.teamId, ...)` (swap to itself)
  goes red at the "Team <new>" group assert. On a fresh-only spec use `plant --fresh --expect`.

Covered in `tidy-up-career-tile-writes-stints-to-the-player.spec.ts` (#3 list + Edit hides; #6 click).
See [[patterns_neo656_career_tile_specs_after_j6]].
