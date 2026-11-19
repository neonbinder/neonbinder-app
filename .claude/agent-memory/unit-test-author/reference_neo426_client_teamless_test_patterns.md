---
name: neo426-client-teamless-test-patterns
description: NEO-426 client tests - private takesNoTeamByDefault read via partition, unresolved-team fixture trap, client/server parity sweep, zsh word-splitting in break loops
metadata:
  type: reference
---

- `takesNoTeamByDefault` is private: test through `autoNoTeamIndexes` / `teamlessCardIndexes`, and assert the partition (a would-be-teamless card is in exactly one) in a helper.
- A printed team string with NO review row counts as RESOLVED (resolved before the sitting), so it takes the card out of both lists. To make a listing claim reachable use a team row with `decision: null`, or `rawTeamName`.
- A BSC card with `teamLookup: "checklist"` and no team strings is `checklistClaimsNoTeam`: in neither list. "checklist" only matters beside a ruled-out string.
- Client/server parity: build the server verdict from the same case (`sportDefaultNoTeam` + real `noTeamCardVerdict` + exported `commitTeamHint`; `settleCardTeamAnswer` is not exported, mirror it). Assert implication client-auto => server-stamp over a cartesian sweep plus a named table; guard against vacuity (client-asks-more count > 0).
- Wizard: the bar shows `aria-valuenow` 0 (not absent) while the plan has not started; empty review rows means the wizard shows nothing useful (CardChecklist decides that path).
- Break-check loops: zsh does not word-split `$T`; use arrays. Restore from a copy and compare md5.
