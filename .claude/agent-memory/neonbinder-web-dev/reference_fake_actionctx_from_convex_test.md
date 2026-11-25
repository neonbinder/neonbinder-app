---
name: reference_fake_actionctx_from_convex_test
description: Run an exported helper that takes an ActionCtx (only runQuery/runMutation) inside convex-test by faking the ctx from t.query/t.mutation
metadata:
  type: reference
---

A Convex action helper that only calls `ctx.runQuery`/`ctx.runMutation` (e.g. the review gate's `computeGateFacts`, via `countHops`) can be driven in a unit test without an action wrapper: export it and pass `{ runQuery: (ref, a) => t.query(ref, a), runMutation: (ref, a) => t.mutation(ref, a) } as unknown as ActionCtx`. This lets a parity test compare the fetch-time derivation with the action that rebuilds it from stored rows.

To make such a test bite, pick a case where the evidence changes the answer for a name that stays pending (pickCardTeam: voters agree on a row the year would not pick and any card is silent -> null, so the year-only run answers differently). A card whose co-printed player does not resolve (no match in sport) switches the card rule off entirely; keep unresolvable names off the cards that carry the team.
