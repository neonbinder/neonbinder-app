---
name: patterns_injected_orders_ship_up_front
description: A sale injected on a fake marketplace for the worker's MAIN account must be already shipped (BSC SHIPPED, eBay FULFILLED) or every later pick-list spec on that worker goes red; plus a Convex error-text anchoring trap
metadata:
  type: pattern
---

**Inject a sale already shipped on a shared worker account.** An order left to ship
sits on the account's Pick List for every later spec of that worker in the pass
(only the failure reset clears `marketplaceSales`). `inventory-ebay-unmatched-sale`
and `inventory-pick-list` start from "Nothing to pull. Go sell something rad." and go
red on it. NB reads BSC `SHIPPED` and eBay `FULFILLED` as a SALE (the box goes down,
Sales shows it) that is not awaiting shipment (`awaitingShipment`), so
`bscFake.addOrder({ status: "SHIPPED", ... })` / `ebayFake.addOrder({ fulfillmentStatus:
"FULFILLED", ... })` prove the sale and leave the Pick List clean. The fake BSC never
replaces an order (new id per post), so "inject open, ship later" is not available
there; the fake eBay replaces by `orderId`. Found NEO-555 on a local run: both listing
specs passed, then the two pick-list specs went red on their first assert.

**Never `$`-anchor a Convex error read off a page.** The client appends the server
stack ("at requireFakeEbayDone (...) Called by client") to the message, so
`/http \(409\)$/` never matches. Anchor on the phrase plus `(\s|$)`.

**A Switch's sr-only input cannot take a pointer click**: the visible track sits over
it ("<div class=relative> intercepts pointer events"). Toggle by keyboard (`focus()`,
Space) or the label, never `force`.

**The scripted reset clears the fake eBay sellers** (policies, alt seller): a
fresh-only spec on the alt seller is fresh again after `agent-convex.sh --seed`.
Related: [[patterns_marketplace_listing_spec_shape]].
