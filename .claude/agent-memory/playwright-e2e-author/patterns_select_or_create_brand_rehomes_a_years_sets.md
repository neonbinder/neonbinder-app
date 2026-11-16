---
name: select-or-create-brand-rehomes-a-years-sets
description: Drilling a real year with drillToSet(createManufacturer) on a deployment whose seed predates a known brand mints a hand-made brand row AND its Sets sync moves every prefix-matching set out of Unknown; check the year's brands read-only first
metadata:
  type: patterns
---

`selectOrCreate("Manufacturers", "Topps")` under a SportLots pause makes the brand through
"+ Custom" when the year lacks it. Its Sets column then syncs and files every set whose name the
brand prefixes under it, moving them out of the year's `Unknown` row (the column notice reads
"N sets moved out of Unknown"). On a long-lived deployment that is a visible re-home of other
sessions' (or the owner's demo) paths, and it cannot be undone in one step.

Before drilling a real year on a deployment you did not seed this session, list the year's brand
rows read-only (`npx convex run --inline-query` over `selectorOptions` `by_parent`). A CI preview
seeded with current code mints the major brands at the seed (known-brands list), so the drill
behaves differently there than on an older local seed.

Also read a fixture set's state before planning a fresh-only spec on it: a checklist someone
already fetched (cards present, stored defaults, cameos) cannot host a "before the fetch" proof
without a reset.
