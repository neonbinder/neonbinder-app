---
name: patterns_marketplace_listing_spec_shape
description: Marketplace listing specs - N listed proof, Rev 4 Sync status shape, eBay seed-hop connect, step ledger waits, first seller press, fake eBay consent, faults and sales
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

- On the fake eBay (NEO-555) Connect goes to NB's own consent page (`/testing/fake-ebay/authorize`, region "Stand-in eBay sign-in": Agree / Agree as another eBay account / Decline), so a spec CAN drive consent; `saveEbayConnection` (the seed hop `sites=ebay[&listing=on]`) is the shortcut when consent is not the subject. The hop SKIPS (not fails) when eBay is unwired or paused, so the spec's next assert must name the missing setup (`expectEbayHookedUp`, then the "Test mode: ..." line, `EBAY_TEST_MODE_LINE`). No sanctioned skip for a missing credential: only the PAUSED_PLATFORMS switch (`env.EBAY_PAUSED`).
- **Fake seller state outlives the spec** (until the pass's reset): a held shipping-policy name answers 409, which `ebayFake.holdShippingPolicy` treats as done, so seed by fixed names. A spec that needs a seller with nothing on it uses the `alt` seller ("Agree as another eBay account") and is fresh-only.
- **One fault list per worker for both sites**, replaced by each post: `bscFake` holds each site's rules and posts them merged, so `ebayFake.setFaults` never clears a BSC rule. Faults with no `times` keep refusing whichever run (press or cron poll) meets them, so the row reads the same in either order.
- **Hop pages answer on one `role="status"` line inside `<main>`** (`[testing-ebay-fake] ...`, `[testing-bsc-fake] ...`): read it by role and filter by text; "Error: ..." is the refusal.
- **A sale step** injects an order (`addOrder`), then `pollNow`; the cron may store it first and the hop then reads nothing new, so assert the Sales tab article `<Platform> order <no>` and the lowered box count, never the poll's counts.
- Sync status always renders BOTH platform regions (bsc and ebay, "Not connected" included), each with its own "Nothing syncing right now." line: any unscoped read of that screen is a strict-mode hit. Scope through `getByRole("region", { name })`.
- The `Switch` primitive is an `<input type=checkbox>`: role `checkbox`, never `switch`.
- "Set me up" is offered only while the seller account lacks a fitting policy; a second run finds the policies and the button is gone. Settle on the "Shipping" heading, then branch on the button, and end both branches on a click of the first radio in each policy group plus the "N to go" checklist status.
- Ships-from form remounts on save (keyed by saved value), so its "Saved." line flickers: prove the save by the checklist ("You're all set"), not that line.
- Against the fake every eBay step is the standard 7 s (no eBay ceiling since NEO-555).
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
- BSC and eBay listing specs run locally on your own deployment (each worker its own fake seller), so the planted-break check runs there too.
