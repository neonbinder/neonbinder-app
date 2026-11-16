---
name: patterns_prove_a_theme_by_painted_colour
description: Prove a theme by painted colour; print emulation and rare-state axe
metadata:
  type: pattern
---

Prove a theme mode by what is painted, not `<html data-theme>`: `support/theme.ts`
(`expectLook`, `expectPageLook`) checks the `banner` landmark's `background-color`
(the page colour) and a heading's `color`. `main` is transparent on the signed-in
layout (only the demo paints it), so do not use it.

**Why:** the root attribute has no perceivable handle (no role, no CSS selector, no
evaluate); colours are what the user sees.

**How to apply:**
- After a reload the inline pre-paint script has already set the saved mode, so a colour
  assertion can pass BEFORE React mounts and then flip (a signed-in page re-resolves from
  the profile, which outranks localStorage). Gate on a mounted control first
  (`toBeChecked` on the radio) and prove "saved to the profile" from a second
  `browser.newContext` carrying only the session cookies (`storageState({cookies, origins: []})`)
  built from the `baseURL`/`viewport`/`isMobile`/... fixtures.
- "No flash before mount" has no perceivable handle; it needs the root attribute at
  `waitUntil: "commit"`, so it is a report-to-coordinator gap, not a workaround.
- Signed in with no saved theme resolves to System, so System/emulateMedia steps and axe in
  both modes can run on a backend that lacks the save mutation.
- Mobile hides the app nav behind `Open menu` -> dialog `Menu`; branch on `isMobile`.

## Print emulation and rare state axe

- `page.emulateMedia({ media: "print" })` keeps the project's viewport. On the
  phone project a fixed-layout print table's flexible column has no width, so
  its text is in the tree but `toBeVisible` fails. Branch on `isMobile`: wide
  `toBeVisible`, phone `toHaveCount(1)`. Restore with `{ media: null }` and
  assert the screen table is back. Pair every `toBeHidden` of screen chrome
  with a positive assert on the sheet.
- `th scope="rowgroup"` reads as `rowheader`; count them to pin the dividers.
- Rare states the live data cannot reach (list cut at a cap, a state the test
  hop never makes) get a vitest + `axe-core` run on the real component
  (`axe.run(container, { rules: { "color-contrast": { enabled: false } } })`);
  it cannot check contrast or light/dark, so say so in the file. Prove it can
  fail by planting an `<img src>` with no alt and confirming `image-alt` reds.
- A `setup` project run needs the reference bundle (the seeded catalogue
  carries SportLots ids). A plain `e2e-seed-reset.sh` without the bundle gets
  past the manufacturers step and fails on the Years pause notice; with gcloud
  reauth expired, a signed-in real-set spec cannot run on a fresh deployment.

Related: [[patterns_responsive_duplicates_and_text_locators]].
