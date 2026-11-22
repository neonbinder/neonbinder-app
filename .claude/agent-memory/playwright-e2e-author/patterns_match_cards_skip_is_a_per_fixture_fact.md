---
name: patterns-match-cards-skip-is-a-per-fixture-fact
description: NEO-640 - Match Cards opens only when a card needs the operator; specs read each checklist file's matchCards fact, predict it with checklistMatch, and read the kept sentence off the right line
metadata:
  type: project
---

Since NEO-640 a fetch with 2+ sources (BSC + an uploaded checklist counts) starts on a
progress line: role=group named by its first status ("Fetching from BSC and your
checklist…"; `checklistFetchProgress`). The ticking " N of M cards ready." is aria-hidden
(getByText only); its Cancel is "Cancel card fetch" (`cancelCardFetchButton`). It skips
Match Cards when every card is Matched at 100%; when it opens, focus is on the dialog
itself ("Match Cards — <set>"), not on a button inside it.

- Each `CHECKLISTS` file has `matchCards: { paused, live }` (`MATCH_CARDS` in
  support/published-checklist.ts); settle with `settleChecklistFetch(page, env, { facts,
  what, lands })`. Never `.or()` the dialog against the kept line (coordinator rule).
- Predict a new file's fact offline before a run: `npx tsx` a scratch script calling
  `checklistMatch(name, { cardsOf, cardNumber })` (the product's matcher). Opens on any
  unmatchedCardIndices / unusedRowIndices / siblingRows, a `via` other than
  number/player, confidence < 1, checklistNumber, or conflict.players. A trimmed file must
  be matched against its whole capture (`cardsOf`), or it looks like a skip.
- A whole capture skips; a left-out row, a same-player duplicate number, publisher
  numbering, or a structural upload edit (drop/renumber/split/extraRows) opens. Dropping
  one row (`edits.drop`) is the cheap way to force a dialog without a new CSV.
- Where the skip is said: with a wizard, the pre-save line stays in front of it ("All N
  cards matched across … No Match Cards needed, totally clean.", `matchedKeptLine`); with a
  direct save the saved line gives the reason right after its count ("Saved N cards. BSC and
  your checklist agreed on every one, so Match Cards sat this one out.", `skippedSavedReason`).
  That saved line NAMES Match Cards, so `getByText(/Match Cards/)` absence asserts break:
  assert the dialog's absence by role (`matchCardsDialog(page)).toHaveCount(0)`).
- A press of "Cancel card fetch" needs the line to stand still: hold BSC's catalogue read
  on the fake (`bscFault.slow(BSC_PATH.results, …, { times: 1 })`) and press it, then prove
  "Sync cancelled — no cards saved." (assert it gone after the new press first, since an
  earlier cancel leaves the same text), no dialog, no "Saved", Sync enabled.
- Proven by plants on `match-cards-needed.ts`: always-open turns the skip spec red,
  never-open turns the unmatched-card spec red.

Related: [[patterns_checklist_is_a_match_cards_source]], [[patterns_planted_red_for_server_side_behaviour]]
