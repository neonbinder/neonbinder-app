---
name: patterns-parallel-build-specs-must-tidy-the-base-j3
description: NEO-645 J3 widened by NEO-661 - ANY pink card on the source checklist holds a parallel build; specs walk the source with tidyForTheParallelBuild (no-team fallback, title cut, zero skips); the Card titles self-open holds back behind the walk
metadata:
  type: feedback
---

Since NEO-661 (Jason, 2026-11-24: "if there is anything that would cause a pink box we should
hold the parallels back") `blocksParallelBuild` is `deriveCardAttention(row).level === "fix"`:
a name, a disagreement, no team (unless awaiting its BSC lookup or confirmed none), autograph
format unset, title over 80, no card name. The server refuses "Build from …" with
"<parallel> — Blocked — the checklist it's built from still has cards that need fixing — tidy
those up first" (a `role="alert"`); the client holds the auto build until the rows clear.

- **Walk the source with `tidyForTheParallelBuild`.** Its defaults are
  `noTeam: "prefilledElseNoTeamOnCard"` (click the "<team>, suggested…" chip, which saves on click
  since NEO-656, else "No team on this card")
  and `title: "cut"` (`answerPinkTitleTile`: the over-cap box opens itself; cut at the last
  word boundary within 80, "Save title"). It asserts `tally.skipped === 0` and annotates the
  tally. "Card name" (needsName) is not answered: a no-name card fails it by name.
  `walkAnsweringEverything` keeps the old defaults (`"prefilled"`, `title: "leave"`).
- **The seed's Base** answers the same way (`answerEveryPink` in setup.spec.ts), then waits out
  "Still looking up teams" and re-walks if the "N need you, M to fix" pill is up. Measured:
  23 cards walked, 2 titles cut, 0 no-team. Wake on `built.or(blockedAlert)` so a refusal reds
  by its words, not at the 120 s ceiling.
- **Gap:** TeamFillChips shows "No team on this card" usable while its pre-fill query is still
  loading, with no perceivable loading state, so the fallback could beat a late pre-fill.
  Not seen in the seed or Bowman specs (0 no-team answers); reported as a product gap.
- **Plant a setup change without `--expect`**: with `--expect` the tool skips the re-seed, so
  setup never runs planted. Without it, a setup red reads "a setup/bootstrap phase failed";
  read the error-context for the planted reason.
- **"Switch to Save for later" does not fit these specs**; Save for later leaves the pinks.
- **Card titles can end up behind the walk.** `ParallelTitlesDoor` never self-opens over another
  dialog: wait for `titlesDialog.or(waitingLine)`, press "Fix N card titles" on the waiting branch.
- An adopting spec (rerun on the same seed) reopens the walk from the "N need you" pill.
- **Proving a spec that now answers every pink:** planting the OLD, narrower rule leaves it green
  by construction (the old rule is more lenient). Plant the spec's OLD fixture instead (leave the
  card teamless / skipped, drop the no-skip asserts) against the new rule: it reds at the
  "Built" line with the "— Blocked —" alert in error-context. On a one-shot sole writer run that
  plant without `--expect` (it re-seeds), after the green run.
- Hand-made quick-add card born No Team: `beforeSubmit` presses
  `getByRole("button", { name: "No Team for the new card", pressed: false })`.

**Why:** NEO-645 rewrites (2026-11-22), NEO-661 widening (2026-11-24). **How to apply:** any
spec that saves a checklist and then expects its parallels built. Related:
[[patterns_tidy_walk_tiles_and_commit_first]], [[patterns_match_cards_specs_after_commit_first]].
