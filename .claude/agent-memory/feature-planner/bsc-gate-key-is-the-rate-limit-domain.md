---
name: bsc-gate-key-is-the-rate-limit-domain
description: Keying the BSC call gate per user — real BSC stays one key (429 is per egress IP), the fake keys per namespace; the one-slot team lane must carry the queuing operator or the 429 spec drains early
metadata:
  type: project
---

Planning NEO-629 (folded into NEO-628, 2026-11-20): the gate key is the rate-limit domain the call lands in, not "the user" as such.

- Real BSC: one key per deployment. Evidence: the 429s come from BSC's load balancer with an empty body, on `card-listing`, which is public and unauthenticated, so BSC cannot be limiting it per account; Convex egress IPs are shared.
- Fake BSC: one key per fake namespace (per test user). A fault lives only in that namespace, so only that key may trip.
- The background team lane (`bscTeamPool`, ONE slot per deployment) has no caller identity and asks under the deployment prefix. Per-namespace gates only stay isolated if each queued item carries the operator who queued it (`queuedBy`, threaded from the enqueue callers as an argument, never read with getCurrentUserId inside scheduled work). Without that, the 429 breaker spec's cards drain before its "all N waiting" assert.
- A per-namespace window must DEFER the lane item, never sleep in the one slot (`BSC_TEAM_WAIT_IN_SLOT_MAX_MS` is 120 s), or one spec's window holds every shard's lane.

**Why:** a per-user gate in real mode lets N users each hammer BSC from the same IP, which is how the test account got locked.
**How to apply:** any future per-user limiter on a marketplace: decide the rate-limit domain from evidence first, and check every background lane that calls under no user. Related: [[scheduled-marketplace-work-has-no-caller-identity]], [[bsc-cold-sheet-read-is-per-job-not-per-condition]].
