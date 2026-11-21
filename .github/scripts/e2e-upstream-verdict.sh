#!/usr/bin/env bash
# NEO-627: the `e2e` gate's "Upstream jobs" decision, pulled out of e2e.yml so
# it can be tested. Three outcomes:
#   upstream_failed  setup or the desktop seed did not succeed, or seed-mobile
#                    did not succeed (failed, cancelled, skipped, empty). A
#                    real fault.
#   fail_fast        seed-mobile SUCCEEDED but did not reset because the desktop
#                    pass was red: its output desktop_green is not 'true' (the
#                    wait step saw a shard that did not conclude `success`,
#                    fail closed) or shard-desktop is not success. The mobile
#                    pass was skipped on purpose (fail fast). Still a red run,
#                    but explained, and only the desktop results are judged.
#   ok               everything upstream is as the gate expects (the gate's
#                    later steps judge the shards and the results).
# NEO-628: seed-mobile starts early and always ends successfully when desktop
# is red; a skipped seed-mobile therefore only happens when setup or seed
# failed (upstream_failed), never as fail fast.
#
# Output (stdout, append to $GITHUB_ENV): UPSTREAM_VERDICT=<outcome>, plus
# UPSTREAM_FAILED=1 or FAIL_FAST=1 when applicable. Messages go to stderr and
# the step summary. Exit status 0 always: the gate's later steps fail the job.
# Environment: R_SETUP, R_SEED, R_SEED_MOBILE, R_DESKTOP_GREEN (seed-mobile output),
# R_SHARD_DESKTOP.
set -uo pipefail

R_SETUP="${R_SETUP:-}"
R_SEED="${R_SEED:-}"
R_SEED_MOBILE="${R_SEED_MOBILE:-}"
R_SHARD_DESKTOP="${R_SHARD_DESKTOP:-}"
R_DESKTOP_GREEN="${R_DESKTOP_GREEN:-}"

verdict=ok
if [ "$R_SETUP" != "success" ] || [ "$R_SEED" != "success" ]; then
  verdict=upstream_failed
  echo "::error::setup or a seed did not succeed (setup=$R_SETUP seed=$R_SEED seed-mobile=$R_SEED_MOBILE)" >&2
elif [ "$R_SEED_MOBILE" = "success" ] && { [ "$R_DESKTOP_GREEN" != "true" ] || [ "$R_SHARD_DESKTOP" != "success" ]; }; then
  verdict=fail_fast
  msg="The mobile pass was skipped because the desktop pass was red (fail fast, NEO-627): shard-desktop=$R_SHARD_DESKTOP desktop-green=$R_DESKTOP_GREEN. seed-mobile did not reset and shard-mobile did not run. Fix the desktop failures; the mobile pass runs once desktop is green."
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
