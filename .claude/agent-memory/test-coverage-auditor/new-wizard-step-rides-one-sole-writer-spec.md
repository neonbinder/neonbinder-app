---
name: new-wizard-step-rides-one-sole-writer-spec
description: a new post-name wizard step proven by one existing sole-writer spec leaves sub-states (error, blocked Next, picker open, chips, nested prompt) without axe or live proof, and every unchanged spec asserting the first post-name step by name is a silent risk
metadata:
  type: feedback
---

When a new step is inserted before other wizard steps, the author rewrites `advanceToSave` and the specs that touch it, but specs that assert the FIRST post-name step by its subtitle ("Cards with no team", "Ready to save") and were not edited are untouched evidence. Grep every spec for the old step subtitles and the `Step 1 of` counters; each one needs either a fixture proving the new step cannot appear (teamless or skipped cards, no existing player) or a pass helper.

**Why:** a fixture with a known player and a team on a new card now opens the new step first, so those specs go red only in CI.

**How to apply:** list the unedited specs by name as "unverified, run before queue". Also check that the single spec carrying the new step covers: the blocked-Next state, the picker/search open, read-failed state, chips/quick-picks, the nested follow-up (an instant `isVisible` branch on a server-read control is a hedge), with axe on each. Counts like "N to look at" taken from the live catalogue are brittle until measured. Helpers that conditionally pass the new step (`passCareerCheck`) let it vanish silently in those specs, so the carrier spec must assert it positively on both projects.
