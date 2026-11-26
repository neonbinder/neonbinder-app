---
name: neonbutton-secondary-radio-states
description: NeonButton secondary (blue) outline/filled as radio choices - contrast pairs, disabled behaviour, hover-equals-selected quirk (NEO-574 CareerCheckStep)
metadata:
  type: reference
---

NeonButton `secondary` as `role="radio"` choices (unselected `outline`, selected filled + a hidden check glyph):

- Contrast (hand-computed from theme.css tokens): filled = `--on-neon-blue` #000 on #00c2ff is about 10.2:1 in both modes (the fill is the same in light); outline text `--neon-blue-text` is #00c2ff on the dark ground (above 8:1) and #006da6 on white (about 5.6:1). Hover fills the outline button with the same blue and black ink, so it passes too. Any text child that inherits the button ink (no per-line colour class) passes on every state.
- Hover on an unselected outline choice looks the same as the selected fill. The check glyph is the only remaining cue; acceptable, but note it if a third visual cue is ever wanted. This is a design-system trait, not a per-site fix.
- `aria-disabled` works with NeonButton: it reads `props["aria-disabled"]` and applies the disabled paint inline, which outranks the stylesheet hover rule. The click is NOT blocked by NeonButton or Radix, so the call site's own `if (disabled) return` guard in onClick and onKeyDown is what blocks activation. Check that guard exists on every radio handler.
- A disabled picked choice turns grey (`--button-neutral` with `--ink-3`), a disabled unpicked one is the outline at 50% opacity: the two stay apart by fill and the check glyph. Disabled controls are exempt from 1.4.3 and 1.4.11.
- Target size: Radix size 2 is about 32px high, so 2.5.8 passes. A multi-line row needs `h-auto whitespace-normal` (Tailwind utilities outrank the Radix layer). Focus uses the shared `focus-outline` utility (2px `--focus`, offset 2px), which NeonButton adds itself.
