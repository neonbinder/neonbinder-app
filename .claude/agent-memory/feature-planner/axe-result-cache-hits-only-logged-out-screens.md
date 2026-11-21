---
name: axe-result-cache-hits-only-logged-out-screens
description: An exact-hash axe skip can only hit logged-out, backend-free screens (~5% of suite axe time); signed-in screens carry per-account avatar URLs and per-seed ids
metadata:
  type: project
---

Estimated for NEO-628 (2026-11-20) from one green run's per-spec axe time: home/* plus dashboard/demo-* (no sign-in, no Convex data) were 194 s of 3,608 s of axe, both passes and all shards: at most about 12 s per shard per pass, about 0.4 min per queue run, before the cost of hashing and restoring the cache.

Signed-in screens rarely repeat byte-for-byte: Clerk's UserButton avatar URL is per test user (and the spec-to-worker mapping moves as timings change), links carry Convex ids minted per seed, and Tailwind's one CSS bundle changes whenever any PR touches classes. Within-scoped checks still need the whole document in the hash (contrast reads ancestors and overlapping elements).

**Why:** caching axe looks like a big win because axe is about 17% of shard time, but the expensive calls are the big-DOM, data-backed screens that can never match.
**How to apply:** for any "skip identical work" idea in the E2E suite, first count how much of the cost sits on screens with no per-run data. Scoping (`within`) and smaller fixtures beat caching. Related: [[system-theme-makes-os-colour-scheme-a-test-input]].
