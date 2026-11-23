---
name: patterns-walk-helper-planted-breaks
description: NEO-645 planted-break recipes for the tidy-walk.ts helpers (settleWalkAfterCommit, walkAnsweringEverything, saveAndNext/skipCard face proof), where each goes red, and why the pill read is not a timing race
metadata:
  type: project
---

Client-only plants (served by a private Vite) that prove the walk helpers fail, with where each goes red:

- **Walk never opens after a commit**: in CardChecklist's post-commit effect, never call `openTidyWalk()`.
  `settleWalkAfterCommit` goes red INSIDE the helper ("the Tidy Up walk is open", `expectTidyWalkOpen`):
  the "N need you" pill is up with the saved line, so it never falls through to `false`.
- **The pill stays readable behind the open walk.** The walk is a portalled `role=dialog aria-modal` with
  an `inert` background; Playwright's `getByRole` still resolves the pill (count 1, visible) while the
  walk is open, so the helper's one pill read does not race the walk opening.
- **"Add as new player" no-op** (PlayerNameRow's create onClick): `answerPinkPlayerTiles` /
  `createPlayerOnOpenRow` go red at `expectPlayerRowAnswered` ("<row> was answered"), so
  `walkAnsweringEverything` cannot finish with a pink name unanswered.
- **Save & next no-op** (early return in TidyUpWalk `save`): red at `expectMovedFrom`'s URL check.
  To prove the FACE check, the plant must move the URL but keep the card: render `current` from a ref
  frozen on an earlier card (armed in `save`/`skip`). Red at "<Save & next|Skip> put another card on screen".
- A temporary probe spec (copy of a hand-made walk fixture calling the helper under test) is the way to
  plant-test a helper whose only real callers are setup or fresh-only real-set specs; `rm` it after.

**How to apply:** reuse these plants when the helpers change; revert by exact reverse edit, then
`git diff --stat -- apps/web/components apps/web/src` must be empty. See [[patterns_tidy_walk_tiles_and_commit_first]].
