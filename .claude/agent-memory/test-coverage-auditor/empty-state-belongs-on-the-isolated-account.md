---
name: empty-state-belongs-on-the-isolated-account
description: sales and marketplace history persist on the worker's main account across specs, so an "empty state" assert there is order-dependent; prove it on the isolated new-profile account
metadata:
  type: feedback
---

Sales, marketplace history and other per-user rows that the per-user reset does not clear accumulate on the main account as other specs on the worker add orders. An empty-state assert on that account is true only by luck of order (or a failure reset).

**Why:** NEO-555 B2: the Sales "No sales yet" proof could not live in the eBay listing spec; it moved to `profile/ebay-connect-and-setup` on `new-profile`, where no spec writes a sale.

**How to apply:** when a spec asserts an empty state, check which account it signs in as and which other specs write that data there (grep `addOrder`, seeds). If the account is shared, ask for the isolated account. Then check what the isolated account also holds (other specs' connections) and that the regex tolerates extra names.
