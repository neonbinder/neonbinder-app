#!/usr/bin/env bash
# Mask private infrastructure details in a log stream before it becomes a
# public CI artifact (the repo is public, so artifacts are world-readable).
#
#   redact-ci-log.sh < raw.jsonl > safe.jsonl
#
# The rules live in ONE place, apps/web/playwright/support/redact.mjs (the same
# scrubber the Playwright suite uses); this script only runs it through
# redact-cli.mjs. Masks object-store hosts and bucket names, account ids, Convex /
# Vercel / Cloud Run hosts and deployment ids, URL queries, bearer tokens, JWTs,
# secret-named pairs, emails, long opaque runs, and any literal in REDACT_LITERALS
# (newline separated, 4+ chars), e.g. this run's own Convex preview deployment
# name. Function names, timings and review_gate_timing lines are untouched, and a
# line that was valid JSON stays valid JSON.
#
# Fails closed: without node it exits 127; if the redactor fails it exits non-zero
# with nothing written. The caller must then drop the artifact (or summary) rather
# than publish an unredacted one.
set -uo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "redact-ci-log: node not found; refusing to pass the stream through" >&2
  exit 127
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REDACT_LITERALS="${REDACT_LITERALS:-}" exec node "$here/redact-cli.mjs"
