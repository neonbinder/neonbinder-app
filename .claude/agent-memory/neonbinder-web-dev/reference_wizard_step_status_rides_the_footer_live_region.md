---
name: wizard-step-status-rides-the-footer-live-region
description: A post-review wizard step's own status words (checking, failed, why Next is held) go through the wizard's always-mounted footer role=status, not a status inside the step; the step only renders the Retry control
metadata:
  type: reference
---

A step that mounts and unmounts (the career step shows only when it has lines, or is checking, or failed) cannot own a live region: a role="status" that mounts with its text is announced unreliably. Compute the words in `EntityReviewWizard` (`careerLine` ahead of `footerLine`) so they swap inside the one footer `<p role="status">` that is mounted for the whole dialog; the step keeps only controls (Retry).

**Why:** NEO-574 audit A4. **How to apply:** any new step with a "working / failed / blocked because" message.

Related traps found in the same pass: `toLines` must sort on stable card data (printed team text), never a name that loads later, or lines jump; a test that indexes `LINES[0]` breaks when you add a sort — find by playerId. A Retry that finds nothing missing removes the step, and the walk's own screen-focus effect lands on the next screen's primary control (Confirm & Save), so do not also focus Next.
