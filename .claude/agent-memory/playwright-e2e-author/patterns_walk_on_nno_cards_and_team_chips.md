---
name: patterns-walk-on-nno-cards-and-team-chips
description: NEO-645 walk on an all-NNO checklist (face name is the identity), the no-team Team tile's unsaved chips, its "Other team…" search, career stints that need a saved team, and Save & next landing on the end screen
metadata:
  type: feedback
---

Learned rewriting the Roanoke (all `NNO`) and 1996 Score title specs onto the Tidy Up walk.

- **On an all-NNO checklist every card's "#…" lines read `#NNO`.** The header `#NNO · <name>`
  is not matched by `getByText(/^#\S+( · .+)?$/)`: the header draws its number in a span of its
  own, and `getByText` keeps the innermost match, so `tidyCardIdentity` yields `#NNO` alone and
  NEVER the player (a `.includes(player)` on it is always false; NEO-645 Leaf Vivid red). The
  lines cannot tell cards apart. The face is ONE `img` named `Card #<n>, <who>[, <teams>]`: read it with
  `getAttribute("aria-label")`, prove Back/Forward with `toHaveAccessibleName(face)`, and take the
  card's name as its second part. `skipCard`/`saveAndNext` now prove a move by "a face named
  otherwise is visible" (a negative-lookahead name regex, one web-first wait).
- **To branch on WHO the walk opened on, don't read then branch.** One web-first assert over the
  dialog: `walk.filter({ has: faceNamed(who) }).filter({ has: <that card's answer> }).or(
  walk.filter({ hasNot: faceNamed(who) }).filter({ has: <the other answer> }))`. Inner locators of
  a filter are relative to the dialog, so build them from `page.getBy…`, never from `tidyTile`
  (which starts at the dialog again).
- **A no-team card's chips (`TeamFillChips`) hold their choice in component state until "Save
  team".** A team picked in "Other team…" or made with "+ New team" (inline group `New team:
  unnamed`, textbox "New team name", button `Create team <name>`) joins the chips PRESSED but
  unsaved; un-pressing an added team removes its chip. Save for later drops it all. To read the
  PRE-FILL, remount the tile: Save for later, then the pill (new sitting) and `skipUntil`.
- **"Other team…" search:** textbox and listbox both "Search existing teams", options
  `Link to <full name>` in the server's ranked order (first is `aria-selected`), "No matches",
  "Cancel linking". There is no create row; Enter takes the highlighted option.
- **Career "+ Add stint for <player>" takes only a team NeonBinder holds** (`knownTeamsOnly`:
  combobox `Career team name for <p>`, spinbuttons `From year for <p>` / `To year (optional) for
  <p>`, button `Add career team for <p>`, enabled once the name resolves to one saved team). Make a
  missing team first (the Team tile's "+ New team"), then add the stint.
- **"Not a team" on a printed team row answers the name for the checklist**: every card that
  prints it turns into a no-team card. One press releases a claim the whole leaf shares.
- **Save & next on the walk's last card lands on the end screen** ("1 card fixed, N skipped",
  "Done (Esc)"): close with `.or()` on Done / Save for later, never assume Save for later.
- **Mark reasons as a per-card read-back:** search the checklist by the card's name, then read the
  `Card NNO, <name> needs attention: <reasons>` mark's aria-label; a team answer shows as the
  reasons losing "team", with the untouched card's mark as the positive.

**Why:** NEO-645 Roanoke rewrite, 2026-11-22: a skip proof that compared `#NNO` lines failed on the
first skip after a fresh-only commit. **How to apply:** any walk spec on NNO cards, or one that
reads a no-team card's pre-fill. Related: [[patterns_tidy_walk_tiles_and_commit_first]],
[[patterns_probe_the_rest_of_a_spent_fresh_only_run]].
