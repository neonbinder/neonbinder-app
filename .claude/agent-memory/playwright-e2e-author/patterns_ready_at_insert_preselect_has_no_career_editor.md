---
name: patterns_ready_at_insert_preselect_has_no_career_editor
description: A Player row with one namesake on file leads with "Link to <name> (<sport>)"; creating needs the demoted "anyway"; real-name fixtures can gain a namesake from seeded data in another sport
metadata:
  type: project
---

A player name with one namesake on file, in any sport, is a READY row with no lookup: its lead action is
`Link to <name> (<sport>)` and "Add as new player anyway" is demoted (it only OPENS the plain create). A real-name
fixture has no fixed set of namesakes: seeded reference data in another sport can give any name one, so a row that
offered a plain create on one seed leads with a link on the next.

**How to apply (Tidy up walk, `support/tidy-walk.ts`):**
- A spec whose intent is "this name is new" uses `createPlayerOnOpenRow` (first row offering a plain create) or
  `answerPinkPlayerTiles` (`promoted: "create" | "link"` picks what a promoted row gets).
- Match the promoted link by its trailing `(<sport>)`: an exact match reads `Link to <name>` and a pick-step row
  reads `Link to <name>, ...`. A pick step ("Which <name> is this?") offers no create until its own "new" option.
- A fixture the spec needs creatable must use a minted name, not a real one.
- See [[patterns_button_name_substring_hides_demoted_variants]].
