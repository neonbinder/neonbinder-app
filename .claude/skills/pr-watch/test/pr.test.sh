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
# A long interval parks the watch in its sleep after tick 1; the state file
# appearing is the signal (bounded by an iteration count, never by wall time).
PR_WATCH_INTERVAL=30 bash "$HERE/../watch.sh" 42 > "$FIX/out1" 2>&1 & pid=$!
for _ in $(seq 1 2000); do [ -s "$STATE" ] && break; sleep 0.01; done
pkill -P "$pid" 2>/dev/null; kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
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
mode=$(stat -c %a "$TMPDIR/pr-watch-$(id -u)" 2>/dev/null || stat -f %Lp "$TMPDIR/pr-watch-$(id -u)")
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

# ── queue mode: first failure, re-arm and enqueue identity ───────────────────
qnodes() { # state mqEntryJson nodesJson
  printf '{"data":{"repository":{"pullRequest":{"state":"%s","mergeCommit":{"oid":"abc123"},"mergeQueueEntry":%s,"timelineItems":{"nodes":%s}}}}}' "$1" "$2" "$3"
}
ADD2='{"__typename":"AddedToMergeQueueEvent","createdAt":"2026-11-14T11:00:00Z"}'
qjobs() { # then name:status:conclusion ... -> a `gh run view --json jobs` payload
  local items='{"name":"CI Gate","status":"in_progress","conclusion":"","url":"g"},' c n s k
  for c in "$@"; do IFS=: read -r n s k <<<"$c"; items="$items{\"name\":\"$n\",\"status\":\"$s\",\"conclusion\":\"$k\",\"url\":\"u-$n\"},"; done
  printf '{"jobs":[%s]}' "${items%,}"
}
QSTATE="$TMPDIR/pr-watch-$(id -u)/acme_widgets-42-queue"
seed_qstate() { # id seconds-ago-started
  mkdir -p "$TMPDIR/pr-watch-$(id -u)"; chmod 700 "$TMPDIR/pr-watch-$(id -u)"
  printf '%s\n%s\n%s\n\n\n' "$1" "$(( $(date +%s) - $2 ))" "$(date +%s)" > "$QSTATE"
}
runq() { out=$(bash "$HERE/../watch.sh" --queue 42 2>&1); rc=$?; }

# (a) success -> one job fails -> the job order swaps with a second failure:
# exactly one extra line, and the first failure is sticky for the attempt.
fresh
echo "$RUNS" > "$FIX/runs.json"
for i in 1 2 3 4; do qnodes OPEN "$(qe 1)" "[$ADD]" > "$FIX/graphql.json.$i"; done
qnodes MERGED null "[$ADD]" > "$FIX/graphql.json.5"
qjobs a:completed:success b:completed:success > "$FIX/run-7.json.1"
qjobs a:completed:success b:completed:failure > "$FIX/run-7.json.2"
qjobs a:completed:failure b:completed:failure > "$FIX/run-7.json.3"
qjobs a:completed:failure b:completed:failure > "$FIX/run-7.json.4"
runq
[ "$rc" = 0 ] && [ "$(lines '^\[t+')" = 2 ] && echo "$out" | tail -1 | grep -q '^DONE MERGED'; r=$?
check "queue: first failing job adds exactly one line and stays sticky when job order swaps" "$r"
# The extra line should say which job failed; today it is only the key that changes.
printf '%s\n' "$out" | grep '^\[t+' | sed -n 2p | grep -q 'PR Pipeline / b'; r=$?
check "queue: the extra first-failure line names the failing job" "$r"

# (b) kill + re-arm in queue mode, same enqueue time: resumes silently.
fresh
echo "$RUNS" > "$FIX/runs.json"
qnodes OPEN "$(qe 1)" "[$ADD]" > "$FIX/graphql.json"
qjobs a:completed:success b:completed:success > "$FIX/run-7.json"
PR_WATCH_INTERVAL=30 bash "$HERE/../watch.sh" --queue 42 > "$FIX/out1" 2>&1 & pid=$!
for _ in $(seq 1 2000); do [ -s "$QSTATE" ] && break; sleep 0.01; done
pkill -P "$pid" 2>/dev/null; kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
[ "$(grep -c '^\[t+' "$FIX/out1")" = 1 ] && [ -s "$QSTATE" ]; r=$?; check "queue: first run prints once and persists state" "$r"
echo 0 > "$FIX/.n"; echo 0 > "$FIX/.rn"
qnodes OPEN "$(qe 1)" "[$ADD]" > "$FIX/graphql.json.1"
qnodes MERGED null "[$ADD]" > "$FIX/graphql.json.2"
runq
[ "$rc" = 0 ] && [ "$(lines '^\[t+')" = 0 ] && [ "$(lines '^DONE MERGED')" = 1 ]; r=$?
check "queue: re-arm with the same enqueue time resumes silently" "$r"

# (c) id "none" then the real enqueue time keeps the original start.
fresh
echo '[]' > "$FIX/runs.json"
seed_qstate none 6000                                             # started 100 min ago, not enqueued yet
qnodes OPEN null "[]" > "$FIX/graphql.json.1"
qnodes OPEN "$(qe 1)" "[$ADD]" > "$FIX/graphql.json.2"
qnodes MERGED null "[$ADD]" > "$FIX/graphql.json.3"
PR_WATCH_ENQUEUE_GRACE_MIN=100000 runq
[ "$rc" = 0 ] && printf '%s\n' "$out" | grep '^\[t+' | sed -n 2p | grep -Eq '^\[t\+10[0-9]m\]'; r=$?
check "queue: adopting the first enqueue time keeps the clock from the original start" "$r"

# (d) a different enqueue time starts fresh, from a state file and within one run.
fresh
echo '[]' > "$FIX/runs.json"
seed_qstate 2026-11-14T09:00:00Z 6000
qnodes OPEN "$(qe 1)" "[$ADD]" > "$FIX/graphql.json.1"
qnodes MERGED null "[$ADD]" > "$FIX/graphql.json.2"
runq
printf '%s\n' "$out" | grep '^\[t+' | sed -n 1p | grep -Eq '^\[t\+0m\]'; r=$?
check "queue: a state file for another enqueue time is not resumed" "$r"
fresh
echo '[]' > "$FIX/runs.json"
seed_qstate 2026-11-14T10:00:00Z 6000
qnodes OPEN "$(qe 1)" "[$ADD]" > "$FIX/graphql.json.1"
qnodes OPEN "$(qe 1)" "[$ADD,$ADD2]" > "$FIX/graphql.json.2"     # re-enqueued
qnodes MERGED null "[$ADD,$ADD2]" > "$FIX/graphql.json.3"
runq
[ "$(lines '^\[t+')" = 2 ] && printf '%s\n' "$out" | grep '^\[t+' | sed -n 1p | grep -Eq '^\[t\+10[0-9]m\]' \
  && printf '%s\n' "$out" | grep '^\[t+' | sed -n 2p | grep -Eq '^\[t\+0m\]'; r=$?
check "queue: a re-enqueue mid-watch restarts the clock and prints" "$r"

# NEO-627: E2E skipped by design (inert paths, deps-only, cheap PR run): the caller job
# "E2E" is SKIPPED, no gate job, CI Gate succeeds. GREEN, and the line says why.
fresh
roll aaa 'Vercel:IN_PROGRESS:' 'E2E::SKIPPED' "$GATE_OK" > "$FIX/pr.json.1"
roll aaa "$VERCEL" 'E2E::SKIPPED' "$GATE_OK" > "$FIX/pr.json.2"
runpr
[ "$rc" = 0 ] && echo "$out" | grep -q 'skipped by design (inert paths NEO-627' && echo "$out" | tail -1 | grep -q '^DONE GREEN'; r=$?
check "E2E skipped by design reads as skipped, CI Gate decides green" "$r"

# NEO-627 fail fast (NEO-628: seed-mobile ends green without resetting): desktop red, shard-mobile skipped. DONE FAILED lists the desktop
# job first and says mobile was skipped.
fresh
roll aaa "$VERCEL" 'E2E / e2e:COMPLETED:FAILURE' 'E2E / seed-mobile:COMPLETED:SUCCESS' 'E2E / shard-mobile:COMPLETED:SKIPPED' 'E2E / shard-desktop (3, 8):COMPLETED:FAILURE' > "$FIX/pr.json.1"
runpr
[ "$rc" = 1 ] && echo "$out" | grep -q '^DONE FAILED.*failing check(s): E2E / shard-desktop (3, 8), E2E / e2e · mobile skipped: desktop red (fail fast)'; r=$?
check "desktop red with mobile skipped: desktop first, fail-fast note" "$r"

# Mobile shards that ran (and failed) with no desktop failure get no fail-fast note.
fresh
roll aaa "$VERCEL" 'E2E / seed-mobile:COMPLETED:SUCCESS' 'E2E / shard-mobile (1, 8):COMPLETED:FAILURE' > "$FIX/pr.json.1"
runpr
if echo "$out" | grep -q 'fail fast'; then r=1; else r=0; fi; check "no fail-fast note without a desktop red" "$r"

# NEO-627 pins (PR mode).
fresh
roll aaa "$VERCEL" 'E2E::SKIPPED' 'E2E / seed:COMPLETED:SUCCESS' 'CI Gate:IN_PROGRESS:' > "$FIX/pr.json.1"
roll aaa "$VERCEL" 'E2E::SKIPPED' 'E2E / seed:COMPLETED:SUCCESS' "$GATE_OK" > "$FIX/pr.json.2"
runpr
if echo "$out" | grep -q 'skipped by design'; then r=1; else r=0; fi; check "skipped caller with E2E child jobs is not 'skipped by design'" "$r"

fresh
roll aaa "$VERCEL" 'E2E / e2e:COMPLETED:FAILURE' 'E2E / seed-mobile:COMPLETED:SUCCESS' 'E2E / shard-desktop (2, 8):COMPLETED:FAILURE' 'E2E / shard-mobile:COMPLETED:SKIPPED' > "$FIX/pr.json.1"
runpr
[ "$rc" = 1 ] && echo "$out" | grep -q 'failing check(s): E2E / shard-desktop (2, 8), .*mobile skipped: desktop red (fail fast)'; r=$?
check "desktop and non-desktop red, mobile shards skipped: desktop first, note" "$r"

fresh
roll aaa "$VERCEL" 'E2E / seed-mobile:COMPLETED:SUCCESS' 'E2E / shard-mobile (1, 8):COMPLETED:SUCCESS' 'E2E / shard-desktop (2, 8):COMPLETED:FAILURE' > "$FIX/pr.json.1"
runpr
if echo "$out" | grep -q 'fail fast'; then r=1; else r=0; fi; check "desktop red with the mobile shards run: no fail-fast note" "$r"

fresh
roll aaa "$VERCEL" 'E2E / e2e:COMPLETED:FAILURE' 'E2E / seed-mobile:COMPLETED:SUCCESS' 'E2E / shard-mobile:COMPLETED:SKIPPED' 'E2E / shard-desktop (5, 8):COMPLETED:FAILURE' > "$FIX/pr.json.1"
runpr
[ "$rc" = 1 ] && echo "$out" | grep -q 'failing check(s): E2E / shard-desktop (5, 8), E2E / e2e · mobile skipped: desktop red (fail fast)'; r=$?
check "a single desktop shard red, mobile skipped: first, with the note" "$r"

# NEO-627 N1: E2E skipped but CI Gate failed (e.g. web-preview failed): no "by design".
fresh
roll aaa "$VERCEL" 'E2E::SKIPPED' 'CI Gate:COMPLETED:FAILURE' > "$FIX/pr.json.1"
runpr
if echo "$out" | grep -q 'by design'; then r=1; else r=0; fi; check "skipped E2E with CI Gate failed: no by-design label" "$r"

if [ "$fails" = 0 ]; then echo "all passed"; else echo "$fails failed"; exit 1; fi
