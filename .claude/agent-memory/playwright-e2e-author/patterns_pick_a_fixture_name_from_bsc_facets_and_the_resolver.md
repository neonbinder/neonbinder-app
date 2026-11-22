---
name: patterns_pick_a_fixture_name_from_bsc_facets_and_the_resolver
description: Picking a Tidy-walk fixture name - BSC public search, the gate resolver verdict, slug probe, attribute tokens, real-person name collisions, global players trap, lookup throughput
metadata:
  type: reference
---

**Cards without a login.** `POST <BSC API base>/search/shop/results?q=` with `filters`
`{sport:["baseball"], year:["2009"], setName:["topps"], variant:["insert"], variantName:["<slug>"]}` answers
unauthenticated. `aggregations.variantName` lists every insert of a set with its card count;
`aggregations.players` the names on one insert; paging `results` (size 100) gives `cardNo | players | teamName`.
`/search/bulk-upload/filters` is the authenticated one (401). `playwright/tools/capture-bsc-checklist-teams.mjs`
uses the same endpoint.

**Catalogue verdict.** Run the gate's own resolver read-only, per name, in parallel (`xargs -P6`):
`npx convex run --codegen disable --typecheck disable players:resolveNameForReview '{"name":…,"sportId":<sport row
id, read with --inline-query>,"cardYear":2010,"cardTeamNames":[<card team>]}'` (`players:resolveNamesForReview`
is the batch form). No `playerId` and `matchCount` 0 = the name is a plain "Add as new player" row; `matchCount` 2
= a pick or Hall-of-Fame case. A hand-rolled name-key query gives false misses (initials are joined: "B.J. Upton"
resolves though a naive key does not): first filter only, sort tokens when keying.

**Selection recipe.** Intersect the player lists of every small insert of the two years, drop names the spec's
other inserts already spend, run the resolver over every card name on the two candidate inserts, keep a pair where
the target is the ONLY unknown name (every other unknown is another live Wikidata lookup to record). Real MLB names
can be absent from the catalogue (Rickie Weeks, Jon Niese), as can BSC misspellings (Kendry for Kendrys).
Record afterwards: [[patterns_record_a_fixture_sets_lookups]]. A suggested player's row is inserted READY with no
lookup, so that second fetch needs no recording. Unprovable from dev alone: whether a CI preview's catalogue (a
prod snapshot) holds the name; say so in the registry.

**Hand-added cards never carry unknown names.** Quick-add's Players field is a `PlayerPicker` and
`addCustomCard` takes real `playerIds`, so a hand-made card is born linked. Unknown names reach the walk from a
BSC fetch or a pasted checklist ([[patterns_checklist_is_a_match_cards_source]]); a SportLots-only fetch yields
none (its adapter declares `team`/`players` but never sets them). Per-worker hand-typed sets are not
BSC-resolvable (`BSC_REQUIRED_LEVELS` checks the setName level, the attach dialog writes ids to the variant row).

**NEVER create a player on a shared real-set fixture.** `players` is GLOBAL and empty at the head of a run. A name
one worker "adds as new" stops being unknown for every worker that fetches the same set afterwards, quietly
draining the fixture. Specs on such a set decide rows as skip / link / "Not a player" (per-set), and a probe
spec that adds players must use minted names ([[patterns_per_worker_data_isolation]]).

## Capture checklist slug probe

Find facet slugs with the public search: `search/shop/results?q=<text>` with sport/year filters, read
`aggregations.setName` / `aggregations.variantName` (each has a `slug`). A set's label can differ from its slug
(`1995-96 Roanoke Express ECHL` is facet `roanoke-express-echl`; a variant name is its own slug, `future-stars`).
Filter `setName`, `variant` and `variantName` together and check `totalResults` against the expected count before
running the tool. For a merged NB set (one NB row over several BSC sets), compare the BSC sets' card numbers first:
two series numbered 1-110 each give a file where every number is on two rows, so `checklistFacts().matched` is 0
and the upload cuts no calls: do not capture those. A row whose number the parser cannot read (`TBD`) is skipped
and still asked of BSC live. Pass `--cache` explicitly into the scratchpad; keep CSVs the only new files in
`fixtures/checklists/`; run sets one after another at `--rate 0.5`. In zsh a bare `echo ===X` fails (`=cmd`
expansion): quote it. Related: [[patterns_published_checklist_upload_fixtures]].

## Probe fixture attribute tokens

A spec that needs "the sync commits cards carrying AU / SN<n>" must verify BSC's `playerAttribute` really holds
the token, because the sync reads that field and nothing else: page the public search by `setName` + `variantName`
and compare `playerAttribute` with `productName`. NEO-345 trap: a set can print "AU, SN99" in `productName` while
`playerAttribute` is `[""]` for every card (2025 Bowman Draft "Prospect Dual Autographs"), while sibling inserts
carry `["AU","SN99"]`. If the field is empty, say so in the spec comment and report instead of asserting on it; a
better fixture is a new real set and needs owner approval (SET-REGISTRY rule 1). `expect(a.or(b))` is a strict-mode
error when both resolve (e.g. Autograph tile radios AND a usable Save), so gate on the one that is always there.

## Real person fixture names collide with committed checklists

Before using a real person's name, grep `apps/web/playwright/tests` AND walk `SET-REGISTRY.md` for every set whose
checklist a spec fetches and COMMITS ("Add all N new players" or a commit mints a `players` row per unknown name).
Check the candidate against each (TCDB or a web search is enough).

**Why:** NEO-289 planned "Tony Gwynn" for the live Wikidata enrichment spec. No spec names him, but he is a card
in a 1996 Score insert another spec bulk-commits every CI run; once that spec lands first, `/admin/players`'
near-match panel finds the row, the primary reads `Open Tony Gwynn`, and `getByRole("button", { name: "Create
player Tony Gwynn" })` matches nothing. The first replacement was then absorbed by the reference catalogue
(every prod player, NEO-330), so the live-proof name is a Hockey player the NHL-only catalogue never holds. Add
checks: the preview's `players` and `playerAliases` read-only, plus one `Q5` binding for the adapter SPARQL with
`LIMIT` removed.

**How to apply:** prefer a player who retired before the oldest committed set's year and is not a legend of any
team the team sets honour. Such a spec is FRESH-ONLY: an existing row is ADOPTED by `createByAdmin` and never
re-enqueued for enrichment, and an optional "anyway" hedge would let a rerun go green on the previous run's QID
(R2 false positive). Say so in the header instead of branching.

## Lookup throughput (measured 2026-10, before NEO-645; the pool is unchanged)

**Size a window on the pool's depth, not a per-lookup time.** The enrichment pool is 5-wide FIFO: N unknowns need
ceil(N/5) rounds, each a round-trip plus ~0.2 s, and staged teams queue behind every player. Per-lookup time is a
CONVEX number (~4-5 s each on a deployment; 0.3-20 s with Wikidata 502 retries; no-match names ~2.3 s), never a
laptop number (the `*Live` bodies under tsx settled 20 NPB names in 3.8 s). One pool per deployment, so CI
contention only lengthens windows. A 244-name batch settled about 0.7 rows/s. Fixture-recorded names
(`enrichment_fixture ... hit`) settle instantly and count for nothing. `startBatch` inserted every player row
before any team row, so a team staged by a lookup waits behind every player still queued. A READY row (a name two
players on file share, no lookup until Create new) is presentable immediately while everything else is looking
up. Check a candidate set's unknown count before choosing a live-lookup walk.
Related: [[reference_same_name_player_panel]], [[patterns_record_a_fixture_sets_lookups]].
