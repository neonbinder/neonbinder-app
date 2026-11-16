---
name: shared-fast-pool-read-ceiling
description: NEO-529 — placeholder "All N photos read." waits use FAST_READ_CEILING because the preview's fast preprocess pool is shared by all shards; no spec proves fast-vs-heavy
metadata:
  type: feedback
---

On a PR preview the fast preprocess pool is a few slots wide and every shard shares it, so a fast-path read that is ~3 s alone can queue to 8-10 s behind another shard's photo spec. Use `FAST_READ_CEILING` (support/placeholder-intake.ts, owner-approved) on every "All N photos read." wait after an upload; never the bare 7 s.

**Why:** a merge-queue red landed 0.5 s late; every call returned 200, nothing was cold (read the request log per instance, not a timing theory). Jason: no spec needs to prove "fast vs heavy", only that images get through in the ceiling; that split lives in the preprocess pytest.

**How to apply:** a placeholder spec whose only extra claim is the fast path gets deleted (and its timings.json rows), not given a bigger wait. Keep specs that prove something else (pairing order, review crops, print mirroring). The ceiling goes void if the preview fast width or the fast-pool callers' call length changes.
