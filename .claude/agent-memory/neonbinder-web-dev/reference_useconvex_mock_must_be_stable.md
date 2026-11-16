---
name: useconvex-mock-must-be-stable
description: A vi.mock of convex/react whose useConvex returns a fresh object per render loops any effect with `convex` in its deps — the test times out at 5s with no error
metadata:
  type: reference
---

`vi.mock("convex/react", () => ({ useConvex: () => ({ query, mutation }) }))`
hands the component a NEW client object on every render. Fine for components
that only call `convex.query` in handlers, but a one-shot read in an effect
(`useEffect(() => { convex.query(...).then(setX) }, [convex, ...])`) re-runs
every render: the fetch resolves, sets state, re-renders, gets a new `convex`,
fetches again. The symptom is a bare "Test timed out in 5000ms", nothing else.

**How to apply:** hoist the client to module scope in the test
(`const client = { query: mockQuery, mutation: mockMutation }; useConvex: () => client`),
as the real `useConvex()` is stable. Do not drop `convex` from the effect's deps
to dodge it (react-hooks/exhaustive-deps, and it is correct to list it).
First met in NEO-528's EveryCardPlayerControl (fetch-once above set level).
Related: [[reference_component_tests_hand_build_the_api_mock]].
