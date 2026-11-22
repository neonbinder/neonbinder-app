---
name: patterns_record_a_fixture_sets_lookups
description: Recording a fixture set's lookups - live lookups from convex logs, catalogue on CI previews, catalogue-seeded wizard staging, measuring a fixture from CI artifacts
metadata:
  type: pattern
---

**`captureFromCli` refuses on any catalogue-loaded preview**: `listCaptureNames`
reads every player/team row of the sport and throws past 5,000 (Baseball's
catalogue is far larger). Arming it is also a preview env change. Instead run
the SAME live bodies locally under `npx tsx` (an `.mts` script — a `.ts` in the
scratchpad is CJS and top-level await fails): `lookupPlayerEnrichmentLive`,
`lookupTeamEnrichmentLive(name, sport, knownQid, trace)`,
`lookupLeagueEnrichmentLive`, then `toFixtureEntry` + `fixtureKey`, 5 workers,
and DROP any entry whose `newLookupTrace()` tripped `transportFailed` (the
capture's own guard). The sport context is the sport row's `sportConfig`
(read-only `--inline-query`). 200 names took ~48 s from a laptop.

**The exact staged names:** after a committed probe the set's
`entityReviewSkips` rows (index `by_selector_option_and_kind_and_name`) hold
every SKIPPED row's raw `name` — the split per-player strings the wizard
staged, not `cardName` ("A / B CO" cards stage two names). Linked rows are
not there; add them by hand. Staged career teams/leagues carry a `knownQid`
(`source.wikidataId`): a recorded entry hits only when its `wikidataId`
equals it, and a recorded `null` is a MISS for a known-QID caller.

**Prove coverage offline** before any deploy: set
`NEONBINDER_ENRICHMENT_FIXTURES=1` and a dummy `TESTING_RESET_SECRET` in the
script's `process.env`, call `readFixture(kind, sportQid, name, knownQid)` for
every lookup the batch makes, count misses. The preview cannot show the new
recording until the bundle is redeployed (the JSON is imported at build).

**File hygiene:** `json.dumps(indent=2, ensure_ascii=True) + "\n"` reproduces
the committed file byte-exact; merge only absent keys, re-sort keys, and
check no existing entry changed. `enrichmentFixtureFile.test.ts` pins the
key/shape/sort and keeps the live-proof player out.

**Auto-link vs operator, without a probe** (NEO-307 rule in
`pickTeamForYear`): dump the sport's `teams` read-only, key rows by
`normalizeEntityName` of the composed name AND each alias, then run the real
`pickTeamForYear(rows, setYear, { allowPastEra: true })` under tsx. One dated
row ending before the set year = silent past-era link (no wizard step); two+
rows with none covering the year = no auto-link (a team step ONLY if the
name reaches the review gate; on a BSC-only fetch it can instead commit
teamless as "needs a team", see [[patterns_record_a_fixture_sets_lookups]]); one of
several covering it =
silent link to that era (the NEO-336 retro-card trap). BSC public shop facets
give `teamName` per card. See [[patterns_record_a_fixture_sets_lookups]],
[[reference_neo284_team_alias_fixture]].

## Find live lookups from convex logs

**Every lookup logs its fixture outcome.** In the `convex-logs-<project>-<n>`
artifacts (gzipped JSONL, one Convex function execution per line; each shard's
file holds the whole deployment's window, so dedupe by `executionId`), the
`logLines[].messages` carry `{"msg":"enrichment_fixture","outcome":"hit"|"miss","kind","name"}`.
`identifier` says who asked: `adapters/wikidata:runEntityReviewLookup` (a
wizard row), `enrichPlayer` (a player the product just created), `enrichLeague`.
A `miss` went live. The artifacts download through the public GitHub API
(`/actions/artifacts/<id>/zip`) even where job logs are blocked.

**Genuine no-matches are logged too.** `wikidata_player_no_match` /
`wikidata_team_no_match` (with the sport label) and `wikidata_league_no_match`
are written only after a completed search found nothing (a transport failure
returns before the log; a team with an ESPN answer returns that instead). Such
a line is a captured `null` answer, usable as a recording entry (an entry for a sport
other than the file's default carries its own `sportQid`). Names with real
answers can be captured without local Wikidata access by calling the
deployment's `adapters/wikidata:runCaptureLookups` with explicit items (it
writes nothing); see the fixture runbook §4b.

**What never costs a lookup:** a team created anywhere (NEO-254), anything in
a sport without `sportConfig.wikidata` (custom sports, Soccer, Golf...), a
checklist name the catalogue resolves to exactly one player, and a name two
players share (inserted ready, NEO-332). A player or league the product
CREATES is always looked up once, so a minted scaffolding name is a live miss.
Use `support/recorded-names.ts` (recorded Baseball no-matches, one per worker
per spec) for a scaffolding Baseball player; such a spec becomes fresh-only.

**Picking names offline:** a recorded-null name that the catalogue-loaded CI
preview staged WITH a lookup in both passes is proven absent from the
catalogue (a resolved name is not staged; a shared name is staged without a
lookup). A two-token real name breaks any spec that asserts an exact players
search COUNT (search is word-wise), so keep minted single tokens there.

## Reference catalogue on ci previews

Since NEO-330, every CI E2E run loads prod's reference catalogue onto the PR
preview right after the reset and before the setup spec. The Playwright guide states the rules ("A reference catalogue is on every CI preview"); these are the working facts behind them.

**Check names against the bundle, not by guessing.** The bundle is a
`convex export`-shaped zip (`<table>/documents.jsonl` plus `manifest.json` with
per-table and per-sport counts). Unzip it into a scratch dir and run
`grep '"name":"…"' players/documents.jsonl`. Use python `-I` to
tokenise `nameNormalized` when you need "does any word start with X" (that is
what `players.search` prefix-matches on the last term). The ops runbook
(docs/operations/neo330-reference-seed.md) says where the bundle lives. Never
copy rows out of it into a spec comment or memory beyond a name you assert.

**Catalogue spellings are not marketplace spellings.** Bulk-loaded players use
the Lahman shape: spaced initials (`J. T. Realmuto`). A seed commit of the
BSC spelling (`J.T. Realmuto`) keys the same (NEO-322 joins initials), so it
ADOPTS the catalogue row and no unspaced row ever exists.
The player-add spaced-initials spec had to flip direction: it now
types `J.T.` at the spaced row. Any spec asserting a real person's exact
spelling should be checked against the bundle.

**Capped lists that read in insertion order hide everything minted mid-run.**
A `.take(N)` with no index walks `_creationTime` ascending, so the catalogue
fills the window and a row a spec just made sits past it:
- `teams.listForManagement` (2000) drives /admin/teams. Its filter is
  CLIENT-side over that window, so a minted team never appears, and
  `?team=<id>` is ignored for an id outside it. This breaks every spec that filters Team Management to its own team. It is a product fix; no spec workaround exists.
- `teams.listForPicker` (2000) is the spine-label free-form team picker:
  same shape, but no spec drives it with a minted team.
- These are SAFE because a typed query goes to a search index:
  `players.listForManagement` (500, the page switches to `players.search` past
  two characters), PlayerPicker (a 500-row pool topped up by `players.search`),
  TeamPicker, CareerTeamEntry and EntityLinkSearch (`teams.search` /
  `players.search`). `franchises.list` reads newest-first (NEO-254).
- Before trusting any admin list at scale, read the query: is the filter
  server-side, and which end of the table does the cap keep?

**Free text is unaffected.** A card's name (the quick-add "Player name"
placeholder is the CARD NAME box), the spine label's "Name on the label", and
descriptions never reach a search. Multi-word card names were still made
single tokens for the rule's sake.

See [[patterns_pick_a_fixture_name_from_bsc_facets_and_the_resolver]],
[[patterns_button_name_substring_hides_demoted_variants]].

## Catalogue seeded wizard staging

**The catalogue is a PROD snapshot, not just public reference data.** It holds
the players/teams prod's own set builds created (2025-26 Bowman prospects, NPB
names, "Checklist" as a baseball player), with their prod `_creationTime`. So
"prospects are absent from Lahman" is not a fixture strategy: anything an
operator has built in prod is known, and every bundle refresh can drain a
fixture that was green. Re-measure wizard fixtures after each refresh.

**What still stages (CI run, all fixtures fresh):** non-person rows ("Become a
Big Leaguer", "Team Photo") — permanent unless prod commits one; spelling
variants of a catalogue row ("Ismael Valdes" vs "Valdez", "Frank Rodriguez" vs
"Frankie"); same-name rows the card year cannot narrow (two "Frank Thomas");
names under the WRONG sport (football stars in a baseball insert); 1995
minor-league hockey (every Roanoke name, Wikidata no-match for all). Current
MLB team sets stage NOTHING: the fetch goes straight to `Saved N cards`.

**Coverage map:** Hockey players = NHL only (Tretiak/Kharlamov/Wickenheiser
absent). Basketball starts ~1976 (Erving, Bird present; Mikan, Robertson,
Chamberlain, Cousy absent). Baseball teams = every MLB era + Negro leagues +
current MiLB affiliates + indie clubs; defunct MiLB (Tidewater Tides, Hawaii
Islanders) and national teams ("Japan", "Team Canada", "USSR") absent. Only
Baseball/Basketball/Football/Hockey carry `sportConfig.wikidata`/`espn`;
every other sport gets no enrichment, so a live-Wikidata fixture must be one
of those four. The enrichment recording is Baseball-only (every key `|Q5369|`).

**1995 minor-league hockey (re-measured 2026-10-10, wizard fixtures):** Tulsa
Oilers / Memphis RiverKings / San Antonio Iguanas / Fort Worth Fire CHL each
stage 15–16 players and 0 teams (BSC tags no team on these team sets — even
absent clubs never stage). Some players DO hit Wikidata (career clubs staged,
tall "Also on Wikidata" bodies). Live-proof person: Vladislav Tretiak (Hockey,
absent; NHL-only catalogue).

**Retro-card trap:** `resolveTeamForSetYear` prefers an IN-era row, so a 2024
retro card naming "Kansas City Monarchs" links to the 2021– independent club,
not the 1920–48 one. A same-name modern club silently wins.

**Will a name stage, and as a pick step?** Run the real gate read-only:
`npx convex run --preview-name <branch> --codegen disable --typecheck disable
players:resolveNameForReview '{"name":…,"sportId":…,"cardYear":…,"cardTeamNames":[…]}'`.
No `playerId` = staged; `matchCount >= 2` with no `playerId` = NEO-332 pick
step. Pass the card's team: most same-name pairs (Will Smith, Pedro Martinez)
only narrow on it. Card names/teams come from BSC public search
(`players` / `teamName` aggregations per `setName`/`variantName` slug).

**Checking a name read-only:** `npx convex run --deployment <preview>
--codegen disable --typecheck disable --inline-query '…'` is sandboxed
read-only. Key = `nameNormalized` (diacritics folded, lowercase, punctuation
to spaces, tokens SORTED: "Frank Thomas" → "frank thomas", "Josh Gibson" →
"gibson josh"); index `by_name_normalized_and_sport_id` on `players`/`teams`,
plus `playerAliases.by_alias_normalized_and_sport_id` and
`playerSports.by_name_normalized_and_sport_id`. Count per sport by iterating
`by_sport_id` (32k-doc read limit; Football/Soccer exceed it).

**Retro/legend sets stage SAME-NAME legends (measured 2026-10-11).** A
retired star's career span never covers a modern card year (tolerance 2), so
any legend who shares a name with another catalogue row gets 0 survivors and
a same-name pick step (NEO-332; was the "Same name, different people" panel): Frank Thomas, Randy Johnson, Tony
Gwynn (Jr. holds the alias), Joe Morgan, Bob Gibson, Pedro Martinez, Billy
Williams, Sam Crawford, Eddie Collins, John McGraw recur across Tribute,
Museum, Gilded, Archives, Diamond Kings, Cooperstown. Every 90–400-card retro
Base checked staged 1–15 such rows. For a team-only batch, hunt SMALL
unique-name star sets (Topps online "Welcome to the Club" style) and run the
names through `sameNamePlayers`' three legs + `careerSpan`/`spanCoversCardYear`
offline before proposing. Defunct-club shape (Baseball catalogue): Brooklyn
Dodgers, NY Giants, Boston/Milwaukee Braves, KC Athletics, Homestead Grays,
Montreal Expos, California Angels = ONE dated row (auto past-era link);
St. Louis Browns (2), Washington Senators (3), Philadelphia Athletics (4),
St. Louis Stars (3), Detroit Stars (2) = ambiguous for any year after
their eras; Kansas City Monarchs = in-era 2021– trap.
**An ambiguous club only reaches the wizard if the fetch waits for its team
lookups.** Before NEO-330's race fix the BSC-only fetch on 2025 Topps WttC 3X
MVP went straight to `Saved 36 cards. 2 need attention` (the action resolved
before the team patches arrived, so the two Phil. Athletics cards committed
TEAMLESS and surfaced as `2 cards need a team`). With the fix (re-probed
2026-10-11) the same fetch stages `0 new players + 1 new teams` and opens on
`New Team: Philadelphia Athletics`. A predicted team step must still be
PROBED; an offline `pickTeamForYear` run only says how a name resolves once
it gets there. See [[reference_reaching_the_missing_team_fixer]].

**A fixture that expected unknown names can now commit with no wizard.**
Prod has built 2025 Bowman Draft, so all its draftees are catalogue rows
(NEO-333's dual-team spec, re-measured 2026-10-12). On the one-marketplace
path with nothing staged, the commit's `Saved N cards` REPLACES the
`Kept all N cards from BSC` line (CardChecklist holds one notice), so a fetch
gate must accept `Saved` too, and a wizard gate must be the either/or: the `Confirm New Players & Teams` heading OR a `Saved N cards` notice. Make the wizard
drain exit on a player OR `Confirm & Save` (a batch can stage teams and no
player). Prove "nothing was staged" through the unknown-name route: an
unresolvable value always lands in `unknownTeams` and opens the wizard.

**Reading a wizard red:** a walk helper that spins through its drain loop and then fails on the `Skip ... not a person` button means the batch
ran out of player rows, not a slow page — check `N of N reviewed` in the
screenshot. `runEntityReviewLookup` `enrichment_fixture` lines in the
convex-logs artifact list every staged player name per fetch, timestamped,
so a passing spec's staging can be counted without a screenshot. See
[[patterns_record_a_fixture_sets_lookups]], [[reference_same_name_player_panel]].

## Measure a fixture from ci artifacts

When a spec needs a data-dependent threshold (e.g. "a Group Parallels plan past
200 entries") and there is no preview to run on, a green CI run of the spec that
already touches the fixture usually has the number:

- **The convex logs artifact** (`convex-logs-runner-0/*.jsonl.gz`):
  `adapter_sync_call` lines carry `level`, `parentSetName` and `result_count` per
  marketplace fetch: how many items BSC / SportLots answered for a set's insert or
  parallel level. Only one runner's deployment log is uploaded, but it is the whole
  preview's log.
- **Rendered counts** (`Accept all suggestions (N)`, `Save N changes`): a spec that
  asserted only a regex over them did not record the number. Read it from the
  failure screenshot / `error-context.md` of a red run, or add a deliberately
  failing probe locally against the PR preview. Traces are NOT an option (they
  record Clerk testing tokens and are never uploaded).

`gh run download <id> -p '<artifact name>'` into the scratchpad; find the shard by
grepping for the spec name.

Group Parallels specifics learned the same way (NEO-308): Accept All only clears
the "suggested" markers; suggestions are PRE-PLACED as promotions at INIT, so
`Save N changes` = the suggestion count, all promotions. And the footer reads `No
changes yet` from the first render (skeleton, before INIT), so a "nothing left to
suggest" assert on a re-open needs a row gate first (a row's `Select <name>` tick,
which every initialised row carries).
