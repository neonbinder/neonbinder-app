---
name: reference_neo239_retire_custom_flow_impact
description: What retiring isCustom (NEO-239) and removing the Admin Tools panel/seeded fixture (NEO-214) change for specs
metadata:
  type: reference
---

# NEO-239 — "custom" is not a thing any more

The `isCustom` boolean is deprecated (kept in the schema, never read or written). A
row either carries marketplace ids or it does not, and both behave identically.

## What specs may no longer assert

- **There is no "Custom" badge.** Provenance is shown by the BSC/SL pills only, and
  a hand-added row has neither, so "this row is hand-made" is NOT assertable in the
  UI. Prove survival/creation with the row's own VALUE instead.
- `SyncDoneNotice`'s old "no bare word Custom" constraint is retired with it.

## The fetch gate: say it the new way

NEO-22's `isCustomSubtree` ("once custom, always custom") is replaced by **per-side
resolvability: a marketplace side is fetched only when the ids that side needs are
present on the ancestors.** BSC needs `sport`, `year`, `setName`; SportLots needs
`sport`, `year` (+ `manufacturer` to attach). A hand-made subtree has no ids anywhere,
so neither side is resolvable, neither is fetched, and every column still goes idle
instantly: the invariant the per-worker fixture specs depend on. `SET-REGISTRY.md`
states it this way; don't reintroduce the `isCustomSubtree` wording.

## Renames

`refusesValueRename` is deleted. **Any variantType can be renamed**: Base is now
`metadata.isBase` (an NB role flag) and the BSC `variant` facet comes off the row's
tagged slot, so no display value is load-bearing. `SetAttributesPanel` renders
`RenameEntityControl` unconditionally. The rename spec renames a hand-added
variantType inside its own minted set. That test is not a tautology: hand-added rows
no longer get the `isCustom` flag the OLD refusal exempted, so the old server would
refuse the exact rename it performs.

## Base is a flag, not a name

The Base column is terminal only when the variantType row carries `metadata.isBase`;
there is no name fallback. Derived at variantType-sync time from a BSC `base` slot,
plus a one-shot backfill for existing rows and a "Mark as base set" control.
`drillToBaseVariant` and its dependents therefore only pass on a deployment whose 2024
Topps Chrome Base row has the flag. On a **PR preview** that is automatic: the preview
starts empty and the seed re-syncs every variantType row from BSC, so the flag must be
derived on the sync's INSERT branch, not only on match
([[patterns_local_run_backend_and_vite]]). Shared dev's rows predate the flag and
would need the backfill before a dev run
(feedback run specs on dev before first push).

## Neo214 no seeded fixture

# NEO-214 — no Admin Tools panel, no seeded team/player fixture

**Fact.** The `AdminTools` panel on `/admin/set-builder` ("Reset Set Builder Data", "Seed
Test Teams", "Wipe Legacy Base Children") was deleted, along with `teams.seedTestTeams`
and the public `selectorOptions.resetSetBuilderData` action. The reset is now a scripted
CLI step (`e2e-baseline.sh reset` calling `selectorOptions:resetSetBuilderDataFromCli`,
still gated by `ALLOW_RESET_SET_BUILDER_DATA`) that the CI seed job runs BEFORE the
`setup` project. There is no seed step for teams or players at all.

**Why:** Jason, 2026-09-03: "those should just not be there in production. If we want to
do either of those it should be a scripted admin task, not something in the UI that any
admin can hit." And 2026-09-04, on the seed: delete it entirely, "we can use admin/teams
and admin/players to create teams and players."

**How to apply:**
* The seed lands on `/admin` (the hub), not `/set-selector`: the deployment is already
  empty when it lands, and the Sports column auto-syncs on first mount, so landing on
  the cascade would race that sync against the BSC/SL credential warm-ups, which 503
  under concurrent logins.
* `teams` and `players` are EMPTY at the start of every run and nothing seeds a shared
  fixture. Every spec creates its own.
* Team creation is TeamPicker's `+ Create` row only (`Create team <name>` calling
  `teams.findOrCreate`, which also schedules a Wikidata enrichment on INSERT, so a
  created team is a small outbound cost). `/admin/teams` has **no** create control by
  design. (Later superseded in shape by the New Team dialog; see the project rule.)
* Name teams **per-worker AND per-attempt**: the create row renders only while no team
  of that name exists, so a leftover row from a prior attempt makes the picker show `Add
  <name>` and the spec reaches for a control that is not there. Register the prefix in
  `SET-REGISTRY.md` ("Team names") in the same commit.
* A spec needing a team's **colours** must create the team in a picker and then colour it
  on `/admin/teams`. The only picker outside the set-builder cascade is the
  `/admin/players` career-history editor, so such a spec also creates a throwaway
  player to reach it.
* On `/admin/teams`, an empty Primary-colour box answers to its PLACEHOLDER (`#01214b`),
  so `getByPlaceholder(...)` is both the handle and, with `toHaveValue("")`, the "no
  colours yet" assertion.

## Traps (CI run, 2026-09-xx)
**1. On `/admin/players` the TeamPicker's "+ Create" row may be unreachable.** The career
editor is the last thing on the panel, so the popover (`absolute top-full`) can render
its create row below the viewport with no page left to scroll. Playwright scrolls into
view itself, but a row clipped by the popover's own container can still miss; prefer the
keyboard path the component supports (Enter takes the highlighted match or else creates),
after asserting `No matches.` so the assertion proves Enter means create.

**2. `CareerTeamEntry`'s suggestion dropdown overlays the controls below it** and closes
only on pick / successful add / Escape. Suggestions come from `teams.search`, a Convex
SEARCH index: it matches on TOKENS, not substrings. Build such names from the provided
single-token attempt value (`env.ATTEMPT_TOKEN`), never from a hyphenated `ATTEMPT_ID`,
because every spec sharing a token (`a1`) would suggest each other's rows (GUIDE "Minted
names are single tokens").

**3. A column footer (`Sync Years`) is not "always visible".** It sits below the rows of
a populated column; scroll it into view (or assert `toBeInViewport` after
`scrollIntoViewIfNeeded`) rather than asserting it in place.

See [[patterns_per_worker_data_isolation]].
