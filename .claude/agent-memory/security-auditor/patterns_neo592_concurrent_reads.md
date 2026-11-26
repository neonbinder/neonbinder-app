---
name: neo592-concurrent-reads
description: Auditing a sequential-read -> mapBounded/Promise.all conversion in Convex; concurrency keeps the read set but can drop an early-exit cap (level-at-a-time BFS), and moved security checks need their own test
metadata:
  type: feedback
---

NEO-592 turned sequential `ctx.db.get` / `ctx.runQuery` loops into bounded
concurrency (`convex/lib/boundedConcurrency.ts`: `mapBounded` 16 wide,
`settleAll`, `memoizeAsync`). What to check on any such conversion:

- **Early exits do not survive batching.** A one-at-a-time walk that returns
  "truncated" the moment it crosses a node cap reads at most ~2 x cap. Read a
  whole level at once and the bound becomes level width x per-parent `take`,
  which can throw the transaction's read limit where the old code returned a
  clean `truncated: true`. Fix: dispatch in chunks of the batch width, check the
  cap between chunks, and size each `take` from the remaining budget.
- **Read set unchanged is the usual truth** for pure point reads (same docs,
  same invalidation); verify by diffing what each worker reads, not the comment.
- **A security check folded into a prelude query** (e.g. "sportId is the sport
  ancestor of selectorOptionId", previously via a public ancestor-chain query)
  is now a hand-written walk: it needs its own refusal test, because the old
  query's tests no longer cover it.
- **Unhandled rejections:** a promise started early (history scan) is safe only
  if nothing awaits between its creation and the `settleAll` that collects it.
- **Writes after reads:** with `settleAll`, a read failure throws before any
  `runMutation`, so no partial batch is written. Confirm the mutations still
  come after the fan-out.
- Positional batch internal queries (`findManyByNameAndSport`) must refuse
  above their cap (never truncate) and be internal; the public single-name
  query keeps its own gate and registry entry.

**Hop removal (runAction(child) -> exported plain helper).** NEO-605 replaced
`ctx.runAction(internal.credentials.getSiteToken)` with a plain exported
helper. Checklist: a plain `export async function` in a `"use node"` module is
never registered (absent from `_generated/api.d.ts`; `browserFetch` and
`actingUserId` are precedent), so it adds no RPC surface; `runAction` already
propagated the parent's `ctx.auth`, so identity is unchanged, and scheduled
callers stay identity-less (null token) both ways; confirm the helper's only
throw is the "Not authenticated" guard (the body must catch everything else),
because the caller now turns the raw `error.message` into a client-visible
string with no child-function boundary in between.

**Why:** concurrency PRs are pitched as latency-only; the regressions hide in
caps and in checks that silently changed implementation.
**How to apply:** for any "N sequential reads -> concurrent" diff, list every
cap/early return in the old loop and prove the new code honours it before any
read is issued past it. Related: [[patterns_neo300_held_elsewhere]],
[[patterns_neo296_transaction_bounds]].
