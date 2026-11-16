---
name: patterns_stale_chunk_injection
description: NEO-434 - stale-chunk injection and the analytics leak check in a spec
metadata:
  type: pattern
---

`support/stale-chunks.ts` answers 404 for every same-origin code file the page had not requested when `arm()` was called (no file name hard-coded; works on Vite dev `/app/about/page.tsx` and a built `/assets/page-<hash>.js`).

- `page.on("request")` fires before a route predicate, so snapshot the seen set at arm time; route handlers cannot be unrouted mid-flight ("Route is already handled!"), so a flag the handler reads switches `fail-once` / `fail-always` / disarm.
- Arm right before the click that needs the chunk. Signed out, `Get Started` visible means the entry bundle is done; measured no late code requests in either mode, and the spec asserts `blockedUrls()` equals the one URL, so a stray blocked chunk fails loudly.
- "No reload" needs a positive anchor: wait for the 404 response, then drive a client-side nav (About) in the same document and assert zero main-frame document requests since arming (`navigations()`). The landing page re-renders after a reload, so URL/visible checks alone cannot see one.
- RED proof used two breaks: no-op the `window.location.reload()` (Recovers and Gives-up go red), and add a reload to the warm-up `.catch` in `app/landing.tsx` (warm-up spec goes red on the navigation count only).
- A new signed-out spec under `tests/home/` needs no registry, project-scope or timings entry (unknown specs get the median timing).

## Patterns analytics leak check in a spec

- Filter analytics by path `/ingest*` OR hostname `*.posthog.com` (the build's `VITE_POSTHOG_HOST` may be either). Under E2E only `e2e_page_start` and a few named events leave, one per full page load (two with StrictMode), sent at once.
- Bodies are gzip (`1f 8b`) or `data=` base64: decode both with `node:zlib` before searching a marker; use ONE alphanumeric token (survives any encoding).
- Positive anchor: `page.waitForRequest(isAnalytics, { timeout: 7_000 })` created before the full-page `goto`. It fails loudly when the build has no `VITE_POSTHOG_KEY` (proved by starting Vite with an empty key).
- Assert on a COUNT of leaking calls, never on the call array: a failing `expect` prints the whole body (and PostHog's public project key) into the published report.
- The PostHog `before_send` scrub already redacts `code` and `state`, so a marker in those never fails. Put the marker in an UNSCRUBBED eBay field (`expires_in`, `error_description`); only then does a no-op of `src/ebay-return-address.ts` turn the spec red.
- Back after a full-page return cannot prove the module (the landing already replaced that entry); the reload-replay assertion can: break the panel's `state: null` clear and the reload shows the refusal again.
- History state is not perceivable; GUIDE hard rule 8 licenses `evaluate` for the theme check only, so assert the user-visible consequence (a reload replays nothing).
