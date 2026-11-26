---
name: action-scan-inside-mutation
description: An action-shaped scan helper (paged nested runQuery, per-call caps) reused inside a mutation loses its bound; order cheap checks first
metadata:
  type: project
---

A helper written for actions (`Pick<ActionCtx, "runQuery">`, paging with per-call caps
and a max-calls budget, e.g. `scanSetHistory`) can be called from a mutation, because
mutations also have `ctx.runQuery`. There the nested queries share ONE transaction's
read limits, so "200 calls x 500 docs" is no longer a bound: a large target throws
a read-limit error instead of returning `complete: false`.

**Why:** NEO-656 N1 ran two such scans in `applyAnswer` before the ordinary sport check,
so a same-sport answer on a large set could fail on the proof it did not need.

**How to apply:** when a review finds an action helper newly called from a mutation,
check (1) the worst-case docs read vs the transaction limit, (2) that the cheap
check that makes the scan unnecessary runs first, (3) the failure is fail-closed.
Related: [[patterns_neo424_offered_on_stored_row]].

**Fix shape that held (NEO-656 round 3):** public admin action runs `requireAdmin`, a cheap
internalQuery probe, then the scan (try/catch → false), and passes a server-computed bool to an
internalMutation (`{...publicArgs, userId, proven}`). Check: the bool is absent from every public
args validator (Convex rejects extra fields), only the internal writer passes it, and the
mutation re-reads the row (proof and write are not one transaction; admin-only, so a note).
