---
name: fake-upstream-fault-injection-proof-gaps
description: When a PR swaps a live marketplace for a fake with injectable faults, which proofs stay probabilistic, which retired unit assertions go missing, and what to demand
metadata:
  type: feedback
---

A fault-injected "wait" or "busy" screen is only proven when the fault is certain to be consumed.

- A `times: 1` or conditional delay on a shared-state sync (rows shared by every worker on the deployment) is consumed only if THIS spec makes the call. Another shard may have synced first, so the wait line never shows and the spec still passes. Treat as probabilistic.
- A `hang`/long-delay rule on a call the spec is certain to make (a per-card lookup the spec names) is deterministic. Ask for an explicit `toBeVisible` on the wait line plus an axe run while it shows. A budget-only proof (`expectAfterMarketplace` going red when the line is missing) is implicit and breaks silently if the timeout is shortened.
- Two-order helpers (run started vs seller awaited) accept both orders, so a delay that only makes one "likelier" does not prove the other branch.
- A count that equals "everything" (all N cards queued) under an unlimited 429 rule cannot prove "no further call was made"; a `times: 1` rule can (any later call would be answered, shrinking the count).

When a module with DB-backed tests is deleted and replaced, diff the old test titles against the new ones. Log-line shape tests ("carries platform, endpoint and timing only") are the ones that get dropped. A mocked `console.log` that never asserts is not a replacement.

Synthesised write paths (listing PUT, photo upload) are only checked against a captured real shape when a capture exists; "for every endpoint that has one" passes vacuously. Ask for a failing check when a write endpoint the specs drive has no capture.

Test-only hop pages that a helper parses by status-text regex need a component test pinning the strings, as sibling hop pages have.

**Why:** found auditing a fake-marketplace PR. **How to apply:** any PR replacing a live upstream with a fake plus a fault API.
