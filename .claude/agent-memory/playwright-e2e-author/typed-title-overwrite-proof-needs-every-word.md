---
name: typed-title-overwrite-proof-needs-every-word
description: To prove a write overwrites a hand-typed listing title, the typed title must hold every generated word, or the NEO-637 rule rebuilds it anyway and the spec cannot fail
metadata:
  type: feedback
---

A spec that proves "this write overwrites a typed title" (for example, Shorten the set name from the
Tidy Up walk) must type a title that holds every word the generator would use: the set name in
effect (or the row's "Set name in titles" box phrase), the player and `#<number>`. Add one extra
token so the spec can assert it is gone.

**Why:** the NEO-637 retitle rule (`convex/features/setNameInTitles.ts`) also rebuilds a typed
title that "shows Left out", meaning one that is missing any of those words. A short typed title is
rebuilt with or without the overwrite, so a plant that removes the overwrite stays green. This
happened once. A 100-character set name cannot fit in a typed title of 80 or less, so the proof
only works after a short name is already in effect: shorten once, type the title, then shorten
again.

**How to apply:** before you trust the assertion, plant the overwrite off (in TitleTile, drop
`regenerateListing: true`) and confirm the spec goes red. A second Shorten saved from a LATER card
retitles cards already reviewed earlier in the walk. They come back as "worth a check", so do both
shortens on the same card.
