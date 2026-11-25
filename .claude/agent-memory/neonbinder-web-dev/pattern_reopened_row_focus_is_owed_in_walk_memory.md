---
name: pattern-reopened-row-focus-is-owed-in-walk-memory
description: When an action unmounts the pressed button and re-opens a different row (Edit on a ruled-out name), owe the focus in the walk's memory BEFORE the write and let the row that mounts take it
metadata:
  type: feedback
---

Edit on a "Not a player/team" row clears the answer; the card then lists the name as waiting and a different component (the question row) mounts where the ruled-out row was. The ruled-out row cannot focus it, and the walk's lost-focus repair would send focus to the first control of the first pink tile (maybe another name).

**Why:** the Convex mutation promise can resolve after React has already rendered the new card, so setting the owing after `await` can miss the mount.

**How to apply:** `memory.oweFocus(...)` before `write.run`, cancel it with `takeFocusOwed` if the write fails; the re-opened row calls `useReopenedFocus` (mount effect, one rAF later than the observer repair, `focusWithoutOpening` on its first control). A screen-reader sentence for an answer whose tile unmounts goes through `useAnswered()(message)` into the walk's always-mounted sr-only status line, never the tile's own region.
