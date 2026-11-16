---
name: backfill-of-operator-editable-field-is-fill-only-by-default
description: A backfill of a field operators can edit fills only missing values by default; rewriting existing values needs its own explicit flag plus a recorded owner ruling
metadata:
  type: feedback
---

A backfill over a field an operator can edit by hand (e.g. a card's listing
description via updateCard) cannot tell operator text from old generated text.
Default it to fill-only; rewriting existing values must be a separate explicit
argument (e.g. `rewriteExisting: true`), and the module header records who
approved the rewrite and when.

**Why:** the only way back from a silent rewrite of operator-authored data is a
whole-deployment restore (NEO-535 audit).
**How to apply:** check every armed backfill for its default mode and the flag
gating overwrites of existing values.
