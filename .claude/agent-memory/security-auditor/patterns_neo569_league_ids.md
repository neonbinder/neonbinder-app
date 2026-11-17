---
name: patterns-neo569-league-ids
description: NEO-569 set/card league ids — auth registry entry made vacuous by a body-level refusal; a new listing hold reason freezes qty/price on every live listing until a backfill runs
metadata:
  type: feedback
---

Two durable checks from the NEO-569 audit (set `leagueIds`, card `leagueId`, eBay League aspect):

1. **Registry entry vacuous by a body refusal.** `publicFunctionAuth.test.ts` asserts "non-admin call rejects". If the
   fixture row is one the BODY also refuses (e.g. a write door that only accepts setName..parallel, called on a sport
   row), the test stays green with `requireAdmin` deleted. Check every new entry: would the call SUCCEED for an admin on
   that fixture? If not, demand a row the body accepts plus an admin positive control.
2. **New hold reason x live listings.** In `listingDrainEbay.syncEbayVariant` a hold `continue`s before the plan, so
   a held live listing gets no price/quantity update (documented as "as for every hold"). A hold whose condition is
   true for EXISTING data (field added by this PR, filled by a later armed backfill, or left blank on purpose for
   mixed/teamless cases) freezes every live listing it touches: qty>=2 listings can oversell. Ask for a live-link
   carve-out (send qty/price with the previously pushed content) or a rollout gate.

**Why:** both pass every gate while failing the property they claim. **How to apply:** any new public fn registry
entry; any new `listingProblemReasonValidator` member. Related: [[patterns_public_function_auth_registry]],
[[a-green-suite-can-mean-the-test-stopped-testing]].
