---
name: patterns-plant-first-on-a-one-shot-fresh-fixture
description: A new fresh-only spec whose feature is consumed by its own click (a shortcut that is gone once taken) — run the PLANT first, then probe the rest via the pill; and never read the "N need you" pill with textContent right after a write
metadata:
  type: feedback
---

When the feature under test disappears once used (NEO-645's Sources disagree cameo shortcut: the
offer is gone after the click) and the fixture is a real set the spec commits (one shot per seed,
no reseed allowed), a green-first run leaves nothing to plant against.

- **Run the plant first** (`plant --edit ... --expect '<assert message>'`): the real spec drives
  paste, fetch, Match Cards and the commit for real, and goes red at the hidden control. That run
  is the proof of the pre-click half AND of the plant.
- **Then a throwaway probe** (`zz-*-probe.spec.ts`, `rm` after) reopens the walk from the pill and
  runs the post-click half once. A second probe can only prove what the first click left (drawer
  read-back, settled pill); the steps between (Save & next, Back to the card) stay CI's to prove.
  Report which run proved which step.
- **The pill is stale right after a write.** `await pill.textContent()` straight after
  `saveForLater` returned the pre-answer "18 need you, 18 to fix"; the settled value was lower.
  Assert the pill with `toHaveAccessibleName(<measured string>)` (it retries), never parse a
  read-once value and do arithmetic on it.
- **A fixture's old registry counts lie after NEO-645.** "16 unknown players, 0 teams" (old
  wizard) hid that the club printed on every row is NOT in NB: every card's Team tile was pink, so
  the card under test stayed pink after the feature's click. Answer such a whole-set name first
  (`createTeamOnOpenRow` fans out) so the pill can drop by exactly the card under test.

**Why:** NEO-645 C2 cameo spec, 2026-11-22. **How to apply:** any fresh-only walk spec whose
asserted control vanishes after use; any pill count assertion.
Related: [[patterns-probe-the-rest-of-a-spent-fresh-only-run]], [[patterns-count-pill-suffix-and-anchored-negatives]]
