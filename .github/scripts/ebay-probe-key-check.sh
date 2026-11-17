#!/usr/bin/env bash
# NEO-555: validate the optional probe-account credential key before it is
# handed to Cloud Run. The key names an operator's connected eBay account, so
# it comes from a repository SECRET and is never printed. The pattern mirrors
# the service's ^ebay-credentials-(?!fake-)[A-Za-z0-9_-]{1,128}$; bash has no
# lookahead, so the fake- exclusion is a second check.
#
# Usage: PROBE_KEY=<key|empty> ebay-probe-key-check.sh
# Exit 0 when unset or valid, 1 when set and invalid. Never echoes the value.
set -uo pipefail
key="${PROBE_KEY:-}"
if [ -z "$key" ]; then
  echo "::notice::NEONBINDER_EBAY_PROBE_CREDENTIAL_KEY is unset: the prod eBay probe will skip its account leg."
  exit 0
fi
if ! [[ "$key" =~ ^ebay-credentials-[A-Za-z0-9_-]{1,128}$ ]] || [[ "$key" == ebay-credentials-fake-* ]]; then
  echo "::error::secrets.NEONBINDER_EBAY_PROBE_CREDENTIAL_KEY must be an ebay-credentials-<id> key that does not start with fake- (or unset)."
  exit 1
fi
