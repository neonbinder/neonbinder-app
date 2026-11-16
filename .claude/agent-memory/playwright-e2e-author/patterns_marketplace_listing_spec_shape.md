---
name: patterns_marketplace_listing_spec_shape
description: Marketplace listing specs - N listed proof, Rev 4 Sync status shape, eBay seed-hop connect, step ledger waits, first seller press, seller set built by the spec
metadata:
  type: pattern
---

A spec that proves box counts reach a marketplace (listing panel, "N listed on
<platform>.") has no BSC-side UI to read. The drain reads the seller sheet, PUTs,
and READS THE ROWS BACK; a mismatch becomes a "Can't list on ..." problem. So the
proof is the status line `^N listed on <platform>\.` plus `heldBack` toHaveCount(0).
`listed` counts card x condition rows, not copies.

Order the steps so each "N listed" is a DISTINCT count from the last (2 -> 1 -> 0):
a stale count then can never satisfy the next assertion, with no sleep needed.

The user's flush is leaving the checklist: click another Inventory tab, assert a
positive (the box spine count proves the writes landed), `page.goBack()`. The only
wait over 7 s is the live round trip, one named constant per the GUIDE exception.

Failure cleanup that must reach the remote system goes in `test.afterEach` on
`context.newPage()` (same signed-in context) so the failing page keeps its
screenshot; module-level `written` state says how far the run got; guard on
`testInfo.status !== testInfo.expectedStatus`. Do it through the product (quantity 0,
Resync, switch off), never by calling the marketplace.

## Patterns marketplace listing rev4 shape

How the Rev 4 BSC listing spec is built (supersedes the leave-the-checklist shape in [[patterns_marketplace_listing_spec_shape]]):

- Rev 5: "if you have credentials you are syncing"; no Start button. `/testing/seed-credentials` marks a seeded BSC sign-in "not syncing" (Profile panel reads "Not syncing.", Sync inert, Sync status pill "Not syncing") unless `listing=on`. Start syncing = the seed hop with `listing=on` (`saveBscSignIn(page, {listing:true})`); stop = `removeBscSignIn` then `saveBscSignIn(page)` without it. The consent warning ("Heads up: connecting starts listing") sits on the sign-in form and describes Connect, so it is only visible with the sign-in removed. A real Profile-form save would start real listing: no spec may do one.
- Before syncing starts (saving walks every listed box), put every other box, Unsorted included, in-person via My Boxes.
- Result surface is Inventory -> Sync status (`?tab=sync`): region "BuySportsCards", list "Last sync by set", row named by the set (a Base checklist reads as the set alone, "1988 Topps", not "1988 Topps Base"); counts line "N listed, M updated, K taken to 0" (zeros omitted; `pushed` includes the zeroed).
- Sync on the checklist is `Sync <checklist title>`; the first press right after box writes hits the server throttle (change queued < 60 s) - it still kicks the run but the toast reads "just synced". Assert the RESULT, not that toast, on a first press.
- Failure cleanup order: wait "Nothing syncing right now." (a run under way plans from old counts), empty the box, Sync, wait the set row "0 listed", only then remove the sign-in. Never delete a box that still holds copies (they fall into the listed Unsorted box).
- A dormant state row keeps its seller account, so another NB account's Start reads "seller account in use" until a reset: one worker may run the spec per pass.

## Ebay listing spec shape

- eBay connects by OAuth, so a spec cannot drive consent: `saveEbayConnection` (support/credentials.ts) uses the seed hop `sites=ebay[&listing=on]`. The hop SKIPS (not fails) when eBay is unwired, the token is unset or eBay is paused, so the spec's next assert must name the missing setup (`expectEbayHookedUp` throws on "isn't hooked up"). No sanctioned skip exists for a missing credential: GUIDE only has the PAUSED_PLATFORMS switch (`env.EBAY_PAUSED` paused branch).
- Sync status always renders BOTH platform regions (bsc and ebay, "Not connected" included), each with its own "Nothing syncing right now." line: any unscoped read of that screen is a strict-mode hit. Scope through `getByRole("region", { name })`.
- The `Switch` primitive is an `<input type=checkbox>`: role `checkbox`, never `switch`.
- "Set me up" is offered only while the seller account lacks a fitting policy; a second run finds the policies and the button is gone. Settle on the "Shipping" heading, then branch on the button, and end both branches on a click of the first radio in each policy group plus the "N to go" checklist status.
- Ships-from form remounts on save (keyed by saved value), so its "Saved." line flickers: prove the save by the checklist ("You're all set"), not that line.
- Live eBay steps share one named ceiling (`EBAY_ROUND_TRIP`), PROVISIONAL until Jason signs it off (GUIDE rule 3); say so at the site.
- Disconnect through the product withdraws live listings, drops the queue and deletes the settings, so a spec that ends Disconnected leaves the account as the bootstrap left it.

## Sync status step ledger waits

Sync status ticks a run's steps off as list items named `<label>, <state>` (state done|working|waiting|failed) in a list `Sync steps for <set> on <platform>` (Running now) that becomes `Last sync steps for <set> on <platform>` on the set row once the run ends. Never both at once for the same set. Helpers: `syncRun`, `followRunToEnd` in `support/collection.ts`.

- **Stale ledger.** The row keeps the PREVIOUS run's finished steps (all done) until the next run claims the set, so a per-step `done` wait alone passes on the old run. Gate first on `run.underWay(resultLine)` = the running list `.or()` the new run's own distinct result line (`0 listed...` vs the old `2 listed`).
- **Step lookup spans both lists** (`running.or(last)`), so it passes whether the spec looks mid-run or after the end, with no race on the run's end.
- **Labels come from the code**, not from guesswork: BSC modern reads are one per BSC sheet named by the NB conditions that fold into it (Mint and Near Mint / Excellent / Very Good and Good / Poor); the confirm's condition is the account's default condition, so match `Double-check .+`.
- **A Sync press inside 60 s of the last press is throttled** (`RESYNC_THROTTLE_MS`): the queued box write still runs the set, but it reads only the sheets NB pushed to. A take-down run therefore asserts "a read, the send, a confirm", not all four reads.
- **eBay's photo step is optional** (a rerun can reuse the last run's pictures): wait on `Upload photos` `.or()` `List the cards` `.first()`, then hard-assert the items, offers, go-live steps.
- A done step is stamped when the NEXT step starts (the last one at finish), so the last step and the result line land together.
- The running-ledger state cannot be axe-checked deterministically (a fast run may be over before the spec looks); the finished row ledger can, so assert it before the existing axe call.
- **A finished BSC row folds** (Jason, 2026-11-02): reads become one `Gathering data, <state>` item, `Double-check` items are dropped (a failed one stays), update steps (`Upload photos`, `Send changes to ...`) stay; eBay rows are unchanged. A bare `step("Read ...")` would hang if the run ended before the spec looked, so BSC reads and confirms are waited on through `readLanded` / `confirmLanded` (the running item OR the folded row). After the run, assert the folded shape and that no Read/Double-check item remains (paired with a positive assert).

## Patterns first seller press may wait for the seller account

A listing-on BSC seed is one store; the seller account may land minutes later (NEO-483). The first press then queues the cards, Sync status shows "Waiting on BuySportsCards…" with NO ledger and NO result line, and the run starts by itself.

- Never gate a first press on `run.underWay(resultLine)`: neither exists while the press is held. Use `expectRunOrSellerWait` (support/collection.ts): settles on run | settled | wait line | "Seller account in use", runs `expectAccessible` on the wait line, records a `seller-wait` annotation.
- `followRunToRest` with `marketplace` makes the CLAIM wait `expectAfterMarketplace` capped at `SELLER_ACCOUNT_CAP_MS`; the cap is a signed-off-by-Jason ceiling (GUIDE rule 3) and void if the background read's delays change.
- An optional wait line is an app-state branch: settle with one `.or()` wait first, branch for free, and keep every assert after the walk unconditional (R2). The branch only adds a check; it never replaces the feature's end state.
- "Seller account in use" is the platform badge (`platform.getByText(word, { exact: true })`); the longer note sentence does not match exactly. Throw by name, never wait it out.
- Seller specs cannot run locally (one shared account), so the planted-break check has to wait for a shared-dev/preview run.

## Seller spec built by spec and the window

1. `testingSellerCleanup.clearBsc` resolves every `SELLER_SPEC_SETS` entry to a
   row BEFORE signing in and THROWS "did the seed run?" when it is missing. That
   is right for a set the seed provisions (1988 Topps) and wrong for one the spec
   builds in-flow: the seller jobs run the cleanup first, on a freshly reset
   preview, so a spec-built set is always absent then. Mark such an entry
   `builtBySpec: true` (skipped, logged `seller_cleanup_set_absent`) and give it
   `parallel: "<name>"` when its cards live in a parallel instead of Base. The
   consequence to say in the PR: in CI that entry's start-clean never reaches BSC,
   so the spec's own takedown Sync and failure hook are the only zeroing; seeding
   the set instead would put the build in every seed.

2. `gh run list --status in_progress` plus the run's jobs shows only seller jobs
   that have STARTED. `seller-mobile` waits behind `seed-mobile`, which waits for
   the last desktop shard, so a run with one desktop shard left is minutes from
   holding the shared seller. A red-then-green seller run takes 15+ minutes: do
   not start it on that signal, and say why.

3. Seller specs run as worker 8 in alphabetical order inside one job, so a new
   `inventory-bsc-listing-*` spec follows the 1988 one; each must end "connected
   and not syncing".
