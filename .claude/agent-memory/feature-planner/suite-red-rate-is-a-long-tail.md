---
name: suite-red-rate-is-a-long-tail
description: About 470 spec executions per run at zero retries means a 0.3% per-execution failure rate is a 75% red rate; no one spec dominates, so plan by cause family and by policy
metadata:
  type: project
---

A full run is about 236 specs on two projects plus seed, seller and breaker jobs, with `retries: 0`. Over the 66 concluded merge-group runs of 2026-11-14 to 11-18, 45 were red; the last 20 were 15 red. That is about 1.4 independent failure events per run, or 0.3% per spec execution. No signature repeated more than six times; most ci-fail tickets have one or two occurrences.

**Why:** fixing the top spec barely moves the rate. The families that did repeat: user-facing waits made of many sequential Convex hops (2-3 s when healthy) meeting routine 10-20 s slow windows; the live eBay sandbox; state left on rows several specs share; one-off platform or network episodes.

**How to apply:** rank fixes by family, state how many of the last 20 reds each would have turned green on its own (a run needs every one of its failures fixed), and say plainly which share only a retry or quarantine policy can remove; that policy is the owner's call. The first failure on a worker is the cause; later reds on the same worker that touch the same shared rows are its cascade, see [[leftover-copy-red-is-an-unconfirmed-final-remove]].
