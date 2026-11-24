---
name: neo656-live-career-mark-and-apply-counts
description: NEO-656 count arithmetic for walk specs - answer drops only the open card, Apply to all drops the rest; a team set later in the card editor turns the card blue (live careerGap), pill reads "1 needs you"
metadata:
  type: project
---

After NEO-656 (2026-11-24) the walk's "N cards left" and the pill are live counts of flagged cards:

- **An answer drops the open card only.** "Add as new player" on #1 of three cards printing the
  name: count falls by one (the open card, if nothing else is on it), not by three. There is no
  blue "check the new player's career" any more (J6), so a No Team card is clear at once.
  `applyNameToAll` then returns "Linked N more cards." and the count falls by the cards it emptied.
  Asserting the count between the answer and the Apply is the B1 proof (one answer = one card).
- **Blue is live (B22).** A single-player card given a team later (card editor, after the walk)
  turns blue "is worth a check: …team is missing from the player's career" the moment the team
  lands, even in a "No teams in this sport" sport. The pill then reads `1 needs you` (singular
  "needs"). A spec that used to assert `needsYouPill` count 0 after such an edit must assert the
  mark and the pill instead.
- **Plant for both:** replace the `applyNameToAll` server call in `NameApplyToAll.tsx` with a fake
  `{ linked: waiting.length }`: the helper's line passes, the next `expectCardsLeft` goes red. That
  proves the spec checks the data, not the result line.

- **Team era picks (B11).** After a link the printed name's row (`Team <printed>`) is gone; the
  card's line is `group "Team <team>"` with `Edit <team>`. A pick onto a stint-less player turns
  the card blue at once (Career "To check"): Skip it and expect `{ fixed: 0, stillToCheck: n }`.
  Plants that redden both era specs: swap `onLink(candidate.teamId)` in `TeamCandidates.tsx` to the
  mirrored index; and in `careerCoverage.careerGaps` guard `gaps.push` off (convex push, ~1.5 min).

**How to apply:** rewriting any NEO-645 walk spec whose counts assumed fan-out or a sticky blue.
Related: [[neo656-tidy-walk-helpers-skip-apply-end-screen]], [[patterns-walk-keeps-a-card-that-clears-on-screen]].
