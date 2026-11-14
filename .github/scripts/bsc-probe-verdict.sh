#!/usr/bin/env bash
# NEO-552: the verdict on a BuySportsCards probe, pulled out of the workflows
# so it can be tested. Pure: files in, one `outcome=<x>` line on stdout, exit 0
# only when the outcome is `ok`.
#
# Usage: bsc-probe-verdict.sh <real|fake> <health.json> <probe.json> [probe_http_status]
#
# health.json  = the browser service's GET /health body; must say
#                bscTarget == <expect> (a service that talks to the wrong BSC
#                is a failure even when the probe itself looks fine).
# probe.json   = the body of POST /probe/bsc (contract: services/fake-bsc/
#                CONTRACT.md, "Probe"): { bscTarget, outcome, signIn.ok,
#                catalogue.{ok,status}, parser.ok, shapes }.
#
# Outcomes: ok | skipped_paused | signin_failed | bsc_unavailable |
#           catalogue_non_2xx | parser_rejected | wrong_target | health_unreadable |
#           probe_unreadable | probe_call_failed | inconsistent_probe |
#           unknown_outcome
set -uo pipefail

expect="${1:?usage: bsc-probe-verdict.sh <real|fake> <health.json> <probe.json> [http_status]}"
health="${2:?health.json}"
probe="${3:?probe.json}"
status="${4:-200}"

case "$expect" in real|fake) ;; *) echo "::error::expect must be real or fake, got '$expect'" >&2; echo "outcome=wrong_target"; exit 1 ;; esac

emit() { # outcome, message
  echo "outcome=$1"
  case "$1" in
    ok) exit 0 ;;
    # The operator paused BSC (NEONBINDER_PAUSED_PLATFORMS): the service made
    # no BSC call. A pass with a warning, never a silent one.
    skipped_paused) echo "::warning::BSC probe ($expect): skipped, BSC is paused - $2" >&2; exit 0 ;;
    *) echo "::error::BSC probe ($expect): $1 - $2" >&2; exit 1 ;;
  esac
}

jq -e 'type == "object"' "$health" >/dev/null 2>&1 || emit health_unreadable "/health did not return a JSON object"
target=$(jq -r '.bscTarget // ""' "$health")
[ "$target" = "$expect" ] || emit wrong_target "/health says bscTarget='$target', expected '$expect'"

[ "$status" = "200" ] || emit probe_call_failed "POST /probe/bsc answered HTTP $status"
jq -e 'type == "object"' "$probe" >/dev/null 2>&1 || emit probe_unreadable "/probe/bsc did not return a JSON object"
ptarget=$(jq -r '.bscTarget // ""' "$probe")
[ "$ptarget" = "$expect" ] || emit wrong_target "/probe/bsc says bscTarget='$ptarget', expected '$expect'"

outcome=$(jq -r '.outcome // ""' "$probe")
case "$outcome" in
  ok)
    # Belt and braces: an "ok" must be backed by every leg of the probe.
    jq -e '.signIn.ok == true and .catalogue.ok == true and ((.catalogue.status // 0) >= 200 and (.catalogue.status // 0) < 300) and .parser.ok == true' "$probe" >/dev/null 2>&1 \
      || emit inconsistent_probe "outcome is ok but signIn, catalogue or parser is not"
    emit ok ""
    ;;
  skipped_paused|signin_failed|bsc_unavailable|catalogue_non_2xx|parser_rejected)
    emit "$outcome" "$(jq -r '.detail // "no detail"' "$probe" | head -c 300)"
    ;;
  *) emit unknown_outcome "outcome='$outcome'" ;;
esac
