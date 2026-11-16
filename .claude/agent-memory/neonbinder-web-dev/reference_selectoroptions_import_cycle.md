---
name: reference-selectoroptions-import-cycle
description: a convex module that players.ts (or anything listingTitleContext.ts loads) imports must not statically reach selectorOptions.ts, or selectorOptions loads mid-cycle and its validators read undefined ("Cannot read properties of undefined (reading 'asOptional')")
metadata:
  type: reference
---

`selectorOptions.ts` reads `titleContextValidator` from `listingTitleContext.ts` at module load (`v.optional(titleContextValidator)`). `listingTitleContext.ts` imports `players.ts`. So any module `players.ts` imports that statically imports `selectorOptions.ts` (directly or through e.g. `storedCardTitle.ts`) closes a cycle: whichever test file loads `listingTitleContext` first sees `selectorOptions` evaluate while the validator is still undefined, and the whole file fails at import with `TypeError: Cannot read properties of undefined (reading 'asOptional')` from `convex/values` `v.optional`. Order-dependent: the module's own tests pass and an unrelated file (NEO-528: `commitCardChecklist.listingShortName.test.ts`) goes red, so only the full `npm run test:unit` shows it.

**How to apply:** when a writer module gains a dependency on title/description helpers, import the helper from its leaf home (`findAncestorLabels` lives in `listingShortName.ts` since NEO-528, re-exported by `selectorOptions.ts`), never from `selectorOptions.ts`. If a failure like the above appears, trace the new edge from the module that `players.ts` imports. Same class as [[reference-placeholder-module-cycle-tdz]].
