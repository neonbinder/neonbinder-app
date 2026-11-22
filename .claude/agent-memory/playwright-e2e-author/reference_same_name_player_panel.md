---
name: reference_same_name_player_panel
description: NEO-332 same-name PICK step on the Player tile ("Which <name> is this?") - locators, top candidate, undated-rival fork refusal; the old wizard navigation parts are gone
metadata:
  type: reference
---

A player name that 2+ NB players answer to (and the card's year and team do not narrow to one) shows the pick
step inside the Player tile's name row on the Tidy up walk. Reference spec:
`tidy-up-same-name-player-asks-which-one.spec.ts`; fixtures: [[patterns_name_lookup_status_and_same_name_fixtures]].

Locators (all user-visible, scoped to `tidyTile(page, "Player").getByRole("group", { name: "Player <name>" })`):
- question text `Which <name> is this?`; intro `We've got N on file under that name. Pick the one on this card.`
  (capped: `More than N answer to that name — …`); the card's printed name shows as `Printed on #<n>`.
- list named `Players already filed under this name`; each candidate is a button
  `Link to <name>, born YYYY` (undated: `Link to <name>, …` with no "born"). One click = the link. Scope to the
  list: other `Link to …` buttons exist in the row.
- `Add as new player anyway` / `Add as new player` (plain create runs the lookup only after "anyway"); after a link
  the row reads the name, `b. YYYY` and a `Change player` button. Read the link back on Players admin's
  `Cards for <name>` list.
- Click the TOP candidate (`.first()`): lower rows can fall under the walk's footer.

The catalogue holds real same-name rows, often UNDATED. You cannot fork a name twice beside one: `createByAdmin`
(`adoptOrForkOnCreate`) forks past ONE undated rival but REFUSES a dated create once there are several and any is
undated ("2 players are already filed under X. Pick the right one…"). The refusal renders in the add form's
button row (below the fold) and the form stays filled, so the flow sees only "no Added line"; the proof is a
`ConvexError` on `players:createByAdmin` in convex-logs. NPB `Shuya Yamada` is therefore ONE fork (b. 1851) + the
catalogue's row = 2 on file (a CI run lost a whole run to a 3-on-file plan). Assert the undated candidate with a
negative lookahead, `Link to <name>, (?!born ).+`, rather than pinning catalogue career text.

Bulk: "Add all N new players" excludes pick-step rows (they are not plain new names).
Related: [[patterns_record_a_fixture_sets_lookups]].
