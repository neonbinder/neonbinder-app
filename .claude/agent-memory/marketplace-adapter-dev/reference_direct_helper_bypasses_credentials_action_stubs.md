---
name: direct-helper-bypasses-credentials-action-stubs
description: Replacing runAction(child) with a plain helper call skips every vi.mock stub of the child action; stub the helper too, and spy _handler to prove no hop
metadata:
  type: reference
---

When an adapter stops using `ctx.runAction(internal.credentials.getSiteToken)` and calls an exported plain function instead (NEO-605, `siteTokenForCurrentUser` / `readBscToken`), every test that `vi.mock("./credentials")` with a stub `getSiteToken: internalAction(...)` silently stops being consulted: the real function runs (about 15 test files went red). Fix per file: build the stub as a `const`, export it, and add a twin `siteTokenForCurrentUser: (ctx, site) => stub._handler(ctx, { site })`. A plain-function twin keeps `...actual` semantics for everything else.

**Why:** the stub lives at the Convex-function boundary, the helper call does not cross it. Run the whole `convex` vitest dir after such a change, not just the adapter folder (the adapters folder was green while 15 root-level files were red).

**How to apply:** to prove a call site makes no action hop, `vi.spyOn(fn as {_handler}, "_handler")` on the wrapper action and on the credentials action, assert zero calls, and add a control that invokes the wrapper through `t.action` and sees exactly one. Every BSC entry that reads the token sits behind `requireAdmin`, so the only identity-less probe of the helper is the `getBscToken` wrapper itself (`t.action` without `withIdentity` answers `Failed to get BSC token: Not authenticated`).
