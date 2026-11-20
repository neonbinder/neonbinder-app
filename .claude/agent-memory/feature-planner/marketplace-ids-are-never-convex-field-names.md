---
name: marketplace-ids-are-never-convex-field-names
description: Convex rejects non-ASCII (or $-leading) object field names on args, returns and documents; marketplace ids, section keys and person names must travel as arrays of {id,label}, never as record keys
metadata:
  type: project
---

A Convex value's object field names must be non-control ASCII and not start
with `$`. The client's `convexToJson` throws before the request is sent, so the
failure never reaches Convex logs; a server-side return or insert with such a
key fails the function. BSC ids are not always ASCII (an insert id `exposé`,
NEO-625), and player names often are not (José, Ramírez).

**Why:** NEO-625: Reconcile Inserts sent `platformLabels` as
`Record<marketplaceId, label>`; one accented BSC id made every Save on that set
throw client-side, and the form's fixed-copy catch hid it from Sentry too.

**How to apply:**
- In a plan, any `v.record(v.string(), …)` on an arg, a `returns`, or a schema
  field is a question: whose strings are the keys? Slot keys (`b0`/`s0`),
  level/facet names, NB enum keys and Convex/Clerk ids are safe; marketplace
  ids, checklist section keys/names and player/team names are not. The
  precedent shape is `attachPlatformIds`' `{ id, label }[]`.
- Convex deploys before the SPA is promoted (release.yml), so a wire-shape
  change is server-accepts-both (union) in the same PR; the old branch stays
  for open tabs. No stored data moves when only an arg shape changes.
- Unit-prove it with `convexToJson` from `convex/values` on the exact args a
  mocked mutation received, with an accented id; convex-test alone is not
  the browser's check.
- Internal CLI actions count too (the enrichment fixture capture returns
  entries keyed by `kind|qid|name`).
- An accented id in E2E has to come from the fake BSC's recordings; check the
  recording holds one before planning the spec around it.

Related: [[shape-probes-see-one-account-state]], [[fake-service-code-deploys-only-from-main]].
