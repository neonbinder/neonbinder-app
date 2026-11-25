---
name: neo672-career-swap-pills
description: NEO-672 Team tile "Swap <gap> for" pills — handles, newest-first order, years text, Or swap line, visible toast, mobile viewport, two-team on-card fixture, plants (throw kills setup)
metadata:
  type: project
---

Team tile "Swap for" pills (NEO-672) on a Tidy Up card with a career gap.

- Scope: `tidyTile(page, "Team").getByRole("group", { name: "Team <gap team>", exact: true })`, then
  `getByRole("list", { name: "Swap <gap team> for", exact: true }).getByRole("button")` for the count.
- Pill name: `Swap <gap team> for <team> · <years>`; years are the Career chips' `stintYears` per
  covering stint, ", "-joined ("2024–" open, "2020–2024", one season "2024"). Visible text has no
  separator between team and years (two spans): assert order with `nth(i).toHaveAccessibleName`.
- Order: newest covering fromYear first; ties keep career (teamYears) order.
- Covering = `stintCoversWindow` (set year and the year before). A career team already on the card
  gets NO pill (Jason, e0e70249). Pills are gone while Edit's search is open (assert count 0 next to
  the visible "Search existing teams" box, R2 pairing).
- The Career gap row says "Or swap the card's team below." whenever a pill is offered.
- After any swap the Team tile shows an aria-hidden green "Swapped X for Y." for 6 s
  (`useFieldToast`): `teamTile.getByText(..., { exact: true })` right after the click (the sr-only
  status lives outside the tile, so the tile scope is unambiguous).
- Mobile: `scrollIntoViewIfNeeded` + `toBeInViewport({ ratio: 1 })` on the longest pill; a
  `min-w-[640px]` plant in TeamChip's action branch proves it (ratio 0.64).
- Any swap (pill or Edit search) announces "Swapped <old> for <new>." in the walk's sr-only
  `role="status"`: `walk.getByRole("status").filter({ hasText })`. The announcement fires even if
  the write is a no-op, so prove the card's team group changed too.
- Career unchanged after a swap: the Career tile vanishes with the gap, so read "Career on file"
  on the NEXT gap card, plus the Players admin read-back.
- Each plant needs a fresh seed (P is a global real name); `e2e-run seed` after this spec fails
  its verify once (selectorOptions 165), the immediate retry passes (see
  [[reseed-right-after-a-queued-lookup-spec]]). Then `plant --expect` with no further re-seed.
- Plant that proves the write: pill `swapTeam(team.teamId, team.teamId, ...)` (swap to itself)
  goes red at the "Team <new>" group assert. On a fresh-only spec use `plant --fresh --expect`.

- "Already on the card" live: a pasted team cell `Colorado Rockies / Seattle Mariners` splits on "/" into two
  linked teams; the one-player card gets a per-team gap (Rockies) and the covered team (Mariners) gets no pill.
  Career = only the on-card team -> no list, no `^Swap ` button, no "Or swap" line. Catalogue two-team titles
  fit 80 on every token length (location cut is quiet, `tidyUp` false), so no blue title mark.
- Axe right after the visible toast: `expectAccessible` (light + dark, `within: walk`) takes ~1 s, well inside
  the toast's 6 s.
- A plain `throw` in `careerSwapOptions` crashes setup's own walk ("An error occurred"), so `plant --fresh`
  dies in setup. Instead `e2e-run seed` (reset + setup + bootstrap, unplanted), then `plant --expect` with
  no `--fresh`: the spec reds at the walk's name (app error boundary). Dropping `onCard.has` reds at the
  "no swap list" assert on card #2.

Covered in `tidy-up-career-tile-writes-stints-to-the-player.spec.ts` (#3 list + Edit hides; #6 click).
See [[patterns_neo656_career_tile_specs_after_j6]].
