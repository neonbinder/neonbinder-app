---
name: host-stored-count-replaced-by-live-count-stales-old-spec
description: When a button/clause switches from a stored snapshot to a live count, the existing live spec that clicks the button after the fix goes stale; grep specs for the old "still there after fix" asserts
metadata:
  type: feedback
---

A change that makes a control disappear once its count hits zero (it used to
persist with its stored label) invalidates every existing spec that asserts
the control is still visible/focused after the fixing save, or re-clicks it for
a "nothing to fix" line. The new-spec author tends to write the happy path
and leave the old assertions.

**How to apply:** grep specs for the button's name regex and for post-save
"toBeFocused/toBeVisible" on it; list each as a stale-spec finding. Also check
the unit file for the stale-read race (newest-count-wins sequence token) and
the in-flight mount count vs a press.
