---
name: patterns_route_key_is_the_object_name_not_the_path
description: Routing one of two concurrent PUTs - key by object name, match by pathname, event-based waits
metadata:
  type: pattern
---

A photo upload retry goes to the bucket's own host, whose pathname has no bucket prefix, so the same object has two different pathnames across tries. A spec that tells "the held photo" from "the other photo" by whole pathname counts the retry as a second photo and goes green on the old sequential code.

**Why:** NEO-466 "saves both at once" spec first passed against the pre-fix build for exactly this reason; only a run on the pre-fix code showed it.

**How to apply:** capture the object name with a regex group (`/copy-photos/([0-9a-f]{32})/image\.`) and compare that. Prove a concurrency spec red on the pre-fix code: `git archive HEAD apps/web` into the scratchpad, symlink node_modules, copy .env.local, run a second Vite on a spare port, point APP_URL at it (no git state touched), then remove it. Hold every try of the held object until the release, so the 2.5 s stall timer cannot let it finish early. See [[patterns_route_key_is_the_object_name_not_the_path]].

## Route only one of two concurrent puts

When a flow sends two requests side by side (copy photo: image and thumb PUTs to the store), a total PUT count is not deterministic. Route the store but force only the one under test: match `new URL(request.url()).pathname` against the object name (regex on the path), `route.fallback()` the rest, and count only the forced file.

**Why:** signed URLs carry credentials and the host carries an account id, so a failing `expect(a).not.toBe(b)` on hosts would print them into published artifacts.

**How to apply:** compare hosts in-test into booleans (`const same = a === b; expect(same, "msg").toBe(false)`), never put a URL or host in a message. Await a console line with `page.waitForEvent("console", { predicate })` started BEFORE the action (event-based, no `expect.poll`). Before moving `page.clock.fastForward`, await the other concurrent request's `requestfinished`, so the jump cannot cut a live request short. `page.clock.install()` alone runs time at the real pace, so a real-time stall case and a fastForward case can share one test.
