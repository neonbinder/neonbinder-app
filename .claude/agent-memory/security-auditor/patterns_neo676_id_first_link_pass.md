---
name: patterns-neo676-id-first-link-pass
description: id-first matching in an armed bulk loader — id step before every decision-replay branch; take(N) before a sport filter; in-call duplicate ids; narrowing several->one must re-run single-candidate guards
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

**Rule 5 (delta round) — narrowing a "several" down to "one" skips the guards
the one-candidate branch applies.** `eraMatch` holds a lone UNDATED overlap
when the incoming era is closed (order-dependent adopt). A later name/alias
narrowing of an id-matched "several" built `{kind:"one"}` directly, so an
undated row picked by name got a closed era's years gap-filled. Any code that
synthesises a match kind outside the matcher must re-run the matcher's
single-candidate checks (or call the matcher on the narrowed list).

Conditions that held in the delta: team `{adopt}`/`{create:true}` replay reads
the id step first and holds; per-call repeated-id refusal on leagues and
players (preview and write share the loader); preview query shares the loader
and validators, writes gated on a MutationCtx handle.

**Rule 6 (delta round 2) — "the id-holder must answer to the name" is only as
strong as its weakest answering leg.** Filtering id-holders by name OR alias
still lets a holder that answers only through a stored alias (a cross-era
former name, e.g. Wikidata-style aliases on a franchise row) win over a
non-holder row whose PRIMARY name is exact: row order decides which era gets
the id first, then the other era's dataset row adopts it by id, and a pinned
`adopt` of the exact-name row is held by the id guard (stuck). Probe: seed an
exact-name row without the id plus an alias-answering holder, run both rows in
one call, then pin the right answer. Ask for an exact-name lookup before an
alias-only id match is accepted.

**Rule 7 (delta round 3) — a downgrade of an id match to "none" re-opens every
branch that keyed on "one".** The fix (alias-only holder yields to an
overlapping exact-name row) is safe on the auto path because the name step
re-reads the same exact-name list through `eraMatch` (two exact rows or an
undated rival vs a closed era = held). But check the replay branches: a
replayed `create:true` that was held on the holder now proceeds, guarded only by
`create`'s alias-holder check (which misses the holder answering through the
INCOMING alias leg). And an exact-name row holding a DIFFERENT id still counts
as "own row", turning a correct id adopt into a hold (fail-closed, but noisy).
