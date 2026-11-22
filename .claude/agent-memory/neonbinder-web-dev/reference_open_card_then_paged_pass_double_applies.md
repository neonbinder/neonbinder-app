---
name: reference-open-card-then-paged-pass-double-applies
description: A mutation that decides the open card in-call and then schedules paged passes over ALL cards re-decides the open card with the same old->new pair; non-idempotent rules (a swap) destroy their own result
metadata:
  type: reference
---

applySetNameToTitles patched the open card, then retitleLeafPage paged over every card including it. A hand edit swapped in pass 1 no longer holds the old name, so pass 2 rebuilt it as generated. Pass the open card's id to the paged job and skip it. Prove with a test that saves FROM the hand-edited card and drains the schedule.

Also: a career/tie verdict shared by tile + commit + answer-time fill + apply-to-all must go through one helper (convex/lib/careerVerdict.ts) so rank (set leagues) and the sport check cannot drop out of one caller.
