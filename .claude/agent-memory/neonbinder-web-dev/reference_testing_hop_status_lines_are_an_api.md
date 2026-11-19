---
name: testing-hop-status-lines-are-an-api
description: A /testing/*-fake hop page's status line is parsed by the DONE/FAILED regexes in playwright/support/<x>Fake.ts; a new op needs a success prefix the helper learns and a refusal that already matches FAILED
metadata:
  type: reference
---

`app/testing/bsc-fake/page.tsx` (and its `ebay-fake` twin) print one status
line the Playwright helper classifies with `DONE` / `FAILED` regexes exported
from `playwright/support/bscFake.ts`. The page test imports those regexes, so a
reworded line turns it red. When a hop gains an operation (NEO-555 `poll=1`):

- Start every refusal with a prefix `FAILED` already matches (`Give exactly …`,
  `Error:`, `Testing mode`, `?param=`), so the helper needs no change to see a
  failure. A bare new `?poll=` prefix is not in `FAILED` until the spec author
  adds it.
- The success prefix (`Polled`) is new to `DONE`; a builder who may not touch
  `playwright/support` pins the literal line in the page test and reports the
  exact string so the spec author extends `DONE`.
- Exactly-one-parameter message is shared by every refusal test: update it in
  one place and in the tests that quote it.

Related: [[interactive-controls-carry-no-dom-id]].
