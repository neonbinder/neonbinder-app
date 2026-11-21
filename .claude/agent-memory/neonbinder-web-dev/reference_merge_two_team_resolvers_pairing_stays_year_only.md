---
name: reference_merge_two_team_resolvers_pairing_stays_year_only
description: After NEO-602 a card's team goes through resolveCardTeamName (players + alias-vs-own-name guard); pairing-time lookups with no cards (resolveTeamIdentities, place round-trip) must use it year-only, not resolveTeamForSetYear
metadata:
  type: reference
---

`resolveTeamForSetYear` (year only) now belongs to STINT callers and to "does any row answer to
this string" existence checks. Anything that asks "which team does this CARD's team text mean"
goes through `resolveCardTeamName`, even with no players to hand: called year-only it still applies
the alias-vs-own-name guard, so "Oakland Athletics" in a 2025 set (own name of the 1968-2024 row,
alias of the 2025- row) answers null instead of the year's alias pick.

**Why:** a pairing-time identity check that kept the year-only resolver would call two names the
same team on the strength of the very alias pick the gate later refuses.
**How to apply:** when merging/adding a team lookup, ask whether a card or a stint is the subject.
Also: a prelude closure that looks up same-name players (`cardPlayerIdFor`) must use the commit's
`sameNameForCommit` (excludes the retry's own minted row) and be declared before the closures that
call it (const TDZ in a long handler).
