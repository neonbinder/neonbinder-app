---
name: patterns-neo627-inert-path-skip
description: Path allow-list that skips E2E (also on merge_group) — file names echoed into GITHUB_OUTPUT inject keys; merge_group base_sha stacking; what the fail-fast mobile skip can and cannot do
metadata:
  type: project
---

Review rules from NEO-627 (`e2e-scope.sh` sets `e2e_inert`; the gate accepts `e2e=skipped` on it, merge_group included).

**1. Never echo a changed-file name into `$GITHUB_OUTPUT`.** A `reason=... '${f}' ...` line with a name containing `\n` writes extra `key=value` lines after the real `e2e_inert=false`; the runner keeps the last value per key. Git permits newlines in names, and `git diff -z` hands them over intact. The pull_request path was safe (it rejected `@json` escapes before echoing); the merge_group path, which is the one guarding main, skipped that check. Test: build a temp repo with such a name, stub `gh`, run the script, `cat -vet` the output. The house pattern (the deps step in pr-pipeline.yml) is a single assignment at the end so duplicate keys are never relied on. Grep any new scope script for `$f`/`$name` inside `emit`/`printf ... >> $GITHUB_OUTPUT`.

**2. "Queued-ahead PRs included" in a merge_group diff of `base_sha..head_sha` is a claim about GitHub's base_sha, not a guarantee.** base_sha is documented as the group's parent commit; with build concurrency above 1 that is likely the previous entry's group commit, so the diff covers only this PR. Safety then rests on the ruleset's `grouping_strategy: ALLGREEN` (each entry must pass its own checks). Under HEADGREEN, a docs PR behind a code PR would merge the code on a skipped E2E. Read the ruleset (`gh api repos/<r>/rulesets/<id>`) and say which it is.

**3. Fail-fast job conditions.** Skipping a later pass on `needs.X.result == 'success'` cannot turn a red green as long as the always() gate still requires every pass's jobs to be `success` (a `skipped` mobile shard fails it). Check the gate's "skipped because upstream red" branch exits 1, and that a skip with a green upstream lands in a failing branch, not a pass.

Related: [[patterns-merge-queue-cheap-full-split]], [[patterns-cross-workflow-preview-wait]].

**4. Delta (fix shape that held).** Screen every name (control chars, `"`, `\`) on BOTH paths before matching; print only a sanitised (`LC_ALL=C tr -c '[:print:]' '?'`) first offender; write the verdict key once, last. merge_group: diff from `git merge-base HEAD origin/<base_ref>` (fetch depth N), not base_sha; a stacked code PR ahead then shows up. AND the verdict with dorny path filters in `changes` and again in the gate: dorny's own merge_group diff uses base_sha (same stacking blind spot), which is harmless because it only narrows a second check behind the merge-base one. A shallow merge-base is either the true base or none (both windows are segments of one linear main), but "older base = larger diff" is false in general: an older base hides a PR that reverts a main change.

**5. Watcher-side inference (pr-watch).** When a watcher infers "skipped by design" from job states, check whether the inference touches the VERDICT or only the status line. Here it is display-only: GREEN still keys on the required gate check's own conclusion, MERGED on GitHub's state. A later edit that lets the inferred skip feed the verdict would turn a watcher into a second gate; flag it. Also check that a path filter added on main (e.g. a skill dir added to `scripts`) narrows the allow-list via the ANDed filter check, so the docs claiming "all of `.claude/**`" drift.
