---
name: shape-probes-see-one-account-state
description: A shape-drift check that probes a real marketplace with one stored account only ever sees that account's state; fields that exist only in another state (a listed row, a filled order) must be optional in the comparison, and the fake's empty-state answer must match the probe key for key
metadata:
  type: project
---

A drift check compares key paths and types from a real marketplace probe with
what a fake serves. The probe account is fixed (no listings, usually no
orders), so its answers show only the empty state. A fake sample built from a
richer state (one listed row) makes every listed-only key look "dropped".

**Why:** the first daily drift run after the fake BuySportsCards shipped
failed on three seller-sheet keys that real unlisted rows simply do not carry;
the fake's blank row carried them as null or a default (NEO-552 follow-up).

**How to apply:** when planning a synthesised endpoint or its drift check,
split the fake's sample into "every row carries this" (missing from the probe
is drift) and "only some states carry this" (type-checked when the probe has
it, never required). Make the fake's empty-state row omit what the real one
omits. Check the root form too: the probe showed the real answer wrapped in an
object while the fake served a bare array that the parser also accepts, so
specs were proving the branch production never takes.
