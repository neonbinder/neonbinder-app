---
name: fake-bsc-miss-store-test-patterns
description: services/fake-bsc durable-miss and sheet-drift test recipes; unref'd flush timer, macOS sed, which owners can reach which endpoints
metadata:
  type: reference
---

- `node --test` fails a test with "Promise resolution is still pending but the event loop has already resolved" when the only pending work is a hung store plus `flushMisses`' unref'd timer; hold the loop with a ref'd `setInterval` for that test (HTTP tests are fine, the socket holds it).
- Inject store failure or a hang by replacing `createOnce` / `deleteVersion` / `listVersions` on the MemoryStore instance; a `gate()` promise gives hand-driven interleaves (delete queued behind a slow create, restore racing a new miss).
- Only `cardListing` misses can be prefix- or anon-owned (`x-nb-fake-ns` header); filters/results need a BSC token, so use `state.recordMiss(owner, ...)` directly for those owners.
- Break-check by editing `dist/` (not src) with `sed -i ''` (macOS), restoring from a copy and comparing with `cmp`; a sed that matched nothing reports "0 failures", so grep the pattern in dist first.
- Drift sheet: probe fixtures use the probe dialect (`results[].x`); required vs listed-only is `synthShape("sheet").required`.
