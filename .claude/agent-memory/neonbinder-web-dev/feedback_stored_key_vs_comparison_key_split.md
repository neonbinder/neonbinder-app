---
name: stored-key-vs-comparison-key-split
description: A name-fold rule change must never move a STORED key (no re-key); put the new rule in an explicit comparison step and route each consumer by what it compares against
metadata:
  type: feedback
---

When a matching rule changes how names read (NEO-643: "a hyphen is a space"), do not put it in the shared character fold that `normalizeEntityName` / `nameNormalized` / alias / skip / queue keys start from. Keep the stored chain byte-identical to origin/main and add an explicit second step (`dashesToSpaces`, `foldNameForCompare`, `entityNameCompareKey` ...) that comparison callers opt into.

**Why:** the first NEO-643 cut folded dashes in the one fold; thousands of stored rows keyed by main's code became unreachable (the wizard offered "Shin-Soo Choo" as a new player), and the token sort made "Min-jae Kim" and "Jae-min Kim" collide. Jason's ruling: no re-key, no seed change.

**How to apply:**
- The stored chain is main's (NFD plus only the junk deletion). NFKD (full-width, ligatures, the ordinals "ª"/"º") belongs to the comparison fold only: NFKD in the stored chain turned "1º de Agosto" into "1o ..." and moved stored teams that a read-only re-key dry run on a reference seed caught.
- Route per consumer by what it compares against: a stored key it read, a skip key, an index lookup = stored function; two incoming/display strings = comparison function. One module can hold both (career-check: `norm` stored for batch-row maps shared with other modules, `fold` comparison).
- A stored-key change is provable: `git show origin/main:<path>` into the scratchpad, run both with tsx over a few hundred thousand random strings (all dash forms, accents), diff the outputs; hardcode a handful of main's outputs as a pin test.
- A typeahead that prefix-matches a stored key's tokens must split those tokens on the hyphen when the typed text reads a hyphen as a space, AND keep main's own reading against space-split tokens as an OR leg: the comparison reading joins initials ("K-C" to "kc") while the stored key keeps "k-c", so typing a stored name in full otherwise drops a row main returned. A search INDEX is still asked with the stored reading so it is never worse than main.
- A comparison hit that is not a stored-key hit is "close", never "exact" (exact would let a wizard auto-link or skip the twin check); rank it first with its own sort rung.
