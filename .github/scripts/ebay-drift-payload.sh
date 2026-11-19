#!/usr/bin/env bash
# NEO-555: build the drift-compare payload from a probe answer. Only key paths
# and types (shapes), status codes and two digests leave the job; no value and
# no `detail` text, because the payload is uploaded as a public artifact.
#
# Usage: ebay-drift-payload.sh <probe.json> <payload.json>
set -euo pipefail
probe="${1:?probe.json}"
payload="${2:?payload.json}"
jq -e '(.shapes | type == "object") and (.statuses | type == "object") and (.hashes | type == "object")' "$probe" >/dev/null
mkdir -p "$(dirname "$payload")"
jq '{marketplace: "ebay", shapes: .shapes, statuses: .statuses, hashes: .hashes}' "$probe" > "$payload"
