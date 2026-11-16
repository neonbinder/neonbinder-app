#!/usr/bin/env bash
# NEO-555: the verdict on an eBay probe (POST /probe/ebay), pulled out of the
# workflows so it can be tested. Pure: a file in, one `outcome=<x>` line on
# stdout, exit 0 unless the outcome is a failure.
#
# Usage: ebay-probe-verdict.sh <real|fake> <probe.json> [probe_http_status]
#
# probe.json = the body of POST /probe/ebay (services/browser/README.md,
# "POST /probe/ebay"): { ebayTarget, outcome, appLeg, accountLeg, shapes, ... }.
#
# Outcomes and exit codes:
#   ok               0
#   account_warning  0, with a ::warning:: (the seller's own account leg is not
#                    a gate: not connected, refresh refused, eBay having a day)
#   skipped_paused   0, with a ::warning:: (an operator paused eBay; no call made)
#   app_failed       1  (the client_credentials grant or the app-token read broke)
#   wrong_target     1  (ebayTarget is not the lane's: a prod revision that
#                        reaches the fake, or a preview that reaches real eBay)
#   rate_limited     1  (HTTP 429 after ebay-probe.sh's bounded retries)
#   probe_call_failed, probe_unreadable, inconsistent_probe, unknown_outcome  1
set -uo pipefail

expect="${1:?usage: ebay-probe-verdict.sh <real|fake> <probe.json> [http_status]}"
probe="${2:?probe.json}"
status="${3:-200}"

case "$expect" in real|fake) ;; *) echo "::error::expect must be real or fake, got '$expect'" >&2; echo "outcome=wrong_target"; exit 1 ;; esac

emit() { # outcome, message
  echo "outcome=$1"
  case "$1" in
    ok) exit 0 ;;
    account_warning|skipped_paused) echo "::warning::eBay probe ($expect): $1 - $2" >&2; exit 0 ;;
    *) echo "::error::eBay probe ($expect): $1 - $2" >&2; exit 1 ;;
  esac
}

[ "$status" != "429" ] || emit rate_limited "POST /probe/ebay answered 429 (one call a minute per instance) and stayed 429 through the retries"
[ "$status" = "200" ] || emit probe_call_failed "POST /probe/ebay answered HTTP $status"
jq -e 'type == "object"' "$probe" >/dev/null 2>&1 || emit probe_unreadable "/probe/ebay did not return a JSON object"
target=$(jq -r '.ebayTarget // ""' "$probe")
[ "$target" = "$expect" ] || emit wrong_target "/probe/ebay says ebayTarget='$target', expected '$expect'"

outcome=$(jq -r '.outcome // ""' "$probe")
# N4: only the outcome enums are printed. `detail` text is free-form service
# output and stays out of logs, summaries and artifacts. A leg outcome that is
# not a plain enum word is shown as "unrecognised".
leg() { jq -r "(.$1.outcome // \"unknown\") | if test(\"^[a-z_]{1,40}\$\") then . else \"unrecognised\" end" "$probe"; }
case "$outcome" in
  ok)
    jq -e '.appLeg.ok == true' "$probe" >/dev/null 2>&1 \
      || emit inconsistent_probe "outcome is ok but the app leg is not"
    emit ok ""
    ;;
  account_warning)
    # The app leg must still be sound, or this is really an app failure.
    jq -e '.appLeg.ok == true' "$probe" >/dev/null 2>&1 \
      || emit inconsistent_probe "outcome is account_warning but the app leg is not ok"
    emit account_warning "account leg: $(leg accountLeg)"
    ;;
  skipped_paused) emit skipped_paused "eBay is paused (NEONBINDER_PAUSED_PLATFORMS), so no call was made" ;;
  app_failed) emit app_failed "app leg: $(leg appLeg)" ;;
  *) emit unknown_outcome "outcome='$outcome'" ;;
esac
