---
name: neo639-chip-years-and-failed-lookup-tests
description: NEO-639 Teams-step tests — fixtures that reach an UNSELECTED chip (years only print there), cap tests vs the per-player tie rule, the server stints read-cap guard, setNoTeam wiring stubs
metadata:
  type: reference
---

Years print only on chips OUTSIDE a line's `suggestion` (`TeamRef.years`), so a
fixture must first produce an unselected chip:

- **Created player**: `careerTeamVerdict` returns NO candidates when it has an
  answer (one team in window). To see years on a second chip make the window a
  tie (set year where two stints overlap), or pass `setNoTeam: true` (holds the
  answer back as a choice).
- **Undated career leads** are dropped unless they are the one in-league team,
  where they become the answer — so the only way to show "undated = no years"
  on a chip is the one-team undated case under `setNoTeam`.
- **Server player**: `{ answer: null, candidates, stints }` or a
  `preferredInWindow` answer plus a lower-ranked candidate. Stints match chips
  by `teamIdKey`, so a batch chip (keyed `name:...`) never gets years — that is
  the pin for "batch chips keyed by name".

Cap tests in `CardAttentionWalker.test.tsx` / `MissingTeamFixer`: since NEO-639
decision B, one player with N set-year teams is a TIE and preselects nothing.
Prove the 8-team cap with N players each holding ONE set-year team.

Server `teamSuggestionsForPreview.stints`: the `teamCache` guard is invisible
to sport-filter tests (other-sport teams are already filtered via `known`). It
only bites for a team past the career read cap (24 distinct teams): seed 30
same-sport teams, then another sport's team, and assert it never appears.

Removed group field (`lookupFailed`): assert `"field" in group` is false rather
than deleting the coverage. CardChecklist wiring of a new wizard prop: add it to
the file's EntityReviewWizard stub as a `<p>` and read it back (see
[[neo592-gate-parity-patterns]] for the source-mutant break-check loop; restore
with cp from scratchpad and confirm `git diff --stat` is empty).
