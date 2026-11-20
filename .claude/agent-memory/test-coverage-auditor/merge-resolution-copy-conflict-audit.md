---
name: merge-resolution-copy-conflict-audit
description: How to audit a hand-resolved merge where two PRs reworded the same copy: diff each parent's removed expects, grep for stale strings across unit, E2E and support helpers
metadata:
  type: feedback
---

When a merge keeps one side's wording, diff the merge against the OTHER parent (`git diff <merge>^2 <merge> -- file | grep '^-'`) and check every removed `expect` has a same-meaning replacement, not just a reword. Then grep the whole of `apps/web` (playwright specs, `playwright/support/*`, unit tests, print sheet) for the losing wording; test titles and comments keep the old short form and are harmless, assertions and accessible names ("Pulled ..., not in X") are not.

**Why:** copy rewordings change toggle accessible names and table names that support helpers locate by.
**How to apply:** also ask for a planted-break proof for a CSS-only wrap fix (revert the class, confirm the no-clip/within-region assert goes red at the config width), since no assert names the class.
