---
name: pick-list-title-bands-and-probing-a-query
description: NEO-590 Pick List "Sales NB didn't list" sport bands - how to scope them, and how to prove a reference-seed lookup before asserting on it
metadata:
  type: project
---

A Pick List set group's header is a `rowheader` whose name reads band + heading + count
("Baseball Sales NB didn't list 1 card"); the band (sport) is plain text, the divider a level-3
heading. Two bands can share the same heading text (one per sport plus "Other"), so scope a band
through the rowheader name, not `pickGroup(table, heading)`:
`table.getByRole("rowgroup").filter({ has: page.getByRole("rowheader", { name: /^Baseball Sales NB didn't list / }) })`.
The row itself also carries a sport chip (cell "Baseball"), so a bare `getByText("Baseball")` in the group is ambiguous.

**Why:** an assertion that a title-filed line lands under a sport depends on reference-seed data
(an NB player row named in the title). Prove that first instead of guessing.

**How to apply:** on your own worktree deployment, call the public query directly with a fake
identity: `npx convex run pickList:titleSports '{"titles":[...]}' --identity '{"subject":"probe","issuer":"probe"}'`
(read-only; fine on your own deployment, never needed on shared dev). If it returns the sport, the
CI preview (same reference bundle) will too. As of NEO-590 the band's count said "card" for lines
NB didn't list, against NEO-520's "never called a card" rule; the spec asserts "1 item" (see
[[sibling-edits-reload-a-local-vite-run]] for the eBay unmatched row names).
