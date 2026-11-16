---
name: fake-service-code-deploys-only-from-main
description: The standing marketplace fake deploys only from main, so a new fake capability must merge (and its recordings load) before the PR whose E2E calls it; fakes are IAM-gated, so nothing browser-facing can live there
metadata:
  type: project
---

The fake (`services/fake-bsc`) is one standing dev Cloud Run service. Its deploy
lane runs from `release.yml` on main; a branch cannot deploy it (the per-PR
fake workflow only builds and tests). A PR's E2E therefore always runs against
main's fake, never the PR's fake code (NEO-552 follow-up found this the hard
way). Host pins in Convex and the browser service also refuse tagged-revision
URLs, so a per-PR fake revision is not an option without loosening a security
control.

**Why:** a plan that adds fake routes and the app code that calls them in one
PR goes red in CI on every call to the new routes (501 or 404), and a fake
needing recordings is red until they are loaded after deploy.

**How to apply:** sequence fake work as PR A (fake capability, inert: nothing
calls it yet, plus any recorder/probe that loads its data) -> release -> load
recordings and run drift -> PR B (app cutover + specs). Say so in the plan as
the reason for two PRs. Also: the fake sits behind Cloud Run IAM with no
`allUsers`, so a step a real user's browser takes (an OAuth consent page) cannot
be served by the fake; put it on a testing-only SPA route on the deployment's
own origin, backed by a Convex testing action that asks the fake server side.
Related: [[fake-bsc-and-bsc-write-capture]], [[browser-secrets-are-per-clerk-user-not-per-deployment]].
