---
name: neo656-stage-a-walk-players-career-in-a-second-tab
description: NEO-656 J6 - the walk has no Career tile for a new player on a no-team card; stage his stints in Players admin in a second tab (same context) and the open Team tile's career chips update live
metadata:
  type: project
---

After J6 the Career tile shows only a live gap, so a player created on the walk on a card with no
team gets NO Career tile and no "+ Add stint" (B24). A spec that needs his career on the Team tile
(league-ranked preselect, years on the unpicked chip):

- `const admin = await page.context().newPage(); await admin.goto("/admin/players")`, gate with
  `expectPlayersLoaded(admin, LAUNCH_GATE)` (fresh app load), filter, open `^<name> <Sport>\b`,
  `addCareerStint(admin, ...)` per stint, `Save` exact, `Saved <name>`, `admin.close()`.
- The walk stays open on his card; `teamSuggestionsForPreview` is subscribed, so the chips appear
  without a reload: assert `suggestedTeamChip(page, team, "<player> played here")` and the unpicked
  chip by its exact name `<team> · 1994–1996`.
- A re-sync may re-ask a ruled-out printed team (B3a): call the spec's release helper again before
  reading chips on that card.
- Plant that reddens it: TeamFillChips `teamSuggestionsForPreview` arg `playerIds.length > 0` ->
  `< 0` (no career chips), `--expect 'suggested'`. Fresh-only spec: `seed` before `plant --expect`.

Used in `checklist-one-marketplace-match-cards-keeps-every-card`. Related:
[[neo656-tidy-walk-helpers-skip-apply-end-screen]], [[neo656-career-tile-specs-after-j6]].
