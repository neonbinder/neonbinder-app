---
name: convex-new-module-gotchas
description: Three traps when adding a Convex module or cross-module helper in apps/web (api.d.ts, playerIds pin, import cycles)
metadata:
  type: feedback
---

- `convex/_generated/api.d.ts` is committed. A new module (or new `lib/` file imported through `internal.*`) needs a hand-registered entry or `npm run typecheck` says the property does not exist on `internal`.
- `cardChecklist.playerLinksPin.test.ts` greps source for `playerIds:` and wants `playerLinks` nearby. Name any other args list `ids` (not `playerIds`) in internal queries and their call sites.
- When two Convex modules would import each other (`players.ts` and a new reads module), put the shared DB-reading helpers in `convex/lib/<name>Facts.ts` and import that from both.
- If `pdfjs-dist` is missing from a worktree's node_modules, `read-pdf-lines.test.ts` fails, `npm run build` fails on the import, and `verify-test-completeness` reports `success=false`. Environment, not the change.
