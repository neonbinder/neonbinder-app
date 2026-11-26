---
name: skip-dialog-fixture-table-unrun-branch-and-cancel-asserted-only
description: When a dialog becomes skippable, check the per-fixture opens/skips table is branch-exact, that edited specs on a paused-only-unrun branch keep stale counts, and that new controls are clicked not just seen
metadata:
  type: feedback
---

A "skip the dialog when clean" change rewrites many specs through one helper keyed on a static per-fixture table. That is sound (no `.or()` race) but leaves three recurring gaps:

- A spec whose dialog branch only runs on the unpaused/live deployment gets its fixture edited ("drop a row so it opens") while the body's counts (Matched (20), BSC only (2)) stay stale; the branch is unrun in CI, so nothing goes red. Ask for counts derived from facts, or the branch moved to a fixture that opens on the paused run.
- A control shown on every run (inline Cancel) is asserted visible in several specs but clicked in none; the unit test is the only proof. Ask for a live click.
- Removing "axe within dialog" from specs that now skip is fine only if other specs keep the dialog axe; the new landing (kept line beside the wizard or on the saved line) needs its own axe label.

**Why:** a table that says "skips" is verified by the helper (kept line + no dialog); a table that says "opens" is verified by the confirm helper waiting on the dialog, so wrong entries fail by name. The gaps are in what the table does not drive.
**How to apply:** grep removed `expectAccessible` labels, grep clicks on new controls, read the unpaused-only branches of edited specs.
