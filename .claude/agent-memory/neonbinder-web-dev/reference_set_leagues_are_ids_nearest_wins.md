---
name: set-leagues-are-ids-nearest-wins
description: Since NEO-569 a set's leagues are selectorOptions.leagueIds (setName and below, nearest row wins, any-of) and a card's is cardChecklist.leagueId; features.league is retired. How readers, fixtures and real-way trees must treat them
metadata:
  type: reference
---

A set's leagues are `selectorOptions.leagueIds` on `setName`, `variantType`,
`insert` or `parallel` rows, looked up (never copied down): the row's own list,
else the nearest ancestor's, stopping after the `setName`
(`convex/lib/selectorLeagues.effectiveSetLeagues`). Lists are never merged.
Membership is any-of (a team is "in the set's league" if in any of them), and
readers keep only the leagues of the sport they rank in (the picker filters to
the searched sport, `teamSuggestionsForPreview` to the set's sport). A card's
own league is `cardChecklist.leagueId`, born at insert and settled inside
`syncCardTeamLinks` (`convex/cardLeague.ts` holds the rule). The free-text
`features.league` is retired: `inheritableFeatures`/`mergeCardFeatures` drop it,
the feature doors refuse it, and `leagueBackfill.pin.test.ts` fails any reader
outside `leagueBackfill.ts`.

**How to apply:**
- Fixtures: put `leagueIds: [leagueId]` on the set row, not `features.league`.
  A fixture string like "MLB" no longer resolves to anything server-side.
- A tree built the real way (`addCustomSelectorOption` sport → … → setName)
  only LINKS the sport's major league if a row already answers to the
  sportConfig name/abbreviation (`findDefaultLeagueId`, read-only). Automatic
  paths never create leagues, so a fixture that expects a default set league
  must insert that league row BEFORE creating the set; otherwise the set is
  born with no `leagueIds`.
- Tests that used `league` as the example free key for
  `setSelectorOptionFeature` now hit the door refusal; use `subsetLabel`.
- Real-way set creation adds reads once per mutation (memoised on `ctx.db` per
  brand), so exact read-budget tests (`setFromMarketplace.test.ts` counting
  ctx) gain a fixed +query/+get, not a per-root cost.
Related: [[convex-system-op-budget-and-bounded-walks]], [[search-mock-must-honour-query-args]].
