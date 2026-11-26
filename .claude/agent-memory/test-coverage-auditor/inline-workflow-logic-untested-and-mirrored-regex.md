---
name: inline-workflow-logic-untested-and-mirrored-regex
description: Gate/hint logic written inline in a workflow yml (jq buckets, exit-1 gates, removed continue-on-error) has no test; a regex mirrored by hand across services drifts silently
metadata:
  type: feedback
---

A workflow edit that changes behaviour (a gate turned from warning to blocking, a jq
bucket split in a run block) is covered by nothing unless a `.github/scripts/*.test.mjs`
reads the yml or the logic lives in a script that has a test. `workflow-path-filters.test.mjs`
only pins trigger lists, not step bodies.

**Why:** the NEO-555 B1 diff removed `continue-on-error` and the skip-on-missing-url path from
browser.yml and added a jq hint split to e2e.yml with no test; a revert of either stays green.

**How to apply:** ask for the shell/jq to be extracted to a script with a node:test (feed sample
JSON, assert buckets), or a yml-pin test (step has no continue-on-error, the missing-url branch
exits 1). Also flag a regex copied by hand between services (Convex narrowMissingCaptures vs the
fake's own mirror test): the copy can drift from the source with every lane green.
