---
name: radio-pill-that-opens-a-picker
description: House pattern for a radiogroup choice that must open a search or form at once without trapping arrow navigation
metadata:
  type: feedback
---

When picking a radio-pill must open a picker or form immediately (Career check: "Wrong player", "Fix card's team"):

- Arrow keys only pick (ARIA radio pattern) and move focus between pills. They never open the picker, never move focus
  into it, so arrowing across several pills is quiet and cannot fire pickers repeatedly.
- A click (Space is a click), and Enter, pick AND open the picker; the picker takes focus as it mounts. Pressing the
  already-picked pill opens it again, so an arrow-picked pill is one key from its picker. Refuse a held (`repeat`) Enter.
- Keep the old in-panel opener button for the arrow-picked, picker-closed state.
- Escape or Cancel returns focus to whatever opened it: the pill, or the panel button. Track that with a small
  `openedFromPill` state rather than always focusing the button.

**Why:** Jason found a second click to open the picker a chore, but a picker that opens on every arrow press steals focus
from the radiogroup (keyboard trap).

**How to apply:** any radiogroup whose choices reveal a search or an entry form. Test it with a mocked picker that counts
mounts, so "arrows open nothing" is an assertion (mount count stays 0).
