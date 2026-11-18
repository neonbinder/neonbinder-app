---
name: feedback-error-state-is-neon-pink-title-fields
description: Jason (NEO-606) wants the too-long title error in neon pink text plus a whole-box aria-invalid highlight, overriding DESIGN.md's "never pink for errors"; shared OVER_FIELD_CLASS in TitleLengthMeter.tsx
metadata:
  type: feedback
---

The too-long title/variation state is neon pink (`text-neon-pink-text`) on the counter, the note AND the field (`OVER_FIELD_CLASS` in `components/SetSelector/TitleLengthMeter.tsx`: `aria-invalid:` border + ring-1 + `bg-neon-pink/10`). The old `text-notice-danger-ink` rendered as salmon (dark `oklch(88.5% 0.062 18)`).

**Why:** Jason, NEO-606: "This error needs to be louder... highlight the whole text box" and "our error state color is the neon pink." DESIGN.md was updated to match (Show-Sign Pink, notice, Error and Don't lines); ~35 other files still use notice-danger-ink for inline errors and are Jason's call to sweep; only the title/variation states moved.

**How to apply:** for a new over-cap/too-long field reuse `OVER_FIELD_CLASS` + set `aria-invalid` + `aria-describedby` to the note; don't re-add notice-danger there. Do not sweep other inline errors to pink without Jason (DESIGN.md update is his call). Contrast measured: dark pink-text 4.55:1 on `raised` (tightest; fails on `row`/chip surfaces per TEXT_NEVER_ON), light 5.92:1. happy-dom runs no CSS, so tests assert the `aria-invalid:` class strings plus the attribute.
