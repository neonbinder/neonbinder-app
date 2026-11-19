---
name: patterns_career_check_step_neo574
description: NEO-574 "Career check" wizard step and New player career prefill - handles, what changed for old walks, fixture limits (real committing set, both sides checked), 6b year rule staging
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
- Next is HELD (aria-disabled) while the careers are checking, and is meant to stay held
  until every line's team name has loaded, with a 15 s timeout that ends in the failed-read
  Retry. A spec waits for the lines (or the Retry) before pressing Next.
- New player step: the career form opens PREFILLED (team = the batch's team name for the
  player's solo cards, From year = set year), not dirty, nothing staged until + Add. A spec
  asserting "no from-year refuses Add" must clear From year first.
- The Decided list is hidden on the career step (as on teams / titles): a spec that skips its
  last name and then opens the Decided list must `passCareerCheck` first.
- The prefill only offers a team the batch keeps: a team step answered "not a team" gives no
  prefill, so a spec asserting the prefill adds (or links) the card's club.

Fixture limits:
- The step only runs on the commit path (`resolveAndCommit` after a fetch); a hand-made
  set cannot fetch ([[reference_hand_made_rows_cannot_reach_the_commit_path]]).
- BOTH sides are career-checked: the marketplace's and the uploaded checklist's (a
  "Checklist says otherwise" pick of the checklist side, a checklist fill where the
  marketplace had no player, a checklist-only card kept in Match Cards). So an uploaded CSV
  CAN put a per-worker player on a real card and stage the step. That is also a collision
  risk: any spec whose upload names a player or team another spec gives a career to can raise
  lines on a sole-writer set it never meant to touch.
- The house way to stage it (NEO-574, alias spec): `usePublishersChecklist(..., { extraRows })`
  appends checklist-only rows (numbers the marketplace does not list) for the spec's own
  player, and `fetchOneMarketplaceSetChecklistToWizard({ extraRows })` keeps them all in Match
  Cards (`confirmChecklistMatchCards({ keepChecklistOnly })`). No disagreement step to answer,
  and the marketplace's own cards are untouched.
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
  "not Step 1 -> discard" guard misses it and walks a stale batch. The batch's rows are frozen
  at its creation, so e.g. a pick step's candidate labels still show a stint the spec's start
  cleanup has since removed (seen on same-name after a planted-break red). Re-seed after such a
  red, or run the spec once more before reading anything into a second red.
- Writes to a career must land on a per-worker player: "Wrong player" -> pick it ->
  the follow-up "Add to career" writes to THAT player, never to the catalogue player.

Measured on the first full run (NEO-574):
- The blocked-Next status ("Fix the years first — then Next.") shows only AFTER a press on the
  held Next: focus Next, press Enter, then assert the status (once, no `.first()` needed) and
  that focus went to the bad line's From year. `toBeDisabled()` alone proves the hold.
- Career team entry suggestions (since the a12d46fb/b2a87c01 rework): a team's WHOLE name shows
  no list (it would only echo the box), so type it and press + Add directly; a partial name shows
  "Existing team suggestions" IN the form, below the field. Prove + Add is not covered with
  `click({ trial: true })` (runs the hit test, adds nothing). Each entry mounts its own
  `role="status"` ("N suggestions"): never call an unfiltered `getByRole("status")` in the wizard.
- Checklist-only rows kept in Match Cards are cards with a team after the save: the line the
  save lands with counts them ("Teams from your checklist: N" = `facts.matched` + kept rows,
  and "Saved <rows + kept> cards."). Before Confirm, N is still `facts.matched`.
- `container.getByRole("listitem").filter({ has: X })`: X is matched INSIDE each item, so build
  it from `page` (`page.getByRole("radiogroup", ...)`), not from the container-rooted helper
  (`careerLine` is rooted at the wizard and matches nothing inside a list item).
