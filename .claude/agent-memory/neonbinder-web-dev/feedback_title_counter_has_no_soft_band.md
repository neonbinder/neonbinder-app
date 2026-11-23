---
name: title-counter-has-no-soft-band
description: The listing-title counter (TitleLengthMeter) warns only past 80; no "may clip" soft band exists, so do not reintroduce one
metadata:
  type: feedback
---

`TitleLengthMeter` / `titleLengthState` have two states only: within the cap (plain grey `N/80`) and over it (pink, `N over`, alert). The 55/70 "may clip in search" soft bands and the `soft` argument are gone (NEO-645).

**Why:** Jason, 2026-11-23: using the full 80 characters is best for search; a clip warning implies shorter is better.

**How to apply:** never add a below-cap warning to a title counter. `LISTING_TITLE_MOBILE_CLIP` / `LISTING_TITLE_SEARCH_CLIP` remain in `convex/features/listingLimits.ts` as unused-by-UI constants. `TitleFieldNote` keeps its own `NOTE_CLASS` ink (an advisory note, not a length state).
