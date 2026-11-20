---
name: patterns-neo622-local-e2e-runner
description: Local E2E runner guards (NEO-622): a destructive guard keyed on a flag misses phases the planner derives; regex patch parsing is not what git apply writes; case-folding FS beats a deny list
metadata:
  type: project
---

Audit shape for a local tool that wraps seed/reset/push behind target guards
and edits repo files temporarily (`apps/web/playwright/tools/e2e-run.mjs`).

- **A destructive guard keyed on the user's flag (`--fresh`, `seed`) misses
  destructive phases the tool derives itself**: a "both projects" plan that
  always re-seeds before the second pass, or an auto re-seed decided later
  (e.g. "this spec already ran on this seed"). Check the guard is computed from
  the final phase plan, and re-checked at the destructive call site (doSeed).
- **Plant/restore by manifest**: the file list must come from the tool that
  applies the change. A regex over `---/+++` lines misses `copy from/to`,
  empty-file deletes, mode-only changes and `-p1` stripping of a non-`a/` prefix,
  so `git apply` writes files outside the manifest (verified: `.claude/` and
  `.github/` reachable). Use `git apply --numstat -z` / `--summary` on a copy of
  the patch, or diff `git status --porcelain -z` before/after.
- **Path deny lists on macOS**: APFS is case-insensitive, so `.ENV.local` and
  `.Claude/` pass a case-sensitive regex. Prefer an allowlist root, `i` flag,
  realpath containment and an lstat non-symlink check.
- **Restore must check the file is still in the planted state** before writing
  the original bytes, or it clobbers edits a parallel agent made meanwhile
  (see [[feedback_reviewing_a_live_worktree]]). A "status" command should not
  restore.
- **Env merge `{...process.env, ...fileVars}`**: a key absent from the file
  (VITE_CONVEX_URL) falls through from the shell unchecked. Require it in the
  file, anchored, or strip the family from process.env first.
- Convex CLI also loads `.env` (not only `.env.local`); see
  [[patterns-convex-cli-target-selection]].
- `redact.mjs` does not mask an ARIA-snapshot line
  `textbox "Password" [ref=eN]: value` (the `[ref]` breaks SECRET_PAIR).

**How to apply:** any wrapper with "never seeds shared dev / never prod" claims:
enumerate every path that reaches the reset script, not just the flags.
