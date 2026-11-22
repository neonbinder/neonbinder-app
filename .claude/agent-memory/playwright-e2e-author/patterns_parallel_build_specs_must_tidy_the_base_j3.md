---
name: patterns-parallel-build-specs-must-tidy-the-base-j3
description: NEO-645 J3 - a spec whose subject is a parallel build (auto build after an insert save, or "Build from Base") cannot use Save for later; it must answer the source's names in the walk, and the Card titles self-open holds back behind the walk
metadata:
  type: feedback
---

Under NEO-645's J3 an insert's (or a Base's) parallels are built only once no card of the
source checklist has a pink sourcesDisagree / playerName / teamName item
(`blocksParallelBuild`, convex/features/cardAttention.ts). The client holds the auto build in a
ref and starts it the moment the live rows clear (same page session, same variant selected);
the server refuses a manual "Build from …" with "the checklist it's built from still has cards
that need fixing — tidy those up first".

- **"Switch to Save for later" does not fit these specs.** Save for later leaves the names pink,
  so the build never starts. Walk the source with `tidyForTheParallelBuild` (tidy-walk.ts:
  `walkAnsweringEverything` + no skipped sources-disagree + Done), the walk equivalent of the old
  wizard's save. Teamless, autograph and title pinks do NOT hold a build.
- **Card titles can end up behind the walk.** The build may finish while the walk is still open
  (it starts on the last name answer). `ParallelTitlesDoor` never self-opens over another dialog:
  it says "Card titles are waiting. Press Fix N card titles when you're ready." Wait for
  `titlesDialog.or(waitingLine)`, press the door's "Fix N card titles" on the waiting branch.
- An adopting spec (rerun on the same seed) reopens the walk from the "N need you" pill when
  the source still has a card needing a person.

**Why:** NEO-645 rewrites of bowman-insert-grouping and the BSC Chrome-prefix listing spec,
2026-11-22. **How to apply:** any spec that saves a checklist and then expects its parallels
built. Related: [[patterns-tidy-walk-tiles-and-commit-first]], [[patterns-match-cards-specs-after-commit-first]].
