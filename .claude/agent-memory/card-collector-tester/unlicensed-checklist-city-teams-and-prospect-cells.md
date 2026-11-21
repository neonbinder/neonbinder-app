---
name: unlicensed-checklist-city-teams-and-prospect-cells
description: Unlicensed (MLBPA-only) checklists print cities as teams and "Prospect (school)"; alias poisoning from bare place names; Prospect X conventions by maker
metadata:
  type: project
---

Unlicensed makers (Onyx, Leaf, some Panini) cannot print club names, so the team column is a city ("Seattle",
"St Louis") with "(A)"/"(N)" for two-club cities (AL/NL). Draft/amateur cards print "Prospect (X)" where X is the
college or HS shown, or bare "Prospect". Bowman (licensed) prints the MLB org instead, so a "Prospect (Yankees)"
cell means an org prospect, not a minor/college team.

Review checks for any feature that reads such checklists:
- A bare place name saved as a team ALIAS poisons other sets: "Arizona" = D-backs on Onyx, = Wildcats on Bowman
  Draft. Prefer resolving a place against the team's Location within the set's league (exactly-one guard) over
  aliasing the place; never default "Remember as a name" on for a bare place.
- City strings resolve nowhere by name, so every card hits the Teams step: count the clicks (one line per player).
- HS, international (country), NPB and summer-league X fall outside a minor/college filter: the held line must
  still have a way out ("Other team…", "No team"), and a filtered chip list may hide the very team listed.
- A note after X ("Prospect (X) (RC)") on a keep-brackets path can survive as a team STRING; test it.

Related: [[team-prefill-set-year-traps]], [[pasted-checklist-format-traps]], [[known-brand-curation-tests]].
