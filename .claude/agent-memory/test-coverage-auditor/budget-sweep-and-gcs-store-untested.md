---
name: budget-sweep-and-gcs-store-untested
description: Fake-service PRs and E2E budget-lowering sweeps; where coverage hides (cloud store adapters tested only via local store, cold-start budgets, measurement citations)
metadata:
  type: feedback
---

A budget-lowering sweep over many specs: diff every removed `expect` line against the added ones (grep `^-`/`^+` for expect/timeout per file); new `.first()` on `.or()` is a harmless widening, but check `state: "hidden"` swaps keep the same locator.

**Why:** the sweep claims "only budgets changed"; the mechanical removed/added pairing is the proof.

**How to apply:**
- A cloud-store adapter (GCS) behind an interface is usually unit-tested only through the local-file implementation; precondition (create-only 412), generation-scoped delete and metadata reads stay unproven. Ask for a stubbed-bucket test.
- Budgets sized from "measured on the merge-group run" with no run id cannot be verified; ask for the id.
- Cold-start: a redeployed service makes the first call slow; seed-hop steps lowered to 7 s contradict a documented cold first-token figure. Require setup+bootstrap before the proof specs.
- A "restart restores state" claim with no E2E: ask for a smoke step in the deploy workflow (post, redeploy, read back).
