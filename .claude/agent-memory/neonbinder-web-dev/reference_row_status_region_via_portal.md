---
name: row-status-region-via-portal
description: A per-row always-mounted live region that child panels write into with createPortal, so status text swaps in a region that existed before it spoke (keeps getByText/role=status contracts)
metadata:
  type: reference
---

A status `<p role="status">` that a panel mounts WITH its final text is silent (the region is new). When several panels of one row each have status words (CareerCheckStep: "Looking for players…", the follow-up's "Checking X's career…"), hoist ONE `<p role="status" className="empty:hidden" ref={setStatusEl}>` into the row, share the element through a small context, and have panels render `createPortal(text, statusEl)` (a `RowStatus` component).

- The text node lands directly in the region, so `getByText(...)` still returns the element that has `role="status"` and "the very same element swaps its words" tests keep passing; no second sr-only copy (a duplicate would double Playwright's strict getByText).
- `empty:hidden` hides the empty region in a browser; a string child of "" leaves no node, so `:empty` holds.
- For a repeat of identical words, alternate a trailing NBSP (as `announceChecklist` does).

Also from the same change: a form's "dirty" after a programmatic `load` must be measured from the loaded values (baseline state), not from "non-empty", or the stint the operator is merely looking at reads as unsaved work; an emptied form is never dirty.
