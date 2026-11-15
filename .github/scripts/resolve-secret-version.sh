#!/usr/bin/env bash
# Resolve a Secret Manager secret's `latest` to its version number and fail
# unless that version is ENABLED. Prints the number. Used to pin a secret
# version on a Cloud Run revision (a floating :latest would take a newly added
# version live on the next cold start without a deploy; same reasoning as the
# eBay preflight, NEO-415).
#
# Usage: resolve-secret-version.sh <secret> <project>
set -uo pipefail
secret="${1:?secret}"; project="${2:?project}"
if ! out=$(gcloud secrets versions describe latest --secret="$secret" --project="$project" \
    --format='value(state,name)' 2>&1); then
  echo "::error::secret $secret not readable in $project (gcloud: $(printf '%s' "$out" | head -n1))" >&2
  exit 1
fi
state=$(printf '%s' "$out" | awk '{print $1}')
version=$(printf '%s' "$out" | awk '{print $2}' | awk -F/ '{print $NF}')
if [ "$state" != "ENABLED" ] || ! [[ "$version" =~ ^[0-9]+$ ]]; then
  echo "::error::latest version of $secret in $project is not ENABLED (state: $state)" >&2
  exit 1
fi
echo "$version"
