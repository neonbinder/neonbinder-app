#!/usr/bin/env bash
# NEO-555: the operator hint for missing fake write captures, pulled out of
# e2e.yml so it can be tested. Print-only: reads the status JSON, prints one
# ::error:: line per non-empty bucket, always exits 0 (the caller exits 1).
#
# Usage: fake-capture-hints.sh <status.json>   (needs .missing: ["<METHOD> <path>", ...])
#
# Buckets: BSC names (no ebay/ path), eBay names a sandbox run captures, and
# the eBay names only a production run can capture (exact: a trailing
# #variant such as #refused is the sandbox's). Any other ebay/ name is the
# sandbox's.
set -uo pipefail
status="${1:?usage: fake-capture-hints.sh <status.json>}"

prod_re='(/create_image_from_file|/image/:imageId|/offer/:offerId/publish|/bulk_update_price_quantity|/offer/:offerId/withdraw)$'
ebay_prod=$(jq -r --arg prod "$prod_re" '[.missing[] | select(test("^[A-Z]+ ebay/")) | select(test($prod))] | join(", ")' "$status")
ebay_sandbox=$(jq -r --arg prod "$prod_re" '[.missing[] | select(test("^[A-Z]+ ebay/")) | select(test($prod) | not)] | join(", ")' "$status")
bsc=$(jq -r '[.missing[] | select(test("^[A-Z]+ ebay/") | not)] | join(", ")' "$status")
[ -z "$bsc" ] || echo "::error::BSC: run 'recorder capture-write' for each of: ${bsc}."
[ -z "$ebay_sandbox" ] || echo "::error::eBay (sandbox): run 'fake-bsc.sh ebay-capture' for: ${ebay_sandbox}."
[ -z "$ebay_prod" ] || echo "::error::eBay (production only, a manual capture by the account owner): 'fake-bsc.sh ebay-capture --prod' for: ${ebay_prod}."
exit 0
