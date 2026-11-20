---
name: client-teamless-default-mirrors-server-conservatively
description: A client-side preview of a server commit default (teamless sport -> "No team") may ASK about a card the server would stamp, never the reverse; gate it on every data-claim the server gates on, and keep the plan from starting until all the facts load
metadata:
  type: feedback
---

When the wizard predicts a server-side default (NEO-426: teamless-sport cards stamped "No team"),
the client check is a conservative mirror: it must never skip a card the server would NOT stamp.

**Why:** a card skipped client-side but not stamped server-side saves teamless with the question never put (rule 8: a data claim holds back a guess).

**How to apply:**
- Mirror every server gate: existing-row positions are asked, a listed team or raw team name blocks, a BSC ref whose team lookup has not ended ("answered"/"checklist") blocks, an unaccounted pending player blocks, and EVERY player's HOME sport must be flagged.
- Carry the extra facts on the shared `StoredPeople` object only beside a flagged sport/name, so the no-teamless path stays byte-identical.
- A step-count tracker fed by a not-yet-loaded fact needs a "known" flag (`teamsStepKnown`) that holds the previous value, or the progress bar measures a half-loaded plan.
- Every wizard test that mocks `useQuery` by ref needs `sportTeamless.listTeamlessSportIds -> []` (and the api mock key where the api is a literal), see [[reference_component_tests_hand_build_the_api_mock]].
