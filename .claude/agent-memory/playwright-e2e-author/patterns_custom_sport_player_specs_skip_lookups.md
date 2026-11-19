---
name: patterns_custom_sport_player_specs_skip_lookups
description: Players minted in the custom sport make no Wikidata lookup; counts, birth-year forks, Back is an exit
metadata:
  type: pattern
---

`customSport(env)` ("E2E Test Sport <worker>") is a real sport in the admin Players sport select, so `addPlayerByHand(page, name, customSport(env))` works with a minted name and sends nothing to enrichment (no `sportConfig.wikidata`). The sport only exists once a custom card was added under it, so a spec that needs it first runs `addCustomCard` on `/set-selector`, then `page.goto("/admin/players")`, and `page.goBack()` returns to the set builder with the drill and card list restored.

Minted players are never deleted, so on a re-run (and desktop + mobile on one seed) the list holds earlier attempts' rows: a "how many of X" assert counts rows by exact accessible name `^<full name>\s*<sport>`, never by a first-word filter, and a message that names only the first two matches ("and N more") is not asserted for the name; the choice button is.

Used by NEO-463 `admin/player-name-fragment-asks-operator`.

## Patterns custom sport player fixture makes no lookup

A spec that needs several players with MINTED single-token names (no recorded
no-match pool) builds them in the worker's custom sport (`drillToCustom(page,
{ sport: customSport(env) })` once, then `/admin/players`, `emptyListAndPickSport`).
The custom sport row has no `sportConfig.wikidata`, so `findPlayerQid` refuses
before any request.

- Reading the Convex logs of such a run: each player's enrich logs
  `wikidata_player_no_match` (name + sport label) THREE times. That is the
  refusal, not a live lookup; the proof of "no request" is zero
  `enrichment_fixture_live_refused` plus the sport having no QID.
- Rows sharing one minted surname token are forked apart with the birth-year
  field: first create is plain, later ones need `Create player <name> anyway`
  with a year no row carries. Typing the surname in the add form then promotes
  the FIRST-created exact row to the primary `Open <name>, b. <year>` and leaves
  the others in the `Possible player matches` list, one listitem each (scope
  rows through that list so the primary never shadows them).
- Stints: `Add team` -> search -> `No matches.` -> Enter -> `New team: <name>`
  dialog -> `Create team <name>`; later stints at the same team pick the
  `Add <team>` option. Pass "is this team new" explicitly, never branch on it.
- The spec re-runs without a re-seed (attempt token differs per run), unlike the
  recorded-name specs.
- `/admin/players` selects with `setSearchParams(..., { replace: true })`:
  Back is an exit from the screen by design, so a spec that opens a row from the
  panel does not walk Back to the add form.
