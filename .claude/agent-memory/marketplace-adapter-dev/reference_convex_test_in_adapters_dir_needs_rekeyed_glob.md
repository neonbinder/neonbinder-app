---
name: convex-test-in-adapters-dir-needs-rekeyed-glob
description: A convexTest file under convex/adapters/ works if the module glob is re-keyed relative to convex/; otherwise "Could not find module"
metadata:
  type: reference
---

The rule "convexTest tests live at the convex/ root" is only about the glob keys. From `convex/adapters/`, `import.meta.glob("../**/*.*s")` yields `../x` for convex/ files and `./y` for sibling adapters, so convex-test looks up `adapters/sportlots` and fails with "Could not find module". Re-key before passing: `../x` -> `./x`, `./y` -> `./adapters/y` (the loaders are already bound, so this is safe). `vi.mock("../credentials", ...)` then works as at the root.

**How to apply:** a new action-level adapter test can sit beside its adapter instead of needing a root file. Pure ingest points (ESPN list, preprocess `call*` with a stub ctx and a loopback URL, Wikidata `lookup*Live` with a stubbed fetch) need no convexTest at all.
