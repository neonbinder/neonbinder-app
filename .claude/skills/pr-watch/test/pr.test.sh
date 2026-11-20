#!/usr/bin/env bash
# Tests for the change-only output and resume state of watch.sh (PR and queue
# mode) against a fake gh. Run: bash test/pr.test.sh
# shellcheck disable=SC2319  # r=$? right after a test chain is intended
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export PR_WATCH_GH="$HERE/fake-gh.sh" PR_WATCH_INTERVAL=0 PR_WATCH_REPO=acme/widgets
TMPDIR=$(mktemp -d); export TMPDIR
STATE="$TMPDIR/pr-watch-$(id -u)/acme_widgets-42-pr"
fails=0

# roll SHA name:status:conclusion ...  -> a `gh pr view` payload
roll() {
  local sha="$1"; shift
  local items="" c n s k
  for c in "$@"; do IFS=: read -r n s k <<<"$c"; items="$items{\"name\":\"$n\",\"status\":\"$s\",\"conclusion\":\"$k\"},"; done
  printf '{"state":"OPEN","headRefOid":"%s","statusCheckRollup":[%s]}' "$sha" "${items%,}"
}
VERCEL='Vercel:COMPLETED:SUCCESS'
SEED_RUN='E2E / seed:IN_PROGRESS:'; SEED_OK='E2E / seed:COMPLETED:SUCCESS'
GATE_RUN='CI Gate:IN_PROGRESS:'; GATE_OK='CI Gate:COMPLETED:SUCCESS'
SH1='E2E / shard-desktop (1, 8):COMPLETED:SUCCESS'; SH2='E2E / shard-desktop (2, 8):COMPLETED:SUCCESS'; SH3='E2E / shard-desktop (3, 8):IN_PROGRESS:'

fresh() { FIX=$(mktemp -d); export FIX; rm -rf "$TMPDIR/pr-watch-$(id -u)"; }
check() { # name ok
  if [ "$2" = 0 ]; then echo "ok   $1"; else echo "FAIL $1"; printf "%s\n" "${out//$'\n'/$'\n     '}"; fails=$((fails+1)); fi
}
lines() { printf '%s\n' "$out" | grep -c "$1"; }
runpr() { out=$(bash "$HERE/../watch.sh" 42 2>&1); rc=$?; }

# 1. prints once per change; shard/check count moves are silent; DONE last.
fresh
roll aaa "$VERCEL" > "$FIX/pr.json.1"                       # pipeline not registered
roll aaa "$VERCEL" > "$FIX/pr.json.2"                       # same: silent
roll aaa "$VERCEL" "$GATE_RUN" "$SEED_RUN" > "$FIX/pr.json.3"   # registered: prints
roll aaa "$VERCEL" "$GATE_RUN" "$SEED_RUN" "$SH1" > "$FIX/pr.json.4"   # count only: silent
roll aaa "$VERCEL" "$GATE_RUN" "$SEED_RUN" "$SH1" "$SH2" "$SH3" > "$FIX/pr.json.5"  # silent
roll aaa "$VERCEL" "$GATE_RUN" "$SEED_OK" "$SH1" "$SH2" "$SH3" > "$FIX/pr.json.6"   # seed done: prints
roll aaa "$VERCEL" "$GATE_OK" "$SEED_OK" "$SH1" "$SH2" > "$FIX/pr.json.7"           # green
runpr
[ "$rc" = 0 ] && [ "$(lines '^\[t+')" = 3 ] && [ "$(lines '^DONE GREEN')" = 1 ] && [ "$(printf '%s\n' "$out" | wc -l | tr -d ' ')" = 4 ] \
  && echo "$out" | grep -q 'waiting for CI Gate' && echo "$out" | tail -1 | grep -q '^DONE GREEN'
check "prints once per change, silent on count-only ticks, DONE last" $?
[ ! -e "$STATE" ]; r=$?; check "DONE removes the state file" "$r"

# 2. VERBOSE prints every tick.
fresh
for i in 1 2 3; do roll aaa "$VERCEL" "$GATE_RUN" > "$FIX/pr.json.$i"; done
roll aaa "$VERCEL" "$GATE_OK" > "$FIX/pr.json.4"
PR_WATCH_VERBOSE=1 runpr
[ "$(lines '^\[t+')" = 3 ] && [ "$(lines '^DONE GREEN')" = 1 ]; r=$?; check "PR_WATCH_VERBOSE=1 prints every tick" "$r"

# 3. DONE FAILED is printed even after silent ticks; failed>0 flips the key.
fresh
roll aaa "$VERCEL" "$GATE_RUN" > "$FIX/pr.json.1"; roll aaa "$VERCEL" "$GATE_RUN" > "$FIX/pr.json.2"
roll aaa "$VERCEL" 'E2E / shard-desktop (1, 8):COMPLETED:FAILURE' > "$FIX/pr.json.3"
runpr
[ "$rc" = 1 ] && [ "$(lines '^\[t+')" = 1 ] && echo "$out" | grep -q '^DONE FAILED.*shard-desktop (1, 8)'; r=$?; check "DONE FAILED after silent ticks" "$r"

# 4. re-arm: kill a running watch, start the same command again. It resumes
# silently, prints the next real change once, and never repeats the old line.
fresh
roll aaa "$VERCEL" "$GATE_RUN" "$SEED_RUN" > "$FIX/pr.json"
PR_WATCH_INTERVAL=0.2 bash "$HERE/../watch.sh" 42 > "$FIX/out1" 2>&1 & pid=$!
sleep 1.5; kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
[ "$(grep -c '^\[t+' "$FIX/out1")" = 1 ] && [ -s "$STATE" ]; r=$?; check "first run prints once and persists state" "$r"
echo 0 > "$FIX/.pn"
roll aaa "$VERCEL" "$GATE_RUN" "$SEED_RUN" > "$FIX/pr.json.1"
roll aaa "$VERCEL" "$GATE_RUN" "$SEED_OK" > "$FIX/pr.json.2"
roll aaa "$VERCEL" "$GATE_OK" "$SEED_OK" > "$FIX/pr.json.3"
runpr
[ "$(lines '^\[t+')" = 1 ] && echo "$out" | grep -q 'seed ✓' && [ "$(lines '^DONE GREEN')" = 1 ]; r=$?; check "re-arm resumes silently, prints only the new change" "$r"

# 5. re-arm keeps MAX_MIN counted from the original start.
fresh
roll aaa "$VERCEL" "$GATE_RUN" > "$FIX/pr.json"
mkdir -p "$TMPDIR/pr-watch-$(id -u)"
printf 'aaa\n%s\n%s\nRUNNING|registered=yes|seed=—|seed-mobile=—|e2e=—|failed=no\n\n' "$(( $(date +%s) - 6000 ))" "$(date +%s)" > "$STATE"   # started 100 min ago
runpr
[ "$rc" = 2 ] && [ "$(lines '^\[t+')" = 0 ] && echo "$out" | grep -q '^DONE TIMEOUT.*90m'; r=$?; check "resume keeps the original start (MAX_MIN)" "$r"

# 6. a new head SHA starts fresh and prints its first tick, even with a state file.
fresh
roll bbb "$VERCEL" "$GATE_RUN" > "$FIX/pr.json.1"; roll bbb "$VERCEL" "$GATE_OK" > "$FIX/pr.json.2"
mkdir -p "$TMPDIR/pr-watch-$(id -u)"
printf 'aaa\n%s\n%s\nanything\n\n' "$(( $(date +%s) - 6000 ))" "$(date +%s)" > "$STATE"
runpr
[ "$rc" = 0 ] && [ "$(lines '^\[t+')" = 1 ] && [ "$(lines 'RUNNING')" = 1 ]; r=$?; check "new SHA is a fresh watch (prints, clock reset)" "$r"

# 7. a stale state file (older than the resume window) is not resumed.
fresh
roll aaa "$VERCEL" "$GATE_RUN" > "$FIX/pr.json.1"; roll aaa "$VERCEL" "$GATE_OK" > "$FIX/pr.json.2"
mkdir -p "$TMPDIR/pr-watch-$(id -u)"
KEYLINE="RUNNING|registered=yes|seed=—|seed-mobile=—|e2e=—|failed=no"
printf 'aaa\n%s\n%s\n%s\n\n' "$(date +%s)" "$(( $(date +%s) - 7200 ))" "$KEYLINE" > "$STATE"
runpr
[ "$(lines '^\[t+')" = 1 ]; r=$?; check "stale state is not resumed" "$r"

# 7b. a forged start in the future is clamped to now, so MAX_MIN still bites.
fresh
roll aaa "$VERCEL" "$GATE_RUN" > "$FIX/pr.json.1"; roll aaa "$VERCEL" "$GATE_OK" > "$FIX/pr.json.2"
mkdir -p "$TMPDIR/pr-watch-$(id -u)"
printf 'aaa\n%s\n%s\n%s\n\n' "$(( $(date +%s) + 86400 ))" "$(date +%s)" "$KEYLINE" > "$STATE"
out=$(PR_WATCH_MAX_MIN=0 bash "$HERE/../watch.sh" 42 2>&1); rc=$?
[ "$rc" = 2 ] && echo "$out" | grep -q '^DONE TIMEOUT'; r=$?; check "a future start in the state file is clamped" "$r"

# 7c. a symlinked state dir is never followed: nothing is read from or written through it.
fresh
mkdir -p "$FIX/elsewhere"
ln -s "$FIX/elsewhere" "$TMPDIR/pr-watch-$(id -u)"
roll aaa "$VERCEL" "$GATE_RUN" > "$FIX/pr.json.1"; roll aaa "$VERCEL" "$GATE_OK" > "$FIX/pr.json.2"
runpr
[ "$rc" = 0 ] && [ -z "$(ls -A "$FIX/elsewhere")" ]; r=$?; check "a symlinked state dir is refused" "$r"
rm -f "$TMPDIR/pr-watch-$(id -u)"

# 7d. the state dir is private (0700) and no temp file is left behind.
fresh
roll aaa "$VERCEL" "$GATE_RUN" > "$FIX/pr.json.1"; roll aaa "$VERCEL" "$GATE_RUN" > "$FIX/pr.json.2"; roll aaa "$VERCEL" "$GATE_OK" > "$FIX/pr.json.3"
out=$(PR_WATCH_MAX_MIN=0 bash "$HERE/../watch.sh" 42 2>&1); rc=$?
mode=$(stat -f %Lp "$TMPDIR/pr-watch-$(id -u)" 2>/dev/null || stat -c %a "$TMPDIR/pr-watch-$(id -u)")
[ "$mode" = 700 ] && [ -z "$(ls -A "$TMPDIR/pr-watch-$(id -u)")" ]; r=$?; check "state dir is 0700 and temp files are cleaned up" "$r"

# 8. a repeated poll error prints once.
fresh
runpr_err() { out=$(PR_WATCH_MAX_MIN=0 bash "$HERE/../watch.sh" 42 2>&1); }
# fake gh has no pr.json -> `cat` fails -> nonzero -> poll error; MAX_MIN=0 ends it
runpr_err
[ "$(lines 'poll error')" = 1 ] && echo "$out" | grep -q '^DONE TIMEOUT'; r=$?; check "poll error line then DONE TIMEOUT" "$r"

# ── queue mode ───────────────────────────────────────────────────────────────
ADD='{"__typename":"AddedToMergeQueueEvent","createdAt":"2026-11-14T10:00:00Z"}'
qpr() { # state mqEntryJson
  printf '{"data":{"repository":{"pullRequest":{"state":"%s","mergeCommit":{"oid":"abc123"},"mergeQueueEntry":%s,"timelineItems":{"nodes":[%s]}}}}}' "$1" "$2" "$ADD"
}
qe() { printf '{"state":"AWAITING_CHECKS","position":%s}' "$1"; }
fresh
qpr OPEN "$(qe 3)" > "$FIX/graphql.json.1"
qpr OPEN "$(qe 3)" > "$FIX/graphql.json.2"
qpr OPEN "$(qe 2)" > "$FIX/graphql.json.3"   # position moves, not the head: silent
qpr OPEN "$(qe 1)" > "$FIX/graphql.json.4"   # reaches the head: prints
qpr OPEN "$(qe 1)" > "$FIX/graphql.json.5"
qpr MERGED null > "$FIX/graphql.json.6"
echo '[]' > "$FIX/runs.json"
out=$(bash "$HERE/../watch.sh" --queue 42 2>&1); rc=$?
[ "$rc" = 0 ] && [ "$(lines '^\[t+')" = 2 ] && echo "$out" | tail -1 | grep -q '^DONE MERGED'; r=$?; check "queue: prints on phase/head change only" "$r"

# queue: group starts, job counts move silently, first failure prints once.
fresh
RUNS='[{"databaseId":7,"headBranch":"gh-readonly-queue/main/pr-42-dead","status":"in_progress","conclusion":"","url":"u","workflowName":"PR Pipeline","createdAt":"2026-11-14T10:01:00Z"}]'
echo "$RUNS" > "$FIX/runs.json"
jobs() { printf '{"jobs":[{"name":"CI Gate","status":"in_progress","conclusion":"","url":"g"},{"name":"a","status":"%s","conclusion":"%s","url":"a"},{"name":"b","status":"completed","conclusion":"%s","url":"b"}]}' "$1" "$2" "$3"; }
for i in 1 2 3; do qpr OPEN "$(qe 1)" > "$FIX/graphql.json.$i"; done
qpr OPEN "$(qe 1)" > "$FIX/graphql.json.4"
qpr MERGED null > "$FIX/graphql.json.5"
jobs in_progress "" success > "$FIX/run-7.json"
out=$(bash "$HERE/../watch.sh" --queue 42 2>&1); rc=$?
[ "$(lines '^\[t+')" = 1 ] && [ "$rc" = 0 ]; r=$?; check "queue: steady group-running ticks are silent" "$r"

if [ "$fails" = 0 ]; then echo "all passed"; else echo "$fails failed"; exit 1; fi
