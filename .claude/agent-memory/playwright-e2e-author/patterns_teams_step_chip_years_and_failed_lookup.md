---
name: teams-step-chip-years-and-failed-lookup
description: NEO-639 - Teams-step chips outside the pre-fill carry stint years in their name; a failed BSC lookup is made with an unscoped card-listing 503 when the spec reads one card live; negatives keyed on "^Team — " go vacuous
metadata:
  type: feedback
---

Teams-step chip names (NEO-639): pre-filled chip `{Team} — {owner}`; any other chip where a
player on the line has a DATED stint is `{Team} · {years} — {owner}` (en dash, `1994–1996`,
`2026`, `2024–present`), visible text `{Team} · {years}` (`toHaveText` on an unchecked chip:
no ✓ in it). No years on "Other team…" picks or the no-players line. Labels follow the
DEFAULT, so checking the other chip does not rename it.

**Why:** an exact name pinned before NEO-639 breaks loudly, but a NEGATIVE like
`getByRole("radio", { name: /^Team — / })).toHaveCount(0)` silently stops matching anything
once the chip gains " · years". Write absences as `^Team( · [^—]+)? — `.

**How to apply:**
- Sweep for `getByRole("radio"|"checkbox", { name: ... — ${owner} })` on Teams-step chips
  whenever chip naming changes; check negatives first.
- To make a card's fetch-time team lookup FAIL: `bscFake.setFaults([bscFault.answersUnavailable(BSC_PATH.cardListing)])`
  before Sync, `times` unset (the retry must fail too). No `cardId` is needed when the uploaded
  checklist leaves exactly one card to BSC; one card = 2 gate failures (gate opens at 5).
  `bscFake.clear()` before a later sync that needs the recorded answer.
- A failed-lookup card that saves WITH a team is not queued: prove it by
  `getByRole("status").filter({ hasText: /Still looking up teams for/ })` → `toHaveCount(0)`
  right after the exact "N need you" pill (the pill alone cannot tell: queued cards are not
  in it). Related: [[patterns_fake_bsc_faults_and_the_call_gate]],
  [[patterns_copy_absence_keys_on_the_refusal_clause]].
