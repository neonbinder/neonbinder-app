---
name: card-number-prefix-remainder-helper
description: lib/cards/card-number.ts splitCardNumberPrefix / cardNumbersDifferOnlyByPrefix is the one prefix-vs-remainder reading (stripLetterPrefix does not split "89B-1" or "T88-12")
metadata:
  type: reference
---

`stripLetterPrefix` only strips leading letters then a digit ("BCP-12"); it leaves "89B-1" and "T88-12" whole. For "same card, different prefix" use `splitCardNumberPrefix` (remainder = trailing digits plus one optional letter, case kept) and `cardNumbersDifferOnlyByPrefix` in `lib/cards/card-number.ts`. Remainders compare as printed so NEO-489 case twins ("1a"/"1A") never fold together.

In `convex/lib/parallelCardLink.ts` a `via: "prefix"` link is the signal the build copies the fetched card's own number; the stale-source check still uses the source number. A rebuilt parallel's old cards then carry the parallel's number, so `cardKey` SKU carry / earlier-link tiebreak no longer match them by key.
