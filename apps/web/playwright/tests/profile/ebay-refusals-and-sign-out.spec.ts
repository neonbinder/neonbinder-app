// NEO-555 (R1): when eBay says no, the collector is told why, card by card, and
// nothing is chopped or guessed; when eBay's sign-in lapses mid-run NeonBinder
// renews it by itself; and a collector can sign out of eBay and come back as
// another eBay account. Every step runs on the stand-in eBay (the worker's own
// fake seller), whose fault rules are the only way to make eBay refuse on cue
// (`ebayFake.setFaults`, ./support/ebayFake.ts). The flow:
//   1. Profile -> Credentials -> eBay, not connected, the test-mode line (the
//      safety assert). A box of their own, every other box in-person, eBay
//      connected (the seed hop) and its setup finished (`connectEbayAndFinishSetup`).
//   2. Two cards of 2024 Topps Chrome Future Stars (the checklist's 4th and 5th
//      rows: the listing spec uses the first three) in the box, a photo on each,
//      a common price.
//   3. eBay turns the cards' details down (`ebayError` 400 / 25717 on the bulk
//      item write, every entry). Sync: the row reads "0 listed, 2 skipped", and
//      each card is held back, named, with "eBay turned this one down." and
//      the step's reason ("Its card details (title, photos or facts) didn't
//      pass. Check the card, then press Sync.").
//   4. eBay refuses to put them live (`ebayError` 400 / 25007 on publish). A
//      box write on each card (a quick count up to 2) queues them again, newer
//      than the last run, so the press within the minute is taken. Sync: still
//      0 listed, each held back with "It didn't go live. Check eBay's Seller
//      Hub for a selling limit, then press Sync."
//   5. eBay's sign-in lapses once (`unauthorized`: one 401 on the next write
//      of the cards' details, a request only a listing push makes). The quick
//      counts back to 1 queue the cards again; Sync: the cards were never live
//      (step 4 stopped them before going live), so the run writes their details
//      again and meets the 401; NeonBinder renews the token and sends the write
//      once more. The row reads "2 listed" with nothing held back, and Profile
//      still reads connected (no sign-in asked). Without the renewal the write
//      would fail signed out and the cards would not list, so "2 listed" is the
//      proof the 401 was met and recovered from.
//   6. Disconnect (it takes the two down). The box tidied (counts to 0, the
//      common price cleared, the box deleted). Then the hand-pick: the same main
//      seller connected and set up again, now holding the payment and returns
//      policies step 1 made or found, so "Set me up" is NOT offered and the
//      helper picks the seller's own (`connectEbayAndFinishSetup` with
//      `setMeUp: "not offered"`); Disconnect again.
//   7. The account switch: Connect, eBay's consent screen, "Agree as another
//      eBay account": connected as a DIFFERENT eBay user than step 1's. Then
//      Disconnect again. The afterEach disconnects on a failure.
//
// Two triggers (NEO-433). The 15-minute sales poll can run a set's sync before
// a press does. The faults stay on until the step's result is read (no
// `times`, except the one 401), so whichever run takes the cards meets the same
// refusal and the row reads the same: the spec asserts the row and the held-back
// reasons, never which run wrote them. Step 5's single 401 sits on the details
// write, which the poll's own sales read never makes, so whichever run lists the
// cards (the press's or the poll's drain) is the one that meets it.
//
// Desktop only (project-scope.mjs PROJECT_IGNORE, with the reason): what it
// proves is the server's answer to eBay's refusals, shown on the screens the
// phone run of the listing and connect specs already covers.
//
// Waits. Every step gets the standard 7 s budget (GUIDE hard rule 3); the fake
// answers at once. The longer waits are full page loads (`LAUNCH_GATE`).
//
// R7/R7a. 2024 Topps Chrome › Insert › Future Stars is a registered real set
// (SET-REGISTRY.md): this spec writes copies of its 4th and 5th cards only and
// lists them on the worker's own fake eBay seller, never beside the listing
// spec (one worker runs its specs one after another), and writes no card,
// player, team or variant of the set. Its NB writes are the signed-in user's
// own rows (the eBay connection and setup, a minted box, two copies with a
// photo, the common price, every other box set to in-person, which is left that
// way). The listings end taken down and the connection removed.
//
// Minted box name: a single token from `env.ATTEMPT_TOKEN`.
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { backToBoxes, cardsWord, checklistTitle, clearChecklistCommonPrice, createBox, deleteOpenBox, drillToCollectorChecklist, emptyBoxCards, followRunToEnd, followRunToRest, inventoryTabs, nameOf, putOtherBoxesInPerson, quantityField, queueSettled, syncRun, TOPPS_CHROME_2024_FUTURE_STARS, walkForCleanup } from "../../support/collection";
import { connectEbayAndFinishSetup, EBAY_TEST_MODE_LINE, expectEbayHookedUp, removeEbayConnection } from "../../support/credentials";
import { EBAY_PATH, ebayFault } from "../../support/ebayFake";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";

const EBAY = "eBay";
const FUTURE_STARS = TOPPS_CHROME_2024_FUTURE_STARS;
const TITLE = checklistTitle(FUTURE_STARS);
/** An insert reads as part of the set's name on Sync status: the checklist's own title. */
const SET_LABEL = TITLE;
const COMMON_PRICE = "1.00";
const PAUSED_LINE = "eBay is on a break. Your changes wait here and go up when it's back.";
const CREDENTIALS = /\/profile\/credentials\?platform=ebay$/;
/** problemCopy("ebay").rejected, then the step's EBAY_CARD_REJECTED detail (convex/listingDrainEbay.ts). */
const TURNED_DOWN = "eBay turned this one down.";
const ITEMS_REFUSED = "Its card details (title, photos or facts) didn't pass. Check the card, then press Sync.";
const PUBLISH_REFUSED = "It didn't go live. Check eBay's Seller Hub for a selling limit, then press Sync.";
const PHOTOS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "intake");
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What the failing run needs undone, filled as the flow goes. */
const written: { connected?: boolean; priced?: boolean } = {};

function syncStatus(page: Page) {
  const platform = page.getByRole("region", { name: EBAY, exact: true });
  const row = platform.getByRole("list", { name: "Last sync by set" }).getByRole("listitem").filter({ hasText: SET_LABEL });
  return { platform, row };
}

// On a failure: the run under way ends, eBay is disconnected (taking down
// anything up), and the common price is cleared. The eBay fault rules go with
// the `bscFake` teardown. On a second page, so the screenshot keeps the failure.
test.afterEach(async ({ context }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const clean = await context.newPage();
  try {
    try {
      if (written.connected) {
        await clean.goto("/inventory?tab=sync");
        await expect(clean.getByRole("heading", { level: 1, name: "Inventory" })).toBeVisible({ timeout: LAUNCH_GATE });
        const { platform } = syncStatus(clean);
        await walkForCleanup(() => followRunToEnd(platform, syncRun(platform, SET_LABEL, EBAY)));
        await removeEbayConnection(clean, { gate: LAUNCH_GATE });
        written.connected = false;
      }
    } finally {
      if (written.priced) {
        await clean.goto("/inventory?tab=checklists");
        await expect(clean.getByRole("heading", { level: 1, name: "Inventory" })).toBeVisible({ timeout: LAUNCH_GATE });
        const checklist = await drillToCollectorChecklist(clean, FUTURE_STARS);
        await clearChecklistCommonPrice(clean, checklist, TITLE, COMMON_PRICE);
        written.priced = false;
      }
    }
  } finally {
    await clean.close();
  }
});

test(
  "eBay refusals: card details and going live turned down are held back with their reasons, a lapsed sign-in renews by itself, and Disconnect then another eBay account connects",
  { tag: ["@profile", "@collection"] },
  async ({ page, signIn, env, ebayFake }) => {
    written.connected = false;
    written.priced = false;
    const boxName = `Ebr${env.ATTEMPT_TOKEN}`;
    const said = (text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
    const tabs = inventoryTabs(page);
    const boxes = page.getByRole("list", { name: "Your boxes" });
    const boxSpine = (cards: number) => boxes.getByRole("button", { name: `${boxName}, box, ${cardsWord(cards)} for sale`, exact: true });
    const connect = page.getByRole("button", { name: "Connect eBay", exact: true });
    const disconnect = page.getByRole("button", { name: "Disconnect eBay", exact: true });
    const connectedLine = page.getByText(/^Rockin' on eBay as .+ since .+\.$/);

    // --- 1. Wired to the stand-in, not connected; a box, every other box in-person, connected and set up ---
    await signIn("/profile/ebay");
    await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible({ timeout: LAUNCH_GATE });
    await expectEbayHookedUp(page);
    if (env.EBAY_PAUSED) {
      await expect(page.getByText(PAUSED_LINE, { exact: true })).toBeVisible();
      await expect(connect).toBeHidden();
      return;
    }
    await expect(
      page.getByText(EBAY_TEST_MODE_LINE, { exact: true }),
      "this spec makes eBay refuse on cue; it runs only on a deployment wired to the fake eBay (EBAY_ENVIRONMENT=fake)",
    ).toBeVisible();
    await expect(connectedLine).toBeHidden();

    await page.goto("/inventory?tab=boxes");
    await expect(page.getByRole("heading", { level: 1, name: "Inventory" })).toBeVisible({ timeout: LAUNCH_GATE });
    await createBox(page, boxName);
    await backToBoxes(page);
    await expect(boxSpine(0)).toBeVisible();
    await putOtherBoxesInPerson(page, boxName);

    await page.goto("/profile/ebay");
    await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible({ timeout: LAUNCH_GATE });
    written.connected = true;
    await connectEbayAndFinishSetup(page, ebayFake, { gate: LAUNCH_GATE });
    const mainUser = /^Rockin' on eBay as (.+) since /.exec((await connectedLine.textContent()) ?? "")?.[1];
    expect(mainUser, "the connected line names the eBay user").toBeTruthy();

    // --- 2. Two cards in the box, a photo on each, a price -----------------------------------------------
    await page.goto("/inventory?tab=checklists");
    await expect(page.getByRole("heading", { level: 1, name: "Inventory" })).toBeVisible({ timeout: LAUNCH_GATE });
    const adding = page.getByRole("combobox", { name: "Adding to" });
    const checklist = await drillToCollectorChecklist(page, FUTURE_STARS);
    const sync = checklist.getByRole("button", { name: `Sync ${TITLE}`, exact: true });
    await adding.selectOption({ label: boxName });
    const boxList = checklist.getByRole("list", { name: `Quantities in ${boxName}` });
    await expect(boxList.getByRole("textbox").nth(4)).toBeVisible();
    const shortOf = async (n: number) => {
      const name = await nameOf(boxList.getByRole("textbox").nth(n));
      const m = new RegExp(`^Quantity of (.+) in ${escapeRegExp(boxName)}$`).exec(name);
      expect(m, `a quantity field named "Quantity of <card> in ${boxName}" (read: ${name})`).not.toBeNull();
      return m![1];
    };
    // The 4th and 5th rows: the listing spec's three are the first three.
    const cards = [await shortOf(3), await shortOf(4)] as const;
    expect(cards[0], "two different cards").not.toBe(cards[1]);

    await checklist.getByRole("button", { name: `Set a common price for ${TITLE}`, exact: true }).click();
    const priceField = checklist.getByRole("textbox", { name: "Common price", exact: true });
    await expect(priceField).toBeFocused();
    written.priced = true;
    await priceField.fill(COMMON_PRICE);
    await page.keyboard.press("Enter");
    await expect(said(`Common price for ${TITLE} is $${COMMON_PRICE}`)).toBeVisible();

    const fields = cards.map((short) => quantityField(boxList, short, boxName));
    for (const [i, short] of cards.entries()) {
      await expect(fields[i]).toHaveValue("0");
      await fields[i].fill("1");
      await page.keyboard.press("Tab");
      await expect(said(new RegExp(`^Boxed 1 more of ${escapeRegExp(short)}\\.`))).toBeVisible();
    }
    // A photo on each, by hand in the card's drawer (Details opens it editing the card's ONE line).
    for (const [short, photo] of [[cards[0], "03-bowe-front.jpg"], [cards[1], "05-bell-front.jpg"]] as const) {
      const drawer = page.getByRole("dialog", { name: new RegExp(`^${escapeRegExp(SET_LABEL)} ${escapeRegExp(short)}`) });
      await checklist.getByRole("button", { name: `Details for ${short}`, exact: true }).click();
      const yourCopies = drawer.getByRole("region", { name: `Your copies of ${short}`, exact: true });
      await expect(yourCopies.getByRole("heading", { name: "Your copies (1 line)", exact: true })).toBeVisible();
      const panel = yourCopies.getByRole("form", { name: /^Edit Raw, / }).getByRole("region", { name: /^Photos of / });
      await panel.getByLabel("Front photo file", { exact: true }).setInputFiles(path.join(PHOTOS, photo));
      await expect(panel.getByRole("status")).toHaveText("Front photo saved.");
      await drawer.getByRole("button", { name: "Close card detail" }).click();
      await expect(drawer).toBeHidden();
    }

    // One Sync and its result, read on Sync status after the walk to rest; Back returns to the checklist.
    const { platform, row } = syncStatus(page);
    const heldFor = (detail: string) =>
      row.getByRole("listitem").filter({ hasText: TURNED_DOWN }).filter({ hasText: detail });
    const syncAndRead = async () => {
      await sync.click();
      await expect(said(`Syncing ${TITLE} now. Watch it on Sync status.`)).toBeVisible();
      await tabs.getByRole("link", { name: "Sync status", exact: true }).click();
      await expect(page).toHaveURL(/[?&]tab=sync/);
      const run = syncRun(platform, SET_LABEL, EBAY);
      await followRunToRest(platform, run, queueSettled(platform, SET_LABEL));
      await expect(run.last).toBeVisible();
      await expect(row.getByText(/^Synced /)).toBeVisible();
    };
    const backToChecklist = async () => {
      await page.goBack();
      await expect(page).toHaveURL(/[?&]tab=checklists/);
      await expect(checklist.getByRole("heading", { level: 3, name: TITLE })).toBeVisible();
    };
    /** A quick count to `to` on each card: a box write that queues it, newer than the last run. */
    const countBoth = async (to: "1" | "2") => {
      await adding.selectOption({ label: boxName });
      for (const [i, short] of cards.entries()) {
        await fields[i].fill(to);
        await page.keyboard.press("Tab");
        await expect(fields[i]).toHaveValue(to);
        await expect(said(new RegExp(`^(Boxed 1 more|Pulled 1) of ${escapeRegExp(short)}`))).toBeVisible();
      }
    };
    const expectHeldBoth = async (detail: string) => {
      await expect(row.getByText(/^0 listed(, \d+ updated)?, 2 skipped$/)).toBeVisible();
      await expect(row.getByText("2 held back:", { exact: true })).toBeVisible();
      await expect(heldFor(detail)).toHaveCount(2);
      for (const short of cards) await expect(heldFor(detail).filter({ hasText: short.split(" ")[0] })).toHaveCount(1);
    };

    // --- 3. eBay turns the cards' details down ------------------------------------------------------------
    await ebayFake.setFaults([ebayFault.error(EBAY_PATH.bulkItems, 400, [25717])]);
    await syncAndRead();
    await expectHeldBoth(ITEMS_REFUSED);
    await expectAccessible(page, { label: "Inventory Sync status, eBay turned two cards' details down" });
    await backToChecklist();

    // --- 4. eBay refuses to put them live ---------------------------------------------------------------------
    await ebayFake.setFaults([ebayFault.error(EBAY_PATH.publish, 400, [25007])]);
    await countBoth("2");
    await syncAndRead();
    await expectHeldBoth(PUBLISH_REFUSED);
    await expect(heldFor(ITEMS_REFUSED)).toHaveCount(0);
    await backToChecklist();

    // --- 5. eBay's sign-in lapses once: renewed by itself, and the cards list ---------------------------------
    // The one 401 is on the details write (POST, bulk), which only a listing push
    // makes: never live, both cards' details go again on this run, so the run
    // meets it whichever of the press and the poll drains them. "2 listed" with
    // nothing held back then proves the renewal and the retried write; a broken
    // renewal fails the write signed out and nothing lists.
    await ebayFake.setFaults([ebayFault.unauthorized(EBAY_PATH.bulkItems, { times: 1 })]);
    await countBoth("1");
    await syncAndRead();
    await expect(row.getByText(/^2 listed(, \d+ updated)?$/)).toBeVisible();
    await expect(row.getByText(/held back/)).toHaveCount(0);
    await ebayFake.setFaults([]);
    // Profile still reads connected: no sign-in was asked of the collector.
    await page.goto("/profile/ebay");
    await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible({ timeout: LAUNCH_GATE });
    await expect(connectedLine).toBeVisible();
    await expect(connectedLine).toContainText(`as ${mainUser} since`);
    await expect(disconnect).toBeVisible();

    // --- 6. Disconnect (it takes the two down), then the box is tidied ---------------------------------------
    await disconnect.click();
    const confirm = page.getByRole("dialog", { name: "Disconnect eBay?", exact: true });
    await confirm.getByRole("button", { name: "Yes, disconnect" }).click();
    await expect(said("Disconnected from eBay. Every listing NeonBinder put up there is down.")).toBeVisible();
    written.connected = false;
    await expect(connect).toBeVisible();

    await page.goto("/inventory?tab=checklists");
    await expect(page.getByRole("heading", { level: 1, name: "Inventory" })).toBeVisible({ timeout: LAUNCH_GATE });
    const tidy = await emptyBoxCards(page, FUTURE_STARS, boxName, cards, false, "fresh");
    await clearChecklistCommonPrice(page, tidy, TITLE, COMMON_PRICE);
    written.priced = false;
    await tabs.getByRole("link", { name: "My Boxes", exact: true }).click();
    await expect(boxSpine(0)).toBeVisible();
    await boxSpine(0).click();
    await expect(page.getByRole("heading", { level: 2, name: boxName, exact: true })).toBeVisible();
    await deleteOpenBox(page, boxName);
    await expect(boxes.getByRole("button", { name: new RegExp(`^${escapeRegExp(boxName)},`) })).toHaveCount(0);

    // --- 6b. The hand-pick: the same seller again, its payment and returns already on eBay ----------------
    // Step 1 left the main seller holding payment and returns policies (Set me up
    // made them, or an earlier spec had), and NB's Disconnect never touches eBay's
    // side, so "Set me up" is not offered now and the seller's own are picked.
    await page.goto("/profile/ebay");
    await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible({ timeout: LAUNCH_GATE });
    await expect(connect).toBeVisible();
    written.connected = true;
    await connectEbayAndFinishSetup(page, ebayFake, { gate: LAUNCH_GATE, setMeUp: "not offered" });
    await expect(connectedLine).toContainText(`as ${mainUser} since`);
    await disconnect.click();
    await confirm.getByRole("button", { name: "Yes, disconnect" }).click();
    await expect(said("Disconnected from eBay. Every listing NeonBinder put up there is down.")).toBeVisible();
    written.connected = false;
    await expect(connect).toBeVisible();

    // --- 7. Another eBay account: Connect, "Agree as another eBay account", a different user ---------------
    await page.goto("/profile/ebay");
    await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible({ timeout: LAUNCH_GATE });
    await connect.click();
    await expect(page).toHaveURL(/\/testing\/fake-ebay\/authorize\?/);
    const consent = page.getByRole("region", { name: "Stand-in eBay sign-in", exact: true });
    await expect(consent.getByRole("button", { name: "Agree", exact: true })).toBeFocused({ timeout: LAUNCH_GATE });
    written.connected = true;
    await consent.getByRole("button", { name: "Agree as another eBay account", exact: true }).click();
    await expect(page).toHaveURL(CREDENTIALS, { timeout: LAUNCH_GATE });
    const switched = said(/^Connected to eBay as .+\. Start with where you ship from, below\.$/);
    await expect(switched).toBeVisible();
    await expect(connectedLine).toBeVisible();
    await expect(connectedLine, "the second eBay account is a different eBay user").not.toContainText(`as ${mainUser} since`);
    await expectAccessible(page, { label: "Profile, eBay connected as another account" });
    await disconnect.click();
    await confirm.getByRole("button", { name: "Yes, disconnect" }).click();
    await expect(said("Disconnected from eBay. Every listing NeonBinder put up there is down.")).toBeVisible();
    written.connected = false;
    await expect(connect).toBeVisible();
    await expect(connectedLine).toBeHidden();
  },
);
