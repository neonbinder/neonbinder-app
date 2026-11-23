---
name: pattern-capped-history-router-test
description: Bounding URL history in a long walk (push to a depth cap, then replace) and testing it against a browser-like capped session history
metadata:
  type: feedback
---

Chromium keeps at most 50 session-history entries, and `history.go(-n)` past what is kept does nothing. A flow that pushes one entry per step and leaves with `navigate(-(depth+1))` silently stops leaving after ~48 steps. Fix that keeps browser Back stepping through steps: push while depth is below a named cap (40), replace after, depth stays at the cap, so leaving always reaches the opening page. Footer Back past the cap must not use `navigate(-1)` (the entry behind is many steps back); replace to the position the step left, carried in `location.state`.

**Why:** NEO-645 Done/Esc/Save for later failed at ~92 skipped cards. Jason chose the cap over a one-entry walk because Back stepping to the previous card is the behaviour he wants.

**How to test it:** react-router exports `unstable_HistoryRouter` and `UNSAFE_createMemoryHistory`. Wrap the memory history with `Object.create(base, { push, replace, go })` overrides that count pushes, evict the oldest past 50, and make `go` a no-op out of range. Pass `v5Compat: true` to `createMemoryHistory`, otherwise the history never notifies the router and the URL looks frozen. Mutate the cap constant to prove the test bites.

**How to apply:** any hook or page that moves through a long list via the URL.

Note: agent memory goes to the repo-root `.claude/agent-memory/`, never `apps/web/.claude/`.
