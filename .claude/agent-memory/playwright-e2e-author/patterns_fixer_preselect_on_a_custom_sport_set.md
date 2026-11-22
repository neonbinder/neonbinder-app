---
name: patterns-fixer-preselect-on-a-custom-sport-set
description: NEO-639 preselect rules on the NEO-645 walk's Team tile - lone window team pressed, tie and set No Team unpressed with years; quick-added linked cards on a custom-sport set; non-vacuous "Apply to all" absence; spec-only counter-fixtures
metadata:
  type: feedback
---

The Team tile's preselect rules need only quick-added cards, never a fetch: players with careers
on /admin/players (`addPlayerByHand`, `createTeamInCareerEditor`, `addCareerStint`, Save) in
`customSport(env)`, `page.goBack()` back to the drill, then `addCardViaForm` with a `beforeSubmit`
that links `Add <player>` in the PlayerPicker. Quick-add never fills a team, so each card is pink
"no team on this card yet".

- The chips' list is named by its heading (careerHeading): "Suggested from career history." /
  "From the career. More than one team that season, …" / "From the career. This set says No Team,
  …" (`it.s`). A chip is a toggle named `<team> · <player> played here` when preselected, else
  `<team> · <player> <years>` (en dash; a one-season stint prints just "2026").
- The window is the set year AND the year before: a stint in [year-1, year] counts for a tie.
- Career stint years are capped at next year ("between 1869 and 2027" alert, Save refused): an
  out-of-window counter stint goes BEFORE the window (year-2), not after.
- "Apply to all" shows only after a team is SAVED and only while another teamless card of the same
  single player exists. Prove its absence under No Team with a spare same-player card left
  teamless, and the presence on an earlier card before the No Team (same shape, one change).
- Set-level No Team ("Yes, set No Team") leaves existing cards teamless; the offer reads
  "Mark N teamless cards No Team" and declining is simply not pressing it.

**Why:** rewrite of the retired walker's fixer spec onto the walk (2026-11-22), green first run.
**How to apply:** any Team-tile pre-fill spec. Prove it with one-value spec-only counter copies
(`w<n>counter-*.spec.ts`, rm after) when the Vite is shared. Related:
[[patterns_set_no_team_spec_shape]], [[patterns_team_fill_career_tier_fixture]].
