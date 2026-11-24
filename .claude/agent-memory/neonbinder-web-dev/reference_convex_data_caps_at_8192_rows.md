---
name: convex-data-caps-at-8192-rows
description: `npx convex data <table> --limit N` fails above 8192 ("Array length is too long"); read a bigger table read-only with --order asc and --order desc and dedupe by _id
metadata:
  type: reference
---

`npx convex data teams --limit 20000 --format jsonLines` errors with
`Array length is too long (10000 > maximum length 8192)`. For a table over
8192 rows, run it twice, `--limit 8000 --order asc` and `--order desc`, and merge
by `_id`; when the merged count is below 16000 the two ends overlapped, so the
union is the whole table. Set `CONVEX_DEPLOYMENT` for that one command (from the
checkout's `.env.local`, never printed) and write the output under the scratchpad.
Read-only, so it is safe against a shared deployment.

**How to apply:** measuring "does reference data exist for this lookup" before
building a resolver (teams, leagues). Join `teams.leagueId` to `leagues.level`
in a scratch script.
