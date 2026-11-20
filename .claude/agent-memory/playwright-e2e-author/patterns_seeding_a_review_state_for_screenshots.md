---
name: seeding-a-review-state-for-screenshots
description: How to stage a signed-in review state (seeded sales, Pick List) and shoot desktop/phone light/dark screenshots without touching the repo
metadata:
  type: reference
---

For a "prepare it for Jason's look" task (seed data, then screenshots), no spec is written:

- Drive the app's own `/testing/*` hops from a throwaway CommonJS script in the session scratchpad that
  `require`s `apps/web/node_modules/playwright` by absolute path. Sign in once per context with
  `/testing/sign-in?redirect=<path>&worker=<n>`, then `page.goto` the hop (e.g. `/testing/seed-pick-order?platform=ebay&order=<tok>&line=<qty>:<title>`, up to 3 `line`s per order; `line=1:` = no title).
  Re-seeding an existing order number re-records it unchanged, so a rerun is safe.
- Catalog-only public queries that just `requireSignedIn` can be probed with
  `npx convex run <mod>:<fn> --identity '{"subject":"probe"}' '<json>'` (the subject need not be a real user).
- Light/dark: emulate `colorScheme` per context; it only works while the user's Profile theme is System
  (check the two shots actually differ). Phone: `devices["iPhone 13"]` with a 390 viewport (3x DPR, so
  full-page PNGs are tall; crop with `sips -c H W --cropOffset Y 0` to inspect).
- To replace an earlier review seed, sign in with `redirect=/testing/reset` (wipes only that worker's own
  rows; lands on /dashboard) and seed again. `devices["iPhone 13"]` carries `defaultBrowserType: "webkit"`;
  drop it from the spread to shoot in Chromium like the e2e-mobile project.
- Gate the shot on a perceivable handle of the state you seeded (a band's `rowheader`), not on text that a
  hidden `<option>` also carries (`getByText("Other")` resolved to the Sport filter's option).
- Screenshots go to `<worktree>/screenshots/` (git-excluded via info/exclude), never `apps/web`.

- **A review seed sits on the account your specs would use.** Workers 3-11 locally all fall back to the
  one `TEST_EMAIL` user, so a review seed made on worker 8 shows up in a later spec run on any of them: a
  Pick List band count read `Received: 5` against `2` (the seed's own titled orders filled the band).
  Do not reset it (it may be what Jason is looking at): bootstrap a worker with its own
  `TEST_EMAIL_<n>` (check `gh run list --status in_progress` is empty first, CI signs in as those) and
  run the specs there. Read the band's rowheaders in error-context before suspecting the product.

Related: [[patterns_local_run_backend_and_vite]].
