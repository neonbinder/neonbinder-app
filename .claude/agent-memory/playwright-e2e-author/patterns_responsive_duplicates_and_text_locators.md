---
name: patterns_responsive_duplicates_and_text_locators
description: Locator traps - CSS-hidden twins, dual-layout rows and card-face text, regex-escaping run-time names, ariaSnapshot name reads, placeholder overlap, phone shell tabs
metadata:
  type: pattern
---

A responsive screen often renders BOTH a phone variant (`sm:hidden`) and a wide variant (`max-sm:hidden`)
of one thing. Role locators (`getByRole`) skip the `display: none` copy, but `getByText` matches the DOM
text of both, so `getByText(/^\+\d+ more$/)` is a strict-mode violation on the Boards cards (two
elements: "+14 more" and "+11 more").

**Why:** NEO-464 `demo-board-needs-open-cards` failed on mobile only, from the text locator.

**How to apply:** for text that exists in two responsive copies use
`getByText(...).filter({ visible: true })` (Playwright 1.51+, installed 1.63), or prefer a role
locator. A spec for such a block can share one flow for both projects and branch on `isMobile` only for
the layout facts (chip count, `boundingBox()` >= 44 px, no `list` on the wide line); the click-open-panel,
Next card and Back-with-focus-return steps stay common.

Also: a panel opened by a dashboard card link shows its position as a status line ("Card 6 of 15, <title>"),
so match `getByText(new RegExp(`^Card 6 of ${n}\\b`))`, never `exact: true`.

## Dual layout rows and card face text

Seen on the NEO-500 Pick List (`support/pick-list.ts`), and likely anywhere a
collection table hides columns with `max-md:hidden` and adds a `md:hidden`
"Card" cell for phones:

- **Every row's text exists twice in the DOM**, one copy display:none. `getByText`
  counts hidden elements, so strict mode trips. Wrap it in
  `locator.filter({ visible: true })` (the `seen()` helper). `getByRole` already
  skips hidden nodes, so a cell located by role needs no filter.
- **`CardFace` thumbnails print the player and set name as text** inside the
  "Bigger picture of …" button, so `row.getByText("Mike Trout")` hits the
  thumbnail as well. Scope by cell name instead: `row.getByRole("cell", { name: /^(#27 )?Mike Trout/ })`
  (wide Player column or the phone's Card cell). The same goes for a dialog
  that shows a big CardFace: assert its `img` by accessible name, not the subtitle text.
- **A `role="status"` with `empty:hidden` is NOT in the tree while empty**, so
  `toHaveText("")` waits forever on "element not found". Assert `toBeHidden()`
  and pair it with a positive assert (GUIDE R2).
- Phone vs wide differences there (column sort buttons vs a "Sort by" select,
  filters under "More filters", row click vs check-box tap) belong in the
  support helper behind `isMobile`, so specs stay single-path.

Related: [[patterns_negative_asserts_pass_on_a_dead_page]], [[patterns_responsive_duplicates_and_text_locators]].

## Runtime names need regex escaping

A run-time name that carries `(`, `)`, `+`, `?`, `.`, `|`, `[`, `]`, `^` or `*`
(marketplace labels carry all of these, e.g. "Topps Stars (Bronze)") silently
breaks the moment it is interpolated into a REGEX locator: `new RegExp(name)` makes
a capture group and matches nothing.

In Playwright prefer the form that needs no escaping:
- `getByText(name, { exact: true })` / `getByRole("option", { name, exact: true })`
  take the string literally;
- to combine with other text, build the regex from an escaped string:
  `new RegExp(\`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\`)`;
- a substring match (the default for a string) is already literal, but remember
  the substring trap: a name that prefixes another also matches it (GUIDE
  "Locators: names, substrings and scope").

A name read with `textContent()` goes into inputs raw (`fill(name)`) and into
locators as a string, never as an unescaped pattern. When reading from a list,
pair the read with the same row's own button so the two agree by construction.

## Read a row name with aria snapshot

To use "the first ordinary row" of a seeded list, locate it with a role + name
regex (`getByRole("button", { name: /^Details for #\S+ .../ }).first()`), then
read the accessible name from `await loc.ariaSnapshot()` (`- button "Details
for #12 First Last"`) and rebuild exact names from it.

**Why:** the name is the perceivable handle; `getAttribute("aria-label")`,
`evaluate` and ids are the under-the-covers hooks the hard rule bans.

**How to apply:** collection/checklist rows whose label embeds the card; then
use `{ name, exact: true }` for every later locator (a bare name is a substring
and "Edit X, Raw" is inside "Edit X, Raw, Near Mint x2"). Scope a search hit's
row by its number span, player span and a sub-line regex, since parallels of the
same card repeat number and player.

## Test value must not overlap placeholder

When a spec writes a value into a text field and later proves it persisted (or
was cleared), choose a value that shares NO substring with the field's
placeholder.

**Why:** the old driver read an EMPTY input's text as its placeholder, and
NEO-291's Card prefix row had placeholder `e.g. DK-` while the plan's test value
was `DK-`, so a "value is gone" negative would have FAILED on the placeholder of
a correctly-cleared field. Playwright separates the two (`toHaveValue` reads the
value, `getByPlaceholder` finds by placeholder), but a text-based check
(`getByText`, a regex over the container) can still match the placeholder, and a
value that overlaps it muddies both the failure message and any text assertion
nearby. Written with `CPX-` instead, the persisted and cleared states are
decisive under either reading.

**How to apply:** before writing a value into any text control, read its
placeholder in the component; make the sentinel and the value under test disjoint
from it. Assert state with `toHaveValue("CPX-")` / `toHaveValue("")` on the
labelled field, never with a text match on the container.

## Shell tabs phone menu

The shell's nav (`navigation "Main"`) is `hidden lg:flex`; below lg the same links are in the `dialog "Menu"` behind the header's "Open menu" button. A bare `page.getByRole("link", { name: "Back to the tour" })` therefore passes on desktop and fails on `e2e-mobile`.

**Why:** found porting the NEO-464 demo specs; the shared helper `goViaShell(page, isMobile, name)` in `support/collection.ts` already does the branch (it also takes "Back to the tour").

**How to apply:** drive shell tabs through `goViaShell`. To assert `aria-current` on a phone, open the Menu, assert, close with Escape. Closing the Menu hands focus to its toggle, so read any focus assertion BEFORE opening it. Demo tab URLs put `side=` / `tab=` after `&` (`/demo/inventory?side=inventory&tab=cards`), so match `[?&]tab=`; a `[?]tab=` regex fails, and inside a `not.toHaveURL` it passes vacuously.
