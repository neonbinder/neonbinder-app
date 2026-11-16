---
name: browser-secrets-are-per-clerk-user-not-per-deployment
description: services/browser keys every saved marketplace session by `<site>-credentials-<clerkUserId>` (credKey), shared by every Convex deployment that signs in the same E2E user; per-deployment test state there needs the deployment in the key, not a clash guard
metadata:
  type: project
---

`credKey(site, userId)` in `apps/web/convex/credentials.ts` is the ONLY name the
browser service stores a session under, and Secret Manager is one store per GCP
project. Every Convex deployment (shared dev, each worktree deployment, each PR
preview) that signs in the same Clerk test user (`TEST_EMAIL`, workers 8-11
locally) reads and writes the SAME secret. Convex rows (`userProfiles`, call
gates, sale cursors, seller id) are per deployment and are not the hazard.

**Why:** NEO-552 namespaced the fake BSC per deployment+user, but the stored
session still lived at the per-user key, so a concurrent seed elsewhere
overwrote it. A guard that refuses on mismatch only turns the overwrite into a
red; re-signing on mismatch ping-pongs and has a TOCTOU window in which one
run's token writes into the other run's namespace.

**How to apply:** isolate by putting the deployment into the key, in test mode
only, behind the one key function (prod stays the bare per-user key), and give
those secrets a lifecycle (TTL), because Secret Manager bills per active
version and previews/worktrees are many and short-lived. The browser service treats the key as opaque
under `KEY_PATTERN`, so the key change needs no contract bump; an env-mismatch
guard (a test key reaching a real-mode browser revision) belongs on both sides.
Same shape exists for SportLots/eBay/EasyPost keys, benign today because each
is one shared account with identical values. See [[fake-bsc-and-bsc-write-capture]],
[[spare-worker-indexes-share-one-account-on-dev]].
