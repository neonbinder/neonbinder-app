---
name: patterns-player-alias-read-back-and-remember-box
description: NEO-671 Player tile "Remember “X” as a name for this player" box — handles, read-back via Player Management's Aliases textbox, plants, and why no spec reaches the Tidy Up Possible matches panel
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
- **Possible matches panel on the Tidy Up Player tile:** no spec reaches it (2026-11-25). It needs
  a printed name with a single alias hit or a close spelling in the row's sport; a hand-added
  near-spelling player reaches a Wikidata lookup, so it needs an enrichment recording first, and
  a pre-existing alias equal to the printed name makes the remember write a no-op (already held).

Related: [[reference_neo284_team_alias_fixture]], [[patterns_e2e_run_tool_in_practice]]
