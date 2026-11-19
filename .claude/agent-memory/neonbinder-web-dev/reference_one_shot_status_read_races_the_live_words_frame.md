---
name: one-shot-status-read-races-the-live-words-frame
description: NoticeLine words (useLiveWords) reach role=status one requestAnimationFrame after the notice lands; a getAllByRole("status") read straight after a find* or act is flaky, wrap it in waitFor
metadata:
  type: reference
---

Text on the status line (`NoticeLine`, drawn by `useLiveWords` in
`app/collection/prototypes/p1/notice.tsx`) is written a frame after the notice
exists. A test that reads `getAllByRole("status")` right after a `findBy*`, or
after `await act(async () => ...)` (which flushes microtasks, not frames), passes
locally and fails under load (NEO-587). Wrap the positive read in
`await waitFor(() => expect(...))`, or `await frames()`-style wait as
`CardDrawerMove.test.tsx` does. Negative reads (`toBe(false)`, `not.toContain`)
taken after a positive `waitFor` on the same line are safe. Other `role="status"`
regions (counts, skeletons, `CopyPhotosField`'s own line, "Page URL") are drawn
directly and need no wait.

Notice timers: a `setTimeout(() => setX(null))` must clear only its own value
(`prev?.id === id ? null : prev`), because it can fire between a newer value
committing and the effect cleanup running. Two writers sharing one `toast`
state must share one timer ref (`EntityColumn`'s `showToast`).
