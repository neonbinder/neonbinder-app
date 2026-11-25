---
name: reference_moderadiogroup_empty_value_means_nothing_checked
description: ModeRadioGroup with value "" renders a radiogroup with nothing checked; use it for "pick one, no default"; labelId lets another control describe the group
metadata:
  type: reference
---

`components/primitives/ModeRadioGroup` takes `value: ""` and renders every radio unchecked (first is the Tab stop; arrows choose). Use it for "nothing preselected" pickers instead of a new component. Its optional `labelId` puts a known id on the visible label so an `aria-describedby` elsewhere can point at the question.

A section that already holds `useConvex()` can call `convex.mutation(...)` on click rather than `useMutation`: ~50 existing tests mock `convex/react` without `useMutation` and break on render otherwise.
