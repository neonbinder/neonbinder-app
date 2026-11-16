---
name: patterns_planted_red_for_server_side_behaviour
description: A planted red for a Convex-side behaviour needs a backend push this agent may not run; plant a wrong expectation instead and read the failure snapshot to prove the product value is what made it green
metadata:
  type: feedback
---

When the behaviour under test lives only in a Convex mutation (e.g. a card born
with its row's default player), breaking it means pushing functions to the
deployment, which this agent never does (`npx convex dev|deploy` is the
coordinator's). Do instead:

1. Confirm the client does not supply the value itself (grep the component's
   mutation call: no prefill means the server is the only source).
2. Plant a wrong expectation at the covering assertion (expect another player),
   run once with `--output=<scratch>`, restore byte-exact (`cp` a backup,
   compare `shasum`).
3. Read `error-context.md`: the real value (the default player's chip) must be
   in the snapshot where the assertion looked. That proves the assertion is
   live and that the product produced the green.
4. Report the backend plant as not run, with the exact one-line patch, for the
   coordinator to push if they want the stronger proof.

**Why:** "green can mean not testing"; a spec-only plant shows the assertion
executes but not that the server fill is what satisfies it. Step 3 closes most
of that gap without touching the deployment.
**How to apply:** any planted-red request whose break point is in `convex/`.
Related: [[patterns_cameo_specs_and_sorted_binder_pages]]
