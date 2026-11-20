---
name: patterns-wizard-progress-bar-and-decided-count
description: NEO-467 - the tidy-up wizard has no "Step x of y"; say where it is by the progress bar's subtitle, prove "row decided" by its skip going, and "exactly one decision" by the Decided (N) history
metadata:
  type: patterns
---

Since NEO-467 the wizard and the attention walker share a header progress bar,
`getByRole("progressbar", { name: "Wizard progress" })`: `aria-valuetext` = the
subtitle, `aria-valuenow` = rounded percent, 100 on Save, forward-only (it never
drops within a mount, even when "Change decision" goes back to a name step).
No exact count anywhere. Translating an old count assertion:

- `Step 1 of N` (nothing decided) -> `expectNothingDecided` (a name-step
  subtitle AND no `Decided (N)` summary).
- `Step x+1` after one press ("exactly ONE decision") -> `readDecidedCount`
  before, `expectDecidedCount(n+1)` after. The `Decided (N)` summary is a span of
  its own inside `<details>`, so it stays visible when the list is collapsed.
  It is NOT rendered on the teams / autograph / titles (or checklist) steps, so
  only count on a name step, and only after lookups are drained.
- "x did not move" -> the row's own `Skip <name> — not a ...` still up plus
  `expectDecidedCount(before)`.
- `expectStepLeft(x)` in a skip loop -> `readNameStep` (the skip's name) then
  `expectNameStepLeft(row)`; on post-name steps `readProgress().subtitle` then
  `expectPostNameStepLeft(subtitle)`.
- `Step 1 of N` on a POST-name step the wizard opened onto (Career check,
  nothing pressed) -> `expectWizardStep(<that subtitle>)`; there is no Decided
  summary there to prove "nothing decided", so don't add a vacuous one.
- A `Which team: X` step (NEO-602 two-era choice) wears the `New team`
  subtitle, so `expectNothingDecided` covers it.
- `Step y of y` on Save -> `expectWizardStep(STEP_SUBTITLE.save)` + valuenow "100".
- Walker `Step 1 of 1` / `of 2` (sitting size) -> prove it by the walk: skip or
  answer each card, then `All clear` and no `Skip for now, card` left.
- A layout check that measured the counter -> measure the progress bar.

Percent: hold "not lower" across a change only; never pin a value except 100.
Related: [[reference_wizard_decided_list_and_batch_resume]]
