---
name: reference-wizard-extra-query-lives-in-a-child-component
description: A new per-step read for EntityReviewWizard goes in a child component that owns its useQuery, so the ~10 wizard test files with hand-built api mocks keep passing; ship heavy data on-demand, keep getBatch slim
metadata:
  type: reference
---

EntityReviewWizard tests hand-build the `api` mock literal, so an `api.<module>.newFn` read in the wizard body fails every one of them at render. Put the read in a child component (`TeamStepContext`) rendered only for the step kind that needs it: the other tests never mount it. Its own test file adds the ref to its api literal and routes `useQuery` by ref string.

Keep the subscribed `getBatch` row slim (ids only, e.g. `teamContext.candidateTeamIds`); expose the heavy join (stints, labels) as a separate admin-gated, on-demand query, and pin it in `publicFunctionAuth.test.ts`.

A step the gate auto-links must carry the same context as one it asks: Change (`clearDecision`) turns it back into a step. See also [[reference-component-tests-hand-build-the-api-mock]].
