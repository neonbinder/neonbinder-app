---
name: patterns_team_management_era_alias_specs
description: Team Management specs — a reload empties the filter so axe scans the whole catalogue (minutes); row/status/alert handles; two-era teams born in a career editor; the alias holder trips the New Team dialog's "Create again"
metadata:
  type: pattern
---

- **Re-filter after every `page.reload()` on /admin/teams.** The selected team survives a
  reload (it is `?team=` in the URL) but the "Filter teams" box comes back empty, so the
  master list renders every catalogue team (~10k rows, an 8,000-line ARIA snapshot). An
  `expectAccessible` there took ~35 s per call; after `filter.fill(token)` +
  `teamsCounter(page, "2 matches")` the whole spec dropped from 1.5 min to 17 s.
- Handles: master row `getByRole("button", { name: "<full> · <from>–<to|present>", exact: true })`;
  save line `getByRole("status").filter({ hasText: "Saved <full>." })`; a refusal is the
  panel's `role="alert"` beside Name (ConvexError data verbatim); years are spinbuttons
  `Active from` / `to`; "Also known as" textbox + `list "Current aliases"`.
- Selecting a row uses `setSearchParams(..., { replace: true })`: Back never steps between
  rows. The admin sub-nav links ("Players", "Teams", "Set Builder") are real navigations,
  so Back/Forward between them is the house Back check.
- Two eras of one club in a custom sport: create both in a player's career editor (search a
  token, Enter, New Team dialog with location/years/aliases), remove the chip if the player
  must not hold a stint. A full name another team holds as an ALIAS makes the dialog say
  "<name> already exists for <holder's era>. Create again to add this as a second era." even
  when the eras are disjoint: press Create twice.
- Stints: after the chip, click the "Career history" heading, fill `Stint from year` /
  `Stint to year`, "Add stint", then the player's "Save".
- Team years are range-checked first: an end year past next year is refused as
  "A team end year must be a whole year between 1869 and <next year>." before any
  alias or name check, so an overlap fixture extends to next year at most.
- On the older team, an overlap with the team that wears its name as an alias is
  refused by NAME_TAKEN ("Another team in this sport is already called <name>."),
  not the alias-holder sentence.
- Team tile `+ New team` form with an alias clash: the sentence shows in the form beside
  `Link to <holder> · <era>` and holds `Create team` disabled. At the desktop project's 1024x629 the Link
  button can sit below the walk's scroll fold, so a wrap check reads the form's copy (`toBeInViewport({ ratio: 1 })` + `toHaveAccessibleDescription`). Dating the
  draft clear of a DATED holder shows "No clash with that name now."; an undated
  holder can never be cleared by the draft's years.
- A printed name the gate leaves to the operator (no stints / stints on both
  eras) is its own Team tile row (`Team <name>`, `Which team: …` for several eras); one sync answers one question per
  printed name, so each outcome needs its own one-card set.

Related: [[reference_hand_made_rows_cannot_reach_the_commit_path]], [[patterns_custom_sport_player_specs_skip_lookups]]
