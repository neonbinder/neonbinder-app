---
name: pick-list-title-bands-and-probing-a-query
description: NEO-590 Pick List "Sales NB didn't list" sport bands - how to scope them, prove absence, read their row order, and prove a reference-seed lookup before asserting on it
metadata:
  type: project
---

A Pick List set group's header is a `rowheader` whose name reads band + heading + count
("Baseball Sales NB didn't list 1 item"). For a title band the level-3 heading itself is named
"<Sport> Sales NB didn't list" (sport inside the heading, so bands sharing the divider words read
apart); the row's own sport chip is aria-hidden inside a band. Scope a band through the rowheader:
`table.getByRole("rowgroup").filter({ has: page.getByRole("rowheader", { name: /^Baseball Sales NB didn't list / }) })`.

- **Absence of every title band:** `getByRole("heading", { level: 3, name: /Sales NB didn't list$/ })`
  toHaveCount(0). An `exact: true` name of the bare divider words matches nothing once the sport
  leads the heading, so it passes vacuously; prove the regex form by planting it where a band
  exists (it went red, Received 1).
- **Row order inside a band:** `band.getByRole("button", { name: /^Pulled / })`, then `nth(i)`
  `toHaveAccessibleName(new RegExp("^Pulled " + escapeRe(title)))` (`support/set-builder`
  `escapeRe`). Make the fixture discriminating: seed the older title first and give it set words
  that sort first, so only "newest year first" passes.
- **Sport filter choices** come from every row on the list (not the filtered ones): "Other"
  appears only while an Other-band row is open. `filterBy` leaves More filters open on a phone.

**Why:** an assertion that a title-filed line lands under a sport depends on reference-seed data
(an NB player row named in the title). Prove that first instead of guessing.

**How to apply:** on your own worktree deployment, call the public query directly with a fake
identity: `npx convex run pickList:titleSports '{"titles":[...]}' --identity '{"subject":"probe","issuer":"probe"}'`
(read-only; fine on your own deployment, never needed on shared dev). Only the words after `#<n>`
are searched for the player/team. If it returns the sport, the CI preview (same reference bundle)
will too. A title band counts "items", never "cards" (NEO-520).

**A sport needs a leading year (NEO-590, after the first audit).** Only a title that opens with a year
(after one "PSA 10"-style grader+grade) is sent to `titleSports` or filed under a sport; anything else
files under Other even when the server would answer a sport ("Mike Trout Hoodie XL" probes Baseball).
Both gates are CLIENT code (`pick/model.ts` `titleFacts` + `titleParses`, used by the store), so a
planted break reaches the run through Vite HMR with no backend push. Make the fixture discriminating by
seeding the year-less title into a run that counts the Baseball band exactly (the plant read 3, not 2).

**A self-cleaning Pick List spec's failure screenshot shows the CLEANED list.** The finally block ships
leftovers on a second page, but the failing page is a live Convex subscription, so its screenshot and
error-context read "Nothing to pull". Read the assertion's Received value, not the screenshot. See
[[patterns_sibling_edits_reload_a_local_vite_run]] for the eBay unmatched row names.
