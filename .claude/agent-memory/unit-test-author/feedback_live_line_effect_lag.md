---
name: live-line-effect-lag
description: LiveLine (role=status) text is written in a passive effect, so a sync read right after a visible-text waitFor is a load-dependent race; wait on the live node itself
metadata:
  type: feedback
---

`LiveLine` (components/modules/RunLedger.tsx) sets its node's `textContent` in a
`useEffect`, one tick after the visible line renders. Waiting for the visible
text and then reading `[role="status"]` synchronously flakes under load.

**Why:** ParallelBuildPanel.titles.test.tsx failed once in a full run ("Built 3
parallels." where "Every title fits now..." was expected).

**How to apply:** `waitFor(() => expect(liveNode.textContent).toBe(...))` on the
live node. Prove a fix of this kind by copying the test to a temp `zz.*.test.tsx`
with `vi.mock` of the module replacing the effect with a 30 ms `setTimeout`
write; old version fails, fixed passes; delete the copy. Also: a test that
returns after the first mocked query call leaves a loader loop in flight that
calls the shared mock after the next test's reset; wait for the whole sequence.
