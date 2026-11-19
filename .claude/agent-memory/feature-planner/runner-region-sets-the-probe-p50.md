---
name: runner-region-sets-the-probe-p50
description: The E2E latency probe's p50 is the GitHub runner's Azure region, not deployment load; compare load with server-side numbers from the Convex log artifact
metadata:
  type: reference
---

The shard log's `probe query: ... p50=` line measures the round trip from the runner. It is set by the runner's region, printed at the top of every job log (`Region: eastus`): about 18-25 ms from the east regions, 40-45 north central, 55-75 central, 85-110 west. Shards of one run land in different regions, so a spread across shards says nothing about the deployment or the PR under test. Measured 2026-11-18 over 125 shard logs, red and green alike; red shards were not more often in the west.

**How to apply:** to ask "did this PR add load", use the Convex log artifact (it is deployment-wide, the same in every shard's copy): server `executionTime` of `latencyProbe:ping`, the workpool `loop:loop` median per 10 s bucket (over ~150 ms is a slow window), OCC and retry counts, queries and mutations over 1 s. Compare with the same numbers from recent runs of main. Slow windows showed no correlation with the suite's own document reads or writes. Related: [[convex-log-tracing-by-request-id]].
