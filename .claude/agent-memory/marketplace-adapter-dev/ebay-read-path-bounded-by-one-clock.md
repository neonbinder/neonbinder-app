---
name: ebay-read-path-bounded-by-one-clock
description: How the eBay policy-list read is held inside the 7 s UX budget, and where the "must hold the policy" wording really lives
metadata:
  type: feedback
---

The eBay policy read (`readPolicyLists` in `convex/ebayConnect.ts`) runs programs, then three lists side by side. Bound it with one shared deadline (`startPolicyReadBudget`, `sendRead` in `adapters/ebaySeller.ts`), 3 s a try, one retry on a timeout only, never a retry on an answer, refusal or network error. Optional calls (shipping metadata) get `retry: false`.

**Why:** a 30 s per-call timeout let one slow sandbox call blow the 7 s E2E budget, and the spec then blamed a missing policy.

**How to apply:** a timeout must stay `kind: "timeout"` and reach the caller as "eBay took too long to answer"; only an answer from eBay may decide "no such policy". The "must already hold the policy" sentence is a Playwright spec message (`mustHoldPolicy`), not server copy: guard it with a check that the page's "Try eBay again" button is not showing. Test slow calls by making the stubbed fetch throw a `TimeoutError`; spy `AbortSignal.timeout` to assert the wait.
