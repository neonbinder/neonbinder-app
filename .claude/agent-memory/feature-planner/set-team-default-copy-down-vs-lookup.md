---
name: set-team-default-copy-down-vs-lookup
description: Set-level team defaults (selectorOptions.teamIds) are COPIED DOWN at node creation and cascaded on edit; NEO-528 player defaults are LOOKED UP nearest-first at card birth. Do not mix the two for one attribute.
metadata:
  type: project
---

Two carry-down mechanisms exist for Attributes-panel defaults:

- **Copy-down + edit cascade** (NEO-277 `teamIds`): every node-creation site spreads the parent's value (`inheritedTeamIds` callers across selectorOptions, setReconciliation, setFromMarketplace, slSetReview, brandRehome, set*Conversion); `setSelectorOptionTeams` cascades with the equal-to-previous rule. The leaf row always holds the effective value, so card birth reads one row.
- **Lookup at birth** (NEO-528 `defaultPlayerIds`/`defaultCameoIds`): nothing copied; `effectiveCardPlayerDefaults` walks the row chain nearest-first (parallels pass through their parallel-of row).

**Why:** a new state of an existing attribute (NEO-556 "No Team" beside the set team) must ride the attribute's own mechanism. A looked-up value competing with a copied-down one gets the wrong "nearest" (a copied team on an insert beats a No Team set above it).

**How to apply:** extend the existing mechanism; when widening a copy-down value, replace/rename the helper so the typechecker lists every creation site rather than grepping. A set default that would suppress a pending marketplace lookup (a No Team stamp stops the BSC team lane) must wait for the lookup's answer (invariant 8). Related: [[attributes-panel-choices-are-stored-and-copied-to-new-cards]].
