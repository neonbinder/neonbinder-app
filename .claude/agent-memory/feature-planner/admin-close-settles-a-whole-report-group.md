---
name: admin-close-settles-a-whole-report-group
description: A write that settles a group across owners (syncReports.close per variant + platform) lets one worker's spec end another worker's row; give each such spec its own group key
metadata:
  type: project
---

`syncReports.close` settles every open report on the same variant and platform, whoever sent it (correct product behaviour: the fix is to the shared catalog). Every E2E account is an admin, so two specs on different workers that each file a report on the same variant and platform collide: one spec's close removes the other's open report, whose Withdraw button then detaches mid-click (seen 2026-11-18, the no-league and report-to-crew dashboard specs, both on the seed's Topps Chrome Base on eBay).

**Why:** R7a covers shared sets, but a per-user row can still be reached through a group-wide admin write.

**How to apply:** when planning a spec that writes a row an admin action handles in bulk (close, approve, decline by group), give it a group key no other spec uses (here: box a card from a different registered set, since the seed hangs the hold on the copy's variant), and record the key in SET-REGISTRY.md. To attribute a vanished row, order the group's mutations in the deployment-wide Convex log by time; the other worker's write sits within a second of the detach. Related: [[e2e-accounts-are-all-admins]].
