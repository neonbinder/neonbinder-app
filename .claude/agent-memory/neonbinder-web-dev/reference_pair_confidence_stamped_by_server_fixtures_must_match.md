---
name: pair-confidence-stamped-by-server-fixtures-must-match
description: A client fixture for a "clean" Match Cards pair must carry the confidence the server really stamps for its pairedBy — number-only and label-only variation pairs are below 1, so they never skip the dialog
metadata:
  type: reference
---

`matchCardsNeeded` reads the `confidence` the server stamped, not `pairedBy`. Since NEO-640 only `stored`, `crossRef` and a same-roster `name` pair can be 1; a number-only pair (`NAMES_UNCONFIRMED_FACTOR`) and a label-only variation pair (`VARIATION_LABEL_CONFIDENCE`) are 0.9. A skip-path fixture built as `pairedBy: "number"` or `"variation"` at `confidence: 1` is a batch the server can no longer produce: use `"name"`, `"stored"` or `"crossRef"` for a clean pair, and import the constants in a test that wants the realistic below-1 stamp.

The core (`lib/cards/pair-names-first.ts`) is shared with the checklist matcher, which reads confidence only off name and near-name pairs, so lowering a number pair there leaves checklist links alone — pin that with a no-`confidence` assertion on the match.
