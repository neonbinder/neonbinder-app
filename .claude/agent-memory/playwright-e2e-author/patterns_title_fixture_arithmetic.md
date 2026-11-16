---
name: title-fixture-arithmetic
description: Compute expected listingTitles by running the real generator (esbuild-bundle it); NEO-535 cut order, pad minted names to a fixed length so the arithmetic is exact on every runner, and the typed card name never reaches the title
metadata:
  type: reference
---

**Compute it, don't estimate it.** The generator is pure and has no Convex
imports, so bundle and call it (from `apps/web`, output to the scratchpad):

```bash
npx esbuild convex/features/generateListing.ts --bundle --format=esm \
  --platform=node --outfile=<scratch>/gen.mjs
node -e 'import("<scratch>/gen.mjs").then(m=>console.log(m.assessListingTitle({
  cardNumber:"C1", year:"2024", manufacturer:"Topps", setName:"ttl...",
  insertName:"Base", sport:"Baseball", playerNames:["George Brett"], teamNames:[]})))'
```

It returns `{title, fits, firstNameLost, dropped, coreFits, shortNameUsed?}`;
`leftOutOfTitle(inputs, text)` is the drawer's "Left out to fit" note.

**NEO-535 rules a fixture leans on:** the description (year, maker, set,
insert, parallel), surnames and `/N` are NEVER cut; a title still over 80 after
every cut is kept over the cap (drawer alert "over the 80-character limit")
unless the row chain has a "Set name in titles", which then opens the title
verbatim. Cut order: repeats, "Insert"/"Parallel" labels, sport, second
Rookie, teams, number, first names, SP, RC, RELIC, variation, AUTO; a title at
exactly 81 loses only the "#". The refill tries the number (with "#", then
bare) before the sport and labels, so an operator can never retype a dropped
number into 80 characters without cutting something the note would report.

**A hand-made `Insert` > `Base` row is an insert by role:** its title says
"<set> Base Insert" (label cut first). The quick-add PlayerPicker's linked
player DOES reach the title; the free "Card name" field never does.

**Exact on every runner:** `ATTEMPT_TOKEN` length varies (worker digits, a
random tail of 1-5 digits), so pad the minted set name and any minted card
number to a fixed length (`padEnd`) and assert the lengths in the spec.
Example: `card-title-uses-short-name-for-titles`.

The collector's "Find a card" (`collectionCatalog.search`) reads the card's
DESCRIPTION, which keeps every fact; to prove it, search a single token only
the description holds (the number the title dropped).
