// NEO-535 (R1): a card eBay held back for a title over 80 characters lists on
// the next sync once the title is shortened in the set builder. The flow is
// `ebay-over-80-title-fixture.ts`'s steps 1-6, on eBay's SANDBOX: the card is
// held back whole (0 listed, 1 skipped, the title's reason), the title is
// retyped at 61 characters and saved, Sync status queues the card again, and
// the next Sync lists it: the row reads "1 listed" with no held-back card, and
// the finished run's ledger holds List the cards / Set prices / Go live (or,
// when the 15-minute sales poll listed the card first, which is real product
// behaviour, the poll listed it and the press reads and sends nothing). Then
// they tidy up and Disconnect eBay.
//
// TEMPORARY, parked (NEO-453, Jason 2026-11-06 for the sibling eBay spec): eBay's
// sandbox refuses every publish (400 / 25002) for any seller on our keyset, so
// "1 listed" cannot happen and this spec cannot pass. It is out of the suite
// (project-scope.mjs PROJECT_IGNORE, both projects) and carries no seller tag, so
// the seller list and the tag agree. Restore the tag, its entry in SELLER_SPECS
// and take it out of PROJECT_IGNORE as soon as publish works. The hold and the
// re-queue it starts with are proven live meanwhile by
// `inventory-ebay-sandbox-listing-title-over-80-is-held-then-requeued`.
//
// R7/R7a, waits, the sandbox seller precondition and the fixture arithmetic:
// see `ebay-over-80-title-fixture.ts`.
import { test, expect } from "../../support/fixtures";
import { installOver80Cleanup, runOver80Flow } from "./ebay-over-80-title-fixture";

installOver80Cleanup();

test(
  "Inventory: an eBay card held back for a title over 80 characters lists on the next sync once the title is shortened in the set builder",
  // NEO-453, TEMPORARY: out of the suite (project-scope.mjs). Put the seller tag back with it.
  { tag: ["@collection"] },
  async ({ page, signIn, env, isMobile }) => {
    await runOver80Flow({ page, signIn, env, isMobile }, "listed");
    // Whichever branch ran (eBay live or paused), the account ends on Profile with eBay NOT connected.
    await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible();
    await expect(page.getByText(/^Rockin' on eBay as /)).toBeHidden();
  },
);
