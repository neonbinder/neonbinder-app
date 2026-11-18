---
name: patterns_collection_optimistic_writes_wait_for_the_notice
description: Collection writes are optimistic - wait for the notice; a goto right after an optimistic tick loses it
metadata:
  type: pattern
---

On `/collection`, Have, Add and Remove copy use Convex optimistic updates: the pressed state or the "None yet." list shows BEFORE the mutation lands. The notice (`Added <short> to your collection`, drawer status `Removed <short>, Raw`) is posted only after the write resolves.

**Why:** a spec that then navigates (page.goto to the set builder) can reach it before the copy is stored or removed. Seen on the mobile project: the final delete was still refused after "None yet." had shown.

**How to apply:** before any cross-page step that depends on the copy being really there or really gone (a set-builder delete refused or allowed by the collector guard), assert the notice, not the optimistic state. Never a sleep.

**Second shape, a lost press in the same list (NEO-481, 2026-11-12):** a "Your copies (N lines)" heading passes on the optimistic update, so a second Remove pressed right after it lands while the first write's answer arrives. That answer swaps the drawer notice above the list for a shorter one ("Added … with its front and back photos." → "Removed …"), the list moves up, and the press is lost: Playwright checks the hit target only on the first pointer event, so the click "succeeds" on the `<li>` and no mutation is sent. Mobile width made it fail (taller notice), desktop got lucky. Before each next press in the list, wait on `drawer.getByRole("status").filter({ hasText: /^Removed <short>, Raw, …/ })`, anchored with `^Removed` so it can't match the "Added" notice.

Other facts from the NEO-358 delete-refusal spec: a hand-made card has no player, so the collector sees only `#<number>` (names are `Have #<n>`, `Details for #<n>`), the checklist region is `2024 <set> Base`, and the cascade column under a hand-made `Insert` type is titled `Insert` (pick `Base` there). Refusal copy for one collector reads "Hold up! A collector has this card, so it stays in the catalog."; the planted break that proves the spec is skipping the Have step (the delete then succeeds and the alert never shows).

**Third shape, the same notice twice (NEO-526, 2026-11-13):** every "Removed <short>, Raw, Excellent · Main" notice reads the same, so a `^Removed` wait only tells the FIRST Remove apart; the 2nd and 3rd waits pass on the stale notice, and a press lost to the reflow goes unseen (the next spec on the worker then found the card already Have). The page-level notice also outlives a closed drawer (10 s), so a Remove in the next drawer visit can be satisfied by the previous card's notice. Fix: `confirmRemoved(drawer)` in `support/collection.ts` after EVERY Remove (wait `^Removed `, press `Dismiss message`, expect the status empty), the last one included, before the next press or closing the drawer. In a `finally` it sits inside the best-effort try, so a miss is annotated and never masks the body's error. A spec that has run only on optimistic state is "green" with a Remove that never reached the server.

**Pin the line (NEO-592, 2026-11-18):** every `confirmRemoved` call passes `Removed ${short}, <what>` (a prefix). `<what>` is `lineWhat`: `Raw, Excellent`, `Raw, Very Good ×2`, `PSA 10`; the notice then adds ` · <home>`. The Remove BUTTON's name uses `lineNames` instead (`, in Main`, `, line 2` only when two lines read the same), so never copy a button suffix into the pin. Where only the card is known (scan intake, box runs) pin `Removed #<n>, ` or `Removed ${short}, Raw, `. Proof: a wrong `×3` goes red with the real `Removed … ×2 · Main` in error-context.

## Optimistic tick then navigate reads from a second tab

Seen on the NEO-500 Pick List: "Pull these 2" ticked both rows and posted its
notice at once (optimistic), the spec went straight to `page.goto(<ship hop>)`,
and after the load both lines were back, unpulled. With the page left open
the same pull was on the server within the 7 s budget.

**Why:** the notice and `aria-pressed` are client state; the screen has no
perceivable "saved" signal, so leaving the page can beat the mutation.

**How to apply:** before a reload or navigation that must read a just-ticked
write, open a second page in the same context on the same screen and assert
the server's state there (web-first, 7 s; it subscribes live). Then reload the
main page. Report the missing "saved" signal as a product gap; never a sleep.

Second trap from the same spec: order numbers `<token>` and `<token>b` made
`Pulled Card NB couldn't match, BSC <token>` (a `^`-prefix regex) match both
orders' rows. Mint sibling ids with disjoint suffixes (`<token>a`, `<token>b`).

Also: a failure cleanup that navigates the failing page wipes the failure
screenshot and error-context (both are taken at teardown). Do it on
`context.newPage()` instead.

Related: [[patterns_collection_optimistic_writes_wait_for_the_notice]], [[patterns_responsive_duplicates_and_text_locators]].

## Fourth shape, the last write before the test ends (NEO-603, 2026-11-18)

A spec whose LAST write is optimistic and ends on the optimistic state (the
checklist row back to `Have <short>`) can close its page before the mutation is
sent; the copy rides into the worker's next spec (a different spec goes red).
Convex runs one client's mutations in order, so only the LAST optimistic write
needs a server confirmation; earlier ones land before it.

- Checklist row un-Have: the notice is the page's floating line (no drawer),
  not portaled, so it sits inside `main`:
  `confirmRemoved(page.getByRole("main"), \`Removed ${short}, Raw, Excellent\`)`
  (real text ends ` · Main`; the helper anchors with `^`, so the prefix is enough).
- Which writes are optimistic: `withOptimisticUpdate` in
  `app/collection/final/data/convexStore.ts` (Have, Remove copy, move, trade,
  want, container update/delete, box quantity, box listed), Profile default
  condition, eBay setup card weight / Best Offer. Set-builder writes are not.
- Binder/box delete is NOT optimistic-only: the confirm dialog closes only
  after `await removeContainer`, so `confirm toBeHidden` is the server's answer.
  Quantity "Pulled N of ..." is built from the server result, also an answer.
- A settings radio: `"Saving…" toHaveCount(0)` is not a confirmation (passes on
  a failed save and on a dead page). Settle on the loaded group
  (`radio { checked: true }` count 1), branch on `isChecked()`, click, wait for
  the "Saved." status.
