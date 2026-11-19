---
name: new-players-insert-sites-must-pass-the-pins
description: Any new insert("players" site must route aliases through syncPlayerAliases and must not name the derived sports-copy field anywhere in its file, comments included
metadata:
  type: project
---

When a plan adds a new place that inserts into `players` (e.g. a bulk-load create leg), call out these pins:

- `players.sportsIndexPin.test.ts` fails if the derived sports-copy field name appears anywhere in the new file, comments included. Inside an `insert("players"` block it also allows only conditional spreads, `...(cond ? {…} : {})`.
- `players.aliasIndexPin.test.ts` forbids any `playerAliases` insert or query outside `players.ts`. Aliases go through `syncPlayerAliases`.
- `createByAdmin` schedules Wikidata enrichment. A bulk path must not.

**Why:** these pins guard single-writer invariants. A new insert site trips them in the unit run, often only because of a comment.
