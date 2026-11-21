---
name: patterns-match-cards-skip-is-a-per-fixture-fact
description: NEO-640 - Match Cards opens only when a card needs the operator; specs read each checklist file's matchCards fact, predict it with checklistMatch, and read the kept sentence off the right line
metadata:
  type: project
---

Since NEO-640 a fetch with 2+ sources (BSC + an uploaded checklist counts) starts on a
role=status progress line ("Fetching from BSC and your checklist…", sibling button
"Cancel checklist fetch", NOT inside the status) and skips Match Cards when every card is
Matched at 100%.

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
- Where the kept sentence lives: with a wizard it stays the banner in front of it
  (`matchedKeptLine`); with a direct save it is said again inside "Saved N cards. …"
  (`savedLine` + `toContainText`), because the bare kept line lasts only the write.
- Proven by plants on `match-cards-needed.ts`: always-open turns the skip spec red,
  never-open turns the unmatched-card spec red.

Related: [[patterns_checklist_is_a_match_cards_source]], [[patterns_planted_red_for_server_side_behaviour]]
