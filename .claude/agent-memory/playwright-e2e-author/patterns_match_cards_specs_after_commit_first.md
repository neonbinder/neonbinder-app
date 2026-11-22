---
name: patterns-match-cards-specs-after-commit-first
description: NEO-645 rewrites of Match Cards specs - the pre-save exit that still exists (Cancel card matching), NB's blue pick in a disagreement, Back after a walk, and where a walk note's data can die
metadata:
  type: feedback
---

Rewriting a multi-fetch Match Cards spec onto the NEO-645 walk (Confirm saves):

- **The one pre-save exit left is Match Cards' own Cancel.** Button "Cancel card matching"; with any
  link/keep edit it asks "Discard N pairings?" (button `^Discard [0-9]+ pairings?$`), then
  "Sync cancelled — no cards saved." and "No cards in this checklist yet." stays. A phase that used
  to Cancel/Discard in the wizard cancels here instead; only ONE fetch per leaf can commit, so order
  the phases so the richest walk is the committing one.
- **NB decides a disagreement when exactly one side is all NB rows** (`pickByNb`): the tile is
  BLUE ("To check"), status `Went with “X”, they're already in your binder.`, the other side a
  `Use “Y” instead` button. A checklist misspelling of a catalogue player, or a team-leader card's
  known team, is blue, not pink. Only names NB lacks on both sides stay pink.
- **A No Team side is an empty value** (`value: []`): check the tile renders words for it before
  asserting on its button; a nameless `Use “” instead` is a product gap to report, not to press.
  Put a gap assert LAST in a fresh-only spec (reopen the walk from the pill and `skipUntil`), so the
  one run per seed proves everything else first.
- **Back after a walk steps into its `?tidy=` history** (each card shown is an address; Done and
  Save for later replace only the last). A later phase that walked the drill with `goBack` must
  re-drill instead; prove Back on a stretch with no walk in it.
- **A walk note fed by a stored field can be dead on the client side.** The commit may store a
  field the client strips first (Match Cards' `committable()` deleted `sourceNumbers`, so "Numbers
  didn't match" never showed). When a note is missing, grep the client's commit-shaping helper
  before blaming the tile.
- Autograph inserts (`AU` on every card) put every card on the walk pink: `answerPinkAutographTile`
  per card, then `Save & next` proves a purple note never holds a card.

**Why:** NEO-645 numbers-differ and team-leader rewrites, 2026-11-22. **How to apply:** any spec
whose old flow cancelled between Match Cards and the save, or reads a source disagreement.
Related: [[patterns-tidy-walk-tiles-and-commit-first]], [[patterns-probe-the-rest-of-a-spent-fresh-only-run]].
