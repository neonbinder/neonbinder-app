---
name: counter-removal-port-loses-close-path
description: Porting specs off a removed header counter can quietly drop the only live click of a sibling control; and sport/set default PRs often prove only the checklist-only birth path live
metadata:
  type: feedback
---

When a UI counter is removed and ~20 specs are ported, diff old vs new for the OTHER controls the old assertion sat next to (e.g. a walker "Close (Esc)" click replaced by Skip -> "Done (Esc)"): the mid-walk close can lose its only live proof. Also check ported "exactly one decision" claims for a conditional branch (`if summary visible ... else readBack`) that weakens the count claim on the last row.

**Why:** the port replaces assertions mechanically; the control click is incidental to the old step and is dropped with it.

**How to apply:** grep removed lines for button names, confirm each survives in some spec or a unit test. For "default stamps X" features, check the live spec covers every birth path the code stamps on (BSC-answer path needs a recorded fixture; a checklist-only hand-made set cannot reach it) and the rule-8 hold (listing names a team).
