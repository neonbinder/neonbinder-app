---
name: reference_error_ink_is_neon_pink_text_alias
description: notice-danger-ink is an alias of neon-pink-text (one pink for errors), so it inherits that role's TEXT_NEVER_ON bars; an error inside a dark row/chip tile goes on a bg-field well
metadata:
  type: reference
---

Errors are neon pink (NEO-606). `--notice-danger-ink: var(--neon-pink-text)` in both modes, mirrored as `"var(--neon-pink-text)"` in tokens.ts (tokenHex resolves one `var()` hop), with the same `TEXT_NEVER_ON` entries as `neon-pink-text`. A paler "error step" was tried and rejected: one pink, nothing new.

**Why:** the owner wants the established neon pink for errors; a lighter ink read as a different colour.

**How to apply:** the class-string scan in tokens.test.tsx only sees a text role and a bg role in the SAME string, so an error span inside a `bg-row` ancestor slips through; check ancestors by hand (NEO-606 found two, in CardPairingModal's tile) and put the message on `rounded bg-field px-1.5 py-0.5`. A `color-mix(.. 30%, transparent)` banner ground composites as `0.3*tint + 0.7*backdrop`; keep the dark tint dark (oklch(30% 0.11 354)) so #ff40a3 stays >= 4.5:1 on it over `raised`. Playwright `expectNoOverCapLook` reads only the field's border-top-color, and Input paints no error border, so an equal ink does not blur it. Screenshot via a scratch HTML that inlines theme.css with `data-theme` on two divs. See [[reference_static_markup_visual_check]].
