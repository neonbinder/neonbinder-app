---
name: patterns-actions-cache-scope-and-vitest-blobs
description: Actions cache ref scoping (PR vs merge_group vs main), composite-action pitfalls, vitest blob/shard artifacts
metadata:
  type: reference
---

- A cache is readable only from the ref that saved it plus the default branch. pull_request runs write `refs/pull/N/merge`, merge_group runs write their own `gh-readonly-queue/...` ref (verifiable with `gh api repos/.../actions/caches`, the `ref` field). So the only cache every run can hit cold is the one saved from main: warm it from a main-only workflow (workflow_run after Release + weekly). Never put secrets in that job.
- Composite actions: `defaults.run.working-directory` of the caller is not something to rely on; give each `run` step an explicit `working-directory: ${{ github.workspace }}/...` and `shell:`. `ImageOS` is a runner env var, not an expression context; read it in a shell step and emit it as a step output for cache keys.
- `actions/cache/restore` + `/save` (same SHA as the combined action) lets a miss save immediately so later jobs of the same run hit. Concurrent savers of one key just warn.
- `upload-artifact` skips dot-directories unless `include-hidden-files: true`. Vitest 5 writes blob reports to `.vitest/blob/blob-<i>-<n>.json` (not `.vitest-reports`), and `vitest --merge-reports` reads that dir by default.
- Jobs of a reusable workflow show up in the caller run's jobs API as `<caller job> / <job name>`; a matrix job without `name:` is `id (value, value)`. A job skipped by `if:` may not be counted like its matrix expansion, so wait-for-jobs counts are only safe when the awaited jobs share the waiter's `if:`.
- `sed -i` needs `''` on macOS.
