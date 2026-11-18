---
name: full-suite-load-and-test-timeout
description: Full-suite load slows happy-dom component tests 3-4x; the components project runs with testTimeout 20s
metadata:
  type: project
---

`npm run test:unit` runs ~900 happy-dom files at once, and a component file can run 3-4x slower than alone. A multi-step walk that takes ~1 s alone (panelLink's ends-of-batch test) hit vitest's 5 s default once. The `components` project in `apps/web/vitest.config.ts` now sets `testTimeout: 20_000` (NEO-591).

**How to apply:** a lone "Test timed out in Ns" with no assertion error, in a test that passes fast alone, is load against the clock. Check for a real race first (unawaited updates, missing findBy/waitFor, timer leaks, shared module state). Only then look at the timeout; never trim a walk that is the point of the test.
