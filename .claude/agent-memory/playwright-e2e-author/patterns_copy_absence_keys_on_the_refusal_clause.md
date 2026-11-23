---
name: copy-absence-keys-on-the-refusal-clause
description: A "refusal is gone" toHaveCount(0) on a shared copy phrase goes red when the product adds an allowed-state statement sharing that phrase; key the absence on the refusal-only clause and assert the statement positively
metadata:
  type: feedback
---

When a spec proves a refusal cleared with `getByText(/<phrase>/)).toHaveCount(0)`,
match the clause only the refusal carries (e.g. `/…as an alias, and /`, the
", and <reason>. Remove it there…" tail), never the phrase the refusal shares
with neutral copy. Then assert the neutral statement that remains, exact text.

**Why:** NEO-602 added an informational form line ("<holder> · <era> already
answers to this name as an alias. Give this one years…") that shows in the
allowed state too. The spec's bare-phrase absence check went red although the
product behaved as intended.

**How to apply:** whenever a copy change adds a statement beside a refusal (a
hint, a status line), audit every absence check on that copy in the specs; a
red there is usually the spec, so read error-context to see which paragraph
matched. Related: [[patterns_near_match_absence_proved_by_the_same_locator]].
