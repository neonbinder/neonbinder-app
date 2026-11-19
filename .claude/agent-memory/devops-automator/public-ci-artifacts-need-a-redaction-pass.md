---
name: public-ci-artifacts-need-a-redaction-pass
description: CI artifacts and step summaries on this public repo are world-readable; what leaks and where the redaction helpers live
metadata:
  type: feedback
---

Artifacts, run logs and `$GITHUB_STEP_SUMMARY` are public on this repo. Filtered Convex logs still carry deployment slugs (in `"deployment"` fields of structured `msg` lines) and storage hosts/bucket names inside error text; Playwright blob/JSON reports carry git author name and email (config-side `captureGitInfo`, not a workflow env).

**Why:** a jq keep-filter drops chatter but not values inside kept lines.

**How to apply:** pipe any log destined for upload through `.github/scripts/redact-ci-log.sh` (perl; pass this run's deployment name via `REDACT_LITERALS`, drop the artifact if the pass fails). Never `::add-mask::` a value that is also a job output: GitHub drops masked values from outputs. Don't echo deployment names in steps or summaries at all.
