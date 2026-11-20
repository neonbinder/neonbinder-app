---
name: actions-cache-writer-enumeration
description: Auditing an Actions dependency cache restored into secret-holding jobs: enumerate every default-branch writer (dispatch counts), check workflow_run checkout ref, same-run jobs-API waits
metadata:
  type: reference
---

When a diff caches node_modules / browser binaries (exact key, no restore-keys) and restores them into jobs that hold deploy keys:

- The poisoning question is only "who can write the DEFAULT-branch scope". pull_request (fork, Dependabot, same-repo) writes refs/pull/N/merge; merge_group writes its own gh-readonly-queue ref; neither is readable by main or by other PRs. Fork pull_request runs get no secrets, and their merge_group run restores from main, so a fork cannot reach a secret job through the cache.
- Enumerate default-branch writers by grepping every workflow that uses the caching action AND has `workflow_dispatch`, `schedule`, `push: main` or `workflow_run`: a dispatch on main writes main scope too. Comments that say "only Release writes it" have been wrong (NEO-628: Release did not use the action; pr-pipeline/e2e dispatch did).
- A `workflow_run` warmer is safe only if it checks out the default branch (no `ref: workflow_run.head_sha`), has no secrets, and its `if:` reads event fields only in expressions, not `run:`.
- Residual (accepted): any main-scope `npm ci` runs install scripts with ACTIONS_RUNTIME_TOKEN and can write any main-scope key. Same trust as Release's own install.
- A wait that polls THIS run's attempt-scoped jobs API cannot be forged by forks (unlike cross-run polling, [[ci-cross-run-queue]]). Check: more matches = error, fewer / API error = keep waiting, timeout = fail.
- `upload-artifact` with `include-hidden-files`: the path, not the flag, is the scope. A vitest blob holds task trees, captured console output and absolute module paths, no env; fine when the job has no secrets.
