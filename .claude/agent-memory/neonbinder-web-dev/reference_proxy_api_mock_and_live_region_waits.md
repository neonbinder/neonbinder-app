---
name: reference_proxy_api_mock_and_live_region_waits
description: Component tests that render a tree of many convex modules mock `api` with a Proxy that returns "module.fn" strings; a delayed live-region lead-in needs findByText, and a pre-fill derived in render beats an effect
metadata:
  type: reference
---

- A tile that renders several shared panels reaches `api.<module>.<fn>` in
  children the test never names. Mock `convex/_generated/api` as a Proxy that
  returns `"module.fn"` strings (return `undefined` for symbols and `then`, or the
  module becomes thenable and the import hangs), and drive `useQuery` / `useMutation`
  from a ref-keyed map (a query result may be a function of its args). No enumerating
  every ref, and a new `api.x.y` in a child never breaks the suite at render.
- A lead-in that is an announced live region (`useAnnouncedText`, empty until a
  beat after the rows) is not there on the first render: `await findByText`.
- Pre-fill state ("untouched = the suggestion, first press makes it mine"): hold
  `null` until touched and derive `chosen = touched ?? (ready ? prefill : [])` in a
  memo. Seeding it from an effect trips `react-hooks/set-state-in-effect`.
- A heading line made of a bold name plus a sentence in ONE `<p>` text-node run is
  unmatchable by `getByText`; give the sentence its own `<span>`.
