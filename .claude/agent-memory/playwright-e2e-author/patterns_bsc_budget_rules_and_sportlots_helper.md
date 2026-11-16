---
name: bsc-budget-rules-and-sportlots-helper
description: How a BSC wait gets its budget now that BSC is the fake; the one helper for steps that also drive SportLots; traps in the measurement TSVs
metadata:
  type: feedback
---

A BSC step's budget (GUIDE hard rule 3): (1) screen shows "Waiting on BuySportsCards" -> `expectAfterMarketplace` / `pickAfterBscSync`; (2) BSC-only, no line -> default 7 s if the measured max is 3.5 s or less, else ceil(max + 7 s) with the measurement in a comment; (3) a step that ALSO drives SportLots -> `expectStepWithSportLots(page, target, env, { liveMs, what, pausedMs?, statusLine?, state? })` in `support/marketplace-wait.ts`: `liveMs` while SportLots is live, rules 1-2 while paused. No `bscReadCeiling` any more.

**Why:** Jason approved "fast always from the bsc mock server"; lowering a timeout only shortens time to red, so every site is justified by a measured number, never a guess.

**How to apply:**
- Keep exported ceilings (`VARIANT_TYPES_SYNC`, `COLD_SYNC`, `INSERT_FETCH`) as the LIVE values; wrap at each BSC site. Do not make them env-dependent: custom-subtree specs reuse `VARIANT_TYPES_SYNC` for non-marketplace waits.
- `expectAfterMarketplace` takes `state: "hidden"` for "Syncing X" going away.
- Branches that only run when SportLots is live (`!env.SL_PAUSED`) keep their ceilings; a line measured there in a paused run is a mis-matched step (measurement TSVs match steps to the nearest preceding line within 8 lines), so re-read the branch before trusting a number.
- Bare heading/page-load waits (`setBuilderReady`, column headings) and Wikidata lookup/wizard waits (`LOOKUPS`, `WIZARD_OPENS`, `BATCH_GROWS`) are not BSC waits; leave them.
- A test whose only wait moves into the helper loses its own `expect` and trips `playwright/expect-expect`; add a real assertion of the end state.
