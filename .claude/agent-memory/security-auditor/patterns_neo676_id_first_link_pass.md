---
name: patterns-neo676-id-first-link-pass
description: id-first matching added to an armed bulk loader — check every decision-replay branch runs the id step too; take(N) before a sport filter; in-call duplicate ids
metadata:
  type: project
---

Audited 2026-11-25 (diff). Bulk legs stayed internal + armed; previews stayed
internalQuery; no public fn writes the new external id (public writers spread
`existing.externalIds`, so the slot survives). Pin test (regex over client
dirs) bites on direct naming, incl. an import path containing the word.

**Rule 1 — an id step inserted AFTER decision replay is skipped by every
replayed answer.** The team leg ran `{adopt}` / `{create:true}` before step 1b,
so an answer could write the id onto a second overlapping-era row, and a
replayed `create` (non-idempotent by design) minted a second holder. The player
leg did it right: idRow looked up first, adopt-of-other-row and create-with-
holder both HOLD. Diff the legs against each other for that parity.

**Rule 2 — "the link vouches, skip the name check"** makes a duplicate id in
one call (or across chunks) attach row B's stints/aliases to row A's person,
and the preview (no writes) cannot show it. Ask for a per-call duplicate-id
refusal on legs where the id is unique per row.

**Rule 3 — `.take(LIMIT)` on a non-unique index, filtered by sport AFTER the
take**, is a saturated-take "exactly one" (see [[patterns-neo591-prospect-claims-and-pdf-runs]]).

**Rule 4 — re-finding a row by name after an id match** (`findOrCreate(name:
before.name)`) can land on a same-named sibling; patch the row you found.
