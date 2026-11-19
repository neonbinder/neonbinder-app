// Specs that skip a project, read by playwright.config.ts (testIgnore) and
// shard-plan.mjs (planning and e2e.yml's gate) so the three always agree.
// Paths are relative to playwright/tests/.
//
// Every spec runs on both projects unless it is listed here, and a listing
// needs a reason: the phone run of it must add no UI coverage. A skipped
// result would fail the gate, so a spec never skips a project with
// test.skip(); it is left out of that project's plan instead.
/** @type {Record<string, string[]>} */
export const PROJECT_IGNORE = {
  e2e: [],
  // NEO-555: desktop only. What it proves is server behaviour on the stand-in
  // eBay (an ebayError fault becomes a held-back reason, a 401 forces one token
  // refresh and a retry, a second eBay account connects after a Disconnect), and
  // each shows on a screen the phone run already checks through
  // `collection/inventory-ebay-listing-2024-topps-chrome-future-stars` (the Sync
  // status row and its held-back list) and `profile/ebay-connect-and-setup` (the
  // consent page, the connection card, Disconnect). The phone run adds no UI coverage.
  "e2e-mobile": ["profile/ebay-refusals-and-sign-out.spec.ts"],
};

/**
 * The specs `project` leaves out, relative to playwright/tests/.
 * @param {string} project
 * @returns {string[]}
 */
export function ignoredSpecs(project) {
  return PROJECT_IGNORE[project] ?? [];
}

// Specs that open the BSC call gate (NEO-552). Convex holds ONE gate per
// deployment (`convex/bscCallGate.ts`): a breaker that a 429, or a run of five
// 5xx or timeouts, opens for every caller, and a token bucket in front of it.
// A spec that injects such a fault (support/bscFake.ts: kind 429, 503, hang or
// reset) therefore stops BuySportsCards calls for EVERY shard on that preview
// until the window passes. Decision (NEO-552 plan): such specs run
// serially, alone, never beside a shard. They are planned in NO shard:
// e2e.yml's `breaker-desktop` / `breaker-mobile` jobs run them, each after the
// pass's every shard has finished, and clear the gate in the
// spec's teardown (`bscFake` fixture, `api.testing.clearBscCallGate`). The
// `e2e` gate still requires each to pass on BOTH projects.
//
// Each listed spec carries the tag below; shard-plan.mjs refuses to plan if
// the tag and this list disagree, and the bscFake helper refuses a breaker
// fault in a spec that lacks the tag, so a fault spec cannot land in a shard.
export const BREAKER_TAG = "@bsc-breaker";
/** @type {string[]} */
export const BREAKER_SPECS = [
  "set-selector/checklist-fetch-bsc-429-cooldown-holds-the-cards-back-and-queues-them.spec.ts",
  "set-selector/checklist-fetch-bounds-a-bsc-stall-and-queues-the-cards.spec.ts",
];
