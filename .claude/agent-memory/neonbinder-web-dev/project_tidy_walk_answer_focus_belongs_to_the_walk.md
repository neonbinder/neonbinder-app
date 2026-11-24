---
name: tidy-walk-answer-focus-belongs-to-the-walk
description: In the Tidy Up walk a tile never decides where focus goes after an answer; it calls useAnswered() and the walk lands on Save & next or the next pink tile. Opener restore is for Cancel/Esc only.
metadata:
  type: project
---

After a tile ANSWER (link, create, not-a-player, team save, pick between sources, set name applied, autograph press) focus must not return to the control that was pressed: it becomes an answered row's Change or a search opener, and the next Enter undoes the answer. Tiles call `useAnswered()` (tidy/answered.tsx); the walk, a frame later, focuses the first control of the first `[data-tidy-level="fix"]` tile, else Save & next. Cancel and Esc restore the opener.

**Why:** collector walk-through S1 (NEO-645): Enter after an answer re-opened it.
**How to apply:** a new tile or part that writes an answer calls `answered()` only on success; a part that is NOT yet an answer (a chip pick before Save team) focuses its own Save button instead. A walk-level focus effect must skip an editable field the operator is typing in. Related: closing the walk pops its own history entries via `state.tidyDepth` so Back never reopens it.
