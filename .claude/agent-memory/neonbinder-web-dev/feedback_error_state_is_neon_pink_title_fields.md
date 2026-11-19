---
name: feedback-error-state-is-neon-pink-title-fields
description: Jason (NEO-606) wants the too-long title error in neon pink text plus a whole-box aria-invalid highlight, overriding DESIGN.md's "never pink for errors"; shared OVER_FIELD_CLASS in TitleLengthMeter.tsx
metadata:
  type: feedback
---

The too-long title/variation state is neon pink (`text-neon-pink-text`) on the counter, the note AND the field (`OVER_FIELD_CLASS` + `{...overFieldProps(over)}` in `components/SetSelector/TitleLengthMeter.tsx`: `data-[over=true]:` border + ring-1 + `bg-neon-pink/10`, keyed on LENGTH not aria-invalid so a refused save keeps its own look; advisory variation fields get the box but no aria-invalid). The old `text-notice-danger-ink` rendered as salmon (dark `oklch(88.5% 0.062 18)`).

**Why:** Jason, NEO-606: "This error needs to be louder... highlight the whole text box" and "our error state color is the neon pink." DESIGN.md was updated to match (Show-Sign Pink, notice, Error and Don't lines); ~35 other files still use notice-danger-ink for inline errors and are Jason's call to sweep; only the title/variation states moved.

**How to apply:** for a new over-cap/too-long field reuse `OVER_FIELD_CLASS` + `overFieldProps`, `aria-describedby` to the note (aria-invalid only if the field blocks a save); don't re-add notice-danger there. Do not sweep other inline errors to pink without Jason (DESIGN.md update is his call). Contrast measured: dark pink-text 4.55:1 on `raised` (tightest; fails on `row`/chip surfaces per TEXT_NEVER_ON), light 5.92:1. happy-dom runs no CSS, so tests assert the `aria-invalid:` class strings plus the attribute.

**Held precedence (verified in built CSS):** `aria-disabled:bg-button-neutral` and the tint are both 0,2,0 and the tint is emitted later, so the tint wins unless the stacked `aria-disabled:data-[over=true]:bg-button-neutral` (0,3,0) is present. Pink text contrast: 4.55 raised / 5.53 field (dark), 5.92 white / 5.58 surface (light); tint 5.09 dark / 5.17 light.
