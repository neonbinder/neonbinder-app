#!/usr/bin/env bash
# NEO-627: may this run skip the E2E suite because the change touches only
# paths that nothing in the product, the build or the test harness reads?
# Called by the `changes` job of pr-pipeline.yml (after ci-mode.sh). That job
# then ANDs this verdict with the paths-filter outputs (e2e-inert-final.sh).
#
# Inert allow-list (EXACTLY these; a file anywhere else keeps E2E on):
#   .claude/**                     agent config, skills, agent memory
#   docs/**                        runbooks and design notes
#   *.md at the repository root    CLAUDE.md, DESIGN.md, PRODUCT.md (root only)
#   services/fake-bsc/recorder/**  the recorder CLI: runs on a person's
#                                  machine, is not copied into the fake's
#                                  image, and no E2E step runs it
#   services/fake-bsc/README.md    prose; only error messages name it
#   services/fake-bsc/tests/**     the fake's own unit tests, which the
#                                  fake-bsc-test lane still runs on such a PR
# NOT services/fake-bsc/CONTRACT.md: services/browser's tests read it.
# Verified when this list was written: no apps/web source, build or test
# config, no workflow and no service reads any of these paths at build or test
# time (references are comments, runbook pointers and error-message text).
# Before adding a path, grep for readers; before trusting one, re-grep.
#
# Output (stdout, append to $GITHUB_OUTPUT), exactly two lines, in this order:
#   reason      one sanitised line for the log (printable ASCII only; a file
#               name is never printed raw, so no name can add an output line)
#   e2e_inert   "true" | "false" (ONCE, and LAST)
# Notes go to stderr, sanitised the same way. Exit status is always 0: every
# failure is e2e_inert=false.
#
# FAIL CLOSED. e2e_inert=true only when ALL hold:
#   * the event is pull_request or merge_group,
#   * PR_NUMBER is set and the PR does not carry the `run-e2e` label (read
#     live, like ci-mode.sh; the label also forces the full suite in the queue.
#     It is read for the group's ONE PR, which assumes the merge queue's
#     max_entries_to_merge is 1),
#   * the file list was read completely, is non-empty, and EVERY name in it
#     (a rename counts both its old and new path) matches the allow-list,
#   * no name contains a control character, a double quote or a backslash.
# Any API, git or parse error, an empty list, a list that may be truncated by an
# API cap, and any odd file name is false.
#
# File list:
#   pull_request  the compare API, BASE_SHA...HEAD_SHA (the event's own base and
#                 head, so the decision is about the SHA under test). It
#                 returns at most 300 files: a list of 300 or more is false.
#                 `filename` AND `previous_filename` are both checked, so a
#                 rename from apps/web into docs/ cannot pass.
#   merge_group   git diff --no-renames MERGE_BASE..HEAD_SHA, where MERGE_BASE
#                 is `git merge-base HEAD_SHA origin/<BASE_REF branch>`. The
#                 event's own base_sha is NOT used: it is the group's parent,
#                 which may be an earlier queue entry's commit if the queue ever
#                 builds more than one entry per group. The merge base against
#                 the base branch is everything the group adds that is not yet
#                 on it, queued-ahead PRs included (intended, conservative),
#                 and a PR ahead that has already merged is correctly absent.
#                 The base branch and the head are fetched (depth 200); a
#                 truncated history can only make the merge base older, so the
#                 diff larger, never smaller. Any failure is false.
#
# Environment: EVENT_NAME, GITHUB_REPOSITORY, PR_NUMBER, GH_TOKEN, HEAD_SHA, and
# BASE_SHA (pull_request) or BASE_REF (merge_group, github.event.merge_group.base_ref).
set -uo pipefail
export LC_ALL=C

EVENT_NAME="${EVENT_NAME:-}"
REPO="${GITHUB_REPOSITORY:-}"
PR="${PR_NUMBER:-}"
COMPARE_FILE_CAP=300
FETCH_DEPTH=200

# Keep only printable ASCII; everything else (newline, CR, NUL...) becomes '?'.
sanitise() { printf '%s' "$1" | tr -c '[:print:]' '?' | cut -c1-"${2:-300}"; }

emit() {
  # emit <true|false> <reason>: the ONLY place anything reaches stdout.
  local reason
  reason=$(sanitise "$2")
  printf 'reason=%s\ne2e_inert=%s\n' "$reason" "$1"
  echo "e2e-scope: e2e_inert=$1 ($reason)" >&2
  exit 0
}

inert_path() {
  case "$1" in
    .claude/*|docs/*|services/fake-bsc/recorder/*|services/fake-bsc/tests/*|services/fake-bsc/README.md) return 0 ;;
    */*) return 1 ;;
    ?*.md) return 0 ;;
    *) return 1 ;;
  esac
}

case "$EVENT_NAME" in
  pull_request|merge_group) ;;
  *) emit false "$(sanitise "${EVENT_NAME:-unknown}" 40) event: full" ;;
esac

[[ "$PR" =~ ^[0-9]+$ ]] || emit false "no PR number (fail closed)"
[ -n "$REPO" ] || emit false "no repository (fail closed)"
head="${HEAD_SHA:-}"
[[ "$head" =~ ^[0-9a-f]{40}$ ]] || emit false "head sha missing or malformed (fail closed)"

# The PR's live labels: run-e2e forces the full suite.
if ! has_label=$(gh api "repos/${REPO}/pulls/${PR}" \
    --jq 'any(.labels[]?; .name == "run-e2e")' 2>/dev/null) || [ -z "$has_label" ]; then
  emit false "could not read PR #${PR} (fail closed)"
fi
[ "$has_label" = "false" ] || [ "$has_label" = "true" ] || emit false "could not read the PR labels (fail closed)"
[ "$has_label" = "false" ] || emit false "run-e2e label forces the full suite"

names=()
if [ "$EVENT_NAME" = "pull_request" ]; then
  base="${BASE_SHA:-}"
  [[ "$base" =~ ^[0-9a-f]{40}$ ]] || emit false "base sha missing or malformed (fail closed)"
  if ! listing=$(gh api "repos/${REPO}/compare/${base}...${head}" \
      --jq '(.files // error("no files")) | .[] | "F" + (.filename | @json), (if .previous_filename then "P" + (.previous_filename | @json) else empty end)' 2>/dev/null); then
    emit false "could not compare the PR base and head (fail closed)"
  fi
  entries=0
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    kind="${line:0:1}"
    body="${line:1}"
    case "$kind" in F) entries=$((entries + 1)) ;; P) ;; *) emit false "unparseable file listing (fail closed)" ;; esac
    # @json quotes the name; any escape means a quote, backslash or control character.
    if [[ "$body" != \"*\" ]] || [[ "$body" == *\\* ]]; then
      emit false "a file name with unusual characters (fail closed)"
    fi
    body="${body#\"}"; body="${body%\"}"
    names+=("$body")
  done <<<"$listing"
  [ "$entries" -lt "$COMPARE_FILE_CAP" ] || emit false "${entries} files, at or past the compare API's ${COMPARE_FILE_CAP}-file cap (fail closed)"
else
  ref="${BASE_REF:-}"
  branch="${ref#refs/heads/}"
  [[ "$branch" =~ ^[A-Za-z0-9._/-]+$ ]] && [[ "$branch" != *..* ]] && [[ "$branch" != -* ]] \
    || emit false "merge_group base_ref missing or malformed (fail closed)"
  git fetch --no-tags --depth="$FETCH_DEPTH" origin "+refs/heads/${branch}:refs/remotes/origin/${branch}" "$head" >/dev/null 2>&1 \
    || emit false "could not fetch the base branch and head (fail closed)"
  git cat-file -e "${head}^{commit}" 2>/dev/null || emit false "head commit not available after fetch (fail closed)"
  mb=$(git merge-base "$head" "refs/remotes/origin/${branch}" 2>/dev/null) \
    && [[ "$mb" =~ ^[0-9a-f]{40}$ ]] || emit false "no merge base with the base branch (fail closed)"
  tmp=$(mktemp) || emit false "mktemp failed (fail closed)"
  trap 'rm -f "$tmp"' EXIT
  git diff --no-renames --name-only -z "$mb" "$head" >"$tmp" 2>/dev/null || emit false "git diff failed (fail closed)"
  # A shell variable cannot hold NUL, so the list is read from the file.
  while IFS= read -r -d '' f; do
    names+=("$f")
  done <"$tmp"
fi

[ "${#names[@]}" -gt 0 ] || emit false "empty file list (fail closed)"

# Screen EVERY name before it is matched or mentioned anywhere: no control
# character (a newline would start a new output line), no quote, no backslash.
for f in "${names[@]}"; do
  [ -n "$f" ] || emit false "empty file name (fail closed)"
  case "$f" in
    *[[:cntrl:]]*|*\"*|*\\*) emit false "a file name with unusual characters (fail closed)" ;;
    /*|../*|*/../*|*/..|..) emit false "unexpected path form in the file list (fail closed)" ;;
  esac
done

outside=0
first=""
for f in "${names[@]}"; do
  if ! inert_path "$f"; then
    outside=$((outside + 1))
    [ -n "$first" ] || first="$f"
  fi
done
if [ "$outside" -gt 0 ]; then
  emit false "${outside} of ${#names[@]} changed paths are outside the inert paths (first: $(sanitise "$first" 120))"
fi

emit true "all ${#names[@]} changed paths are inert (.claude, docs, root *.md, fake-bsc recorder/tests/README)"
