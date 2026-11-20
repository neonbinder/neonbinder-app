---
name: title-fixture-arithmetic
description: Compute expected listingTitles by running the real generator (esbuild-bundle it, pass titleLevels); NEO-609 cut order and Tidy Up line, Base and type names, pad minted names to a fixed length so the arithmetic is exact on every runner
metadata:
  type: reference
---

**Compute it, don't estimate it.** The generator is pure and has no Convex
imports, so bundle and call it (from `apps/web`, output to a scratchpad SUBDIR
of your own: the session scratchpad is shared, a bare `gen.mjs` may be another
agent's):

```bash
npx esbuild convex/features/generateListing.ts --bundle --format=esm \
  --platform=node --outfile=<scratch>/<own dir>/gen.mjs
node -e 'import("<scratch>/<own dir>/gen.mjs").then(m=>console.log(m.assessListingTitle({
  cardNumber:"C1", year:"2024", manufacturer:"Topps", setName:"ttl...",
  titleLevels:[{name:"Rw...", typeName:"Insert"}], sport:"Baseball",
  playerNames:["George Brett"], teamNames:["Kansas City Royals"],
  teamSplits:[{location:"Kansas City", name:"Royals"}]})))'
```

Since NEO-609 pass `titleLevels` the way `listingShortName.titleChainFacts`
builds them from the chain (leaf rows only, top level first): an insert row is
`{name: row, typeName: <variant type's value>}`, a sub-variant `{name, typeName:
"Parallel"}`, a card sitting directly on a variant type `{name:
singular(type)}`, and on the Base type `{name:"Base", base:true}` (the flag is
the type's KIND; without it "Base" is an ordinary level name). It returns `{title, fits,
firstNameLost, dropped, tidyUp, coreFits, shortNameUsed?}`; a card is on the
Card titles step / Tidy Up when `!coreFits || !fits`.

**NEO-609 rules a fixture leans on:** "Base" (a card directly on the Base
type) is IN the full title and is cut first. A hand-made `Insert` > `Base` row
is an ordinary insert called Base ("<set> Base Insert ..."), so keep fixture
rows off the word. Every level says its name then its type name in the
SINGULAR ("Proofs" reads "Proof"), the type name a quiet cut; when a level
opens with the words of the level above ("Anime" > "Anime Red Refractors"),
the upper level's type name is left out ("Anime Red Refractors Parallel"). Order: Base; AUTO/RC/RELIC repeats; type
names top level first; cameos; sport; 2nd Rookie; Rookie->RC; team cities ---
Tidy Up line --- whole teams; number; RELIC-if-Memorabilia; AUTO-if-Signature;
SP; RELIC; first names; RC; AUTO. The "#"-at-exactly-81 rule only fires from
the Tidy Up line (every quiet cut is made first) and is not Tidy Up. Never cut:
year, maker, set, every level's own name, surnames, `/N`, the VARIATION (a
71-character variation keeps a title over 80 after every cut). The refill puts
cuts back most valuable first; the number tries "#" then bare.

**When the box ("Set name in titles") applies (NEO-618):** to a title over 80
after every cut (always), or to any Tidy Up title (a whole team, the number, SP,
RELIC, a first name, RC or AUTO out) when the box version FITS. A title that fits
with nothing Tidy Up cut ignores it. So under a short box, a fitting card that
lost only its team changes too; fixtures written before NEO-618 that said "the
box leaves a full-name card alone" are wrong now. In the wizard's Card titles
step the box shows a PREFILL (the set's description) but its draft starts
undefined: titles before the operator edits it are the builder's own.

**Product moved under you:** rebundle gen.mjs after every product commit, and
a Vite `page reload` in its log during a run voids that run (setup included).

**Real-set fixtures change shape:** under a long description EVERY card loses a
team or number, so every card is listed. The Card titles step draws only the
first 50 rows in card order (`TITLE_ROWS_SHOWN`) and says "And N more, saved as
generated."; choose fixture cards among the first 50 and read their stored
titles back with the checklist's "Search cards" searchbox (it opens at its END).
The parallel-copies dialog lists every Tidy Up copy too ("28 titles").

**Exact on every runner:** `ATTEMPT_TOKEN` is at most 12 characters (`pw11ma1`
+ 5 digits) and varies, so pad the minted set name, row, surname, team and any
minted number to a fixed length (`padEnd`) and assert the lengths in the spec.
A custom sport's name ("E2E Test Sport <w>") varies by a digit: make sure the
sport is cut and never fits back. Examples: `card-title-uses-short-name-for-titles`,
`card-title-level-type-name-cut-quietly-tidy-up-cuts-listed`.

**Random tails flip "N need you" counts.** Since NEO-609 a card whose title
gives up a whole team or its number is a Tidy Up card ("auto-generated title
was cut short"), and the header pill counts it. A spec that mints card numbers
as `<n>-${ATTEMPT_ID}` on a minted set with a team linked can sit right at 80:
whether it crosses is the attempt's random tail, so the pill reads N+1 on some
runs (checklist-attention-badge-and-filter: green on desktop, red on mobile in
the same CI run, no project difference involved). Sweep every spec that pins a
pill count or asserts "no marks": run the generator over every worker 0-11, d/m,
attempt 1-2, tail 1 and 99999; a card number does not need the attempt in it
on the attempt's own set (use a bare "703").

**Demo titles move with the generator.** The dashboard demo builds titles
through `dash-card.ts` -> `generateListingTitle`; a generator change renames
every demo card ("1989 Score Base Barry Sanders #257 ..."). Diff the whole set:
esbuild a tiny script that walks `getDashboard()` for `title`s (alias `@` to
apps/web, empty loaders for images/css) at HEAD and at origin/main
(`git archive` into scratch, symlink node_modules), then grep playwright/ for
each main title's first 4-5 words.

**Stored vs regenerated:** a print run (drawer `spinbutton` "Print run") does
not move the stored title; Regenerate writes through `updateCard`, which CLEARS
`listingTitleTruncated`, so a Tidy Up proof reads the title the card was BORN
with, then regenerates in the walker. The walker's "Left out to fit" reads the
field against the card's current facts (a later /N shows as left out).

The collector's "Find a card" (`collectionCatalog.search`) reads the card's
DESCRIPTION, which keeps every fact; to prove it, search a single token only
the description holds (the number the title dropped).
