---
name: neo592-ci-redactors
description: Public CI text has two scrubbers with different rule sets (redact-ci-log.sh for logs/summaries, playwright/support/redact.mjs for suite output); audit which one each path really runs, and redact before any slice
metadata:
  type: feedback
---

NEO-592 added `.github/scripts/redact-ci-log.sh` (perl: storage hosts, buckets,
hex32, Convex/Vercel/Cloud Run hosts, emails, literal names) and
`apps/web/playwright/support/redact.mjs` (URL queries, JWTs, Bearer/Basic,
secret-named pairs, Convex hosts, emails, long opaque runs). Neither is a
superset of the other.

- **Trace each publishing path to the scrubber it actually runs.** The per-shard
  retried table got redact.mjs (via flaky.json) AND the perl pass; the whole-run
  table read raw `results.json` errors and got only the perl pass, so tokens,
  JWTs, Bearer values and query strings went straight to the public summary.
- **Slice after redacting, never before** (same trap as
  [[patterns_neo475_body_scrubber]]): a 160-char cut made before the regex pass
  leaves `user@domai` and `slug-123.convex.clo`, which no pattern matches.
- **Convex log `error` fields hold raw error objects** (`console.error(msg, err)`
  in credentials/auth/adapters); an undici header error can embed a Bearer value
  ([[patterns_neo278_session_lifetimes]]). A log redactor without Bearer/JWT/query
  rules is not covering the realistic leak.
- Deployment names are hygiene, not a secret boundary: the Convex URL ships in
  every SPA bundle. Rank email/token leaks above slug leaks.
- Grep for every `upload-artifact` and `>> $GITHUB_STEP_SUMMARY` in the workflow;
  side artifacts (latency probe, degraded marker) often skip the new pass.

**How to apply:** feed adversarial lines (email at the cut boundary, a URL with
`__clerk_testing_token=`, `Bearer eyJ...`, `R2_BUCKET=x`, a virtual-hosted R2
URL) through every path with the real scripts before approving.
