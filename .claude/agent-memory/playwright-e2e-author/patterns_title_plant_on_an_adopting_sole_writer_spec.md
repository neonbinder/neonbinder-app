---
name: patterns-title-plant-on-an-adopting-sole-writer-spec
description: A changed stored-title assertion on a sole-writer spec that adopts on rerun - plant the drawer's read path, not the generator; a generator plant either misses (titles already stored) or poisons the seed
metadata:
  type: feedback
---

Sole-writer specs on a real set (fetch on a fresh seed, adopt and read back on a rerun) assert
stored card titles in the card drawer. After a title rule changes, a plant on the generator
(`convex/features/generateListing.ts`) is the wrong tool:

- run after the green run, `--expect` keeps the seed, the spec takes the adopt branch and the
  stored titles never pass through the planted code: it STAYS GREEN;
- run first on a fresh seed, the walk writes every card's title through the break, so the next
  real run adopts poisoned titles and goes red until a reseed (which is not yours to take).

Do instead: real run first (`--project both`), then a client read-path plant on the drawer's
title field (`CardDetailFields.tsx`, `titleField`'s `value: card.listingTitle`, e.g. strip the
new word) with `--expect` on the expected title. It reds at the exact assertion in ~25 s, no
reseed, nothing written. Pair it with the offline old-vs-new title from the pre-change generator
([[patterns-compute-titles-with-tsx-before-a-title-spec-runs]]) so the report shows the old
product value fails the new assertion.

A generator plant with a TS-narrowing guard: `if (inputs) return undefined;` makes the rest
`never` and the Convex push refuses it; use `if (inputs.cardNumber.length >= 0) return undefined;`.

**Why:** NEO-645 Base-word change on the Leaf Pete Rose spec (2026-11-23); the generator plant
on the per-attempt Card name spec was fine because its fixture is minted per attempt.
**How to apply:** any plant for a title assertion on a spec whose second run adopts data.
