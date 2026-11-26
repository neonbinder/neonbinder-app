---
name: patterns_teams_step_chip_years_and_failed_lookup
description: NEO-639 on the walk's Team tile - chip names carry the player and stint years, negatives keyed on a bare team name go vacuous; making a card's team lookup FAIL with an unscoped card-listing 503
metadata:
  type: feedback
---

**Chip names on the Team tile.** A career chip reads `<team> · <player> <from>–<to>` (en dash; `2024–present`;
undated stints have no years) and, once pressed, `<team> · <player> played here`; the pre-fill ("Suggested from
career history.") shows as already pressed. A pressed chip is a choice, not a write: `Save team` writes it
([[reference_team_tile_on_a_hand_added_card]]). Pin the regex with the years (`1982.1996`) and the pressed variant
by exact name.

**Why:** an exact name pinned before a chip-naming change breaks loudly, but a NEGATIVE like
`getByRole("button", { name: /^Team · / })` silently stops matching anything once the name gains the player and
years. Write absences against the full current shape, and read the positive first
([[patterns_copy_absence_keys_on_the_refusal_clause]]).

**How to apply:**
- Sweep for chip-name regexes whenever chip naming changes; check negatives first.
- To make a card's fetch-time team lookup FAIL: `bscFake.setFaults([bscFault.answersUnavailable(BSC_PATH.cardListing)])`
  before Sync, `times` unset (the retry must fail too). No `cardId` is needed when the uploaded checklist leaves
  exactly one card to BSC; one card = 2 gate failures (gate opens at 5). `bscFake.clear()` before a later sync
  that needs the recorded answer.
- A failed-lookup card that saves WITH a team is not queued: prove it by
  `getByRole("status").filter({ hasText: /Still looking up teams for/ })` → `toHaveCount(0)` right after the exact
  "N need you" pill (the pill alone cannot tell: queued cards are not in it). Related:
  [[patterns_fake_bsc_faults_and_the_call_gate]].
- **Read a Team tile row only once it has loaded**: wait `Checking for teams by that name…` gone (and the tile's
  skeleton, "Waiting") before counting pressed chips. On a no-set-team BSC fixture whose lookup failed, seed
  players still pre-fill (NEO-639): measure which on a fresh seed, never assume none.
