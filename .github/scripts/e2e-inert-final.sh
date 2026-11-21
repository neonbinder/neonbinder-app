#!/usr/bin/env bash
# NEO-627: the `changes` job's FINAL e2e_inert. The script's verdict
# (e2e-scope.sh) is trusted only if the path filters agree: it is "true" only
# when SCOPE is "true" AND every area filter that gates real work is exactly
# "false". An independent second check, made in `changes` itself so the skip
# never happens (and the gate never sees a refused skip). fake_bsc is left out
# on purpose: the recorder, README and tests are fake-bsc paths that are inert.
# Anything unset or unexpected is false.
# Environment: SCOPE, F_WEB, F_BROWSER, F_BROWSER_PREVIEW, F_PREPROCESS,
# F_SCANNER, F_SCRIPTS. Prints e2e_inert=true|false (once), exit 0.
set -uo pipefail
result=false
reason="scope verdict is not true"
if [ "${SCOPE:-}" = "true" ]; then
  result=true
  reason="scope is inert and no area filter matched"
  for kv in "web=${F_WEB:-}" "browser=${F_BROWSER:-}" "browser_preview=${F_BROWSER_PREVIEW:-}" "preprocess=${F_PREPROCESS:-}" "scanner=${F_SCANNER:-}" "scripts=${F_SCRIPTS:-}"; do
    if [ "${kv#*=}" != "false" ]; then
      result=false
      reason="the ${kv%%=*} filter is '${kv#*=}', not false"
      break
    fi
  done
fi
echo "e2e-inert-final: e2e_inert=$result ($reason)" >&2
printf 'e2e_inert=%s\n' "$result"
