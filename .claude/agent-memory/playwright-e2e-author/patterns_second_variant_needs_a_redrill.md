---
name: second-variant-needs-a-redrill
description: openVariant/ensureAndSelect cannot add a SECOND variant while a checklist is open (its marker "Open add card form" is already visible, so the create confirm is skipped); re-drill with drillToCustom({ ...variant })
metadata:
  type: feedback
---

`openVariant(page, type, name)` passes "Open add card form" as the "drill advanced"
marker to `ensureAndSelect`. When a checklist (say Base) is already open, that button
is ALREADY on screen, so `create.or(marker)` passes at once, the "Create insert … ?"
confirm is never pressed, and the helper fails at `Add Custom Entry` toBeHidden
(screenshot shows the confirm still up). Seen on NEO-602's set-history team spec.

**Why:** a readiness marker that is true before the action proves nothing (same family
as [[negative-asserts-pass-on-a-dead-page]]).

**How to apply:** for a spec that needs two variants of one hand-made set, call
`drillToCustom(page, { sport, year, manufacturer, set, variantType, variant })` again for
the second variant (it re-drills from /set-selector, as the two-era siblings do for a
second set), then assert "No cards in this checklist yet.". Use `openVariant` only from
a state with no checklist open.
