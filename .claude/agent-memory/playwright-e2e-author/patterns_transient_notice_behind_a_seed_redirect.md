---
name: transient-notice-behind-a-seed-redirect
description: A spec that asserts a transient status (heavy "closer look" notice) on a page reached through an upload-then-redirect seed route only sees it if the window outlasts the upload; read the window from Convex log timestamps
metadata:
  type: feedback
---

A `/testing/seed-*` route that awaits a whole upload and only then navigates
(seed-placeholder-upload does) hides every server state that starts AND ends
during the upload. A spec asserting such a state on the destination page (the
placeholder "A few of these need a closer look…" notice = `deriveHeavyWarming`:
first escalated image processing, none resolved) goes red whenever the window
closes before the page's first subscription.

**Why:** NEO-528 triage, 2026-11-16: `pipeline-escalation-cold-start` went red
4/4 merge-queue runs while green runs had the SAME heavy latency (first heavy
call 2-3 s, consistent with the dev result cache). The variable was the order:
green = first `noteHeavyStart` after the last `confirmPlaceholderImageUpload`;
red = first `processHeavyEntryWorker` finished 0.1-1.1 s BEFORE the page's
first `getPlaceholderJob`. Faster fast-service declines (0.9 s vs 1.3-2.2 s)
plus slower uploads (0.7 s/photo vs 0.4 s) flipped it.

**How to apply:** for a "notice never appeared, everything else finished"
red, line up in the deployment-wide convex-logs: last upload confirm, first
`noteHeavyStart`, first heavy worker completion, first page query. If the
window closed before the page mounted, the spec cannot pass and the cause is
neither timing nor the PR: it needs an uncached/cold escalation or the
assertion moved to where the window is observable (propose to Jason; never
weaken it silently). Related: [[never-diagnose-timing-first]].
