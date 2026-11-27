---
name: reference_hold_from_first_commit_needs_a_render_time_mark
description: A layout/passive effect cannot hold a freshly mounted child's first DOM, since uSES rows subscribe passively; mark an external store during the parent's render
metadata:
  type: reference
---

A child that reads an external store through `useSyncExternalStore` subscribes in a PASSIVE effect, so a parent's `useLayoutEffect` bump is not seen until the passive phase: the first committed DOM is unchanged, so `useLayoutEffect` is not enough for "held from the first commit". Parents render before children in one pass, so an idempotent, non-notifying `Set.add` on the store during the parent's render is read correctly by the children. The effect then does the call and releases it. Do not read `ref.current` in that render (`react-hooks/refs` is an error): keep the "already asked" card id on the store. Test it with a sibling probe placed AFTER the host, whose layout effect reads `document.body.textContent` in the first commit (NEO-680 `useLinkOnOpen`, PlayerTile.test.tsx).
