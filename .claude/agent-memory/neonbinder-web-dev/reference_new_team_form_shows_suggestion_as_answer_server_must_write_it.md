---
name: reference_new_team_form_shows_suggestion_as_answer_server_must_write_it
description: NewTeamForm shows the lookup's league suggestion as the answer while leagueId/leagueName are undefined; any host that creates the team must forward it or the shown answer is silently lost
metadata:
  type: reference
---

`NewTeamForm` renders `leagueSuggestion` as the current League answer while the draft is unanswered (`leagueId` and `leagueName` both undefined), but writes nothing to the draft. The old wizard commit fell back to `enrichment.league` (link-only, fail-soft). A host that calls `teams.findOrCreate` directly (the Tidy Up inline form) lost that silently, along with the era, colours and ESPN/Wikidata ids.

Fix shape: `findOrCreate` takes an optional `enrichment` object, read on the INSERT branch only, each field validated and DROPPED (never thrown on) when malformed; the operator's league / years always win and `leagueId: null` is never overridden. A client form that shows a suggestion must forward it as `enrichment.league`.

Related: [[entity-enrichment-fires-only-at-creation]] (coordinator memory), team lookup data is assistive.
