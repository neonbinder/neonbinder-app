#!/usr/bin/env bash
# NEO-627: may this run skip the E2E suite because the change touches only
# paths that nothing in the product, the build or the test harness reads?
# Called by the `changes` job of pr-pipeline.yml (after ci-mode.sh).
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
# Output (stdout, append to $GITHUB_OUTPUT):
#   e2e_inert   "true" | "false"
#   reason      one line for the log
# Notes go to stderr. Exit status is always 0: every failure is e2e_inert=false.
#
# FAIL CLOSED. e2e_inert=true only when ALL hold:
#   * the event is pull_request or merge_group,
#   * PR_NUMBER is set and the PR does not carry the `run-e2e` label (read
#     live, like ci-mode.sh; the label also forces the full suite in the queue),
#   * the file list was read completely, is non-empty, and EVERY name in it
#     (a rename counts both its old and new path) matches the allow-list.
# Any API, git or parse error, an empty list, a list that may be truncated by an
# API cap, and any odd file name (quotes, backslashes, control characters)
# is false.
#
# File list:
#   pull_request  the PR files API, paginated. `filename` AND
#                 `previous_filename` are both checked, so a rename from
#                 apps/web into docs/ cannot pass. The API caps a PR at 3000
#                 files; the count of entries must equal the PR's live
#                 changed_files and stay below the cap.
#   merge_group   git diff --no-renames BASE_SHA..HEAD_SHA, which is everything
#                 this group adds to its base, PRs queued ahead included (that
#                 is intended: conservative). Both commits are fetched at depth
#                 1 when the checkout lacks them; a tree diff needs no history,
#                 and git has no file cap.
#
# Environment: EVENT_NAME, GITHUB_REPOSITORY, PR_NUMBER, GH_TOKEN, and for
# merge_group BASE_SHA and HEAD_SHA (github.event.merge_group.base_sha/head_sha).
set -uo pipefail

EVENT_NAME="${EVENT_NAME:-}"
REPO="${GITHUB_REPOSITORY:-}"
PR="${PR_NUMBER:-}"
API_FILE_CAP=3000

emit() {
  # emit <true|false> <reason>
  printf 'e2e_inert=%s\nreason=%s\n' "$1" "$2"
  echo "e2e-scope: e2e_inert=$1 ($2)" >&2
  exit 0
}

inert_path() {
  case "$1" in
    .claude/*|docs/*|services/fake-bsc/recorder/*|services/fake-bsc/tests/*|services/fake-bsc/README.md) return 0 ;;
    */*) return 1 ;;
    *.md) return 0 ;;
    *) return 1 ;;
  esac
}

case "$EVENT_NAME" in
  pull_request|merge_group) ;;
  *) emit false "${EVENT_NAME:-unknown} event: full" ;;
esac

[[ "$PR" =~ ^[0-9]+$ ]] || emit false "no PR number (fail closed)"
[ -n "$REPO" ] || emit false "no repository (fail closed)"

# The PR's live metadata: the run-e2e label and the file count.
if ! meta=$(gh api "repos/${REPO}/pulls/${PR}" \
    --jq '"\(.changed_files)\t\(any(.labels[]?; .name == "run-e2e"))"' 2>/dev/null) || [ -z "$meta" ]; then
  emit false "could not read PR #${PR} (fail closed)"
fi
IFS=$'\t' read -r changed_files has_label <<<"$meta"
[ "$has_label" = "false" ] || [ "$has_label" = "true" ] || emit false "could not read the PR labels (fail closed)"
[ "$has_label" = "false" ] || emit false "run-e2e label forces the full suite"
[[ "$changed_files" =~ ^[0-9]+$ ]] || emit false "could not read the PR file count (fail closed)"

names=()
if [ "$EVENT_NAME" = "pull_request" ]; then
  [ "$changed_files" -lt "$API_FILE_CAP" ] || emit false "PR has ${changed_files} files, at or past the API cap of ${API_FILE_CAP} (fail closed)"
  if ! listing=$(gh api "repos/${REPO}/pulls/${PR}/files" --paginate \
      --jq '.[] | "F" + (.filename | @json), (if .previous_filename then "P" + (.previous_filename | @json) else empty end)' 2>/dev/null); then
    emit false "could not list the PR files (fail closed)"
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
  [ "$entries" -eq "$changed_files" ] || emit false "listed ${entries} files but the PR has ${changed_files} (possibly truncated; fail closed)"
else
  base="${BASE_SHA:-}"; head="${HEAD_SHA:-}"
  [[ "$base" =~ ^[0-9a-f]{40}$ ]] && [[ "$head" =~ ^[0-9a-f]{40}$ ]] || emit false "merge_group base/head sha missing or malformed (fail closed)"
  for sha in "$base" "$head"; do
    if ! git cat-file -e "${sha}^{commit}" 2>/dev/null; then
      git fetch --no-tags --depth=1 origin "$sha" >/dev/null 2>&1 || emit false "could not fetch ${sha:0:12} (fail closed)"
      git cat-file -e "${sha}^{commit}" 2>/dev/null || emit false "${sha:0:12} not available after fetch (fail closed)"
    fi
  done
  tmp=$(mktemp) || emit false "mktemp failed (fail closed)"
  trap 'rm -f "$tmp"' EXIT
  git diff --no-renames --name-only -z "$base" "$head" >"$tmp" 2>/dev/null || emit false "git diff failed (fail closed)"
  # A shell variable cannot hold NUL, so the list is read from the file.
  while IFS= read -r -d '' f; do
    names+=("$f")
  done <"$tmp"
fi

[ "${#names[@]}" -gt 0 ] || emit false "empty file list (fail closed)"

for f in "${names[@]}"; do
  [ -n "$f" ] || emit false "empty file name (fail closed)"
  case "$f" in /*|../*|*/../*|*/..) emit false "unexpected path '${f}' (fail closed)" ;; esac
  if ! inert_path "$f"; then
    emit false "'${f}' is outside the inert paths"
  fi
done

emit true "all ${#names[@]} changed paths are inert (.claude, docs, root *.md, fake-bsc recorder/tests/README)"
