---
name: one-fake-host-pin-shared-by-both-marketplaces
description: Fake-marketplace host pin and request signer live in lib/fakeMarketplace.ts (no fetch, no BSC host); a second fake marketplace reuses it instead of copying
metadata:
  type: reference
---

When a second marketplace joins the standing fake, share the pin and signer (`isFakeServiceHost`, `signForFake`), do not copy them. `bscHttpSeam.test.ts` pins that `lib/bscHttp.ts` holds the only two send sites and that no marketplace host appears outside it, so the shared module must contain no `fetch(` and no host literal.

- The adapter that sends (eBay seller client) re-resolves the BSC target at send time and throws if it is not fake; a throw from signing becomes a `network` failure and nothing leaves.
- A fake-mode switch (`EBAY_ENVIRONMENT=fake`) keys naming/cleanup on the REQUEST for fake, not on config validity: an unusable fake setup must be refused, never fall back to a bare key or another environment.
- A strict echo check on a browser-service answer (connect `environment`) is the guard against a bare key accepting a fake answer: expected value comes from the deployment's own config, compare with `!==`, test both directions.
- Control actions that return a body need their own helper (the BSC `control()` discards it); keep return shapes `{ok, skipped, ...} | {ok:false, status?, error, detail?}`, except where a caller contract says a bare `{code}` (then throw fixed messages).
- Bound seeds/orders on the Convex side with the fake's own limits so a bad seed never leaves; test each bound with `test.each` plus "fetch not called".
