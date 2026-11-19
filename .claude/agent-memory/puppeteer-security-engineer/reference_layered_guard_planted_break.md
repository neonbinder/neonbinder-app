---
name: layered-guard-planted-break
description: when two layers refuse the same input, a planted-break proof only goes red if the test asserts the first layer's own reason
metadata:
  type: reference
---

A fake-marked credential key in prod is refused by the route guard AND, if that is removed, by the pinned-URL resolver (which throws in prod). A test that only asserts "refused, nothing called" stays green when the first guard is deleted. Assert the specific refusal reason (logged, never returned) and the status the first guard gives; then the planted break (comment out the guard line, rebuild, run) turns the test red. Restore and rebuild after.

Also: when a new field is added to /health, `tests/bsc-endpoints.test.mjs` deep-equals the whole body and must be updated.
