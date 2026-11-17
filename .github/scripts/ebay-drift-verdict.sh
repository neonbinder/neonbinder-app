#!/usr/bin/env bash
# NEO-555: the daily eBay drift verdict, pulled out of bsc-drift.yml so it can
# be tested. Pure: env in, a markdown summary on stdout, exit 1 on FAIL.
#
# Env:
#   PROD_OUTCOME     outcome of the prod /probe/ebay leg (ebay-probe-verdict.sh vocabulary)
#   DRIFT_OUTCOME    the fake's drift-compare answer: ok | shape_drift | unrecorded pinned key | <error> | "" (not run)
#   DRIFT_PATHS      comma/newline separated "<endpoint> <key.path>" (shape_drift)
#   DRIFT_WARNINGS   comma separated "<endpoint>:<kind>" (hash_mismatch, hash_unrecorded, not_2xx)
#
# Policy (NEO-555):
#   shape_drift                 FAIL, listing the paths
#   hash_mismatch               WARNING annotation, still PASS (sandbox recordings
#                               differ from production's catalogue by nature)
#   unrecorded pinned key       PASS with a warning (recordings not loaded yet)
#   account_warning             PASS with a warning; the comparison still ran
#   skipped_paused              PASS with a note, nothing compared
#   app_failed and any other    FAIL
set -uo pipefail

PROD_OUTCOME="${PROD_OUTCOME:-}"
DRIFT_OUTCOME="${DRIFT_OUTCOME:-}"
DRIFT_PATHS="${DRIFT_PATHS:-}"
DRIFT_WARNINGS="${DRIFT_WARNINGS:-}"

fail=0
echo "### eBay drift check"
echo
echo "- prod probe: \`${PROD_OUTCOME:-<none>}\`"
echo "- fake drift-compare: \`${DRIFT_OUTCOME:-<not run>}\`"

compared() {
  case "$DRIFT_OUTCOME" in
    ok) ;;
    "unrecorded pinned key")
      echo "::warning::ebay-drift: a pinned eBay request has no recording on the fake, so shapes were not fully compared. Run ebay-record to load it."
      echo; echo "**Not fully compared.** A pinned request (shipping services or item aspects) has no recording on the fake."
      ;;
    shape_drift)
      fail=1
      echo; echo "**Shape drift.** The real eBay's response shapes no longer match the fake's. Paths:"; echo
      # shellcheck disable=SC2016  # backticks are markdown, not expansion
      printf '%s\n' "$DRIFT_PATHS" | tr ',' '\n' | sed '/^[[:space:]]*$/d; s/^/- `/; s/$/`/'
      ;;
    "") fail=1; echo; echo "**The drift comparison did not run.**" ;;
    *) fail=1; echo; echo "**The drift comparison failed:** \`$DRIFT_OUTCOME\`." ;;
  esac
  if [ -n "$DRIFT_WARNINGS" ]; then
    echo; echo "Warnings (not failures):"; echo
    printf '%s\n' "$DRIFT_WARNINGS" | tr ',' '\n' | sed '/^[[:space:]]*$/d' | while IFS= read -r w; do
      echo "::warning::ebay-drift: $w"
      # shellcheck disable=SC2016
      echo "- \`$w\`"
    done
  fi
}

case "$PROD_OUTCOME" in
  ok) compared ;;
  account_warning)
    echo; echo "The seller account leg warned today; the app-level shapes were still compared."
    compared
    ;;
  skipped_paused)
    echo; echo "eBay is paused (NEONBINDER_PAUSED_PLATFORMS), so the probe made no call. Nothing was compared."
    ;;
  app_failed) fail=1; echo; echo "**The app leg of the prod eBay probe failed.**" ;;
  "") fail=1; echo; echo "**The prod probe produced no outcome.**" ;;
  *) fail=1; echo; echo "**The prod probe failed:** \`$PROD_OUTCOME\`." ;;
esac

if [ "$fail" = 1 ]; then echo; echo "**Result: FAIL**"; exit 1; fi
echo; echo "**Result: PASS**"
