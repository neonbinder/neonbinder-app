---
name: nested-confirmdialog-leaks-escape-and-tab
description: ConfirmDialog raised inside another hand-rolled dialog lets Escape and Tab bubble to the outer dialog's handlers; and a control mounted off a live count must stay mounted while its own dialog is busy
metadata:
  type: reference
---

`components/modules/confirm-dialog.tsx` handles Escape (onCancel) and wraps Tab
only at its ends, but never stops propagation. Raised inside another
non-portalled dialog (e.g. a fixer inside `CardAttentionWalker`), Escape then
also reaches the outer dialog's onKeyDown (the walker closes) and a mid-list
Tab reaches the outer trap. Wrap it: `<div onKeyDown={e => { if (e.key ===
"Escape" || e.key === "Tab") e.stopPropagation(); }}><ConfirmDialog …/></div>`.
Its cancel button is always named "Cancel" (see [[confirmdialog-owns-the-word-cancel]]).

Related trap (NEO-535 checklist "Fix card titles" door): a button rendered only
while a live subscription count is > 0 gets torn out — with its open dialog —
the moment its own save drops the count to 0 (Convex reflects the write before
the mutation's await resolves). Have the control report `onActiveChange` and
mount on `count > 0 || active`; keep its last status line in an always-mounted
host `role=status`, and park focus (pill, else that line as a `tabIndex={-1}`
park) when it finally leaves. Prove it with a test that rerenders the cleared
count while the mutation promise is still pending.

How to apply: any confirm nested in a dialog; any door/pill keyed on a count
its own action changes. See [[count-gated-row-tears-out-its-own-dialog]].
