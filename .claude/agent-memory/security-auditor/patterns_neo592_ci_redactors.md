---
name: neo592-ci-redactors
description: Public CI text scrubbing (NEO-592) - now ONE rule list (redact.mjs, CI via redact-cli.mjs); trace each public path to it, redact before any slice, and the residual gaps of the secret-pair rule
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

**Resolved in the delta (one redactor):** `redact-ci-log.sh` is now a wrapper over
`redact-cli.mjs` -> `playwright/support/redact.mjs`, with a shared corpus tested
both ways; `retry-summary.sh` redacts each TSV cell in full, then cuts. Fail-closed
pattern that holds: buffer all input, write nothing on error; shell callers drop
the artifact on non-zero (`PIPESTATUS[1]`, or `if ... > "$OUT.safe"`).

Residual shapes the secret-pair rule misses (feed these on the next audit):
- an escaped quote inside a quoted value (`"password":"a\"b"` keeps `\"b`);
- an unquoted number (`{"apiKey":12345}`);
- `name:value` with no space (deliberate, keeps `auth:getSession`), so
  `secret:abc`, `x-api-key:VAL`, and URL userinfo on a dotless host
  (`postgres://u:pw@localhost`) pass; userinfo on a dotted host is caught only by
  the email rule as a side effect.

Playwright screenshots (and ARIA-snapshots `pages()[0]`) every page of a context
created during a red test when that context closes (`willCloseBrowserContext`), even
one a fixture opened from `browser`. Blanking each page first is the guard; a
blank that times out falls through, so `page.close()` each page before
`context.close()` is the fail-closed form.

**Delta 964ac91e (escaped quotes + bare numbers):** the new value alternatives
`(?:[^"\\]|\\.)+` are linear (disjoint first chars; 100k-char `\"` / `\\` runs
scrub in ~1 ms). What still passes: a value nested one escape level deeper
(`\"password\":\"ab\\\"cd\"` keeps `cd`), a negative number (`"apiKey":-1`).
Pre-existing, not from this rule: STORAGE_HOST / EMAIL / *_HOST / SECRET_PAIR
are quadratic on one unbroken `[\w.-]` run (~1 s per 20k chars) - a slowdown on
a giant base64url blob, never a leak. The latency probe slices `error` to 120
chars at write time, so `--summary` redacts after the cut (truncated host
survives); the summary also skips REDACT_LITERALS. Planner's no-retry check
detects tags only as `"@tag"` (double-quoted), same as the list check.
