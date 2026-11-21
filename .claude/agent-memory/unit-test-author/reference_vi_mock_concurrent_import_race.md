---
name: vi-mock-concurrent-import-race
description: Async vi.mock factory with importOriginal races when two first-imports overlap; adapter silently gets the REAL module. Fix is a top-level warm-up import. Shard runs expose it, isolation does not.
metadata:
  type: reference
---

Symptom: a test that mocks `./credentials` (stub `siteTokenForCurrentUser`) passes alone and in
full runs but fails ~1 in 2 under `vitest --shard`, with the real `Failed to retrieve token ...
site_token_failed` log and a sync status "error". Heavy CPU load from parallel copies of the
single file did NOT reproduce it; only the busy shard did.

Cause: vitest's mocker (`callFunctionMock`) does not dedupe an in-flight async factory, and its
own source says `Promise.all(import(), import())` does not work for mocks. The adapter import and
convex-test's function loader (`runAction` on a `credentials` function) first-import the mocked
module at the same moment (BSC and SportLots sides fetched together); the factory is built twice
or one importer falls through to the real module.

Fix: right after the `vi.mock("./credentials", ...)` block, a top-level `await import("./credentials");`
so the mock is cached before any test runs. Applied to every convex test that stubs
`siteTokenForCurrentUser` (copy-pasted mock, about 18 files). New tests copying that mock must keep it.

Diagnosis recipe: append probes with `fs.appendFileSync` to a scratchpad file (console output from a
hoisted factory is swallowed), log a stack in the factory, count factory starts vs stub calls.
Proof recipe: 5-8 repeated `npx vitest run --shard=1/3`, grep the failing file in each log.
