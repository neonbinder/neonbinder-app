---
name: reference_park_focus_before_a_write_that_unmounts_the_button
description: A pick button that unmounts with its picker on success needs focus parked on a tabIndex -1 heading before the write; arm a focus-after ref only until its target exists
metadata:
  type: reference
---

When a save closes the picker that holds the focused button (first pick, no "Change" yet), the mutation resolves AFTER the live query has already unmounted the button, so focus is on `<body>` by then. Park it on the section heading (`tabIndex={-1}`, `focus-outline`) BEFORE awaiting the write, then move it to the control that appears (Change) from an every-commit effect; on failure send it back to the save button.

**How to apply:** the focus-after ref is nulled only when it focused, or when the save has settled and the target never drew (a run started meanwhile) — never on the first commit, or a target that mounts a commit later never gets focus. Don't clear the pick state on success: the picker is unmounting and clearing flashes "Copy from…". A test needs a hand-resolved promise plus a `rerender` with the new plan to model the server moving first. Same section's "always-mounted status" is the visible line itself (`<span role="status">`), not a second copy, so `getByText` stays single.

Related: [[reference_relabelled_primary_slot_needs_a_focus_move]], [[reference_ref_cleanup_sees_focus_before_removal]].
