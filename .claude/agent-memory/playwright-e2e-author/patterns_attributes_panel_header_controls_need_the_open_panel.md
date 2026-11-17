---
name: patterns_attributes_panel_header_controls_need_the_open_panel
description: NEO-569 - the shut Set attributes panel draws only its title and toggle; Rename/Delete/Base tag/breadcrumb/Set actions need openAttributesPanel first
metadata:
  type: reference
---

Since NEO-569 a COLLAPSED "Set attributes panel" region draws only its heading
`Attributes for <value> (<Level>)` and the `Edit attributes` toggle. Everything
else in its header comes back only when it is open: `Rename <value>` (or the
Unknown brand's refused pencil), the `Base set` tag, `Delete <value>`, the
` › ` breadcrumb, and the `Set actions` group (Move to another brand, Make
parallel of…, Make insert of…, Promote to set). The team livery and the
"No Team" summary on the shut bar are gone entirely.

Open state: `setName` rows open by default unless the operator closed that set
earlier in the tab session (sessionStorage); EVERY other level (sport, year,
brand, variant type, insert, parallel) starts shut, cards or not
(`SetSelector` always passes `defaultCollapsed`).

**How to apply:**
- Call `openAttributesPanel(page)` (support/set-builder.ts) before any header
  control, at any level; it is idempotent. Put it inside rename/delete helpers.
- Gate on the new row's heading first when the selection just moved, or the
  open can land on the previous row's panel (the state settles per row).
- A `toBeHidden` on a Set action is vacuous on a shut panel: open it and
  anchor on `Rename <value>` (drawn only open) before the absence (R2).
- "No Team still in force" is read on the reopened Team row
  (`No Team for new cards here`, pressed), not on the shut bar.
- Hunt for misses by grepping specs for `Rename ${`, `Delete ${`/`"Delete `,
  ` › `, `Titled Base`, and the Set action labels; `custom-card-crud`'s
  `Delete Base` (an insert row with a card) is an easy one to miss.

Related: [[patterns_set_league_and_card_league_specs]].
