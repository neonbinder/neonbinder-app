---
name: reference_stand_down_on_mounted_not_on_phase
description: A page element that stands down because a dialog carries its own copy must key on "dialog actually mounted/open", never on the session phase that precedes the mount
metadata:
  type: reference
---

CardChecklist's `pairingPhase` goes to "review" before the first rows stream in, but `streamedPairing` (null until rows exist) is what mounts `CardPairingModal`. A page-level wait line gated on `pairingPhase !== "review"` left a multi-second window with no "Waiting on BuySportsCards" anywhere (NEO-624). Gate on `pairingPhase === "review" && streamedPairing !== null` (named `pairingDialogOpen`), which equals the modal's `isOpen` AND its render-past-`if (!isOpen) return null`.

Test pattern: start with `state.liveCandidates = null`, assert the page line, then `streamCandidates(rerender, ...)` to mount the dialog and assert the page line is gone at once and the dialog's own appears exactly once after its 1.5 s gate. The handoff has a <=1.5 s gap by design (the dialog's line is a fresh mount with its own gate).
