---
name: removing-stored-rows-hides-implicit-guards
description: When a stored per-name table goes, audit the guards and deferrals that its row's mere existence enforced (on-card check, lookup deferral, origin whitelist)
metadata:
  type: feedback
---

A stored row does more than hold an answer. Removing `tidyNames`/`cardPrintedNames` (NEO-656) silently dropped three things that rode on a row existing:
- the "name isn't on this card" refusal (the resolver required a printed row);
- the deferred Wikidata lookup for names that already have a same-name choice or preselect (`awaitsOperatorBeforeLookup`: born `ready`, asked only on "Add anyway");
- an origin whitelist applied when the gate wrote its auto answer (a team link was taken only for setHistory/careerTeam).

**Why:** parity audits that diff only the obvious read and write paths miss these. Every one of them became drift.

**How to apply:** in a storage-removal plan or parity audit, grep the deleted writer's (`upsert…`) and resolver's (`resolveName`) bodies for refusals and status choices. Port each one to the new trust point (the commit re-check, the action args) or mark it flow-required explicitly. Also confirm that a retained "retry overlay" path is still reachable from the UI's retry condition. See [[removing-a-seen-ack-needs-a-per-kind-fix-audit]].
