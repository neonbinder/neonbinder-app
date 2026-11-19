// NEO-535 (R1): a card eBay held back for a title over 80 characters lists on
// the next sync once the title is shortened in the set builder. The flow is
// `ebay-over-80-title-fixture.ts`'s steps 1-6, on the stand-in eBay (NEO-555:
// the worker's own fake seller): the card is held back whole (0 listed, 1
// skipped, the title's reason), the title is retyped at 61 characters and
// saved, Sync status queues the card again, and the next Sync lists it: the row
// reads "1 listed" with no held-back card, and the finished run's ledger holds
// List the cards / Set prices / Go live (or, when the 15-minute sales poll
// listed the card first, which is real product behaviour, the poll listed it
// and the press reads and sends nothing). Then they tidy up and Disconnect eBay.
//
// Back in the suite with NEO-555 (parked since NEO-453: the eBay sandbox refused
// every publish). The fake publishes, so "1 listed" is reachable on every run.
// The hold and the re-queue it starts with are also the subject of
// `inventory-ebay-listing-title-over-80-is-held-then-requeued`.
//
// R7/R7a, waits, the fake seller and the fixture arithmetic: see
// `ebay-over-80-title-fixture.ts`.
import { test, expect } from "../../support/fixtures";
import { installOver80Cleanup, runOver80Flow } from "./ebay-over-80-title-fixture";

installOver80Cleanup();

test(
  "Inventory: an eBay card held back for a title over 80 characters lists on the next sync once the title is shortened in the set builder",
  { tag: ["@collection"] },
  async ({ page, signIn, env, isMobile, ebayFake }) => {
    await runOver80Flow({ page, signIn, env, isMobile, ebayFake }, "listed");
    // Whichever branch ran (eBay live or paused), the account ends on Profile with eBay NOT connected.
    await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible();
    await expect(page.getByText(/^Rockin' on eBay as /)).toBeHidden();
  },
);
