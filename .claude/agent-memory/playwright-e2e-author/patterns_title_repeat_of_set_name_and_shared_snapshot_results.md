---
name: patterns-title-repeat-of-set-name-and-shared-snapshot-results
description: A minted team equal to the set name (case-folded) is dropped from generated titles as a repeat; worker 11's long ATTEMPT_TOKEN pushes near-80 fixtures over; a shared run snapshot needs its own --output
metadata:
  type: feedback
---

- **Repeat rule bites minted names.** The title generator leaves out a team whose name
  repeats a word already in the title, case-folded: set `tlf<token>` + team `TLF<token>`
  gives a title with no team. Keep a spec's minted set and team prefixes distinct
  (`tlfset<token>` vs `TLF<token>`). Probe with the bundled generator
  ([[title-fixture-arithmetic]]) before blaming the product.
- **Worker index changes title arithmetic.** ATTEMPT_ID/TOKEN are 2 chars longer on
  workers 10-11 than CI's 0-7, so a fixture near the 80 cap drops the sport locally and
  not in CI. Size fixtures for the longest worker, or pad to a fixed length.
- **Shared run snapshot (several authors, one folder):** `rsync --delete` of `playwright/`
  wipes other runs' `results/` mid-run (ENOENT on trace/context close, no
  error-context.md). Sync with `--exclude results` and run with
  `--output=<own scratch dir>`.
- **A diagnostic bypass lives in the snapshot only:** to see past a known product red
  (e.g. an axe finding) edit the run copy, never the source spec, and re-sync after.

**Why:** cost three runs on NEO-645 before the real cause showed.
**How to apply:** any spec asserting a generated title, and any multi-author snapshot run.
