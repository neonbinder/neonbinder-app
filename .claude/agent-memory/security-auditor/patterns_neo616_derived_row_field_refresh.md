---
name: patterns-neo616-derived-row-field-refresh
description: Derived selectorOptions field kept by a scheduled internal refresh from card mutations; what to check (no public args name it, refresh internal, per-write scheduling bounded by admin gate + RECOUNT_MAX read), and the checklist byte-estimate parity
metadata:
  type: project
---

Shape (NEO-616 `selectorOptions.printRun`): a row field DERIVED from its cards,
written only by an `internalMutation` refresh that public card mutations
(`addCustomCard`, `updateCard`, `deleteCard`, all `requireAdmin`) schedule with
`runAfter(0)`, plus an armed internal backfill.

Checks that settled it:
- grep every public `args` validator for the field name; `selectorOptionFields`
  feeds only `returns` validators (`selectorOptionDocValidator`), never args.
- Amplification = one scheduled job per card write, each reading up to
  `RECOUNT_MAX + 1` cards. Acceptable only because every scheduling door is
  admin-gated and the UI deletes one card per call; re-check if a bulk or
  non-admin card writer starts scheduling it.
- Backfill: the page mutation re-checks the env flag itself when `apply` is
  true, so calling the page directly cannot bypass the action's arming.
  A derived field may be rewritten by `repair`; contrast
  [[backfill-of-operator-editable-field-is-fill-only-by-default]].
- Published-checklist uploads: client batcher and server both size rows with
  `storedRowBytes` (getConvexSize) and the server re-measures the CHECKED rows,
  so a client estimate that drifts only produces a refusal, never an overrun.
  A new optional row field must be added to `publishedChecklistRowValidator`,
  `publishedChecklistStoredRowValidator` and the re-check by hand (three places).

**How to apply:** for any new derived row field, run the three greps (args
validators, scheduling doors' gates, backfill page arming) before approving.
