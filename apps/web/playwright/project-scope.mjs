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
  // NEO-453, TEMPORARY, Jason 2026-11-06: eBay's sandbox refuses every publish
  // (400 / 25002) for any seller on our keyset, so this spec cannot pass. Restore
  // it, its entry in SELLER_SPECS and its seller tag as soon as publish works.
  e2e: ["collection/inventory-ebay-sandbox-listing-2024-topps-chrome-future-stars.spec.ts"],
  "e2e-mobile": [
    "collection/inventory-ebay-sandbox-listing-2024-topps-chrome-future-stars.spec.ts",
  ],
};

/**
 * The specs `project` leaves out, relative to playwright/tests/.
 * @param {string} project
 * @returns {string[]}
 */
export function ignoredSpecs(project) {
  return PROJECT_IGNORE[project] ?? [];
}

// Specs that write to a marketplace seller account shared by EVERY PR's CI
// (NEO-415): today the ONE eBay sandbox seller. Two PRs running one at once
// clobber each other (one preview's sync zeroes the other's listings), and
// sharding cannot fix that. So they are planned in NO shard: e2e.yml's
// `seller-desktop` / `seller-mobile` jobs run them, one PR at a time repo-wide
// (a queue, never a cancel), and the `e2e` gate still requires a passing
// result for each on BOTH projects.
//
// NEO-552: BuySportsCards is NOT shared any more. Every test user has a fake BSC
// account of their own (a namespace), so the two BSC listing specs left this
// list and run in the ordinary shards: two PRs, or two shards of one, cannot
// clobber each other's listings. The list is empty until the eBay sandbox spec
// is restored (see PROJECT_IGNORE above); the seller jobs then have nothing to
// run and say so.
//
// Each listed spec carries the tag below; shard-plan.mjs refuses to plan if the
// tag and this list disagree in either direction, so a new seller spec cannot
// slip into a shard (or a listed one lose its tag) unnoticed. Paths are
// relative to playwright/tests/.
export const SELLER_TAG = "@marketplace-seller";
/** @type {string[]} */
export const SELLER_SPECS = [];

// Specs that open the BSC call gate (NEO-552). Convex holds ONE gate per
// deployment (`convex/bscCallGate.ts`): a breaker that a 429, or a run of five
// 5xx or timeouts, opens for every caller, and a token bucket in front of it.
// A spec that injects such a fault (support/bscFake.ts: kind 429, 503, hang or
// reset) therefore stops BuySportsCards calls for EVERY shard on that preview
// until the window passes. Decision (NEO-552 plan): such specs run
// serially, alone, never beside a shard. They are planned in NO shard:
// e2e.yml's `breaker-desktop` / `breaker-mobile` jobs run them, each after the
// pass's every shard and seller job has finished, and clear the gate in the
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
