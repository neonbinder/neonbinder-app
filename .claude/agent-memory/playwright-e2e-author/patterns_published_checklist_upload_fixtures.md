---
name: patterns_published_checklist_upload_fixtures
description: Checklist upload fixtures - NNO sets, N-of-M arithmetic, team claim blocks career prefill
metadata:
  type: pattern
---

- A fixture CSV is a capture of BSC's own answers (public storefront search + per-card card-listing, laptop, 1 call/s, backoff on 429). Rule 7 matching pairs a number only when it is exactly one on BOTH sides, so a set whose cards are all `NNO` (Roanoke, Louisiana, Silk Collection) cannot use an upload: keep its live fetch. Check the numbers of any candidate set (shop search, one call) before capturing.
- `Teams from your checklist: N of M cards`: N = rows whose number is on exactly one row (`checklistFacts().matched`), not rows with a team; M = cards.
- `expectAfterMarketplace` (support/marketplace-wait.ts): own time = elapsed - time the "Waiting on <platform>" status was on screen, plus a 1.5 s back-credit per episode (the product mounts the line after ANNOUNCE_AFTER_MS). Prove the credit through the `marketplace-wait` annotation, not pass/fail: at the 7 s threshold it rarely flips a result.
- A blocked Next shows its status only after a blocked press, and Next may be aria-disabled (click() waits): use the Enter shortcut the footer names.
- Disagreement choices are radios in a radiogroup `Disagreement on #N` (number regex needs a not-followed-by-alphanumeric guard: #6 vs #60).
- A background `node` capture started with `&` can be STOPPED by the shell (TN state); start it with stdin from /dev/null and output redirected, and cd to the dir the script path is relative to.

## Checklist upload team claim blocks career prefill

A team named by an uploaded checklist row is a data claim that stays
(`checklistClaim` in `components/SetSelector/teams-on-cards.ts`, invariant 8): no
rule fills another team over it, and SKIPPING the New Team step does not release
it. A live BSC per-card answer is different: its team string is a claim only
until the operator rules the name "not a team" (the skip), then the normal rules
(career pre-fill) apply again.

**Why:** `checklist-one-marketplace-skips-match-dialog` uploaded the Roanoke file
(25 NNO rows, team "Roanoke Express" each) and went red at STEP 6: the created
player's in-window career team (`Templetuohy`) stayed UNCHECKED, every line on
"Leave for later". The same spec on a live fetch passed in three passes. The
checklist was put back out of the spec; the file stays as a fixture.

**How to apply:** before wiring an upload into a spec, list what it asserts about
teams. Pre-fill, "N need you", and teams-only re-sync lines all change under a
claim. An upload suits a spec whose point is something else (autograph format,
set history, a stall) and whose team answers it only reads back.

Related: a dialog button that is `aria-disabled` while there is nothing to use
(the checklist dialog's "Use this checklist") cannot be `click()`ed (7 s
actionability wait); focus it and press Enter to see the product's refusal
status. Another live-call burst note: two fetches of 25 cards back to back
(one spec) left BSC answering 429 to the NEXT spec's whole first wave of 10, on
desktop and mobile alike; the card-listing cooldown row showed 15 s, streak 1.
