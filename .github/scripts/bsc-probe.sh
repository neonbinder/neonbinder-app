#!/usr/bin/env bash
# NEO-552: call a browser service's /health and POST /probe/bsc, then judge
# the answers with bsc-probe-verdict.sh. Shared by browser.yml (preview),
# browser-deploy.yml (dev and prod lanes) and bsc-drift.yml.
#
# Usage: bsc-probe.sh <real|fake> [--health-only]
#
# Env:
#   TARGET_URL        browser service or tagged revision URL (no trailing /)
#   PROBE_ID_TOKEN    Google ID token whose audience is the BASE service URL
#   OUT_DIR           where health.json / probe.json land (default $RUNNER_TEMP/bsc-probe)
#   PROBE_TIMEOUT_S   per-call budget (default 120)
#
# fake: the probe signs in with the fake's constant credentials (public by
#   design, they only mean something to the fake). real: NO credentials are
#   sent; the service uses its own stored account in Secret Manager. No BSC
#   credential ever passes through CI.
#
# Writes `outcome=<x>` to $GITHUB_OUTPUT when set. Exit 0 only on `ok`.
set -uo pipefail

expect="${1:?usage: bsc-probe.sh <real|fake> [--health-only]}"
health_only="${2:-}"
: "${TARGET_URL:?TARGET_URL}"
: "${PROBE_ID_TOKEN:?PROBE_ID_TOKEN}"
TARGET_URL="${TARGET_URL%/}"
out="${OUT_DIR:-${RUNNER_TEMP:-/tmp}/bsc-probe}"
timeout_s="${PROBE_TIMEOUT_S:-120}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$out"
rm -f "$out/health.json" "$out/probe.json"

echo "::add-mask::${PROBE_ID_TOKEN}"

curl -sS --max-time 60 -o "$out/health.json" \
  -H "Authorization: Bearer ${PROBE_ID_TOKEN}" "${TARGET_URL}/health" >/dev/null 2>&1 || true

if [ "$health_only" = "--health-only" ]; then
  echo '{}' > "$out/probe.json"
  target=$(jq -r '.bscTarget // ""' "$out/health.json" 2>/dev/null || true)
  if [ "$target" = "$expect" ]; then
    echo "bscTarget=$target"
    [ -z "${GITHUB_OUTPUT:-}" ] || echo "outcome=ok" >> "$GITHUB_OUTPUT"
    exit 0
  fi
  echo "::error::/health says bscTarget='${target}', expected '${expect}'"
  [ -z "${GITHUB_OUTPUT:-}" ] || echo "outcome=wrong_target" >> "$GITHUB_OUTPUT"
  exit 1
fi

if [ "$expect" = "fake" ]; then
  body='{"username":"nb+probe-ci@fake.invalid","password":"fake-bsc-password"}'
else
  body='{}'
fi

status=$(curl -sS --max-time "$timeout_s" -o "$out/probe.json" -w '%{http_code}' \
  -X POST -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${PROBE_ID_TOKEN}" \
  -d "$body" "${TARGET_URL}/probe/bsc" 2>/dev/null || echo 000)

result=$(bash "$here/bsc-probe-verdict.sh" "$expect" "$out/health.json" "$out/probe.json" "$status")
rc=$?
echo "$result"
[ -z "${GITHUB_OUTPUT:-}" ] || echo "$result" | grep '^outcome=' >> "$GITHUB_OUTPUT"
exit $rc
