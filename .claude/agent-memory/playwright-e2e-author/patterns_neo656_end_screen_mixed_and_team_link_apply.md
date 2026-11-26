---
name: neo656-end-screen-mixed-and-team-link-apply
description: NEO-656 walk end screen with one pink + one blue card (label, Review reopens both), and the New Haven team-link spec's B1 shape (link #12, #13 still pink, link #13 + Apply = "Linked 6 more cards.")
metadata:
  type: project
---

Learned rewriting `tidy-up-walk-one-card-at-a-time` and the New Haven team-link spec (2026-11-24):

- **Mixed end screen.** One skipped pink + one blue (title cut) walked card: verdict "1 card skipped,
  not ready to list", tally "1 card fixed, 1 skipped, 1 still to check.", button "Review the skipped
  card" (`reviewButtonLabel`: pink wins). The button reopens EVERY passed card still flagged
  (`skippedIds`, pink and blue), so cards left reads 2 after it. Save & next and Skip on a blue
  title-cut card end identically (no gap on screen = nothing written; no "seen").
- **A walk can't show an answer's Apply after leaving the card** (`leaveCard` drops walk memory).
  B1 proof on a real set: link on card A, Skip to B (still pink row "“X” isn't linked…"), link B
  too, then `applyNameToAll`. A second link with "Remember" on does not duplicate the alias
  (Team Management still reads `Pca<token>, New Haven Ravens`).
- **New Haven fixture arithmetic:** walk opens on #12; the club is on all 8 numbered cards, so
  Apply from #13 = "Linked 6 more cards.". Linking the club onto a catalogue player's card raises
  a live career gap (blue): never Save & next there, Skip or Save for later.
- **Plants that redden them:** `TidyUpWalk.tsx` `stillToCheck = 0 * cardsStillToCheck(...)` (tally
  red); `NameApplyToAll.tsx` fake `{ linked: waiting.length, skipped: 0 }` (next card unlinked).

Related: [[neo656-tidy-walk-helpers-skip-apply-end-screen]], [[neo656-live-career-mark-and-apply-counts]].
