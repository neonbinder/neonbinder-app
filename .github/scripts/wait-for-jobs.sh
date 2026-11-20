#!/usr/bin/env bash
#
# Wait until named jobs of THIS workflow run attempt have finished (NEO-628).
#
# seed-mobile (e2e.yml) starts while the desktop pass is still running, does
# its read-only prep, then calls this to hold until every desktop shard has
# COMPLETED, whatever its result, before its reset wipes the shared preview. It replaces the `needs:` edge that used to do the same.
#
# Usage:
#   wait-for-jobs.sh [--repo OWNER/REPO] [--run-id ID] [--attempt N]
#       [--interval SECONDS] [--timeout-min MINUTES]
#       --pattern REGEX --count N [--pattern REGEX --count N ...]
#
# Defaults come from GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT;
# the token comes from GH_TOKEN (needs `actions: read`). The jobs list is
# GET /repos/{repo}/actions/runs/{run}/attempts/{attempt}/jobs, so jobs of an
# earlier attempt are never counted.
#
# Matching: a job name is tested against each REGEX after stripping a leading
# "E2E / " (the caller job's prefix when e2e.yml runs as a reusable workflow),
# so the same patterns work in a standalone workflow_dispatch run. Anchor the
# patterns (^...$): a loose one would count unrelated jobs.
#
# Done = for EVERY pattern, exactly N jobs match and all have status
# `completed`. Fails closed:
#   - fewer than N matches (jobs not created yet): keep waiting;
#   - more than N matches: error, exit 1 (the count is wrong, never guess);
#   - an API error (5xx, 403, 429, network, bad JSON): retry with backoff
#     (interval doubling, capped at 60 s), never treated as done;
#   - --timeout-min elapsed: error, exit 1.
#
# Exit: 0 all done, 1 error or timeout, 2 usage error.

set -euo pipefail

repo="${GITHUB_REPOSITORY:-}" run_id="${GITHUB_RUN_ID:-}" attempt="${GITHUB_RUN_ATTEMPT:-}"
interval=10 timeout_min=55
patterns=() counts=()
pending_pattern=""
num='^[0-9]+(\.[0-9]+)?$'

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)        repo="${2:-}"; shift 2 ;;
    --run-id)      run_id="${2:-}"; shift 2 ;;
    --attempt)     attempt="${2:-}"; shift 2 ;;
    --interval)    interval="${2:-}"; shift 2 ;;
    --timeout-min) timeout_min="${2:-}"; shift 2 ;;
    --pattern)
      [[ -z "$pending_pattern" ]] || { echo "usage error: --pattern needs a --count before the next --pattern" >&2; exit 2; }
      pending_pattern="${2:-}"; [[ -n "$pending_pattern" ]] || { echo "usage error: empty --pattern" >&2; exit 2; }
      shift 2 ;;
    --count)
      [[ -n "$pending_pattern" ]] || { echo "usage error: --count without a preceding --pattern" >&2; exit 2; }
      [[ "${2:-}" =~ ^[0-9]+$ && "${2:-}" -ge 1 ]] || { echo "usage error: --count must be a positive integer" >&2; exit 2; }
      patterns+=("$pending_pattern"); counts+=("$2"); pending_pattern=""
      shift 2 ;;
    *) echo "usage error: unknown arg $1" >&2; exit 2 ;;
  esac
done
[[ -z "$pending_pattern" ]] && true || { echo "usage error: --pattern without --count" >&2; exit 2; }
[[ ${#patterns[@]} -gt 0 ]] || { echo "usage error: at least one --pattern/--count pair is required" >&2; exit 2; }
[[ -n "$repo" && -n "$run_id" && -n "$attempt" ]] \
  || { echo "usage error: --repo, --run-id and --attempt (or GITHUB_REPOSITORY/GITHUB_RUN_ID/GITHUB_RUN_ATTEMPT) are required" >&2; exit 2; }
[[ "$run_id" =~ ^[0-9]+$ && "$attempt" =~ ^[0-9]+$ ]] || { echo "usage error: --run-id and --attempt must be integers" >&2; exit 2; }
[[ "$interval" =~ $num && "$timeout_min" =~ $num ]] || { echo "usage error: --interval and --timeout-min must be numbers" >&2; exit 2; }

endpoint="repos/${repo}/actions/runs/${run_id}/attempts/${attempt}/jobs?per_page=100"
timeout_s=$(awk -v m="$timeout_min" 'BEGIN { printf "%.3f", m * 60 }')
backoff="$interval"
polls=0
last_status="no poll completed yet"
start=$SECONDS

timed_out() {
  awk -v e="$((SECONDS - start))" -v t="$timeout_s" 'BEGIN { exit !(e >= t) }'
}

fail_timeout() {
  echo "::error::Timed out after ${timeout_min} min waiting for jobs in run ${run_id} attempt ${attempt} (last status: ${last_status}). seed-mobile cannot reset the preview until the desktop pass has finished. \"Re-run failed jobs\" is not supported for E2E (it skips the seed); re-run the whole workflow."
  exit 1
}

while true; do
  polls=$((polls + 1))
  if jobs_json=$(gh api --paginate "$endpoint" 2>"${TMPDIR:-/tmp}/wait-for-jobs.$$.err" | jq -s -c '[.[].jobs[]]' 2>/dev/null) \
     && [[ -n "$jobs_json" && "$jobs_json" != "null" ]]; then
    backoff="$interval"
    all_done=true
    summary=""
    for i in "${!patterns[@]}"; do
      p="${patterns[$i]}" want="${counts[$i]}"
      matched=$(jq -c --arg p "$p" '[.[] | select((.name | sub("^E2E / "; "")) | test($p))]' <<<"$jobs_json")
      have=$(jq 'length' <<<"$matched")
      done_n=$(jq '[.[] | select(.status == "completed")] | length' <<<"$matched")
      if [[ "$have" -gt "$want" ]]; then
        echo "::error::Pattern '${p}' matched ${have} jobs in run ${run_id} attempt ${attempt}, expected exactly ${want}. Refusing to guess; fix the pattern or the count."
        jq -r '.[] | "  matched: \(.name) (\(.status))"' <<<"$matched" >&2
        exit 1
      fi
      summary+="'${p}' ${done_n}/${want} done (${have} created); "
      if [[ "$have" -ne "$want" || "$done_n" -ne "$want" ]]; then all_done=false; fi
    done
    last_status="$summary"
    if $all_done; then
      echo "All awaited jobs completed (poll ${polls}, $((SECONDS - start))s):"
      for i in "${!patterns[@]}"; do
        jq -r --arg p "${patterns[$i]}" '.[] | select((.name | sub("^E2E / "; "")) | test($p)) | "  \(.name): \(.conclusion)"' <<<"$jobs_json"
      done
      rm -f "${TMPDIR:-/tmp}/wait-for-jobs.$$.err"
      exit 0
    fi
    echo "poll ${polls}: ${summary}retry in ${interval}s"
    sleep_for="$interval"
  else
    err=$(tr '\n' ' ' < "${TMPDIR:-/tmp}/wait-for-jobs.$$.err" 2>/dev/null | cut -c1-200 || true)
    last_status="API error: ${err:-unparseable response}"
    echo "poll ${polls}: ${last_status}; retry in ${backoff}s"
    sleep_for="$backoff"
    backoff=$(awk -v b="$backoff" -v i="$interval" 'BEGIN { n = (b * 2 > 60) ? 60 : b * 2; if (n < i) n = i; print n }')
  fi
  rm -f "${TMPDIR:-/tmp}/wait-for-jobs.$$.err"
  timed_out && fail_timeout
  sleep "$sleep_for"
  timed_out && fail_timeout
done
