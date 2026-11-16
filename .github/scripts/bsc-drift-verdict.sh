#!/usr/bin/env bash
# NEO-552: the daily bsc-drift verdict, pulled out of the workflow so it can be
# tested. Pure: env in, a markdown summary on stdout, exit 1 on FAIL.
#
# Env:
#   PROD_OUTCOME   outcome of the prod /probe/bsc leg (bsc-probe-verdict.sh vocabulary)
#   PREV_OUTCOME   the previous completed run's PROD_OUTCOME ("" = unknown)
#   DRIFT_OUTCOME  the fake's drift-compare answer: ok | shape_drift | <error> | "" (not run)
#   DRIFT_PATHS    newline- or comma-separated key paths the fake reported (shape_drift only)
#
# Policy (Jason's brief for NEO-552):
#   signin_failed     -> FAIL now (a sign-in failure is a real regression or a
#                        lockout, never noise)
#   bsc_unavailable   -> FAIL only on the SECOND consecutive day (BSC has bad days)
#   shape_drift       -> FAIL with the drifted paths
#   unrecorded pinned key -> PASS with a warning (the recorder has a miss queued)
#   skipped_paused    -> PASS with a note (an operator paused BSC; no call made)
#   anything else not ok -> FAIL (parser rejected, non-2xx catalogue, wrong
#                        target, unreadable probe)
set -uo pipefail

PROD_OUTCOME="${PROD_OUTCOME:-}"
PREV_OUTCOME="${PREV_OUTCOME:-}"
DRIFT_OUTCOME="${DRIFT_OUTCOME:-}"
DRIFT_PATHS="${DRIFT_PATHS:-}"

fail=0
echo "### BSC drift check"
echo
echo "- prod probe: \`${PROD_OUTCOME:-<none>}\` (previous run: \`${PREV_OUTCOME:-<unknown>}\`)"
echo "- fake drift-compare: \`${DRIFT_OUTCOME:-<not run>}\`"

case "$PROD_OUTCOME" in
  ok)
    case "$DRIFT_OUTCOME" in
      ok) ;;
      "unrecorded pinned key")
        # Not a failure: the fake queued the missing request as a miss. The
        # comparison simply cannot run until a recording exists.
        echo "::warning::bsc-drift: a pinned catalogue request has no recording on the fake, so shapes were not compared. Run the recorder to load it."
        echo
        echo "**Not compared.** A pinned request has no recording on the fake (it is already queued as a miss). Run the recorder to load it; the comparison resumes on the next run."
        ;;
      shape_drift)
        fail=1
        echo
        echo "**Shape drift.** The real BSC's response shapes no longer match the fake's. Paths:"
        echo
        # shellcheck disable=SC2016  # backticks are markdown, not expansion
        printf '%s\n' "$DRIFT_PATHS" | tr ',' '\n' | sed '/^[[:space:]]*$/d; s/^/- `/; s/$/`/'
        ;;
      "") fail=1; echo; echo "**The drift comparison did not run.**" ;;
      *) fail=1; echo; echo "**The drift comparison failed:** \`$DRIFT_OUTCOME\`." ;;
    esac
    ;;
  bsc_unavailable)
    if [ "$PREV_OUTCOME" = "bsc_unavailable" ]; then
      fail=1
      echo
      echo "**BSC has been unavailable two days running.**"
    else
      echo
      echo "BSC was unavailable today. This is a warning; a second day in a row fails the check."
    fi
    ;;
  skipped_paused)
    echo
    echo "BSC is paused (NEONBINDER_PAUSED_PLATFORMS), so the probe made no call. Nothing was compared."
    ;;
  signin_failed)
    fail=1
    echo
    echo "**Sign-in to the real BSC failed.** Check the stored account and BSC's sign-in flow."
    ;;
  "")
    fail=1; echo; echo "**The prod probe produced no outcome.**" ;;
  *)
    fail=1; echo; echo "**The prod probe failed:** \`$PROD_OUTCOME\`." ;;
esac

if [ "$fail" = 1 ]; then echo; echo "**Result: FAIL**"; exit 1; fi
echo; echo "**Result: PASS**"
