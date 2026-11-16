// NEO-535 (R1): an eBay listing whose title is over 80 characters is never
// chopped. NeonBinder holds the card back whole, says why, and, once the title
// is shortened in the set builder, queues the card for the next sync by itself.
// The flow is `ebay-over-80-title-fixture.ts`'s steps 1-4, on eBay's SANDBOX:
//   1. A hand-made card whose title is stored at 99 characters (no cut the
//      generator makes brings it under 80), in a box, with a photo and a price,
//      eBay connected and its setup finished.
//   2. Sync. Sync status reads the set "0 listed, 1 skipped" with ONE card held
//      back, and the reason is the title's, in a collector's words: "Its title is
//      over the 80-character limit for listings, and we won't chop it. Once we
//      shorten it on our end, it goes up on the next sync." The finished
//      run's ledger holds no List the cards / Set prices / Go live step. That row
//      is the whole of what a collector can see of eBay (the app shows no eBay
//      listing of its own), so "nothing was listed, nothing chopped" is read from
//      the count, the ledger and the held-back card together. Axe runs on this
//      state, light and dark.
//   3. In the set builder they retype the title at 61 characters and save
//      (Enter). Sync status then lists the card under "Queued for the next
//      sync" with no Sync pressed: the save re-queued it. Axe runs there too.
//   4. They tidy up and Disconnect eBay (the afterEach does the same on a failure).
// That a card then LISTS on the next sync needs a publish that works, and eBay's
// sandbox refuses every publish (NEO-453), so that proof is the parked sibling
// `inventory-ebay-sandbox-listing-title-over-80-lists-once-shortened`. This spec
// needs no publish and runs in the seller job.
//
// What would turn this red: the drain cutting the title to 80 and listing it
// ("1 listed" instead of "0 listed, 1 skipped", no held-back card); a hold for
// another reason (a missing detail, no photo, eBay turning the card down); a
// shortened title that does not queue the card; a card still held after it fits.
//
// R7/R7a, waits, the sandbox seller precondition and the fixture arithmetic:
// see `ebay-over-80-title-fixture.ts`. This spec writes no real set; it is a sole
// writer of the eBay sandbox seller account's listings, so it never runs beside
// the sibling eBay listing specs (the seller job runs them one after another).
import { test, expect } from "../../support/fixtures";
import { installOver80Cleanup, runOver80Flow } from "./ebay-over-80-title-fixture";

installOver80Cleanup();

test(
  "Inventory: an eBay card whose title is over 80 characters is held back whole with its reason, never chopped, and is queued again when the title is shortened in the set builder",
  // @marketplace-seller: writes to the eBay sandbox seller account shared by every PR's CI
  // (project-scope.mjs SELLER_SPECS).
  { tag: ["@collection", "@marketplace-seller"] },
  async ({ page, signIn, env, isMobile }) => {
    await runOver80Flow({ page, signIn, env, isMobile }, "requeued");
    // Whichever branch ran (eBay live or paused), the account ends on Profile with eBay NOT connected.
    await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible();
    await expect(page.getByText(/^Rockin' on eBay as /)).toBeHidden();
  },
);
