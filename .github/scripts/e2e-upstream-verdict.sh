#!/usr/bin/env bash
# NEO-627: the `e2e` gate's "Upstream jobs" decision, pulled out of e2e.yml so
# it can be tested. Three outcomes:
#   upstream_failed  setup or the desktop seed did not succeed, or seed-mobile
#                    ran and did not succeed (or is in a state other than
#                    skipped-because-desktop-was-red). A real fault.
#   fail_fast        seed-mobile was SKIPPED and the desktop pass was red
#                    (shard-desktop or breaker-desktop not success): the mobile
#                    pass was skipped on purpose (fail fast). Still a red run,
#                    but explained, and only the desktop results are judged.
#   ok               everything upstream is as the gate expects (the gate's
#                    later steps judge the shards and the results).
# A skipped seed-mobile after a GREEN desktop pass is NOT fail fast (that cannot
# happen by the job conditions): it is upstream_failed.
#
# Output (stdout, append to $GITHUB_ENV): UPSTREAM_VERDICT=<outcome>, plus
# UPSTREAM_FAILED=1 or FAIL_FAST=1 when applicable. Messages go to stderr and
# the step summary. Exit status 0 always: the gate's later steps fail the job.
# Environment: R_SETUP, R_SEED, R_SEED_MOBILE, R_SHARD_DESKTOP, R_BREAKER_DESKTOP.
set -uo pipefail

R_SETUP="${R_SETUP:-}"
R_SEED="${R_SEED:-}"
R_SEED_MOBILE="${R_SEED_MOBILE:-}"
R_SHARD_DESKTOP="${R_SHARD_DESKTOP:-}"
R_BREAKER_DESKTOP="${R_BREAKER_DESKTOP:-}"

verdict=ok
if [ "$R_SETUP" != "success" ] || [ "$R_SEED" != "success" ]; then
  verdict=upstream_failed
  echo "::error::setup or a seed did not succeed (setup=$R_SETUP seed=$R_SEED seed-mobile=$R_SEED_MOBILE)" >&2
elif [ "$R_SEED_MOBILE" = "skipped" ] && { [ "$R_SHARD_DESKTOP" != "success" ] || [ "$R_BREAKER_DESKTOP" != "success" ]; }; then
  verdict=fail_fast
  msg="The mobile pass was skipped because the desktop pass was red (fail fast, NEO-627): shard-desktop=$R_SHARD_DESKTOP breaker-desktop=$R_BREAKER_DESKTOP. seed-mobile, shard-mobile and breaker-mobile did not run. Fix the desktop failures; the mobile pass runs once desktop is green."
  echo "::error::$msg" >&2
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    { echo "### Mobile pass skipped (fail fast)"; echo "$msg"; } >> "$GITHUB_STEP_SUMMARY"
  fi
elif [ "$R_SEED_MOBILE" != "success" ]; then
  verdict=upstream_failed
  echo "::error::setup or a seed did not succeed (setup=$R_SETUP seed=$R_SEED seed-mobile=$R_SEED_MOBILE)" >&2
fi

echo "UPSTREAM_VERDICT=$verdict"
case "$verdict" in
  fail_fast) echo "FAIL_FAST=1" ;;
  upstream_failed) echo "UPSTREAM_FAILED=1" ;;
esac
exit 0
