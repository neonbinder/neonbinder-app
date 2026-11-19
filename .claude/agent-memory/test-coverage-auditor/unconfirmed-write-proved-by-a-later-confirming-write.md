---
name: unconfirmed-write-proved-by-a-later-confirming-write
description: a UI write that says nothing on success (a switch) can be proven landed by a later write from the same client that does confirm, since one client's mutations apply in order; still needs a reload assert
metadata:
  type: feedback
---

A control whose success is silent (its live line speaks only on failure) has no wait to hang an assert on. A later mutation from the same client that DOES confirm (a "Saved." line) proves the earlier one landed, because one Convex client's mutations apply in order. Valid only when both are mutations (an action breaks the ordering), and only with a reload assert afterwards to prove it persisted.

**Why:** NEO-555 B2 Offers switch then card weight "Saved."; accepted over a sleep.

**How to apply:** accept it when both writes are `useMutation`; ask for the failure alert to be asserted absent after the confirming write and for a reload check. Reject it across an action or two clients.
