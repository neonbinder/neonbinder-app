---
name: inline-refusal-alerts-in-match-cards-and-titles-step
description: Where the Match Cards rename/roster refusals and the CardTitlesStep "Set name in titles" refusal can be shown live, and which need SportLots unpaused
metadata:
  type: reference
---

Proving an inline refusal alert (text + axe while it shows) needs a spec that
already reaches the control:

- **Match Cards rename editor** (`Edit name for #<num>` button, then textbox of
  the same name): any two-source Match Cards row works while SportLots is
  paused (BSC + a publisher's checklist). Example:
  `checklist-published-numbers-differ-pairs-by-player`, PHASE A2. 121 chars +
  Enter → alert "Card names are limited to 120 characters — shorten it to save.";
  the editor stays open; Escape abandons it without closing the dialog.
- **Match Cards roster field** (`Players for #<num> (separate names with |)`)
  only renders under a PLAYERS CONFLICT, which needs both BSC and SportLots on
  one row (`conflictingPlayers(bsc, sportlots)`); a checklist never raises one.
  So it lives in `checklist-pairing-dialog-cancel`'s live branch and cannot run
  while SportLots is paused. Say so in the report.
- **CardTitlesStep box refusal** (`shortError`, "Set name in titles tops out at
  80 characters.") is on the wizard in `inserts-1996-score-…` (P5) and on the
  parallel-copies dialog in `bowman-insert-grouping-…`. The hand-made-card specs
  (`card-title-uses-short-name-for-titles`) never open CardTitlesStep: their
  walker uses TitleFixer.

Plant for an alert: `toHaveCount(0)` at the alert assertion (red only if it
really shows), not a wrong string.
