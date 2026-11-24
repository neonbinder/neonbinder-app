---
name: describedby-on-activedescendant-options-neo616
description: Moving an option's second line from its name to aria-describedby (aria-hidden target) in the StaticColumn combobox/listbox; what it costs, and measured ink-2 ratios on row/pick fills
metadata:
  type: project
---

StaticColumn (app/collection/prototypes/p1) is a combobox with aria-activedescendant over a listbox of `<button role="option">`; DOM focus never moves to the option. A description moved out of the name via aria-describedby on such an option is the least reliably announced thing in that pattern: several SR/browser pairs read only name+role+state on an activedescendant change, and an aria-hidden target is also absent from the browse-mode buffer. Before accepting "move X from name to description" on an activedescendant option, ask whether X is information (then keep it in the name or give it a spoken equivalent) or decoration.

Raw "/5" and "1/1" read badly ("slash five", "one one", sometimes a date). Prefer a spoken string ("numbered to 5", "one of one") from one helper beside printRunLabel.

Measured (oklch to sRGB, WCAG formula), `text-ink-2` as DESCRIPTION_TONE:
- dark: on `row` 6.94, `row-hover` 5.09, pick-pink 6.53, pick-blue 7.01, pick-green 6.11, pick-purple 7.37, pick-orange 6.34, pick-teal 6.37. Keyboard-highlight tint (`neon-green/20` over `raised`, #00d558 assumed) about 4.32: marginal, the row a keyboard user is looking at.
- light (ink-2 #322b48): row white 13.34, row-hover 11.92, pick-* fills 10.9 to 12.1.
