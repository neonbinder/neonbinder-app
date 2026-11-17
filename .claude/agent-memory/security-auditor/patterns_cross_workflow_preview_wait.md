---
name: patterns-cross-workflow-preview-wait
description: A pipeline job that waits for a preview another path-filtered workflow builds - gate parity, merge_group scope, SHA-stamp wait, sha source agreement, clearing the stamp on the serving lane
metadata:
  type: project
---

Review rules from NEO-555 (pr-pipeline `wire-browser-url` waiting on browser.yml's `pr-<N>` revision).

**1. The waiter's path gate must be a SUBSET of the builder's merge_group scope filter**, not of its `pull_request.paths`. `paths:` does not apply to merge_group, so the builder's own `scope` job decides there. A waiter wider than the builder waits on a preview that never comes and ejects the PR (CI Gate red). Wider in the other direction is safe (preview built, not wired). A "tests read these files" filter (unit-test gate) is a different set from "builds an image" and needs its own output.

**2. What decides the image is the Docker build context**, not the filter. Check `docker build ... .` cwd: if the context is the service dir, only that dir changes the image, and the subset is complete. A filter that names files outside the context cannot change the image.

**3. Tag-exists waits accept a stale revision.** "URL stops 404ing" is true of the previous push's `pr-<N>` revision on any second full run (Claude-run push, or a `run-e2e` full run followed by enqueue). Preprocess fixed this with a PREVIEW_SHA wait (NEO-484); check whether the browser side has one before calling a wire "proves the PR's code".

**4. Parity tests over YAML without a parser**: verify by mutation on COPIES in the scratchpad (copy test + workflows into a temp `.github/` tree; the test resolves paths from its own location). String-equality subset is conservative (false fail only).

Related: [[patterns-merge-queue-cheap-full-split]], [[feedback-reviewing-a-live-worktree]].

**5. Delta (fix shape).** The SHA the waiter wants and the SHA the builder stamps must come from the same `ci-mode.sh` `sha` output on both sides (pull_request: PR head; merge_group: GITHUB_SHA of the group), each computed by its own workflow's scope job. On pull_request the builder checks out the MERGE ref but stamps the HEAD sha, so a re-run after main moves (same head) accepts the previous build: narrow, shared with preprocess. The two ci-mode calls can disagree on `full` (label or variable read at different moments): that fails closed (wait times out red), never stale.

**6. Clearing a stamp on the serving lane.** deploy-cloudrun `env_vars` defaults to merge (`--update-env-vars`), so a preview's stamp rides the service template into the next main deploy. `--remove-env-vars=KEY` in `flags` is legal beside it (gcloud: only update+remove combine; remove applies first); it would conflict with `env_vars_update_strategy: overwrite` (`--set-env-vars`). Preprocess also asserts `--absent PREVIEW_SHA` after deploy; check a new lane copies that assert or accepts the gap knowingly.
