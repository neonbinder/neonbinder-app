---
name: tokens-scan-reads-state-variants
description: tokens.test.tsx's class-string scan resolves disabled:/aria-disabled:/hover: as states, so a held look of text-ink-3 on bg-button-neutral fails (dark TEXT_NEVER_ON); NeonButton escapes only via inline style
metadata:
  type: reference
---

The "no class string paints text on a surface it fails on" test in
`apps/web/src/theme/tokens.test.tsx` parses every class string in app/,
components/, src/ and lib/ and resolves each STATE variant (hover, focus,
disabled, aria-disabled, aria-selected, …) to the text and bg role the element
ends up with, falling back to the rest-state role. Any pair listed in
`TEXT_NEVER_ON` fails the build of the suite.

Gotcha: DESIGN.md says a disabled button swaps to `button-neutral` + `ink-3`,
but `ink-3` on `button-neutral` is a dark-mode TEXT_NEVER_ON pair. NeonButton
gets away with it because it paints that swap through inline `style`, which the
scan never sees. Copy the swap as Tailwind classes onto a field
(`aria-disabled:bg-button-neutral aria-disabled:text-ink-3`) and the scan goes
red. NEO-535's field off-look (`components/primitives/field-off.ts`) steps the
ink to `ink-2` for that reason, and so the held value stays readable.

**How to apply:** when adding a held/disabled look as classes, check the pair
against `TEXT_NEVER_ON` first; variants like `placeholder:` are NOT states to
the scan (skipped), so they are never flagged. Related: [[runtime-colour-needs-a-per-theme-split]].
