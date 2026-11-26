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
