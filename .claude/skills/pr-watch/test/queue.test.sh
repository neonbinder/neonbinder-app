#!/usr/bin/env bash
# Tests for `watch.sh --queue` against a fake gh. Run: bash test/queue.test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export PR_WATCH_GH="$HERE/fake-gh.sh" PR_WATCH_INTERVAL=0 PR_WATCH_REPO=acme/widgets
TMPDIR=$(mktemp -d); export TMPDIR  # watch.sh keeps its resume state under TMPDIR
fails=0

pr() { # state mqEntryJson nodesJson
  printf '{"data":{"repository":{"pullRequest":{"state":"%s","mergeCommit":{"oid":"abc123"},"mergeQueueEntry":%s,"timelineItems":{"nodes":%s}}}}}' "$1" "$2" "$3"
}
ADD='{"__typename":"AddedToMergeQueueEvent","createdAt":"2026-11-14T10:00:00Z"}'
rem() { printf '{"__typename":"RemovedFromMergeQueueEvent","createdAt":"2026-11-14T10:30:00Z","reason":"%s","actor":%s}' "$1" "$2"; }
RUN='[{"databaseId":7,"headBranch":"gh-readonly-queue/main/pr-42-deadbeef","status":"%s","conclusion":"%s","url":"https://example.invalid/runs/7","workflowName":"PR Pipeline","createdAt":"2026-11-14T10:01:00Z"},{"databaseId":8,"headBranch":"gh-readonly-queue/main/pr-421-cafe","status":"completed","conclusion":"failure","url":"https://example.invalid/runs/8","workflowName":"Other PR","createdAt":"2026-11-14T10:01:00Z"}]'
JOBS='{"jobs":[{"name":"CI Gate","status":"%s","conclusion":"%s","url":"https://example.invalid/jobs/1"},{"name":"E2E / shard-desktop (3, 8)","status":"completed","conclusion":"failure","url":"https://example.invalid/jobs/2"}]}'

run() { # name expectExit expectPattern  (fixtures already in $FIX); extra args after
  local name="$1" code="$2" pat="$3" out rc
  out=$(bash "$HERE/../watch.sh" --queue 42 2>&1); rc=$?
  if [ "$rc" = "$code" ] && echo "$out" | grep -Eq -- "$pat"; then echo "ok   $name"
  else echo "FAIL $name (exit $rc, wanted $code /$pat/)"; echo "$out" | sed 's/^/     /'; fails=$((fails+1)); fi
}
fresh() { FIX=$(mktemp -d); export FIX; echo '[]' > "$FIX/runs.json"; }

fresh; pr MERGED null "[$ADD]" > "$FIX/graphql.json"
run "merged" 0 '^DONE MERGED .*abc123'

fresh; pr OPEN null "[$ADD,$(rem CI_FAILURE '{"__typename":"Bot","login":"github-actions[bot]"}')]" > "$FIX/graphql.json"
printf "$RUN" completed failure > "$FIX/runs.json"; printf "$JOBS" completed failure > "$FIX/run-7.json"
run "ejected names reason and failing job, ignores another PR's run" 1 'DONE EJECTED.*CI_FAILURE.*PR Pipeline / E2E / shard-desktop \(3, 8\): https://example.invalid/jobs/2'

fresh; pr OPEN null "[$ADD,$(rem CI_TIMEOUT null)]" > "$FIX/graphql.json"
run "ejected on timeout with no failing job" 1 'DONE EJECTED.*CI_TIMEOUT.*no failing job'

fresh; pr OPEN null "[$ADD,$(rem MANUAL '{"__typename":"User","login":"someone"}')]" > "$FIX/graphql.json"
run "removed by hand" 4 'DONE REMOVED.*someone.*do not re-enqueue'

fresh; pr OPEN null "[$ADD,$(rem SOMETHING_NEW null)]" > "$FIX/graphql.json"
run "unknown reason is REMOVED, not EJECTED" 4 'DONE REMOVED.*SOMETHING_NEW'

fresh; pr OPEN null "[$ADD,$(rem CI_FAILURE '{"__typename":"User","login":"someone"}')]" > "$FIX/graphql.json"
run "known reason with a human actor is REMOVED" 4 'DONE REMOVED.*CI_FAILURE.*someone'
fresh; pr OPEN null "[$ADD,$(rem failed_checks '{"__typename":"Bot","login":"github-merge-queue"}')]" > "$FIX/graphql.json"
run "real D0 shape: failed_checks by github-merge-queue is EJECTED" 1 'DONE EJECTED.*failed_checks'

fresh; pr OPEN null "[]" > "$FIX/graphql.json"
PR_WATCH_REPO=other/repo run "wrong repo refused" 3 'DONE ERROR.*only watches other/repo'

fresh; pr CLOSED null "[$ADD]" > "$FIX/graphql.json"
run "closed without merge" 4 'DONE REMOVED.*closed'

# An older ejection must not hide a fresh enqueue: it is in the queue again,
# then merges on the second poll. Never reports green or ejected on the way.
fresh; Q='{"state":"AWAITING_CHECKS","position":1}'
OLD=$(rem CI_FAILURE null | sed 's/10:30/09:30/')
pr OPEN "$Q" "[$OLD,$ADD]" > "$FIX/graphql.json.1"; pr MERGED null "[$OLD,$ADD]" > "$FIX/graphql.json.2"
printf "$RUN" in_progress "" > "$FIX/runs.json"; printf "$JOBS" in_progress "" > "$FIX/run-7.json"
out=$(bash "$HERE/../watch.sh" --queue 42 2>&1); rc=$?
if [ "$rc" = 0 ] && echo "$out" | grep -q 'RUNNING — AWAITING_CHECKS' && echo "$out" | grep -q 'DONE MERGED' && ! echo "$out" | grep -q 'GREEN'; then echo "ok   re-enqueue then merge"
else echo "FAIL re-enqueue then merge ($rc)"; echo "$out" | sed 's/^/     /'; fails=$((fails+1)); fi

# Re-armed after an earlier ejection, still waiting on the PR's own checks
# (shakedown, #482): the old failed_checks removal must not be this attempt's verdict.
ARM='{"__typename":"AutoMergeEnabledEvent","createdAt":"2026-11-14T11:00:00Z"}'
OLDREM=$(rem failed_checks '{"__typename":"Bot","login":"github-merge-queue"}')
fresh; pr OPEN null "[$ADD,$OLDREM,$ARM]" | jq -c '.data.repository.pullRequest.autoMergeRequest={"enabledAt":"2026-11-14T11:00:00Z"}' > "$FIX/graphql.json"
PR_WATCH_QUEUE_MAX_MIN=0 run "re-armed, not yet queued: waits, ignores the old removal" 2 'DONE TIMEOUT'
fresh; pr OPEN null "[$ADD,$OLDREM,$ARM]" > "$FIX/graphql.json"
run "armed then disarmed before joining is REMOVED" 4 'DONE REMOVED.*armed and then disabled'

fresh; pr OPEN null "[]" > "$FIX/graphql.json"
PR_WATCH_ENQUEUE_GRACE_MIN=0 run "never enqueued" 5 'DONE NOT_QUEUED'

# NEO-627: E2E skipped by design (inert paths). The queue entry is in the group, the
# PR Pipeline run finished, the caller job "E2E" is skipped and CI Gate succeeded.
Q='{"state":"AWAITING_CHECKS","position":1}'
INERT_JOBS='{"jobs":[{"name":"Detect changed areas","status":"completed","conclusion":"success","url":"https://example.invalid/jobs/9"},{"name":"E2E","status":"completed","conclusion":"skipped","url":"https://example.invalid/jobs/10"},{"name":"CI Gate","status":"%s","conclusion":"%s","url":"https://example.invalid/jobs/11"}]}'
fresh; pr OPEN "$Q" "[$ADD]" > "$FIX/graphql.json.1"; pr MERGED null "[$ADD]" > "$FIX/graphql.json.2"
printf "$RUN" completed success > "$FIX/runs.json"; printf "$INERT_JOBS" completed success > "$FIX/run-7.json"
out=$(bash "$HERE/../watch.sh" --queue 42 2>&1); rc=$?
if [ "$rc" = 0 ] && echo "$out" | grep -q 'E2E skipped (inert paths, NEO-627): CI Gate decides' && echo "$out" | grep -q 'DONE MERGED' && ! echo "$out" | grep -Eqi 'missing|pending|first failure'; then echo "ok   inert skip reads as skipped by design, not missing or red"
else echo "FAIL inert skip reads as skipped by design ($rc)"; echo "$out" | sed 's/^/     /'; fails=$((fails+1)); fi

# While CI Gate is still running the skip is only noted, not yet called inert.
fresh; pr OPEN "$Q" "[$ADD]" > "$FIX/graphql.json"
printf "$RUN" in_progress "" > "$FIX/runs.json"; printf "$INERT_JOBS" in_progress "" > "$FIX/run-7.json"
PR_WATCH_QUEUE_MAX_MIN=0 run "inert skip before CI Gate finishes: E2E skipped, CI Gate decides" 2 'E2E skipped, CI Gate decides'
out=$(PR_WATCH_QUEUE_MAX_MIN=0 bash "$HERE/../watch.sh" --queue 42 2>&1); echo "$out" | grep -q 'inert paths' && { echo "FAIL inert claimed before the gate finished"; fails=$((fails+1)); } || echo "ok   inert not claimed before the gate finished"

# NEO-627 fail fast (NEO-628: seed-mobile ends green without resetting): desktop red, shard-mobile skipped. Ejected with the desktop failure
# first and the note; nobody is sent looking for mobile artifacts.
FF_JOBS='{"jobs":[{"name":"E2E / e2e","status":"completed","conclusion":"failure","url":"https://example.invalid/jobs/20"},{"name":"E2E / seed-mobile","status":"completed","conclusion":"success","url":"https://example.invalid/jobs/21"},{"name":"E2E / shard-mobile (1, 8)","status":"completed","conclusion":"skipped","url":"https://example.invalid/jobs/22"},{"name":"E2E / shard-desktop (3, 8)","status":"completed","conclusion":"failure","url":"https://example.invalid/jobs/23"},{"name":"CI Gate","status":"completed","conclusion":"failure","url":"https://example.invalid/jobs/24"}]}'
fresh; pr OPEN null "[$ADD,$(rem CI_FAILURE '{"__typename":"Bot","login":"github-merge-queue"}')]" > "$FIX/graphql.json"
printf "$RUN" completed failure > "$FIX/runs.json"; printf '%s' "$FF_JOBS" > "$FIX/run-7.json"
run "ejected after a desktop red names the desktop job first and says mobile was skipped" 1 'DONE EJECTED.*failing job\(s\): PR Pipeline / E2E / shard-desktop \(3, 8\): https://example.invalid/jobs/23; PR Pipeline / E2E / e2e.*mobile skipped: desktop red \(fail fast\)'

# Mobile shards that ran with no desktop failure are not called fail fast.
fresh; pr OPEN null "[$ADD,$(rem CI_FAILURE '{"__typename":"Bot","login":"github-merge-queue"}')]" > "$FIX/graphql.json"
printf "$RUN" completed failure > "$FIX/runs.json"
printf '%s' '{"jobs":[{"name":"E2E / seed-mobile","status":"completed","conclusion":"success","url":"https://example.invalid/jobs/21"},{"name":"E2E / shard-mobile (1, 8)","status":"completed","conclusion":"failure","url":"https://example.invalid/jobs/22"}]}' > "$FIX/run-7.json"
out=$(bash "$HERE/../watch.sh" --queue 42 2>&1); echo "$out" | grep -q 'fail fast' && { echo "FAIL fail-fast claimed without a desktop red"; fails=$((fails+1)); } || echo "ok   fail fast needs a desktop red"

# NEO-627 pins: E2E skipped but CI Gate failed or cancelled prints no e2e note.
for c in failure cancelled; do
  fresh; pr OPEN "$Q" "[$ADD]" > "$FIX/graphql.json"
  printf "$RUN" completed "$c" > "$FIX/runs.json"; printf "$INERT_JOBS" completed "$c" > "$FIX/run-7.json"
  out=$(PR_WATCH_QUEUE_MAX_MIN=0 bash "$HERE/../watch.sh" --queue 42 2>&1)
  if echo "$out" | grep -q 'E2E skipped'; then echo "FAIL e2e note printed with CI Gate $c"; echo "$out" | sed 's/^/     /'; fails=$((fails+1)); else echo "ok   no e2e note when CI Gate $c"; fi
done

# Fail fast: a desktop job and a non-desktop job both failed -> note, desktop first.
J='{"name":"%s","status":"completed","conclusion":"%s","url":"https://example.invalid/jobs/%s"}'
mkjobs() { printf '{"jobs":[%s]}' "$(IFS=,; echo "$*")"; }
fresh; pr OPEN null "[$ADD,$(rem CI_FAILURE '{"__typename":"Bot","login":"github-merge-queue"}')]" > "$FIX/graphql.json"
printf "$RUN" completed failure > "$FIX/runs.json"
mkjobs "$(printf "$J" 'E2E / e2e' failure 1)" "$(printf "$J" 'E2E / seed-mobile' success 2)" "$(printf "$J" 'E2E / shard-mobile' skipped 4)" "$(printf "$J" 'E2E / shard-desktop (2, 8)' failure 3)" > "$FIX/run-7.json"
run "fail fast: desktop and non-desktop red, desktop first with note" 1 'failing job\(s\): PR Pipeline / E2E / shard-desktop \(2, 8\).*PR Pipeline / E2E / e2e.*mobile skipped: desktop red'

# Mobile shards NOT skipped with a desktop red: no note.
fresh; pr OPEN null "[$ADD,$(rem CI_FAILURE '{"__typename":"Bot","login":"github-merge-queue"}')]" > "$FIX/graphql.json"
printf "$RUN" completed failure > "$FIX/runs.json"
mkjobs "$(printf "$J" 'E2E / seed-mobile' success 2)" "$(printf "$J" 'E2E / shard-mobile (1, 8)' success 4)" "$(printf "$J" 'E2E / shard-desktop (2, 8)' failure 3)" > "$FIX/run-7.json"
out=$(bash "$HERE/../watch.sh" --queue 42 2>&1)
if echo "$out" | grep -q 'fail fast'; then echo "FAIL note with the mobile shards not skipped"; echo "$out" | sed 's/^/     /'; fails=$((fails+1)); else echo "ok   no fail-fast note when the mobile shards ran"; fi

# A single desktop shard red, mobile shards skipped: it sorts first and gets the note.
fresh; pr OPEN null "[$ADD,$(rem CI_FAILURE '{"__typename":"Bot","login":"github-merge-queue"}')]" > "$FIX/graphql.json"
printf "$RUN" completed failure > "$FIX/runs.json"
mkjobs "$(printf "$J" 'E2E / e2e' failure 1)" "$(printf "$J" 'E2E / seed-mobile' success 2)" "$(printf "$J" 'E2E / shard-mobile' skipped 4)" "$(printf "$J" 'E2E / shard-desktop (4, 8)' failure 3)" > "$FIX/run-7.json"
run "fail fast: a single desktop shard red sorts first with note" 1 'failing job\(s\): PR Pipeline / E2E / shard-desktop \(4, 8\).*PR Pipeline / E2E / e2e.*mobile skipped: desktop red'

[ "$fails" = 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
