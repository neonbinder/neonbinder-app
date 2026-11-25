---
name: patterns-player-alias-read-back-and-remember-box
description: NEO-671 Player tile "Remember “X” as a name for this player" box — handles, read-back via Player Management's Aliases textbox, plants, and the hand-made-sport fixture that reaches the Tidy Up Possible matches panel
metadata:
  type: reference
---

- **Box handle:** `row.getByRole("checkbox", { name: `Remember “${printed}” as a name for this player`, exact: true })`,
  `printed` = the row group's aria-label minus `Player `. It sits inside the Link to existing…
  search (under the input) and inside the Possible matches panel; on by default, per row.
- **Read-back:** after `openPlayerCards`-style navigation (Player Management, filter, open the
  player), `page.getByRole("textbox", { name: "Aliases", exact: true })` holds the aliases joined
  ", ". A hand-added player starts empty, so `toHaveValue(printed)` is exact. The catalogue's
  Wayne Gretzky (Hockey) had no aliases on the reference seed.
- **Catalogue pick = untick** (R7a), then a negative `not.toHaveValue(/printed/i)` paired with
  `toBeVisible()` on the same box.
- **Plants that went red as planted:** client `withAlias && saveAsAlias` → `withAlias` (catalogue
  row gets the alias, negative reds); `… && false` (hand-made player's toHaveValue reds).
- **Possible matches panel on the Tidy Up Player tile (reached, NEO-671):** use a per-attempt
  HAND-MADE sport (no `sportConfig.wikidata`, so neither the hand-added player nor the printed name
  is looked up: no recording needed). Add `Joshua <Sur><token>` by hand, paste a checklist printing
  `Josh <Sur><token>`: the truncated-first-name rung of `playerNamesMatch` makes him `close`, never
  `exact`, so no one-tap link or same-name step stands in front of the panel. Pick:
  `row.getByRole("list", { name: "Possible player matches" }).getByRole("button", { name: `Link to ${onFile}`, exact: true })`
  (no birth year, no career = bare name). Spec: `tidy-up-possible-matches-pick-remembers-…`.
  A real sport would need the lookup recording; the hand-made sport avoids it entirely.
- **Plant that went red as planted:** panel `onPick={(id) => void link(id, true)}` → `link(id)`
  (Aliases read back "").
- **Temporary screenshots for the coordinator:** `tidyWalk(page).screenshot({ path })` inside an
  `if (!project.name.includes("mobile"))` block, run once, then delete the block; the dialog
  shot is the whole walk.

Related: [[reference_neo284_team_alias_fixture]], [[patterns_e2e_run_tool_in_practice]]
