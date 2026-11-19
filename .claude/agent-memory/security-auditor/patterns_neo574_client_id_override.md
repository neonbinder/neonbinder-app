---
name: patterns_neo574_client_id_override
description: Per-card client-chosen entity id (playerIdByName, like NEO-335 teamIds) and a commit-side stint appender - the validation shape that held and the one gap (no dedupe vs the card's other resolved ids)
metadata:
  type: project
---
NEO-574 added two client-chosen-id doors to `commitCardChecklist` (public admin action):
a per-card `playerIdByName` override and a batch-wide `careerStints` list, plus two
admin one-shot queries in `careerCoverage.ts`.

Shape that held (reuse as the checklist for any new client-chosen id on the commit):
- an internal validator query per id table (`validateOperatorPlayerIds` beside
  `validateOperatorTeamIds`), paged, sport walked from the row server-side (never the
  action's client `sportId`), no sport = every id foreign (fail closed);
- foreign-sport refuses the whole commit BEFORE any phase writes; vanished = dropped and
  counted, never guessed;
- the writer (`players.appendCareerStints`, internal) re-checks team sport against the
  player's sports (home + playerSports) and the career cap inside its own transaction;
- an id-less reference (team by printed name) resolves only through the prelude's own
  name map, so it cannot reach a team the batch does not carry;
- logs: selectorOptionId + counts; error text: indices, lengths, years, never names.

Gap to look for next time: an override that REPLACES one name's resolution can produce
the same id twice on one row (override X while another printed name already resolves
to X). Derived link tables dedupe with a Set, but the row's own `playerIds`/
`playerLinks` do not. Ask for a dedupe or a refusal at the server even when the UI only
offers the override on single-player cards.
Resolved in NEO-574's delta: skip a relinked id already on the row, in both orders, and do
not count the skipped name as answered. The preview queries were also made to answer a
foreign-sport id as covered without reading it, matching the commit's sport check.

Cost note: the gate's coverage read pages 100 pairs per internal query, each pair up to
MAX_PLAYER_TEAM_YEARS (64) team reads, memoised; bounded but heavy - fine for admin.
See [[patterns_neo313_cross_sport_override]], [[patterns_convex_auth_boundary]].
