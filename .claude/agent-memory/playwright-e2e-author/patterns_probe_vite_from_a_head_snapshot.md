---
name: probe-vite-from-a-head-snapshot
description: When parallel builders edit the worktree, a dev Vite on it HMR-reloads main.tsx mid-run (double createRoot, "multiple ClerkProvider", blank page); serve a git-archive HEAD snapshot with hmr off instead
metadata:
  type: patterns
---

Signature (NEO-496): a spec red on its first LAUNCH_GATE wait with a pure black
failure PNG, no page snapshot in `error-context.md`, the trace's console showing
"createRoot() on a container that has already been passed to createRoot()" then
"You've added multiple <ClerkProvider> components", and the Vite log showing
`hmr update` lines for files you did not touch. Another agent's edit propagated
HMR up to `src/main.tsx`. Environment, not product, not timing.

Fix for a probe or spec run while other builders work in the same worktree:
- `git archive HEAD apps/web | tar -x -C <scratchpad>/snap`; symlink the
  worktree's `node_modules` and `.env.local` into it (never copy the env file).
- In the SNAPSHOT's `vite.config.ts` only: add `hmr: false` to the existing
  `server` block (not a second `server:` key, the later one wins) and a
  `cacheDir` in the scratchpad so the dep cache does not fight another Vite.
- Also add `preserveSymlinks: true` to the snapshot's `resolve` block. Without
  it the symlinked `node_modules` resolves to `/@fs/<worktree>/node_modules/...`,
  outside the snapshot root, and a `?url` asset import (pdf.js's worker in
  `lib/checklists/read-pdf-lines.ts`) comes back as the raw file instead of a
  URL string: "Invalid `workerSrc` type", which the app reports as "Couldn't
  read <file> as a PDF". Snapshot artifact, not product: the worktree's own
  Vite serves it fine. Clear the snapshot's cacheDir after changing resolve.
- Run Vite and Playwright from the snapshot (`--output` into the scratchpad); a
  throwaway probe spec can live in the snapshot's `playwright/tests/`, so the
  worktree stays untouched.
- Delete the snapshot and every `--output` folder afterwards (traces hold Clerk
  testing tokens).

It serves HEAD, not the builders' uncommitted code: right for probing today's
product, wrong for testing their change.

Planted breaks in the snapshot (prove-it-can-fail runs): seed and run setup
with CLEAN code first, then plant, restart Vite (hmr is off) and run only the
specs. A break on a shared path (a throw in Match Cards' checklist branch) also
reds `setup.spec.ts`, and then nothing tests the spec. Restore with
`git -C <snapshot> checkout -- apps/web/components` and check that `status`
lists only `vite.config.ts`. A spec's `finally` cleanup shows in the failure PNG
(the screenshot comes after `finally`), which proves cleanup-on-red for free.

Related: [[local-vite-serves-one-worktree]]

NEO-639: `e2e-run run` refuses a snapshot Vite on its port ("in use by a process that is
not this worktree's Vite"). With the snapshot up on the ticket port, `e2e-run seed` still
works (reset + setup + bootstrap go through it; with NO Vite up its setup reds), then run
the spec with `npx playwright test --project=e2e|e2e-mobile --no-deps --retries=0 --output
<scratchpad>` from the worktree, `.env.local` sourced, `APP_URL`/`WORKER_INDEX`/`PAUSED_PLATFORMS`
set. Signature that sent us there: a sibling builder editing-and-reverting product files
(`git status` clean on them, mtimes seconds old) made "Could not Fast Refresh" invalidations
remount CardChecklist mid-spec, dropping the uploaded checklist chip before Sync.
