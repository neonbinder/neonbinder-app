---
name: patterns-neo552-fake-upstream-and-recorder
description: Standing fake of a marketplace behind Cloud Run IAM + a local recorder driven by its miss list - where the unsigned-token trust breaks, how a privileged recorder gets steered, and which probe outputs leak via public artifacts
metadata:
  type: project
---

NEO-552 added `services/fake-bsc` (a fake BSC on Cloud Run, IAM + caller key + admin key) and a laptop recorder that replays the fake's miss list against the REAL site with the owner's production seller token.

Durable audit rules:

1. **Unsigned `X-Serverless-Authorization` is only as strong as the IAM binding.** Cloud Run strips the signature after it verifies the header, so the app trusts unsigned claims when `K_SERVICE` is set. If invoker IAM is ever disabled or `allUsers` is bound, Cloud Run passes the header untouched and anyone can forge an unsigned token naming an allowlisted SA. The "allowlist fails closed if IAM loosens" claim is false for that path. Robust fix: callers also send the signed token in a custom header the app verifies itself; or a CI/Terraform check that the service has no allUsers and the invoker check is on.
2. **A recorder that replays an attacker-writable to-do list with a privileged token** (here: misses written by any caller-key holder, i.e. any same-repo PR's preview code) must validate each request's SHAPE (known body keys, sizes), not just the endpoint path, and show the list before sending.
3. **CLI numeric caps: `Number(flag)` turns a typo into NaN, and `Math.min(NaN, cap)` is NaN, so `sent >= NaN` never stops.** Grep every safety cap fed from argv/env.
4. **Probe "shapes only" outputs still leak data-as-keys.** A key filter of `^[A-Za-z_][A-Za-z0-9_$-]*$` passes a username or a hex id starting a-f. Seller/buyer endpoint shapes that go to a public GitHub artifact should be cut to the paths the parser reads (the comparator ignores the rest anyway).
5. **Two sides must agree on the base-URL form** (root vs `/api`): a gate that refuses a path fails closed, which is safe but breaks every call; check the workflow that writes the env against the resolver.

6. **A per-scope resource cap is only a cap when the caller cannot choose the scope.** The fake's hang cap (N held sockets per namespace) is bypassed by any caller that can open more namespaces; pair it with a process-wide ceiling.
7. **"Confirm, then refetch" is a TOCTOU.** A recorder that confirms on one read of the to-do list and then re-reads it inside the session sends whatever was added in between (and, in watch mode, everything later) without a second look; the allowlist is the real bound, the prompt only covers the first snapshot. Pass the confirmed plan in, or re-confirm when the set grows.

8. **A destructive sweep bounded by `key.startsWith(prefix)` is only bounded if the remainder is charset-checked and the key is path-encoded.** `fetch`/`URL` normalise `..` segments, so a key remainder containing `/../../` escapes the prefix and the request lands on `/credentials/<any key>`. Check the full key against a strict regex (and `encodeURIComponent` it) before the call, not just its prefix.
9. **Mode-gated key namespaces hold when both sides refuse the mismatch and each check keys on the call's own target.** Shape that held in NEO-552: Convex in test mode refuses any BSC credential call unless the browser's cached `/health` says fake; the browser refuses test-form keys while real, and non-test usernames (transient AND stored) while fake, before any network call; the forced-real recorder passes its own empty env so the guard follows that call, not the process. Check every adapter entry that reads a stored session sits behind the guard, and that a missing username fails closed.
10. **Adding token renewal to a capped recorder removes token lifetime as the implicit time bound on a watch session.** The request cap is then the only bound; confirm renewals happen only before a send (so they are bounded by the cap) and are never retried (B2C rotates the refresh token).

11. **"Undo only the row carrying our SKU" is only as narrow as the SKU namespace.** If the operator picks the SKU freely, it can equal a SKU the production app writes (here NEO-370's `NB1-...` listing SKU, which the sales poll parses back to an NB card/box). Then undo can take down an NB-made listing and a sale of the capture can be routed to a real copy. Require a capture-only prefix the prod parser rejects, and refuse the prod prefix outright.
12. **A real write whose follow-up fails still needs the undo hint.** "capture failed: timeout" after the PUT was sent (or the shape upload refused after a 2xx) leaves a live listing with no instruction to take it down. Key the hint on "the write was sent", not on overall success.
13. **A manual real-write tool should write the minimum.** Capturing a response shape needs quantity 1 at a deterrent price; a 1..100 quantity range is a purchasable-inventory risk for no capture benefit.

14. **"Refuse if already listed, then write" is a read-then-write race with the production app on the same account.** A manual capture tool's guard read and its PUT are seconds apart; if the connected app lists the same row in between, the capture overwrites it and the capture-SKU undo then takes down what was the app's listing. Acceptable for an operator-run, one-shot tool; say so in the README (pause the app's pushes for that card, or pick a card the app never lists) rather than claim the guard is absolute. The undo also leaves the row's SKU and price as the capture set them (quantity 0), which is harmless only while the app rewrites SKU on its next list.
15. **Unknown keys in an operator request file should be refused, not ignored.** Ignoring is safe when the tool rebuilds the body from validated fields, but a refused `qty: 5` tells the operator their file does not mean what they think; check both the top level and the nested intent.

16. **Persisting an attacker-writable list adds a spend vector that a total cap does not bound.** A create-only object per new key, capped at N in all with oldest-first eviction, still lets any writer drive one create (plus one delete past the cap) per request forever. Pair the total cap with a process-wide write rate (token bucket; over it, keep memory-only and count it in a log line), and remember oldest-first global eviction lets one owner push out everyone else's entries.
17. **A boot sweep that deletes "objects of another schema/allowlist version" must delete only OLDER versions.** An older revision cold-starting (rollback, overlapping deploy) otherwise wipes what the newer one kept. Leave higher versions alone.
18. **A hot-path await on "all in-flight persistence" couples unrelated requests.** A 501 that awaits a global flush also waits on an admin bulk delete; await the request's own promise.

Related: [[patterns-cross-run-artifacts]], [[patterns-neo355-reverse-oidc-tokeninfo]], [[patterns-unauthenticated-probe-functions]].
