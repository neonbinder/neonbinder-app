---
name: one-redactor-shared-corpus
description: CI and Playwright share one JS redactor (redact.mjs) behind a shell wrapper; summaries redact in full before cutting; pair-rule pitfalls
metadata:
  type: feedback
---

Public CI text (artifacts, step summaries) goes through ONE scrubber, `apps/web/playwright/support/redact.mjs`; `.github/scripts/redact-ci-log.sh` is a node wrapper (`redact-cli.mjs`), fail-closed (127 without node, buffered output, non-zero exit writes nothing). A shared corpus JSON is asserted by both the node:test suite and vitest.

**Why:** two scrubbers (perl + JS) drifted and each missed what the other caught.

**How to apply:**
- Redact the FULL text, then cut; cutting first leaves half an email/host that no rule matches.
- Rules must skip their own markers (idempotent) and never emit quotes/backslashes (JSON lines stay valid); exclude `\` from value classes so escaped-JSON `\"` survives.
- Secret-pair rule: `name:value` with no space is NOT matched (Convex function ids look like `auth:getSession`); `name=value` and `name: value` are. Run Bearer/pair before the JWT rule, with a marker lookahead, or you get `[removed] removed]`.
- jq `@tsv` keeps newlines as the two chars `\n`; `read` with a tab IFS merges empty fields, so format table rows in node, not bash.
- Playwright JSON report: annotations live on both `tests[].annotations` (last attempt only) and `results[].annotations`; read both or a retried test hides an earlier attempt's annotation.
