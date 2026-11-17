#!/usr/bin/env bash
# NEO-555: POST /probe/ebay on a browser service or tagged revision, then judge
# the answer with ebay-probe-verdict.sh. Shared by browser.yml (preview, fake),
# browser-deploy.yml (prod lane, real) and bsc-drift.yml (live prod, real).
#
# Usage: ebay-probe.sh <real|fake>
#
# Env:
#   TARGET_URL            browser service or tagged revision URL (no trailing /)
#   PROBE_ID_TOKEN        Google ID token whose audience is the BASE service URL
#   OUT_DIR               where probe.json lands (default $RUNNER_TEMP/ebay-probe)
#   PROBE_TIMEOUT_S       per-call budget (default 120)
#   EBAY_PROBE_RETRIES    extra attempts after a 429 (default 2, max 3)
#   EBAY_FAKE_REFRESH_TOKEN  fake mode only: a refresh token minted by the fake
#                         (ebay-fake-token.sh); without it the account leg skips
#
# real: NO body and NO credential leaves CI; the service uses the account its
#   own env names. fake: the body is {} or {refreshToken} (a fake token).
#
# One-call-a-minute limit: the service answers a second probe within 60 s of
# the first (per instance) with 429 + Retry-After. This script waits the
# advertised time (capped at 65 s) and retries, at most EBAY_PROBE_RETRIES
# times, so a deploy gate and a drift run that land on one instance still both
# get an answer. A 429 that outlasts the retries is the `rate_limited` failure.
#
# Writes `outcome=<x>` to $GITHUB_OUTPUT when set. Exit 0 unless the verdict fails.
set -uo pipefail

expect="${1:?usage: ebay-probe.sh <real|fake>}"
: "${TARGET_URL:?TARGET_URL}"
: "${PROBE_ID_TOKEN:?PROBE_ID_TOKEN}"
TARGET_URL="${TARGET_URL%/}"
out="${OUT_DIR:-${RUNNER_TEMP:-/tmp}/ebay-probe}"
timeout_s="${PROBE_TIMEOUT_S:-120}"
retries="${EBAY_PROBE_RETRIES:-2}"
case "$retries" in 0|1|2|3) ;; *) retries=2 ;; esac
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$out"
rm -f "$out/probe.json" "$out/headers.txt"

echo "::add-mask::${PROBE_ID_TOKEN}"

if [ "$expect" = "fake" ] && [ -n "${EBAY_FAKE_REFRESH_TOKEN:-}" ]; then
  echo "::add-mask::${EBAY_FAKE_REFRESH_TOKEN}"
  body=$(jq -cn --arg t "$EBAY_FAKE_REFRESH_TOKEN" '{refreshToken: $t}')
else
  body='{}'
fi

status=000
attempt=0
while :; do
  status=$(curl -sS --max-time "$timeout_s" -o "$out/probe.json" -D "$out/headers.txt" -w '%{http_code}' \
    -X POST -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${PROBE_ID_TOKEN}" \
    -d "$body" "${TARGET_URL}/probe/ebay" 2>/dev/null || echo 000)
  [ "$status" = "429" ] && [ "$attempt" -lt "$retries" ] || break
  wait_s=$(awk 'tolower($1)=="retry-after:" {gsub(/\r/,"",$2); print $2}' "$out/headers.txt" 2>/dev/null | tail -n1)
  case "$wait_s" in ''|*[!0-9]*) wait_s=61 ;; esac
  [ "$wait_s" -le 65 ] || wait_s=65
  [ "$wait_s" -ge 1 ] || wait_s=1
  attempt=$((attempt + 1))
  echo "eBay probe answered 429; waiting ${wait_s}s (retry ${attempt}/${retries})"
  sleep "$wait_s"
done

result=$(bash "$here/ebay-probe-verdict.sh" "$expect" "$out/probe.json" "$status")
rc=$?
echo "$result"
[ -z "${GITHUB_OUTPUT:-}" ] || echo "$result" | grep '^outcome=' >> "$GITHUB_OUTPUT"
exit $rc
