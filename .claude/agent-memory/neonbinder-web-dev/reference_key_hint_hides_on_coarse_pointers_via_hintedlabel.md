---
name: key-hint-hides-on-coarse-pointers-via-hintedlabel
description: Bracketed key hints ("Save & next (Enter)") go through components/SetSelector/HintedLabel, which sr-onlys the bracket on pointer:coarse; a button with a visible label must drop its aria-label (label-in-name) and spec/test lookups follow the visible words
metadata:
  type: reference
---

A label that ends in "(Esc)" / "(Enter)" is rendered by `HintedLabel`: the bracket sits in a `[@media(pointer:coarse)]:sr-only` span, so it leaves the screen on touch but stays in the accessible name and `textContent` (tests and specs still find the button by the whole string). Do not use `hidden`, it would change the name.

When a button's visible text is dynamic (Fetch from Marketplaces / Fetching... / Saving... / Refresh) and an `aria-label` hid it, dropping the label moves every lookup to the visible words; tests then use one regex constant, and non-test code that found it by aria-label (the drill's terminal-focus rule) matches on textContent from a shared pure constants module, never a copy of the string.

**Why:** WCAG 2.5.3 label in name (NEO-645 collector pass).
**How to apply:** new keyed buttons use `HintedLabel`; a visible-label/aria-label mismatch is fixed by dropping the label, then grep playwright/support for the old name and list old -> new for the E2E author.
