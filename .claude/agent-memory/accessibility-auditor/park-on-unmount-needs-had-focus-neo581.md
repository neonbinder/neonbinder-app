---
name: park-on-unmount-needs-had-focus-neo581
description: "activeElement === body" is not proof focus was dropped by an unmount; on page load or a silent recount it is body anyway. Gate the park on the control having held focus.
metadata:
  type: feedback
---

A park effect that fires when a control unmounts and checks only `document.activeElement === document.body` also fires when the unmount is NOT user-caused (reload, silent background recount): focus was body all along, so the park steals the sequential-focus start and speaks the container's name unprompted (NEO-581, ParallelBuildPanel door).

**Why:** the house guard (body-only) was written for unmounts the operator caused (Stop, a save).

**How to apply:** when the unmount can come from a non-interaction trigger, also require evidence the control held focus (focus-within ref via onFocusCapture/onBlurCapture ignoring blurs with a relatedTarget, or "the door was busy/dialog closed" this run). Related: a dialog closed with no save whose recount then removes the control leaves no visible or spoken reason; say one plain line. See [[focus-park-pattern]].
