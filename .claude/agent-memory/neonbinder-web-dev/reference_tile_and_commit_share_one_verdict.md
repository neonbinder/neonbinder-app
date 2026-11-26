---
name: tile-and-commit-share-one-verdict
description: A client preselect and the server write it predicts must call ONE pure verdict function, and one test must run both over the same shapes
metadata:
  type: reference
---

The Team tile's preselect and the commit's team fill drifted apart (tile: exact set year, preselect every
in-year team; commit: window [Y-1, Y], exactly one team, every player answering), so a card the tile
preselected stopped pink at commit (rule 8 risk). Fix was to make `suggestedTeamsForCard` call
`careerTeamVerdict` (convex/lib/teamFill.ts) and to add `tidyTeamFillAgreement.test.ts`, which runs the
real commit action AND the query on one set of shapes and asserts "fill happens iff preselected".

**How to apply:** any time a UI shows "we'll pre-fill X" for a rule a mutation also applies, route both
through one pure function in `convex/lib/` and pin the agreement with a test that drives both ends.
Also: a golden "equals origin/main" gate test and the `noTeamDefault.pin` source pins break when a new
auto-answer or `stampNoTeam` call site lands; update them deliberately, with a comment naming the
departure, never by loosening the pin.
