---
name: reference_neo255_one_marketplace_surfaces
description: One-marketplace checklist sync surfaces - NEO-255, sync summary is not a UI surface, name-fallback Match Cards solo and cancel confirm
metadata:
  type: reference
---

When exactly ONE marketplace is **attached** to a row, `handleSync` never enters the
review phase, so `CardPairingModal` never mounts. Attachment is
`attachedSidesOf(chain)` (`convex/marketplaceResolvability.ts`): BSC iff any
`BSC_SOURCE_FACETS` filter is populated (the setName row's id counts), SportLots iff a
row at `setName | variantType | insert | parallel` carries an SL id. The sport/year
rows' SL ids are irrelevant, so **any real BSC set whose Base has never been mapped on
SportLots is a one-sided fixture.**

Surfaces to key on (`CardChecklist.tsx`):

| what | handle |
|---|---|
| inline progress, structural anchor | the `Cancel checklist fetch` button (renders only while the solo fetch is in flight) |
| inline progress, sentence | `Fetching from <BSC\|SportLots>... <ready> of <total> cards ready.` |
| the result, and the FETCH COUNT | `Kept all <n> cards from <marketplace>. Nothing to match, no other marketplace attached.` (appears only once the action RESOLVED, so it is the solo path's equivalent of waiting on the Confirm button) |
| stream never arrived | `The fetched cards did not arrive — nothing was saved. Run the sync again.` (30 s cap; commits nothing) |
| wizard | opens as normal, but **no "Back to Match Cards"** (`onBack` is gated on `streamedPairing`) |
| the kept card's badge | `BSC only` (token `unmatched-sl`) / `SL only` (token `unmatched-bsc`): the mapping in `CardChecklistItem.badgeLabel` reads inverted at a glance |

**The inline progress line is too short-lived to assert** (measured on PR #242's
preview, 2026-09-07): on a 25-card BSC-only set the whole `Fetching from BSC...`
sentence is up ~1.3 s and the `<n> of <m>` half ~0.25 s, and the numerator never
leaves 0. Do not assert it and do not inflate the fixture to make it assertable;
leave it to the unit tests. The same applies to the `Cancel checklist fetch` button.
`Kept all N cards from <marketplace>...` IS assertable and is the R2 gate: it is
produced on ONE branch (`expectSolo && agreed && serverSides.length === 1`, after the
streamed batch arrived in full), while the pre-existing `candidateCount === 0`
fall-through prints nothing at all.

Asserting that the Match Cards dialog is ABSENT is a negative: pair it with the
positive `Kept all N cards` assertion ([[patterns_negative_asserts_pass_on_a_dead_page]]).

A one-sided spec cannot be validated against dev until the branch is pushed there:
without the server's new `attachedSides` field the client reads `serverSides.length` off `undefined` and
throws. See feedback run specs on dev before first push and
[[patterns_local_run_backend_and_vite]]. Fixture rules:
[[patterns_entity_column_shapes_and_cold_sync]].

## Sync summary is not a ui surface

# The sync summary string is a return value, not a screen

`syncSetsAcrossManufacturers` (and `fetchAggregatedOptions`) return
`{ success, message: "Synced sets (312 sets, 74 sets added from SportLots)" … }`.
`ensureSelectorOptions` reads `res.message` ONLY on failure (console.error); on
success it composes the column's notice from `pausedSides`, `failedPlatforms`,
notifiable `skippedSides` and `unlinkedTotal`, and writes `status: "done"` only
when one of those is non-empty; otherwise the status row is deleted and
`EntityColumn` renders the bare idle action row (`selectorOptions.ts` around the
`hasNotice` block).

**So:** when a plan says "the summary fragment will read X", check whether X ever
reaches a `setSelectorSyncStatus` write. If not, the assertion has no surface.
**Do not ask for it to be given one as a count sentence.** Ask instead for an
AFFORDANCE the operator would want anyway, or prove the behaviour structurally.

**How to prove the gap cheaply:** run the spec against a backend WITHOUT the
notice and read `error-context.md`: the Sets column idle with `Sync Sets` and no
status region above it (NEO-237, 2026-09-21: red by name at the notice step in
1 minute, the R2 property).

**Worked examples.**
- NEO-294 (2026-09-22): the known-brands split added `N brands added from the
  known list` fragments to the summary array; neither reaches a status write, so
  both are unassertable. The spec proves the filing STRUCTURALLY (the view's
  back-fill card plus the panel breadcrumb). Check the RETURN OBJECT, not just the
  summary: a fragment is only a target once `ensureSelectorOptions` has a field to
  compose it from.
- NEO-237: the count `N sets added from SportLots.` WAS carried on the done row
  and asserted as the sole proof of a save. Jason removed it the next day: *"We
  don't do it for other marketplaces we shouldn't do it here."* A count sentence
  that exists only because a test needed a handle is a notice the product does not
  want.

What the spec does now, and the shape to reuse: assert the side was ASKED, not
what it added. `syncSetsAcrossManufacturers` puts `"sportlots"` into
`skippedSides` only when NOT ONE brand of the year passes the ATTACH gate, so
`SportLots skipped: no SportLots ids on this path.` is present exactly when the
side was never asked: absent live, present under the pause, a real R2 pair on one
sentence. Scroll to the idle `Sync <X>` button FIRST, because `SyncDoneNotice`
shares its slot directly above it, so the negative is not vacuous.

What stays unprovable: that a set was saved from SportLots, because nothing on
screen separates an SL-minted set row from a BSC-filed one. The ask to file when
this comes up again is an affordance: a set row that carries its marketplace
coverage, plus a way to REACH such a row that does not need its name. Recorded in
`SET-REGISTRY.md`. Related: NEO-294 (no longer
kept as a memory; see SET-REGISTRY.md and GUIDE).

## Name fallback match cards solo and modal cancel confirm

- A published checklist whose numbers match no card: equal row/card counts pair by unique player name on the server (no dialog); different counts apply nothing and open Match Cards in solo mode with name pairs as pre-linked suggestions. Derive expected counts from the CSV through `nameFallbackFacts` in `support/published-checklist.ts`, never hard-code.
- Match Cards "Cancel" opens a "Discard N pairing?" confirm (audit round); a spec that cancels must click the "Discard N pairing" button too, or the dialog stays and `toBeHidden` goes red. Not seen by specs that Confirm instead.
- Card item and checklist-row item both contain "#SIG-XX": filter listitems by `^#SIG-XX` regex (card side) to avoid strict-mode violations.
- Combobox option names carry league and era ("Oakland Athletics MLB · 1968–2024"): match by `^Name .*1968.2024`.
- The card list is virtualized: never assert all N cards render; assert one visible plus absence of the bad shape.
- A two-phase fresh-only spec (phase A discards before committing, phase B commits) passes once per seed; a red between phases parks a review batch that must be cancelled or the deployment re-seeded.
- Copy and accessible names in a new modal move during the audit round: pin them with minimal regexes and re-run after the audit commit.
- Equal counts with ONE misspelled name: the server pairs the rest and Match Cards still opens (solo) for the one leftover card and row, saying "N cards already matched to your checklist — they're saved too". Linking a pair whose spellings differ makes the wizard open on "Checklist says otherwise" FIRST (`expectChecklistDisagreementFirst`, then `pickDisagreementSide`, then Next).
- A full local run on ONE test account: workers=1 (every local worker maps to the one account, so parallel workers race on its data), and a placeholder/photo-upload burst can hit the per-account batch limit ("12 batches in the last 60 minutes", it is a screenshot-only message); those specs pass alone, so classify by an isolated re-run on a fresh seed. A spec that needs a deployment env var (a BSC stall id list) fails by name on a per-worktree deployment that lacks it.
- A fresh-seed re-run is the only way to retry a committing spec: keep a byte-exact backup of the file before a planted break, and plant the break BEFORE the first commit point so no review batch is parked.
- A past-era club with a player whose stints name it is now linked by the wizard ("Linked to <club> · <player> played there"), so a spec that answered its New Team step must read the Decided line instead (NEO-490 rule 2b).
