---
name: auto-commit-reason-lines
description: When a review dialog is skipped and the run commits itself, the "why no dialog" sentence must not restate a count the commit result can contradict; check note order and pluralisation on the saved line.
metadata:
  type: feedback
---

When a feature skips an operator dialog and commits on its own (NEO-640 Match Cards skip), review the saved line as one sentence chain, not each piece alone.

- A pre-commit count ("Kept all N cards") appended after the commit's own notes can contradict them ("Saved 328 cards. 2 linked to two cards, not saved. Kept all 330 cards."). The reason sentence should be count-free and say which step was skipped by its visible name.
- Watch word collisions: "(kept)" in an earlier note means something else than "Kept all N".
- Put the reason before the caveats; check n=1 ("Saved 1 cards." was pre-existing).
- Ask whether the skipped evidence is reachable after the commit when no wizard follows (the "Back to …" undo only exists if a wizard step opens).

**Why:** the saved line is the only trace of a step the operator expected and did not see; a contradiction there reads as lost cards.
**How to apply:** any auto-keep / auto-confirm path. Related: [[multi_landing_dialog_copy_follows_the_landing]], [[none-answer-copy-traps]].
