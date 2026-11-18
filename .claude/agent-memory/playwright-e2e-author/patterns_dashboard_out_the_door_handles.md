---
name: patterns_dashboard_out_the_door_handles
description: Dashboard Out the Door locators (region, per-order article "eBay order #<no>" with a hash, unlike the Sales tab), the "N item(s). Sold today." line, hidden expanded lines, and reaching it from an Inventory spec with goto + goBack
metadata:
  type: reference
---

Out the Door handles (NEO-464/NEO-590), same on the demo and signed in:

- `page.getByRole("region", { name: "Out the Door" })`; each order is an `article`
  named by its h3: `"<Market> order #<orderNo>"` (sr-only market words + `#`). The
  Inventory Sales tab's article is `"eBay order <orderNo>"` with NO hash, so a
  helper built for one does not find the other. Use `exact: true`: minted order
  numbers can prefix each other.
- The order's count line is one text node: `"1 item. Sold today."` ("item" only when an
  EBAY order has a line with no NB card; BuySportsCards orders always say "card", e.g. demo
  DEMO-1003 "2 cards. Sold today."; "Yesterday"/"N days ago" otherwise). The toggle opened
  reads "Hide the items|cards" to match. One line of quantity N shows "×N", never "and N-1 more". Its row-wide
  block makes it a good `toBeInViewport({ ratio: 1 })` target for "a long unspaced
  title wrapped": an overflowing row pushes the block past the edge (and the
  section's overflow-hidden clips it, which also lowers the ratio).
- A multi-line order's lines sit in a `hidden` list until "Show all N cards|items in
  <Market> order <no>" is pressed. `toHaveCount(0)` counts hidden nodes too, so an
  absence check on the region (`getByText(/matched/i)`) covers unopened lines;
  pair it with a visible positive (R2).
- Needs a Look's per-order entry is the link `"Jump to order #<no>"`. Do not assert
  Needs a Look absent on a worker account: a box with cards not listed puts it up.
- From an Inventory spec: `page.goto("/dashboard")` then gate on
  `heading level 1 "Welcome back, slugger."` with LAUNCH_GATE (full load); `goBack()`
  is a full load of the previous URL too (the seed hop navigates without replace, so
  the entry before is the redirect target), gate it with LAUNCH_GATE as well.

- The lead is the order's first CARD, not its first line: an order whose line 0 has no card but a later
  line does leads with that card, so "A sale with no title" shows only when no line has a card. The demo's
  eBay `12-34567-89123` (untitled line, then 1989 Score #270 Troy Aikman) proves it; its opened list names
  the untitled line "An item with no title". An absence check for the lead words on that article also
  catches the HIDDEN line list (toHaveCount counts hidden nodes), which is how a planted
  ITEM->SALE swap went red before the order was opened.

Related: [[reference_dashboard_shelf_boxes_and_demo_limits]].
