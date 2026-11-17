---
name: existing-player-questions-are-card-steps-not-review-rows
description: A wizard question about an EXISTING player or a card (not an unknown name) cannot be an entityReviewQueue row; plan it as a client-state post-review step, and size any career-vs-card-year rule against prospects and empty careers
metadata:
  type: project
---
A name that resolves to one NB player never gets an `entityReviewQueue` row, and a sync where every name resolves opens the wizard with no batch at all (`teamsOnly`). So a question about an existing player, or about one card rather than one name, has no row to hang on. Plan it like the Teams step (NEO-335) and the checklist step (NEO-478): derived in the browser from the preview cards, answers held in `FetchPreview`, zipped onto the cards (or sent as a commit argument) at save, never stored. The commit resolves players per NAME, so a per-card player change needs its own per-card field, as `teamIds` is for teams.

**Why:** NEO-574 was briefed as "new queue kind vs reuse `careerTeamOf`"; both need a player row that does not exist, and a new kind touches the hand-kept validator copies ([[hand-kept-validator-copies-of-schema-shapes]]). See also [[wizard-answers-are-not-stored-sync-is-one-time]].

**How to apply:**
- A new post-review step can open the wizard on the path that used to save with no dialog, and it adds a screen to every walk to Save. Plan the shared walk helper and the seed spec in the same PR ([[wizard-chrome-strings-are-suite-wide-e2e-gates]]); make the step passable with one Next.
- Any rule comparing a card's team to a career "up to the card year" flags two big groups: prospect cards (bulk-loaded careers start at the pro debut, the card names the parent club years earlier) and players with no stints on file. Count both before promising a quiet step, and default every line to "leave".
- The gate's own name answers (`resolvedNames`) are the only source for "which player did this name resolve to"; never resolve a second time in the browser or a second query.
