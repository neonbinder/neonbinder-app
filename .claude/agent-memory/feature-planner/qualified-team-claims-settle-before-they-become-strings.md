---
name: qualified-team-claims-settle-before-they-become-strings
description: The commit resolves a card's team STRINGS by name, set-wide and unrestricted (resolveTeamForSetYear), so a team claim carrying a restriction (league level, "college or minor only") must be settled at fetch or held off the teams array
metadata:
  type: project
---
Every team string on a checklist card reaches the commit prelude's resolve loop,
which keys `teamIdByName` by the string alone and calls
`resolveTeamForSetYear(sportId, name, setYear, {allowPastEra})` with no league
filter; the Names gate does the same exactly-one lookup before the wizard opens.
A string therefore cannot carry a qualifier. A claim like "Prospect (Arizona)"
(college/minor only) left as "Arizona" binds silently to an MLB row whose alias
is "Arizona" whenever NB lacks the college team.

So a qualified claim is resolved server-side at fetch (beside
`resolveChecklistTeamTexts`): exactly one qualifying row becomes its full name
ONLY if `resolveTeamForSetYear(fullName)` returns that same row (the commit's
own lookup agrees); anything else travels as a separate held-claim field that
never enters `teams` and puts the card in the Teams step with no pre-fill.

**Why:** found planning the NEO-591 Prospect team rule (2026-11-17); the Onyx
checklist itself prints MLB clubs as bare locations ("Arizona", "Tampa Bay").

**How to apply:** any plan that adds a team claim with a condition (league
level, era, sport) checks where the string is first resolved and settles or
holds it before that point. A per-card attribute from a checklist row rides the
`isRookie` route (candidate row, previewCardFields, commit chunk,
`deriveCardObservedFeatures`). Related: [[checklist-pairing-modal-absorbs-only-teams]],
[[reversible-auto-links-are-decisions-not-fast-path-answers]].
