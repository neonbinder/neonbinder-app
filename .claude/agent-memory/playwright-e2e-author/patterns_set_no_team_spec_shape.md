---
name: patterns-set-no-team-spec-shape
description: NEO-556 set-level No Team spec shape - handles, the toast the cascade replaces, ledger region, aria pressed via role option
metadata:
  type: patterns
---

- Toggles are `getByRole("button", { name, pressed })` (the role's own state), never an aria attribute read. Names: panel "No Team for every card here", drawer "No Team for this card", quick-add "No Team for the new card".
- A checklist row's text run is matched by `#<n>[^#]*<text>`; a bare `#<n>.*<text>` is satisfied by a LATER row's text through the virtualized list container (a toBeHidden then reds, a toBeVisible passes falsely).
- Drawer toggle un-presses (teamNone:false, toast "Cleared No Team") and quick-add under a No Team set starts pressed with hint "From the set. Pick a team to change it."; the set toggle is named "No Team for new cards here" and its cascade toast "No Team applied to the checklists under it".
- The Attributes panel's save toast ("Saved No Team · new cards here get No Team") is REPLACED within a frame by the cascade finish line "Team applied to cards" (same as the team path); assert the finish line, not the save toast.
- Mark-existing run: offer button "Mark N teamless card(s) No Team" appears only after the cascade clears (no recount branch seen); confirm dialog "Mark N card(s) No Team?" with group "Cards left as they are"; ledger is `region` named by its heading ("Marked 1 card No Team"), line text exact "Base - marked 1 card No Team, left 1 as it is", button "Dismiss the No Team run".
- Prove "teamless" before the run with the missing-team badge (`img` "Card <n> needs attention: no team on this card yet") visible, and gone after.
- A teamed fixture card needs no league/location: quick-add Add team -> Search teams -> create row -> `Create team <name>`.
- Seed `setup` can fail on a per-worktree deployment at the live BSC variant-types sync; hand-made-set specs only need `bootstrap`, so run them `--no-deps` after it.

Related: [[patterns-per-worker-data-isolation]]

Not reachable on a hand-made (no marketplace id) set, so no local live proof: the unreviewed-name fixer (a typed pending team/player name is born only by an undecided wizard row at a fetch commit; quick-add never sends names), a parallel "Build from Base" (a parallel with no ids is skipped), a fetch/commit or publisher-checklist upload ("No marketplace ids on this path"), the wizard teams step and its set-team hint (needs a fetch and 8+ teamless cards). Clearing No Team on a set patches only that row: rows beneath keep it, so assert the flip on the checklist row where the card is born. A finished run on a small set cannot be caught mid-run (one page of ~200 cards), so no running/stopped ledger axe.
