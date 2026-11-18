#!/usr/bin/env bash
# NEO-592: markdown tables for $GITHUB_STEP_SUMMARY about retries and resets.
# Always exits 0: a summary never decides a verdict.
#
#   retry-summary.sh shard <flaky.json> <label>
#       one shard's list of specs that failed once and passed on retry, as
#       written by the flaky reporter: [{file, title, project, firstError}, ...].
#       Says "no retried specs" for `[]` and "not written" for a missing file.
#   retry-summary.sh combined <results.json>
#       the whole run, read from the merged Playwright JSON report: (1) any test
#       whose final result passed after an earlier attempt failed; (2) any test
#       whose failure reset FAILED (the `failure-reset` annotation the fixture
#       records), because the next test on that worker may have inherited state.
#       Prints nothing when there is nothing to list.
#
# Step summaries are public. Every cell is redacted IN FULL by the suite's one
# scrubber (redact-cli.mjs -> apps/web/playwright/support/redact.mjs) and only
# THEN cut to the first line and 160 characters. If the redactor fails, nothing
# from the report is written.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mode="${1:-}"
CUT=160

# emit <title> <last-column-header>: reads TSV (project, file, title, text) on
# stdin; prints the title and a table, or nothing for no rows or a redactor failure.
emit() {
  local title="$1" last="$2" rows safe
  rows="$(cat)"
  [ -z "$rows" ] && return 0
  if ! command -v node >/dev/null 2>&1; then
    echo "retry-summary: node not found; table withheld" >&2
    return 0
  fi
  safe="$(printf '%s\n' "$rows" | node "$here/redact-cli.mjs" --md-rows "$CUT")" || {
    echo "retry-summary: redaction failed; table withheld" >&2
    return 0
  }
  [ -z "$safe" ] && return 0
  printf '%s\n\n| Project | Spec | Test | %s |\n|---|---|---|---|\n%s\n\n' "$title" "$last" "$safe"
}

# jq helper: ANSI gone, tabs/CRs gone. NOT cut: @tsv keeps newlines as `\n`, the
# redactor cuts to the first line after redacting.
# shellcheck disable=SC2016  # jq programs, not shell expansions
CLEAN='def clean: (. // "") | gsub("\u001b\\[[0-9;]*m"; "") | gsub("[\t\r]"; " ");'

# Every test in the merged report, one object each: file, spec title, test.
# shellcheck disable=SC2016
WALK='def walk_specs(f): (.file // f) as $f
        | ((.specs // [])[] | . as $s | (.tests // [])[] | {f: $f, s: $s, t: .}),
          ((.suites // [])[] | walk_specs($f));
      def all_tests: (.suites // [])[] | walk_specs("");'

case "$mode" in
  shard)
    file="${2:-}"; label="${3:-shard}"
    if [ ! -s "$file" ]; then
      printf '#### Retried specs (%s)\n\nNo retry list: the flaky reporter did not write flaky.json.\n\n' "$label"
      exit 0
    fi
    if jq -e '(if type == "array" then . else (.flaky // []) end) | length == 0' "$file" >/dev/null 2>&1; then
      printf '#### Retried specs (%s)\n\nNo retried specs.\n\n' "$label"
      exit 0
    fi
    jq -r "$CLEAN"'
      (if type == "array" then . else (.flaky // []) end)[]
      | [(.project // ""), (.file // ""), (.title // ""), (.firstError | clean)] | @tsv
    ' "$file" 2>/dev/null | emit "#### Retried specs (${label})" "First failure"
    ;;
  combined)
    file="${2:-}"
    [ -s "$file" ] || exit 0
    jq -r "$CLEAN $WALK"'
      all_tests
      | select((.t.results // []) | length > 1)
      | select(.t.results[-1].status == "passed")
      | [(.t.projectName // ""), .f, (.s.title // ""), (.t.results[0].error.message | clean)] | @tsv
    ' "$file" 2>/dev/null | emit "### Retried specs (failed once, passed on retry)" "First failure"
    # A failed failure-reset is recorded on the result of the attempt that was red
    # (and on the test, for the last attempt); a retry hides it from the test-level
    # list, so read every result's annotations as well.
    jq -r "$CLEAN $WALK"'
      all_tests
      | . as $x
      | ((($x.t.results // []) | map(.annotations // []) | add // []) + ($x.t.annotations // []))
      | map(select(.type == "failure-reset" and ((.description // "") | startswith("FAILED"))))
      | map(.description | clean) | unique
      | select(length > 0)
      | [($x.t.projectName // ""), $x.f, ($x.s.title // ""), join("; ")] | @tsv
    ' "$file" 2>/dev/null | emit "### Failure resets that failed (the worker's next test may have inherited state)" "Reset"
    ;;
  *)
    echo "usage: retry-summary.sh shard <flaky.json> <label> | combined <results.json>" >&2
    ;;
esac
exit 0
