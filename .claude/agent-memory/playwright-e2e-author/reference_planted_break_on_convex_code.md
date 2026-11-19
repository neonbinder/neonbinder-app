---
name: reference_planted_break_on_convex_code
description: How to plant a deliberate break in convex/ code and push it to the worktree's own deployment without touching the shared worktree (linked-worktree copy named like the ticket)
metadata:
  type: reference
---

Planting a break in product code inside the shared ticket worktree risks it being committed
by the coordinator or picked up by another builder. Plant it in a scratch copy instead.

- Client code (components/, lib/): serve a `git archive HEAD apps/web` snapshot with Vite
  (`hmr: false`, `preserveSymlinks: true`, its own `cacheDir`, node_modules symlinked), plant
  there, restart Vite, run the specs from the worktree against that port.
- Convex code: the deployment script picks its target from the checkout's directory name, so
  a scratch copy must be a linked worktree named like the ticket (`git worktree add --detach
  <scratch>/<ticket>` off a scratch repo, then `git archive HEAD apps/web` into it, committed
  there so it can be restored). Run the script from the copy's apps/web: it pushes the copy's
  convex/ to the ticket's own deployment. Restore with `git checkout -- .` and push again.
- Re-seed when the covering spec is fresh-only ([[pattern_adopting_specs_need_reseed_for_planted_break]]).
- The deployment script can be edited by another session while it runs (bash reads scripts
  lazily): run a frozen copy from the scratchpad, with any sibling helper it calls.
- A break may go red in no E2E: then say so and name the unit test that catches it (run it
  with the break planted, e.g. `npx vitest run <file>` in the copy).
- UI-review screenshots without touching the repo: copy the spec into a scratch dir with absolute
  imports, add a `{"type":"module"}` package.json there (the support files use `import.meta`), and
  a scratch config that spreads the repo config with `testDir`/`testMatch`/`outputDir` overridden.
  Shoot both themes with `page.emulateMedia({ colorScheme })` (the app follows the OS by default).
