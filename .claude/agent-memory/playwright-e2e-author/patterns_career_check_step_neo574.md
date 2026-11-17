---
name: patterns_career_check_step_neo574
description: NEO-574 "Career check" wizard step and New player career prefill - handles, what changed for old walks, why it needs a real committing set, the checklist-side blind spot
metadata:
  type: reference
---

NEO-574 put a "Career check" step FIRST after the names (before teams / autograph /
titles). It lists each (existing player, NB team) pair on a NEW single-player card whose
player's career has no stint for that team (id, franchise or name key) that is undated or
starts in or before the set year.

Handles (`support/wizard.ts`): `CAREER_STEP_SUBTITLE`, `careerLine(page, player, team)`
(radiogroup "<player> on <team>"; after the audit its radios read Keep as is / Add to career /
Wrong player / Fix card's team, and the namesake chooser is a radiogroup "Which <name>?"),
`postNameSubtitle` (the subtitle of whichever post-name step is up), `passCareerCheck` (Next
past the career step only, then a positive assert of the step after it, so a following
`toBeHidden` of "Cards with no team" is about a live step) and `passCareerAndTeamsSteps`
(career + teams, for a spec whose feature is a later step). Anchor the subtitle regex and
take `.first()`: the step's h3 starts with the same words.

What it changed for existing walks:
- `advanceToSave` runaway guard is 5 (four screens can sit between names and Save).
- A sync with NO names now opens the wizard when the only question is a career gap,
  straight onto "Career check" (Step 1 of N). Any "no names" branch that asserts
  `/^(Cards with no team|Card titles)$/` must include "Career check".
- Next is NOT held while the step says "Checking careers..." (only bad years hold it),
  so a spec that asserts lines waits for the line first.
- New player step: the career form opens PREFILLED (team = the batch's team name for the
  player's solo cards, From year = set year), not dirty, nothing staged until + Add. A spec
  asserting "no from-year refuses Add" must clear From year first.
- The Decided list is hidden on the career step (as on teams / titles): a spec that skips its
  last name and then opens the Decided list must `passCareerCheck` first.
- The prefill only offers a team the batch keeps: a team step answered "not a team" gives no
  prefill, so a spec asserting the prefill adds (or links) the card's club.

Fixture limits (why the feature spec needs an owner-approved real set):
- The step only runs on the commit path (`resolveAndCommit` after a fetch); a hand-made
  set cannot fetch ([[reference_hand_made_rows_cannot_reach_the_commit_path]]).
- `careerContext.players/teams` are built from the cards' MARKETPLACE side only, so a
  name or team the operator takes from the checklist's side of a "Checklist says otherwise"
  disagreement is never career-checked: an uploaded CSV cannot smuggle a per-worker player
  onto a real card for this step.
- Once committed, re-synced cards are existing and never checked again: a career-check spec
  on a real set is fresh-only.
- NEO-574 also gave NEO-490 rule 6b/2b the year rule (a stint counts only if undated or it
  starts in or before the set year): a career-team auto-link a spec relied on can turn back
  into a pick step when the only covering stint starts after the card's year. To stage a 6b
  link on a hand-made namesake, give him a stint at the card's club that STARTS before the card
  year and ENDS within 2 years before it (e.g. 2021-2022 for a 2024 card): a stint covering the
  year is rule 4 (the name resolves before review, so no Decided line), and one ending earlier
  drops him from the +-2 year survivors.
- A red that stops between a fetch and Cancel leaves its review batch open; the next fetch
  RESUMES it, and a resumed batch with no decisions still reads "Step 1 of N", so a spec's
  "not Step 1 -> discard" guard misses it and walks a stale batch. Re-seed after such a red.
- Writes to a career must land on a per-worker player: "Different player" -> pick it ->
  the follow-up "Add the stint" writes to THAT player, never to the catalogue player.
