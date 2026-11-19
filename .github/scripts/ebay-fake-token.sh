#!/usr/bin/env bash
# NEO-555: mint a refresh token on the FAKE eBay so a preview's /probe/ebay can
# run its account leg: POST /__fake/ebay/consent, then the authorization_code
# grant with the fake's fixed PUBLIC client (services/fake-bsc/CONTRACT.md,
# "Tokens (row 14)" and "Consent and seller seeding"). Nothing here is a real
# credential; the token only means something to the fake.
#
# Env:
#   FAKE_URL        the fake's own service URL (vars.NEONBINDER_FAKE_BSC_URL)
#   FAKE_ID_TOKEN   Google ID token, audience = FAKE_URL
#   FAKE_CALLER_KEY the fake's caller key (x-nb-fake-bsc-key)
#   FAKE_NS         namespace (default ebay-probe-ci)
#   OUT_DIR         the refresh token is written to $OUT_DIR/refresh-token (mode 600)
#
# A failed mint FAILS the job (S2): it writes `minted=false` to $GITHUB_OUTPUT,
# prints an ::error:: naming only the step that broke, and exits 1. A broken
# fake consent or token endpoint must not pass green with the account leg
# skipped.
set -uo pipefail

: "${FAKE_URL:?FAKE_URL}"; : "${FAKE_ID_TOKEN:?FAKE_ID_TOKEN}"; : "${FAKE_CALLER_KEY:?FAKE_CALLER_KEY}"
ns="${FAKE_NS:-ebay-probe-ci}"
base="${FAKE_URL%/}"
out="${OUT_DIR:-${RUNNER_TEMP:-/tmp}/ebay-probe}"
mkdir -p "$out"
umask 077
rm -f "$out/refresh-token"

# Public by design: they open nothing but the fake (tokens.ts in the fake).
client_id="NeonBind-FakeEbay-PRD-0fake000-00000000"
client_secret="PRD-0fake0000000-fake-ebay-client-secret"
ru_name="nb-fake-ebay-ru-name"

echo "::add-mask::${FAKE_ID_TOKEN}"; echo "::add-mask::${FAKE_CALLER_KEY}"
giveup() { echo "::error::fake eBay token not minted ($1); check the fake's /__fake/ebay/consent and token endpoints (services/fake-bsc/README.md)"; [ -z "${GITHUB_OUTPUT:-}" ] || echo "minted=false" >> "$GITHUB_OUTPUT"; exit 1; }

hdrs=(-H "X-Serverless-Authorization: Bearer ${FAKE_ID_TOKEN}" -H "x-nb-fake-id-token: ${FAKE_ID_TOKEN}" -H "x-nb-fake-bsc-key: ${FAKE_CALLER_KEY}")

code_body=$(curl -sS --max-time 30 -w '\n%{http_code}' -X POST -H "Content-Type: application/json" "${hdrs[@]}" \
  -d "$(jq -cn --arg ns "$ns" '{ns: $ns}')" "$base/__fake/ebay/consent" 2>/dev/null) || giveup "consent call failed"
[ "$(printf '%s' "$code_body" | tail -n1)" = "200" ] || giveup "consent answered HTTP $(printf '%s' "$code_body" | tail -n1)"
code=$(printf '%s' "$code_body" | sed '$d' | jq -r '.code // empty' 2>/dev/null)
[ -n "$code" ] || giveup "consent returned no code"
echo "::add-mask::$code"

tok=$(curl -sS --max-time 30 -w '\n%{http_code}' -X POST "${hdrs[@]}" \
  -u "${client_id}:${client_secret}" \
  --data-urlencode "grant_type=authorization_code" --data-urlencode "code=${code}" \
  --data-urlencode "redirect_uri=${ru_name}" \
  "$base/ebay/api/identity/v1/oauth2/token" 2>/dev/null) || giveup "code grant call failed"
[ "$(printf '%s' "$tok" | tail -n1)" = "200" ] || giveup "code grant answered HTTP $(printf '%s' "$tok" | tail -n1)"
refresh=$(printf '%s' "$tok" | sed '$d' | jq -r '.refresh_token // empty' 2>/dev/null)
[ -n "$refresh" ] || giveup "code grant returned no refresh token"
echo "::add-mask::$refresh"
printf '%s' "$refresh" > "$out/refresh-token"
[ -z "${GITHUB_OUTPUT:-}" ] || echo "minted=true" >> "$GITHUB_OUTPUT"
echo "minted a fake eBay refresh token for namespace ${ns}"
