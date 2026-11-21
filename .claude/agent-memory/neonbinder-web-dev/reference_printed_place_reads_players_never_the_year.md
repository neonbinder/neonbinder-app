---
name: reference_printed_place_reads_players_never_the_year
description: A checklist team printed as a PLACE settles at pairing only when ONE in-league team (any era) has it; several go to the card rule with playersMustDecide, never the year
metadata:
  type: reference
---

`pickPlaceTeam` settles only a lone in-league location row. Two or more (Pilots + Mariners) leave the text as printed; the gate (`resolveGateTeamNames`, new optional `selectorOptionId`) and the prelude (`resolveTeamSilently`) pass `placeLeagueIds` (lazy loader) to `resolveCardTeamName`, whose place leg (no name/alias hit, >=2 in-league location rows) runs `pickCardTeam` with `playersMustDecide: true` (step 4, the year fallback, answers null). The place rows come back as `candidates` so the gate marks the name ambiguous (skips set history, offers the rows in the team step).

Consequences to remember: a players' answer against the year is a visible careerTeam row at the gate and "unreviewed" at the prelude (same agreesWithYear rule as NEO-602); a lone place row is still the operator's at the gate (pairing's job); at pairing the unsettled text AGREES with a marketplace team that is one of the place's teams (Jason 2026-11-20): `resolveChecklistPlaceTeamIds` (set of ids, any era) -> `resolveChecklistPlaceSets` -> `applyChecklistRow`'s 6th param `resolvePlaceTeamIds` -> `placesAgree` (one-to-one matching of checklist texts to marketplace ids); agreement is NOT `answered`, so the card keeps the marketplace team and the place text is never written over it. A marketplace team outside the place's teams, or no set answer, is still a conflict. One test file drives gate and commit with the same fixture so they cannot drift.

Related: [[client-preview-of-a-commit-rule-shares-its-predicate]].
