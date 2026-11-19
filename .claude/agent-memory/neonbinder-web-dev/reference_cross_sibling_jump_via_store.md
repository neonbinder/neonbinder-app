---
name: reference-cross-sibling-jump-via-store
description: How a control inside the attention walker takes the operator to a field in the sibling SetAttributesPanel — a tiny external store of targets and closers, door rendered only while a target exists
metadata:
  type: reference
---

`components/SetSelector/set-name-in-titles-jump.ts` (NEO-535). The walker (in
CardChecklist) and SetAttributesPanel are siblings under SetSelector, and the
fixer contract (`AttentionFixerProps`) is locked, so neither props nor context
reach. Pattern:

- the destination registers a TARGET while it can serve (a null-rendering child
  component calling the hook, so the panel's hooks stay above its early return);
- each modal in front registers a CLOSER;
- the door renders only while `useSyncExternalStore` says a target exists, so it
  is never a dead end (operator-copy rule: reachable and actionable);
- the target expands, then focuses ONE FRAME LATE (rAF): the walker's unmount
  cleanup restores focus to its opener first and would win otherwise. Find the
  field by `data-feat-key`, never a DOM id.

In-view move, so no URL/history entry. Tests: RTL cleanup unmounts targets, so
the module store does not leak between tests.
