---
name: patterns_collection_checklist_total_and_drawer
description: Collection specs - checklist total and drawer, hidden empty levels, binder flake mechanisms, binder page names and async radio
metadata:
  type: pattern
---

Collection checklist total ("Have 0 of T"):
- T is the row's stored non-variation count (`nonVariationCardCount`), read by `collection.variantCompletion`; the cascade's Base option shows the same number from `collectionCatalog.drill` as "N cards".
- The checklist LISTS every card including photo variations (their Details name ends `, <x> variation`), and its count status reads `N cards` for ALL of them. So T = listed - variation rows, not listed.
- A missing stored count is invisible on screen while the hand tally fits its budget (4000 cards): the fallback is the same computation, so equality assertions catch a stale or swapped count, never "missing". A count the server cannot tally reads "N owned" (total 0), which breaks any `Have 0 of` read.
- Nothing owned yet means one `Details for ...` button per card, so `toHaveCount(listed)` proves the list finished rendering before a count is taken.

Card drawer (`Overlay` drawer variant):
- `detail=<cardId>` is pushed on open (Back closes it, the checklist stays); `mode=add` only from a row's "Add another <short name>" button, which passes no list, so that route has NO "Card i of n" status. Open with Details to assert the status.
- Width: `w-full max-w-[95vw]` under 640px, `sm:w-[40rem]` above. Phone = ~95% of the viewport; desktop 1024 = ~62%.
- The dialog's accessible name comes from the h2's aria-label (the card's full label), not its visible text.

See also [[patterns_responsive_duplicates_and_text_locators]].

## Hidden empty levels need app created rows

The collector's Checklists cascade hides a level whose stored subtree card count is exactly 0. Reference-bundle rows carry NO subtree count (unknown, always shown), so a bundle row can never prove the hide. Rows the app creates are born at 0 and are the fixture: drill a per-worker hand-made set in the set builder, look for it in `/collection` > Checklists > Sets (absent), add a card (present), delete it (absent again).

**Why:** an absence assert on a not-yet-loaded column passes vacuously (R2).
**How to apply:** first assert a real sibling in the same listbox is visible (Topps Chrome under Baseball > 2024 > Topps), then `toHaveCount(0)` on the hand-made option; the same locator turning visible after the card proves it was the filter.

## Collection binders flake mechanisms

Three things seen on the binders specs, each with a named mechanism:

1. **Undo shows "Undone." before its write lands.** A split's new line carries a placeholder id until the server answers; the drawer's open Move panel is keyed on the line id, so the panel vanishes (desktop: form never visible; phone: Move button detached mid-click). Move/notice writes post their status AFTER the write, Undo posts it BEFORE, so the status is not a settle signal there. A product fix (post it after the write) is the right one; do not add a wait.
2. **The pinned pack tray scrolls the page on mouse focus.** `MyBindersTab` `onFocus` -> `keepClearOfTray` scrolls by tray height plus 16 px when the focused control sits under the tray, with no keyboard-only guard. Playwright's mousedown focuses a spine low on the page, the page jumps, mouseup lands elsewhere and no click fires: the Want List spine "click" opens nothing. Tell-tale: the trace's click box and the final screenshot differ by exactly the tray height plus 16. Dismissing the notice does not help (the hunt strip is the tray).
3. **Hunt hits include parallels.** Searching "<player> <number>" lists the base card and its parallels ("..., Orioles, Gold Wave Refractors"), so a `^Slot in ... #N Player` prefix regex is a strict-mode violation. Match the base card with `, [^,]+$` after the player.

Also: a card the collector has marked Have sits under "Everything else I own" (My Cards with binders on) as list "Off the board, N cards" and a status "N card(s)"; Have does not make a set a build.

**How to apply:** reproduce an intermittent red in a loop inside one scratch spec (delete it after) and read the trace's click box against the final screenshot before suspecting timing. A local seed needs the reference bundle (`e2e-seed-reset.sh` with `NB_REFERENCE_BUNDLE`) or `setup.spec` fails at the Years pause notice.

## Patterns binder page names and async radio

Four handles on the binder screens, each of which cost a red run:

- **A binder page's group name is not always `Page N`.** The owner's back page is
  `Page 2, A fresh page` until a card lands on it; a sorted page is
  `Page 1, <section>`. Match `^Page N(,|$)`. An exact `Page 2` reads as "the
  page never turned", and the page had turned. Read the snapshot's `group` line
  and the status line before believing the key did nothing.
- **Page 1 draws before the binder's cards are in.** A PageDown pressed then
  clamps to the only page and is spent. A Next button's click auto-waits for
  enabled and a key press does not, so assert the Next button `toBeEnabled()`
  first. That is a real precondition (there is a page to turn to), not a settle wait.
- **`check()` fails on a controlled radio moved by an async save.** "Clicking the
  checkbox did not change its state" means the radio moved after the write
  landed, not that it refused. "Where I put them" writes the sorted order down
  first. Use `click()` and then a web-first `toBeChecked()`.
- **An image really loaded:** `await expect(img).not.toHaveJSProperty("naturalWidth", 0)`.
  It retries on the 7 s budget and needs no `evaluate`.

A red run leaves its copies on the account, and the first ordinary Base row then
drops out of `ordinaryBaseRows` or changes its form. Re-run `bootstrap` after every
red before reading anything into the next run of a collection spec.

Related: [[patterns_collection_checklist_total_and_drawer]]
