---
name: same-name-team-eras-unprovable-on-a-card
description: Two team rows with one full name read the same on every card surface (drawer chip, row sub-line); to prove WHICH era a card got, give the other era a different own name holding the printed name as an alias
metadata:
  type: feedback
---

No card surface prints a team's era: the drawer chip (`Remove team <full name>`, built
by `TeamPicker` from `teamFullName`), the checklist row's sub-line and Player
Management all print the full name only. Two rows sharing a full name (the real
Orioles/Athletics shape, `admin-teams-two-eras`) therefore cannot be told apart on a
committed card; `checklist-wizard-past-era-team-link-commits` says so in its header and
proves the era through the wizard's era options instead.

**Why:** a drawer assertion on a same-name pair passes whichever era the commit wrote,
so it proves nothing about the era (NEO-602).

**How to apply:** when the feature is "the card got era X", make the other era's OWN
name different and give it the printed name as an ALIAS (`aliases (optional)` in the
New Team dialog; allowed when eras don't overlap). `pickCardTeam`'s players step reads
eras and stints only, so the alias holder exercises the same path, and the drawer's
`Remove team <other>` toHaveCount(0) beside `Remove team <expected>` visible is then a
real era proof. Say why in the spec header. If the feature is specifically the
own-name tie (step 4's alias guard), the alias variant does NOT cover it. Example:
`tidy-up-two-era-team-name-links-silently-when-a-card-with-no-career-abstains`. Related:
[[near-match-absence-proved-by-the-same-locator]].
