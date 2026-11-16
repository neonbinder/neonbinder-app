---
name: adopting-specs-need-reseed-for-planted-break
description: Specs that adopt a committed checklist assert stored values, so a planted product break only goes red after a real reseed; a failed reseed lets them pass silently
metadata:
  type: feedback
---

A spec that branches "empty -> fetch and commit, else adopt the committed checklist" asserts values the SERVER WROTE AT COMMIT (card titles, descriptions). Pushing a planted break in `convex/` and rerunning changes nothing if the checklist is already committed, so it stays green.

**Why:** a local reseed helper whose reference bundle path no longer exists prints one error line (`NB_REFERENCE_BUNDLE is set but is not a file`) and carries on; setup and bootstrap then run on the old data and the specs adopt it. The green looks like a pass of the fetch branch and is not.

**How to apply:** before a planted-break proof for such a spec, confirm the reseed really ran (`import took ...` in its output); if the bundle is missing, fetch it again (the seed URI repo variable, copied to a scratch folder outside the checkout) and point the helper there. Reseed before EACH plant and before the final green run.

Also: a card's committed listing title needs an exact-string assertion, not a regex with optional parts; compute the expected value from `generateListingTitle` in a scratch `npx tsx` script first, then confirm live.
