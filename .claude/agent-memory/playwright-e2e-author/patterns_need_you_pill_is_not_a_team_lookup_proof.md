---
name: patterns-need-you-pill-is-not-a-team-lookup-proof
description: NEO-645 - the "N need you" pill counts every pink card (unlinked player names too), so a spec about the background team lookup reads each row's attention-mark reasons; the Q1-A career fill takes known players' cards out of the lookup queue
metadata:
  type: feedback
---

After NEO-645 a card with an unlinked player name is pink whether or not its team lookup is
still pending, so the "N need you" pill is no longer "cards whose team is the operator's".
Old team-lookup specs asserted `CARDS - M need you` or no pill; both are wrong now.

- **Read the team side per row:** the attention mark is `role="img"` named
  `Card <n>[, <name>] needs attention: <reasons joined by "; ">` (blue: `is worth a check`).
  The team reasons are "team name not yet linked" and "no team on this card yet"; a card
  awaiting the lookup raises neither. Helper: `cardAttentionMark(page, n, reasonSource)` in
  support/cards.ts. Pair a `toHaveCount(0)` with the row's `editCardButton` visible (Virtuoso:
  an unrendered row passes vacuously).
- **The Q1-A career fill runs at the save** (a lookup that never ran is not a claim, NEO-639):
  a card whose player the reference catalogue knows, with one career team in the window, gets
  that team and stops waiting. A "Still looking up teams for <all> cards" count drops by those
  cards (1995 Dayton Bombers ECHL: #7 Kevin Brown, Los Angeles Kings, so 31 of 32).
- **"Saved N cards." vanishing after Match Cards** with the walk opened: check the client wire
  log for a burst of unsubscribes plus `drillPath:resolveDrillPath` at the `?tidy=` push. That
  is the checklist remounting (product), not a timing problem.

**Why:** NEO-645 BSC stall / 429 spec rewrites, 2026-11-22. **How to apply:** any spec that
proves a card waits on the background team lookup, or counts the pill after a fetch.
Related: [[patterns-tidy-walk-tiles-and-commit-first]], [[patterns-match-cards-specs-after-commit-first]].
