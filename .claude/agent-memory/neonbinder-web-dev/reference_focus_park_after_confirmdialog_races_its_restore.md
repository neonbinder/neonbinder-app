---
name: focus-park-after-confirmdialog-races-its-restore
description: A setTimeout(0) focus park after a ConfirmDialog closes races the dialog's unmount restore (React renders in a macrotask); a disabled focused button drops focus to body — park via a focus-request effect plus a layout effect on the disabled flag
metadata:
  type: reference
---

Seen on NEO-556's SetAttributesPanel Team row (No Team toggle).

1. **`setTimeout(() => el.focus(), 0)` after `setConfirm(null)` is a race.** An update set in a promise callback renders in a Scheduler macrotask, so the timer can fire BEFORE the commit that unmounts the `ConfirmDialog`. The dialog's cleanup then focuses its opener last. If that opener is now disabled, happy-dom blurs to `<body>` (a browser leaves focus where it was, so the bug hides in Chrome and shows in tests, or the reverse). Fix: hold the request in state (`setFocusRequest(r => ({ selector, seq: (r?.seq ?? 0) + 1 }))`) and act on it in a `useEffect`. It commits in the same batch as `setConfirm(null)`, and passive unmount cleanups run before new passive effects, so the request is the last word.
2. **A focused button that becomes `disabled` loses focus** (Chrome's focus fixup; happy-dom too). Busy/in-flight states that disable a row's controls need a `useLayoutEffect` keyed on the disabled flag. When it turns true and `document.activeElement` is a now-disabled button inside the row, focus the row container (`tabIndex={-1}`, labelled group) and remember the button. When the flag turns false and focus is still on the row, hand it back. It must be a layout effect, so it runs before the fixup.
3. A disabled target is a no-op for `focus()`. Any "focus X after a decision" helper checks `.disabled` and falls back to a stable focusable, never to nothing.

Test recipe: make the mocked mutation swap the module-level `currentRow` to the in-flight shape before resolving. The next render then reads it, and you can assert `activeElement` is the group. Re-render without the timestamp and assert focus is back on the toggle.

Related: [[raf-focus-request-clear-by-identity]], [[reference_inert_the_opener_behind_confirmdialog]], [[reference_ref_cleanup_sees_focus_before_removal]].
