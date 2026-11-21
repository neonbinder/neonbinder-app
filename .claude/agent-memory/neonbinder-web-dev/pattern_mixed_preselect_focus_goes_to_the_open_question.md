---
name: pattern-mixed-preselect-focus-goes-to-the-open-question
description: When a panel preselects some answers but leaves one open, focus goes to the open question's own control (by ref, not first button) and the heading names both facts
metadata:
  type: feedback
---

A panel that preselects part of an answer and leaves another part open (one
player's team ticked, another player tied between two) must not focus Save or
say "Enter accepts": one Enter would save the ticked part and silently skip
the open one. Focus the open question's FIRST control that is not already
ticked, found through a ref map keyed by the item id, never
`querySelector("button")` (the first button may belong to another list, e.g. a
listing's era chips rendered above). The heading names both facts ("some
players have more than one team that season. Pick theirs; the others are
ticked."). Accessibility audit on NEO-639 (MissingTeamFixer) raised it.

**Why:** "focus follows what the copy promises" is the house rule for
keyboard-first panels; a mixed state breaks both halves at once.

**How to apply:** whenever a preselect rule is per-item (per player, per
line), check the mixed case explicitly: some items answered, some open.
Test it with the answered item's control FIRST in DOM order so a lazy
first-button focus fails. Set-level facts a locked fixer contract cannot
carry go through `AttentionSetContext` (walker prop, then CardChecklist).
Related: [[disambiguate-duplicate-aria-labels-by-rewording]].
