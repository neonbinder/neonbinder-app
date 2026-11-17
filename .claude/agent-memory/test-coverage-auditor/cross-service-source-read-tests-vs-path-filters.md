---
name: cross-service-source-read-tests-vs-path-filters
description: parity tests that read another service's source/docs only run when that service's CI lane runs; check pr-pipeline path filters cover both directions
metadata:
  type: feedback
---

A test in service A that reads service B's source or CONTRACT.md (a parity pin) is only a gate when a change to B triggers A's lane. In `pr-pipeline.yml` the `browser` filter lists only `services/browser/**` plus two named fake-bsc files, and `fake_bsc` is `services/fake-bsc/**` only.

**Why:** a PR added browser tests reading fake-bsc `src/ebay/tokens.ts` and `CONTRACT.md`, and fake-bsc tests reading browser `src/routes/ebay-probe*.ts`. A PR touching only one side skips the other lane, so the parity pin goes unrun on PRs (the merge-queue full run may still catch it).

**How to apply:** when a diff adds a test that reads a sibling service's files, grep the `changes` filter for those exact paths in BOTH directions and ask for the paths to be added. Also check that HTTP-level tests assert the flat field names a workflow `jq` reads, not only the library result.
