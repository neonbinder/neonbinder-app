#!/usr/bin/env bash
# NEO-592: markdown tables of the specs that failed once and passed on retry
# (Playwright "flaky"), for $GITHUB_STEP_SUMMARY. Prints nothing when there
# are none. Always exits 0: a summary never decides a verdict.
#
#   retry-summary.sh shard <flaky.json> <label>
#       one shard's list, as written by the flaky reporter:
#       [{file, title, project, firstError}, ...]
#   retry-summary.sh combined <results.json>
#       the whole run, read from the merged Playwright JSON report (any test
#       whose final result passed after an earlier attempt failed)
#
# The first error is one line, ANSI-stripped, cut to 160 chars and passed
# through redact-ci-log.sh, because step summaries are public.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mode="${1:-}"

emit() { # reads TSV (project, file, title, firstError) on stdin
  local rows
  rows="$(cat)"
  [ -z "$rows" ] && return 0
  printf '%s\n' "$title"
  printf '\n| Project | Spec | Test | First failure |\n|---|---|---|---|\n'
  printf '%s\n' "$rows" | "$here/redact-ci-log.sh" | while IFS=$'\t' read -r proj file name err; do
    esc() { printf '%s' "$1" | sed 's/|/\\|/g'; }
    printf '| %s | %s | %s | %s |\n' "$(esc "$proj")" "$(esc "$file")" "$(esc "$name")" "$(esc "$err")"
  done
  printf '\n'
}

# jq helper: first line, no ANSI, <= 160 chars, tabs/newlines gone.
CLEAN='def clean: (. // "") | gsub("\u001b\\[[0-9;]*m"; "") | split("\n")[0] | gsub("[\t\r]"; " ") | .[0:160];'

case "$mode" in
  shard)
    file="${2:-}"; label="${3:-shard}"
    [ -s "$file" ] || exit 0
    title="#### Retried specs (${label})"
    jq -r "$CLEAN"'
      (if type == "array" then . else (.flaky // []) end)[]
      | [(.project // ""), (.file // ""), (.title // ""), (.firstError | clean)] | @tsv
    ' "$file" 2>/dev/null | emit
    ;;
  combined)
    file="${2:-}"
    [ -s "$file" ] || exit 0
    title="### Retried specs (failed once, passed on retry)"
    jq -r "$CLEAN"'
      def walk_specs(f): (.file // f) as $f
        | ((.specs // [])[] | . as $s | (.tests // [])[]
            | select((.results // []) | length > 1)
            | select(.results[-1].status == "passed")
            | [(.projectName // ""), $f, ($s.title // ""),
               ((.results[0].error.message // "") | clean)] | @tsv),
          ((.suites // [])[] | walk_specs($f));
      (.suites // [])[] | walk_specs("")
    ' "$file" 2>/dev/null | emit
    ;;
  *)
    echo "usage: retry-summary.sh shard <flaky.json> <label> | combined <results.json>" >&2
    ;;
esac
exit 0
