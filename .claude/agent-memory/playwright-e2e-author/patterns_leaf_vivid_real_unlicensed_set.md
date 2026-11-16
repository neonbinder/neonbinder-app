---
name: patterns-leaf-vivid-real-unlicensed-set
description: NEO-556 - finding a real set through the year-wide Sets sync, the Proof variant type, how held cards and parallel copies behave under No Team
metadata:
  type: patterns
---

- Find a real set with NO new recording: Sport -> year -> `All Brands` view -> search the Sets column; the year-wide Sets sync a
  seed already ran lists every set (and mints a brand row from the known-brands list, e.g. `Leaf`). Only the set's own variant-types
  read is new. A BSC variant type that is not Base/Insert/Parallel (e.g. `Proof`) lists its rows directly; the leaf row's panel
  reads "(Insert)" and its column is "Proofs" (support `Column` carries it).
- A real set under paused SportLots is one-marketplace: Sync card checklist ends "Kept all N cards from BSC. Nothing to match" and
  the tidy-up wizard opens straight on "Cards with no team" ("Step 1 of 2") when every player is already known (no name steps).
  Cancel on a batch with NO decision says "Fetch cancelled" at once (no Discard question): `cancelUndecided`, not `cancelAndDiscard`.
- The wizard's teams step lists every card whose team nothing answers, "Leave for later" preselected, whether or not the set has
  an answer; only the set-team HINT (needs >= 8 cards) goes when the set (or a team) answers. The hint sentence is the product's copy.
- A pasted checklist (`usePastedChecklist`, textbox "Paste the checklist") can carry one row; the rest of the cards are looked up
  per card inline in the fetch (answered at once from recordings).
- A real Base can hold hundreds of cards; its fetch looks up only some inline and queues the rest on the background lane
  ("Still looking up teams for N cards"), one card about every 2-3 s: nothing a 7 s assertion can wait out.
- A parallel row has no "Sync card checklist": it is populated only by "Build N parallels from Base" on the Parallel type, which
  pairs Base cards to the parallel's marketplace cards (by number, else player). Real Base cards need not appear in a parallel at
  all ("Nothing copied - none of Base's N cards turned up"). Copies carry the source's lookup state; a copy of a card whose
  lookup never ran is "Still looking up teams" with nothing scheduled to run it.
- A checklist row is virtualised (about ten rows in the DOM): reach a card with the searchbox "Search cards", never by scrolling.

Parallel copies owe their own card-listing lookup (NEO-556 fix): after "Build N parallels from Base" the copies join the one-slot team lane, and each copy's own BSC card id is a fresh `marketplace/card/<id>/card-listing` read. On the fake an unrecorded one 501s on both attempts and the lane retries only after 60 s, so a "No Team" assertion on the copies cannot be green until the recorder has captured those reads (`reportMisses` lists them). Once recorded, a replay is instant and the lane settles each copy in a couple of seconds. Check the misses list before blaming the product.
