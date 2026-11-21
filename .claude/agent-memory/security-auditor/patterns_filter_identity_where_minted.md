---
name: filter-identity-where-minted
description: An identity filtered only at the last scheduled hop still persists in earlier hops' _scheduled_functions args; filter where it is minted
metadata:
  type: reference
---

Filtering an identity (a Clerk subject, an operator id) at the last scheduled hop leaves it in every earlier hop's `ctx.scheduler.runAfter` args, which Convex persists in `_scheduled_functions`. Filter at the server site that mints the value, and keep the sink filter as defence in depth.

**How to apply:** when a change threads a user identity through a scheduler chain and the identity is only needed in some modes (e.g. the fake BSC), check every `runAfter` hop, not only the final consumer. Related: [[patterns_actions_cache_writer_enumeration]].
