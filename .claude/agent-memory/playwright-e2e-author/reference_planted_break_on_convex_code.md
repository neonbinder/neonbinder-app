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
- Convex code: the per-worktree deployment script names the deployment after the git
  toplevel's basename and refuses the main checkout. So make the scratch copy a LINKED
  worktree whose directory has the ticket's name: `git init` a scratch repo (with
  `apps/web/.env.local` symlinked to the main checkout's, which the script reads for team and
  project), `git worktree add --detach <scratch>/<ticket>`, extract `git archive HEAD apps/web`
  into it, commit it there, symlink node_modules, copy the worktree's `.env.local` (mode 600).
  Run the script from `<scratch>/<ticket>/apps/web`: it selects the same deployment and pushes
  the copy's convex/. Restore with `git checkout -- .` in the copy and push again.
- Re-seed when the covering spec is fresh-only ([[pattern_adopting_specs_need_reseed_for_planted_break]]).
- The wrapper script can be edited by another session while it runs (bash reads scripts
  lazily): run a frozen copy from the scratchpad, with any sibling helper it calls.
- A break may go red in no E2E: then say so and name the unit test that catches it (run it
  with the break planted, e.g. `npx vitest run <file>` in the copy).
