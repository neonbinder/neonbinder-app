---
name: patterns_pick_a_wizard_name_from_bsc_facets_and_the_gate_resolver
description: Picking a wizard fixture - BSC facets and the gate resolver, slug probe, attribute tokens, real-person name collisions, reaching the wizard only from a real fetch, lookup throughput
metadata:
  type: reference
---

**Cards without a login.** `POST <BSC API base>/search/shop/results?q=` (body in
probe bsc public search for card ids) with `filters` `{sport:["baseball"],
year:["2009"],setName:["topps"],variant:["insert"],variantName:["<slug>"]}`
answers unauthenticated. `aggregations.variantName` lists every insert of a set
with its card count; `aggregations.players` lists the names on one insert;
paging `results` (size 100) gives `cardNo | players | teamName` per card. The
`/search/bulk-upload/filters` endpoint is the authenticated one (401).

**Catalogue verdict.** Run the gate's own resolver read-only, per name and in
parallel (`xargs -P6`): `npx convex run --codegen disable --typecheck disable
players:resolveNameForReview '{"name":…,"sportId":<Baseball sport row id, read
with --inline-query>,"cardYear":2010,"cardTeamNames":[<card team>]}'`. No
`playerId` and `matchCount` 0 = the name stages as a plain New player;
`matchCount` 2 = a pick or Hall-of-Fame case. A hand-rolled name-key query gives
false misses (initials are joined: "B.J. Upton" resolves though a naive key
does not) so use it only as a first filter, and sort tokens when keying.

**Selection recipe.** Intersect the player lists of every small insert of the
two years, drop names already spent by the spec's other inserts, run the
resolver over every card name on the two candidate inserts, keep a pair where
the target is the ONLY unknown name (every other unknown name is another live
Wikidata lookup to record). Real MLB names can be absent from the catalogue
(Rickie Weeks, Jon Niese), as can BSC misspellings (Kendry for Kendrys).

**Record afterwards.** Baseball (default sport, no `sportQid`) hit plus a
Football no-match, with `lookupPlayerEnrichmentLive` under `npx tsx` and a
tripped-`transportFailed` check; see [[patterns_record_a_fixture_sets_lookups]]. A
suggested player's row (rules E1/E2) is inserted READY with no lookup, so the
second fetch needs no recording.

**Unprovable from dev alone:** whether the CI preview's catalogue (a prod
snapshot) holds the name. Say so in the registry.

## Capture checklist slug probe

Find the facet slugs with the public storefront search (no login): POST `search/shop/results?q=<text>` with
`filters` of sport/year and read `aggregations.setName` / `aggregations.variantName` (each entry has a `slug`).
A set's label can differ from its slug source (BSC row `1995-96 Roanoke Express ECHL` is facet `roanoke-express-echl`;
a variant name is its own slug, e.g. `future-stars`). Filter by `setName`, `variant` and `variantName` together and
check `totalResults` against the spec's expected count before running the tool.

Before capturing for a merged NB set (one NB row over several BSC sets), compare the BSC sets' card numbers: two series
numbered 1-110 each give a file where every number is on two rows, so `checklistFacts().matched` is 0 and the upload cuts
no calls. Do not capture those.

A row whose number the parser cannot read (`TBD`) is skipped and that card is still asked of BSC live.

Pass `--cache` explicitly into the scratchpad; keep CSV outputs the only new files in `fixtures/checklists/`.
Run several sets from one script, one after another (never parallel), at `--rate 0.5`.
In zsh a bare `echo ===X` fails (`=cmd` expansion): quote it.

Related: [[patterns_published_checklist_upload_fixtures]]

## Probe fixture attribute tokens from bsc public catalogue

A spec that needs "the sync commits cards carrying AU / SN<n>" must verify the
fixture really has the token in BSC's `playerAttribute` field, because the
sync reads that field and nothing else. The shop search answers without a
login (recipe in probe bsc public search for card ids in the
marketplace-adapter-dev memory): page through `q=<year set variant>`, filter on
`setName` and `variantName`, and compare `playerAttribute` with `productName`.

Trap found on NEO-345: a set's cards can print "AU, SN99" in `productName`
while `playerAttribute` is `[""]` for every card (2025 Bowman Draft "Prospect
Dual Autographs"), so the sync sees no AU and no print run. Sibling inserts of
the same set (Bowman Draft Nights, Bowman In Action, Prized Prospects,
Achromatic Autographs) do carry `["AU","SN99"]`.

**How to apply:** before asserting a wizard step or a print run that hangs on a
token, probe the fixture's rows; if the field is empty, say so in the spec
comment and the report instead of asserting on it. Adding a better fixture is a
new real set and needs the owner's approval (SET-REGISTRY rule 1).
Also: `expect(a.or(b))` is a strict-mode error when both resolve (the autograph
step shows its radio group AND Next together), so gate on the one that is
always there, then branch.

## Real person fixture names collide with committed checklists

Rule: before using a real person's name in a spec, grep `apps/web/playwright/tests`
AND walk `SET-REGISTRY.md` for every set whose checklist a spec fetches and
COMMITS (the wizard's "Add remaining players as new" mints a `players` row per
unknown card name). Check the candidate against each of those checklists (TCDB /
a web search is enough) before settling on it.

**Why:** NEO-289 (2026-09-20) planned "Tony Gwynn" as the live-proof name for the
live Wikidata enrichment spec. No spec names him, but he is a card in a 1996
Score insert that another spec bulk-commits every CI run, so on any run where
that spec lands first, `/admin/players`' near-match panel finds the row, the
primary button reads `Open Tony Gwynn`, and `getByRole("button", { name: "Create
player Tony Gwynn" })` matches nothing: the spec reds by name. Replaced with a
player who retired before the oldest committed set and is in none of them.
Since NEO-330 the preview also holds the reference catalogue (every prod player),
which absorbed the first replacement too, so the live-proof name is now a Hockey
player the NHL-only catalogue never holds (Vladislav Tretiak). Add a fourth
check: the preview's `players` and `playerAliases` read-only, plus one `Q5`
binding for the adapter SPARQL with `LIMIT` removed.

**How to apply:** the committed-checklist set (NEO-330) is 2024 Topps Chrome (seed),
the 1995 CHL/ECHL hockey team sets (Tulsa, Memphis, San Antonio, Roanoke), 1996 Line
Up Venezuelan Winter League and 1996 Score Dugout Collection. Re-read
`SET-REGISTRY.md` for the current list, and check the preview's reference catalogue
too. Prefer a player who retired before the oldest committed set's year and is
not a legend of any team the team sets honour. Such a spec is FRESH-ONLY: an
existing row is ADOPTED by `createByAdmin` and never re-enqueued for enrichment,
so a re-run needs a reset, and an optional "anyway" hedge on the create button
would let the spec go green on the previous run's QID (R2 false positive). Say so
in the header instead of branching.

## Reference neo220 wizard only from real fetch

**Date: 2026-09-05 (NEO-220/221, PR #229).**

## The fixture that died

Six specs reached `EntityReviewWizard` the same way: type an invented name into the
quick-add card form's free-text **Players** box, sync, and the resulting
`cardChecklist.pendingPlayerNames` opens the wizard. All six were **deleted**.

**Why it cannot be rebuilt:** quick-add's Players field is a `PlayerPicker` now and
`addCustomCard` takes real `playerIds`, so a hand-added card is **born linked** and
never carries a pending name. `resolveUnknownsAndStartBatch` finds nothing unknown,
the sync commits immediately, and no wizard appears. Do not "fix" a wizard spec by
re-typing into a Players box: that control is gone.

## Where wizard coverage lives

- **E2E:** the committing wizard specs under `tests/set-selector/` (see
  `SET-REGISTRY.md` and the GUIDE reference table), driven through `support/wizard.ts`.
  The seed also drains a wizard but only bulk-confirms.
- **Unit:** `EntityReviewWizard.test.tsx` (cancel/back/Enter), `entityReviewQueue.test.ts`,
  `entityReviewSkips.test.ts`, `SkippedNamesPanel.test.tsx`.

## Two facts worth keeping

- **The Confirm and Cancel footer buttons need distinct accessible names.** The old
  driver re-found the focused element by class and landed Enter on Cancel; the fix
  (NEO-260) was distinct aria-labels plus a marker class, never a DOM id. The button
  also handles Enter in its own `onKeyDown`, because a synthetic KeyboardEvent has no
  default action. In Playwright address each by role and name, and drive Enter with
  `press("Enter")` on the focused control.
- **On a REAL fetch the presented row may be a TEAM.** The decide button's accessible
  name is `Add as New {Player|Team}`, so match `/^Add as New (Player|Team)/`. (An exact
  near-match promotes the button to `Link to {name}`, effectively impossible for a
  queued row, since only names with no `findByNameAndSport` hit are queued.)

## Revival

`todos/neo-220-221-e2e-fixture-plan.md` (private wrapper) holds the conditions:
back-and-resume first, then skip / link-existing / career-team, on an owner-approved
SportLots set whose players are not already known. Needs Jason's approval of that set
AND of the "marketplace id on a per-worker set" pattern. See
[[patterns_per_worker_data_isolation]].

## Neo248 wizard fixture via attached sl set

# NEO-248 — the SL-only wizard fixture DOES NOT WORK (disproven live)

The design "hand-typed set under real ancestors plus ONE attached SportLots set id"
was tested end to end against two PR previews on 2026-09-05 and it CANNOT reach the
entity-review wizard.

`fetchSportLotsChecklist` (`convex/adapters/sportlots.ts`) **declares** `team` /
`teams` / `players` in its return validator but its handler never sets them. The doc
comment on `tokenizeSlDescription` says so deliberately: *"Team extraction is
intentionally NOT attempted here ... BSC supplies the canonical team in the merged
record anyway."* So **a SportLots-only fetch yields zero unknown player/team names for
ANY set**: the wizard never opens and every card commits as "needs attention"
(measured: "Saved 10 cards. 10 need attention", no wizard, `players` unchanged). This
is structural, not a bad choice of source set.

**Unknown names reach the wizard only from BSC** (`parsePlayersField` in
`convex/adapters/buysportscards.ts`) or from the retired hand-added
`pendingPlayerNames` path.

A per-worker set cannot become BSC-resolvable either: `BSC_REQUIRED_LEVELS` checks the
row **at level `setName`**, and the attach dialog writes ids to the **variant** row, so
a hand-typed set stays unresolvable even though `resolveBscFacetFilters` buckets ids by
FACET. Worth raising as a product inconsistency: resolvability is judged per-LEVEL,
the query is built per-FACET.

**THE WORKING ANSWER (measured on PR #235's preview, 2026-09-05):** the real,
BSC-listed set `Baseball > 2024 > Topps > Topps Big League > Base`. It syncs through
the real hierarchy (Base/Insert/Parallel, no reconcile), pairs 310 cards, and opens the
wizard on **88 unknown names (87 players + 1 team)**, first row a player with the
career-team form and "Back to Match Cards" present. The seed provisions its structure and
Base mapping and must NEVER fetch its checklist: committing would make those 87
players known and destroy the fixture.

**All readers must Cancel then Discard.** CI has NO serialization lanes beyond the
shard plan; "sole writer" (1996 Score) is a review convention (SET-REGISTRY), not a
runtime mechanism. Concurrent READS are safe: candidates are scoped to the fetching
operator and batches are keyed by selectorOption + user.

Also rejected on PRODUCT grounds (Jason, 2026-09-05): hand-creating a set with
`+ Custom` and then attaching marketplace data to it. Hand-creating exists to AVOID
syncing; if a test syncs, it must sync through the real hierarchy. And an insert set
never has a "Base" variant.

## Constraint that shapes every spec on a real wizard fixture: NEVER create a player
`players` is GLOBAL and empty at the head of every run. A name one worker "adds as new"
stops being unknown for every worker that fetches the SAME set afterwards, which quietly
drains the fixture until a later spec's wizard never opens. So specs on this fixture end
in **Discard** or decide every row as **skip / link**. Skips are per-set, so they do not
leak.

## Source-set checklist (probe before approving)
Under a real ancestor; small; its players not already in `players` but at least TWO
unknown names; its teams already known (the wizard shows one row at a time and which
settles first is a Wikidata race, so unknown TEAMS make "the current row is a player" a
coin flip); and no other candidate's name may contain it as a substring.

Related: [[reference_neo239_retire_custom_flow_impact]], [[patterns_per_worker_data_isolation]].

## Wizard fixture lookup throughput

**Per-lookup time varies too much to size a window on; size it on the pool's depth.**
One NPB batch on a PR preview (2026-10-11) ran Convex-side lookups from 0.3 s to 20 s
(Wikidata 502 retries in the tail; one 502'd name was re-looked-up ~42 s later and held
the tail to +44 s). The structural floor is the 5-wide FIFO pool: N unknowns need
ceil(N/5) rounds, each a round-trip plus ~0.2 s between a slot freeing and the next
start, and staged teams queue behind every player. Measured there: first five lookups
+0.5 s after `startBatch`, last player started +13.3 s, first team settled +14.1 s.

**Per-lookup time is a CONVEX number, never a laptop number.** Running the `*Live`
lookup bodies under tsx from a laptop (5 workers) settled 20 NPB names in 3.8 s wall.
Convex-side the same kind of names take ~4-5 s EACH: a CI run that had the 5-wide pool
to itself for the NPB batch started 21 lookups in 21 s. Dev 2026-10-10 agrees: 129 rows
of a 244-name batch (216 players + 28 teams, none recorded) in 180 s (~0.7 rows/s),
all in ~218 s on a later pass. No-match names are faster (~2.3 s, 1995 minor-league
hockey). So a batch of N unknowns keeps "still being looked up" on screen for about
ceil(N/5) x 4-5 s, and longer when other shards share the pool (it is ONE pool for the
deployment, so CI contention only lengthens windows). Fixture-recorded names
(`enrichment_fixture ... hit`) settle instantly and count for nothing.

**Order.** `startBatch` inserts every player row before any team row and the pool is
FIFO, so a team staged by a lookup is enqueued behind every player still waiting. The
first staged team settles roughly when the players have drained, which is when an
untouched player step starts yielding (`resolveNav`, teams first). The wizard walk
helper's first wait (`walkToPlayerRow` in `support/wizard.ts`) is the sanctioned 180 s
Wikidata ceiling, so it cannot drain a batch much over ~125 live names; the team-skip
drain afterwards costs ~3-4 s per team/league step on top (54 steps took 3m25s once
career teams were staged). Check a candidate set's unknown count before choosing the
walk.

**Where the batch starts relative to the spec.** In that CI run the wizard's title
(`Confirm New Players & Teams`, the fetch helper's last gate) painted 0.6 s BEFORE the
first lookup started (trace vs convex-logs clocks). A read right after the helper
returns lands ~1 s into the batch.

**Ready rows.** `isPresentable` is "undecided and not pending". A row inserted READY
(NEO-332: a name two players on file share, no lookup until Create new) is presented
the moment the wizard opens, while everything else is still looking up. Prove that in
ONE read: the heading below the header `0 of N reviewed - K still being looked up`.
Never put a resumed-batch discard helper that waits for something to be absent in front
of such a read: check the header text first and call the discard only inside the branch
that needs it. That is how the same-name pick-step spec skips the walk on a 244-name set. Main-branch backends
look such a row up, so a local run against a deployment on older code needs the walk
to reach it.

Related: `support/wizard.ts` (the walk helpers), [[reference_same_name_player_panel]], [[patterns_record_a_fixture_sets_lookups]].
