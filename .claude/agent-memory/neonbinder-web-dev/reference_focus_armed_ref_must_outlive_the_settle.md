---
name: reference-focus-armed-ref-must-outlive-the-settle
description: A "focus Change after the save" ref must stay armed until the target mounts; a write can settle a render before the reactive plan carries the new state
metadata:
  type: reference
---

On a first pick the mutation resolves (savingChoice false) before the reactive query delivers the new source, so an effect that disarms "once the save settled and the target is absent" drops focus on the heading when Change draws a render later. Stay armed until the target mounts; disarm only on a reason the target will not come soon (a run hiding it) or when the opposite request (reopen) overwrites the ref. Pin it with a rerender after the resolve, not before. See [[reference-park-focus-before-a-write-that-unmounts-the-button]].

A second always-mounted `role="status"` in a view breaks tests that use `getByRole("status")`: scope the old helper to `getAllByRole("status")[0]`.
