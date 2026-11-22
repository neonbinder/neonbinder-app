---
name: pairing-conflict-pills-are-bare-values
description: NEO-344/NEO-591 — Match Cards conflict choices (marketplace vs checklist too, `· your checklist`) show only the value (`<value> — use this name|these players for <scope>`), so a spec tells the sides apart by reading each half's value off the unmatched COLUMNS before it links; how to assert bare, checked and "no marketplace named"
metadata:
  type: reference
---

Since NEO-344 (2026-10-13) `CardPairingModal`'s name and players conflict
choices never name a marketplace. Each is `role="radio"` in a `radiogroup`
named `Name for <scope>` / `Players for <scope>`, inside a `group` named
`Name conflict on <scope>` / `Players conflict on <scope>`. Accessible name
`<value> — use this name for <scope>` / `<players> — use these players for
<scope>`; visible text is the value, plus an aria-hidden `✓ ` on the checked
one. The typed option is bare too (no `Custom: `). Warnings (inside the group):
`Potential names for this card — pick the right one before it is listed.` /
`Potential players for this card — pick the right ones before it is listed.`
BSC's value stays preselected (Jason). Select by VALUE, never by index.

**NEO-591: one name picker for every name difference.** A marketplace card
against its checklist row (server pair, near-name pair, hand link) gets the
same group/radiogroup/warning. One pill per distinct name, marketplaces first;
the checklist's pill reads `<Name> · your checklist` (accessible name
`<Name> · your checklist — use this name for <scope>`) only when no marketplace
said that name (a shared name is one bare pill, so the count stays 2). The
Matched toggle's `, N with a name conflict` counts these rows. Preselect is the
card's own name; an UNTOUCHED preselect answers nothing, so the card still
gets the pink "Sources disagree" tile on the walk (a spec that wants that tile must not
click a pill). The modal's difference test is `nameKey` (card name vs the row's
players joined " / "), stricter than the server's `playersAgree` (which drops
trailing SP/RC markers and accepts surnames): a pair the server calls agreeing
can still show pills. Before pinning `0` or `N with a name conflict`, compute it:
`checklistMatch(...)` from support plus `nameKey` from `lib/cards/card-name`
over the raw capture players.

**Which value is whose:** read it BEFORE the link, from the unmatched columns,
which still say which side a card is on. The `Select BSC card <label>` and
`Link selected BSC card to <label>` buttons carry `label()` = `#<number>
<name>[ · <variation>]` in their aria-label; strip the verb, the number and
any ` · …` tail to get the value. Read the BSC row before clicking it:
selecting renames it `<label>, selected. Press to deselect.`. SportLots rows
are `disabled` until a BSC row is selected, but their aria-label is readable.

**Asserting:**
- the pill: `getByRole("radio", { name: \`${v} — use this name for ${scope}\`, exact: true })`
  (a runtime value goes in as a string with `exact: true`, never a raw regex:
  [[patterns_responsive_duplicates_and_text_locators]]) plus `toHaveText(/^(✓ )?<escaped v>$/)`
  for the visible half;
- checked: `toBeChecked()` works on the `role="radio"` button
  (aria-checked); also prove it by the row's `Unlink #<n> <value>`, which
  carries the chosen name and is what will be saved;
- no source named: `getByRole("radio", { name: /^(BSC|SportLots|Custom): / })`
  and `getByRole("radio").filter({ hasText: /^(✓ )?(BSC|SportLots|Custom): / })`
  both `toHaveCount(0)`, plus `getByText(/These marketplaces/)` count 0, each
  riding on a positive pill assert ([[patterns_negative_asserts_pass_on_a_dead_page]]);
- scopes prefix each other (`#FS-1` vs `#FS-10`): every group/radiogroup/
  textbox name lookup uses `exact: true`, and a regex on `Edit name for #FS-1 `
  keeps the trailing space.

**Big sets:** the dialog body is not virtualised, so `click()` and
`toBeVisible()` reach any matched row. The committed checklist IS virtualised
and opens at its last row ([[patterns_entity_column_shapes_and_cold_sync]]); since
NEO-343 use the checklist search (`searchbox` "Search cards", status `<n> of
<total> cards`, number terms are PREFIX matches) to reach a saved row instead
of choosing fixture cards by list position. Worked examples:
`checklist-pairing-dialog-cancel` (read-only, #FS-1/#FS-2) and
`checklist-team-leader-cards-pair-and-picked-name-saves` (commits #442).
