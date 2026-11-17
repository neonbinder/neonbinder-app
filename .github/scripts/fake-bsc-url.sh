#!/usr/bin/env bash
# NEO-555: validate NEONBINDER_FAKE_BSC_URL (the fake's own run.app service URL,
# no tag, no path) and print the normalised base. Pure; shared by browser.yml
# and bsc-drift.yml.
#
# Usage: FAKE_URL=<url> fake-bsc-url.sh      prints `base=<url>`, exit 0
#        anything else: prints nothing on stdout, exit 1
set -uo pipefail
re='^https://neonbinder-fake-bsc-[a-z0-9-]+(\.[a-z0-9-]+)*\.run\.app$'
base="${FAKE_URL:-}"
base="${base%/}"
if [[ ! "$base" =~ $re ]] || [[ "$base" == *---* ]]; then
  exit 1
fi
echo "base=$base"
