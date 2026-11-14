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

Related: [[patterns-cross-run-artifacts]], [[patterns-neo355-reverse-oidc-tokeninfo]], [[patterns-unauthenticated-probe-functions]].
