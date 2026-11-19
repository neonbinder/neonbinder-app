// NEO-555 (R1): a collector connects eBay through eBay's own consent screen and
// finishes the setup that listing waits on. On a test deployment eBay is the
// stand-in (services/fake-bsc), whose consent screen is NB's testing page
// `/testing/fake-ebay/authorize` on the app's own origin, so the whole trip is
// driven as a collector drives it. The flow:
//   1. Profile -> Credentials -> eBay, not connected: the test-mode line (the
//      safety assert), and the consent warning before Connect, which describes
//      the button.
//   2. Every box they have goes in-person first (a connection that lists walks
//      every card in a listed box, and this spec lists nothing).
//   3. Connect: eBay's consent screen, "Agree as another eBay account" (the
//      worker's SECOND fake seller, `alt`, which no other spec sets up: see
//      "Fresh-only" below). Home again, the page says who is connected and
//      where to start; the consent screen is not in Back's path. Connected IS
//      listing, but nothing goes up until the setup is done: "5 to go".
//   4. Sync status agrees ("Setup unfinished") and links back to the page;
//      Back returns.
//   5. Packing: the weight of a single card, 1 oz to 3 oz by Enter; a reload
//      keeps it.
//   6. Shipping, which NB never makes (NEO-423): the seller has no shipping
//      policy, so the card says so, links out to make one on eBay (a new tab,
//      eBay's business policies) and offers "Check eBay again". Checked with
//      none made yet: "Still no shipping policies..." and the keyboard stays on
//      the button. The seller then makes two on eBay (the fake's seller hop,
//      `ebayFake.holdShippingPolicy`, is the eBay side of that), and the check
//      finds them: "Your shipping policies are in. Pick away.", focus on the
//      Shipping heading.
//   7. Ships from: Enter saves it, "4 to go", the keyboard stays in the field.
//   8. "Set me up" (offered: the seller has no payment or returns policy) makes
//      NeonBinder's standard ones on eBay, ticked off step by step, never a
//      shipping policy; it picks them for the Payment and Returns slots.
//   9. The shipping picks: $20 and up first NB Free Shipping then NB Tracked (a
//      changed pick saves), Cards under $20 NB Free Shipping. "You're all set".
//  10. Disconnect (the confirm dialog): "Disconnected from eBay...", not
//      connected, Connect and the consent warning back. The afterEach does the
//      same on a failure.
//
// Fresh-only (GUIDE "fresh-only specs"): the `alt` seller is new only once per
// seed. The fake keeps a seller's policies, payment and returns, location and
// opt-in for the namespace until the pass's scripted reset, so a second run on
// the same seed finds shipping policies already there and goes red at step 6
// (reset and re-seed before running it again locally).
//
// Waits. Every step gets the standard 7 s budget (GUIDE hard rule 3), the eBay
// calls included (the fake answers at once). The longer waits are full page
// loads (`LAUNCH_GATE`): the sign-in hop, the consent screen (its own route),
// the return home, Sync status and the reload.
//
// R7/R7a. Writes no set. Its NB writes are the signed-in user's own rows: the
// eBay connection and its setup (cleared by the Disconnect), and every box set
// to in-person, which is left that way. On the worker's fake `alt` seller it
// leaves two shipping policies, NB's standard payment and returns policies and
// a location, until the pass's reset.
import { putOtherBoxesInPerson } from "../../support/collection";
import { EBAY_TEST_MODE_LINE, expectEbayHookedUp, removeEbayConnection } from "../../support/credentials";
import { EBAY_POLICY } from "../../support/ebayFake";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";

const EBAY = "eBay";
const CREDENTIALS = /\/profile\/credentials\?platform=ebay$/;
const CONSENT_HEADING = "Heads up: connecting starts listing";
const PAUSED_LINE = "eBay is on a break. Your changes wait here and go up when it's back.";
const SETUP_NOTE = "Your eBay setup isn't finished, so nothing goes up there yet.";
const STILL_NO_SHIPPING = "Still no shipping policies on eBay. Make one there, then check again.";
const SHIPPING_IN = "Your shipping policies are in. Pick away.";
/** No box has this name: `putOtherBoxesInPerson` keeps none of the worker's boxes listed. */
const KEEP_NO_BOX = "";
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What the failing run needs undone, filled as the flow goes. */
const written: { connected?: boolean; disconnected?: boolean } = {};

// Pass or fail, the account ends with eBay NOT connected (the disconnect also
// clears the saved setup). On a second page, so the failure screenshot keeps
// the page that failed.
test.afterEach(async ({ context }) => {
  if (!written.connected || written.disconnected) return;
  const clean = await context.newPage();
  try {
    await removeEbayConnection(clean, { gate: LAUNCH_GATE });
  } finally {
    await clean.close();
  }
});

test(
  "Profile -> Credentials -> eBay: connecting through eBay's consent screen, then the setup (card weight, shipping policies made on eBay, ships from, Set me up, the picks) until it's all set, and Disconnect",
  { tag: ["@profile", "@credentials"] },
  async ({ page, signIn, env, ebayFake }) => {
    written.connected = false;
    written.disconnected = false;
    const said = (text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
    const connect = page.getByRole("button", { name: "Connect eBay", exact: true });
    const disconnect = page.getByRole("button", { name: "Disconnect eBay", exact: true });
    const connectedLine = page.getByText(/^Rockin' on eBay as .+ since .+\.$/);
    const steps = page.getByRole("status").filter({ hasText: /to go\. Nothing lists on eBay until they're done\.$/ });
    const allSet = page.getByRole("heading", { level: 3, name: "You're all set", exact: true });

    // --- 1. Not connected: the stand-in, and the consent warning before Connect ----------------
    await signIn("/profile/ebay");
    await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible({ timeout: LAUNCH_GATE });
    // Fails loudly, naming the setup, when this deployment has no eBay wiring.
    await expectEbayHookedUp(page);
    await expect(page.getByRole("heading", { level: 2, name: EBAY, exact: true })).toBeVisible();
    if (env.EBAY_PAUSED) {
      // Paused: no Connect, and the page says eBay is on a break (R2: a hard end).
      await expect(page.getByText(PAUSED_LINE, { exact: true })).toBeVisible();
      await expect(connect).toBeHidden();
      await expectAccessible(page, { label: "Profile, eBay on a break" });
      return;
    }
    await expect(
      page.getByText(EBAY_TEST_MODE_LINE, { exact: true }),
      "this spec connects eBay; it runs only on a deployment wired to the fake eBay (EBAY_ENVIRONMENT=fake)",
    ).toBeVisible();
    await expect(connectedLine).toBeHidden();
    await expect(page.getByText("Connect your eBay seller account.", { exact: true })).toBeVisible();
    await expect(page.getByText(CONSENT_HEADING, { exact: true })).toBeVisible();
    await expect(page.getByText(/Connecting lists every raw card in your boxes on eBay at your box counts, once your setup is done/)).toBeVisible();
    await expect(connect).toHaveAccessibleDescription(new RegExp(`^${escapeRegExp(CONSENT_HEADING)}`));
    await expectAccessible(page, { label: "Profile, eBay not connected, listing consent" });

    // --- 2. Every box in-person before connecting ---------------------------------------------------
    // A full page load, so the launch gate applies.
    await page.goto("/inventory?tab=boxes");
    await expect(page.getByRole("heading", { level: 1, name: "Inventory" })).toBeVisible({ timeout: LAUNCH_GATE });
    await putOtherBoxesInPerson(page, KEEP_NO_BOX);

    // --- 3. Connect through eBay's consent screen, as the second account -----------------------------
    await page.goto("/profile/ebay");
    await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible({ timeout: LAUNCH_GATE });
    await connect.click();
    await expect(page).toHaveURL(/\/testing\/fake-ebay\/authorize\?/);
    const consent = page.getByRole("region", { name: "Stand-in eBay sign-in", exact: true });
    await expect(consent.getByRole("button", { name: "Agree", exact: true })).toBeFocused({ timeout: LAUNCH_GATE });
    // Recorded BEFORE the answer: the trip home may connect and still fail after.
    written.connected = true;
    await consent.getByRole("button", { name: "Agree as another eBay account", exact: true }).click();
    // Home again (a full page load, as eBay's return is), the code spent and scrubbed from the address.
    await expect(page).toHaveURL(CREDENTIALS, { timeout: LAUNCH_GATE });
    await expect(said(/^Connected to eBay as .+\. Start with where you ship from, below\.$/)).toBeVisible();
    await expect(connectedLine).toBeVisible();
    await expect(disconnect).toBeVisible();
    await expect(page.getByText(EBAY_TEST_MODE_LINE, { exact: true })).toBeVisible();
    // Connected IS listing, but nothing goes up until the setup is done.
    await expect(
      page.getByText("Nothing goes up until your setup below is done. Then every raw card in a listed box lists at its box count."),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "Finish these and your boxes go up", exact: true })).toBeVisible();
    await expect(steps).toHaveText("5 to go. Nothing lists on eBay until they're done.");
    await expect(allSet).toBeHidden();
    await expectAccessible(page, { label: "Profile, eBay connected, setup to do" });
    // Back never lands on the consent screen or the return (each replaced the last).
    await page.goBack();
    await expect(page).toHaveURL(CREDENTIALS);
    await expect(page).not.toHaveURL(/code=|state=/);
    await expect(connectedLine).toBeVisible();

    // --- 4. Sync status agrees, and links back to the page ---------------------------------------------
    await page.goto("/inventory?tab=sync");
    await expect(page.getByRole("heading", { level: 1, name: "Inventory" })).toBeVisible({ timeout: LAUNCH_GATE });
    const unfinished = page.getByRole("region", { name: EBAY, exact: true });
    await expect(unfinished.getByText("Setup unfinished", { exact: true })).toBeVisible();
    await expect(unfinished.getByText(SETUP_NOTE)).toBeVisible();
    await expect(unfinished.getByText("Not connected", { exact: true })).toBeHidden();
    await expectAccessible(page, { label: "Inventory Sync status, eBay setup unfinished" });
    const finishSetup = unfinished.getByRole("link", { name: "Finish your eBay setup", exact: true });
    await finishSetup.click();
    await expect(page).toHaveURL(CREDENTIALS);
    await expect(connectedLine).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/[?&]tab=sync/);
    await expect(unfinished.getByText("Setup unfinished", { exact: true })).toBeVisible();
    await finishSetup.click();
    await expect(page).toHaveURL(CREDENTIALS);

    // --- 5. Packing: the weight of a single card -------------------------------------------------------
    // A fresh connection reads the default, 1 oz. Enter on 3 oz saves it.
    const weight = page.getByRole("radiogroup", { name: "Weight of a single card", exact: true });
    const oneOz = weight.getByRole("radio", { name: "1 oz", exact: true });
    const threeOz = weight.getByRole("radio", { name: "3 oz", exact: true });
    await expect(page.getByRole("heading", { level: 3, name: "Packing", exact: true })).toBeVisible();
    await expect(oneOz).toBeChecked();
    await expect(weight.getByRole("radio", { checked: true })).toHaveCount(1);
    await threeOz.focus();
    await page.keyboard.press("Enter");
    await expect(said("Saved. Each card weighs in at 3 oz.")).toBeVisible();
    await expect(threeOz).toBeChecked();
    await expect(threeOz).toBeFocused();
    await expect(weight.getByRole("radio", { checked: true })).toHaveCount(1);
    // Saved for real: a reload (a full page load) still reads 3 oz.
    await page.reload();
    await expect(connectedLine).toBeVisible({ timeout: LAUNCH_GATE });
    await expect(threeOz).toBeChecked();
    await expect(weight.getByRole("radio", { checked: true })).toHaveCount(1);

    // --- 6. Shipping: none on the account, made on eBay, found by "Check eBay again" ----------------
    const shippingHeading = page.getByRole("heading", { level: 3, name: "Shipping", exact: true });
    await expect(shippingHeading).toBeVisible();
    await expect(page.getByText("No shipping policies on your eBay account yet.", { exact: true })).toBeVisible();
    const makeOne = page.getByRole("link", { name: "Make a shipping policy on eBay (opens in a new tab)", exact: true });
    await expect(makeOne).toHaveAttribute("href", "https://www.ebay.com/bp/manage");
    await expect(makeOne).toHaveAttribute("target", "_blank");
    const checkAgain = page.getByRole("button", { name: "Check eBay again", exact: true });
    await expect(checkAgain).toBeVisible();
    // Nothing to pick yet, so no shipping picker is offered.
    await expect(page.getByRole("radiogroup", { name: "Cards under $20", exact: true })).toHaveCount(0);
    await expectAccessible(page, { label: "Profile, eBay connected, no shipping policies yet" });
    // Checked before any is made: still none, said, and the keyboard back on the button.
    await checkAgain.click();
    await expect(said(STILL_NO_SHIPPING)).toBeVisible();
    await expect(checkAgain).toBeFocused();
    // The seller makes two on eBay (the fake's side of eBay's business policies page).
    await ebayFake.holdShippingPolicy(EBAY_POLICY.free, "alt");
    await ebayFake.holdShippingPolicy(EBAY_POLICY.tracked, "alt");
    await checkAgain.click();
    await expect(said(SHIPPING_IN)).toBeVisible();
    await expect(shippingHeading).toBeFocused();
    const underTwenty = page.getByRole("radiogroup", { name: "Cards under $20", exact: true });
    const twentyPlus = page.getByRole("radiogroup", { name: "$20 and up", exact: true });
    await expect(underTwenty.getByRole("radio", { name: EBAY_POLICY.free.name, exact: true })).toBeVisible();
    await expect(page.getByText("No shipping policies on your eBay account yet.", { exact: true })).toHaveCount(0);

    // --- 7. Ships from -------------------------------------------------------------------------------------
    await page.getByRole("textbox", { name: "ZIP code", exact: true }).fill("53703");
    await page.getByRole("textbox", { name: "City", exact: true }).fill("Madison");
    const stateField = page.getByRole("textbox", { name: "State", exact: true });
    await stateField.fill("WI");
    // Enter in the last field saves (the form is a form), and makes the seller's inventory location on eBay.
    await page.keyboard.press("Enter");
    await expect(said("Saved. Your cards ship from here.")).toBeVisible();
    await expect(steps).toHaveText("4 to go. Nothing lists on eBay until they're done.");
    await expect(stateField).toBeFocused();
    await expect(page.getByRole("textbox", { name: "ZIP code", exact: true })).toHaveValue("53703");

    // --- 8. Set me up: NeonBinder's standard payment and returns policies, made on eBay ---------------
    // Offered: this seller has neither. Each step is ticked off as eBay answers;
    // each wait covers exactly ONE step landing.
    const setMeUp = page.getByRole("button", { name: "Set me up", exact: true });
    await expect(setMeUp).toBeEnabled();
    await setMeUp.click();
    const ledger = page.getByRole("list", { name: "Set me up, step by step", exact: true });
    await expect(ledger).toBeVisible();
    const ledgerSteps = ledger.getByRole("listitem");
    const answer = said(/^(Made \d+ on your eBay account|You already had everything)/);
    for (let i = 0; i < 4; i++) {
      const step = ledgerSteps.nth(i);
      await expect(step.or(answer).first()).toBeVisible();
      if (await answer.isVisible()) break;
      await expect(step).toHaveAccessibleName(/, (done|eBay said no|already on eBay|not made)$/);
    }
    await expect(said(/^Made \d+ on your eBay account/)).toBeVisible();
    await expect(ledger.getByRole("listitem", { name: /, eBay said no$/ })).toHaveCount(0);
    await expect(ledger.getByRole("listitem", { name: /, (working|waiting|not made)$/ })).toHaveCount(0);
    // Never a shipping policy.
    await expect(
      ledger.getByRole("listitem", { name: new RegExp(`^(${escapeRegExp(EBAY_POLICY.tracked.name)}|${escapeRegExp(EBAY_POLICY.free.name)}),`) }),
    ).toHaveCount(0);
    await expect(setMeUp).toBeHidden();
    // It picked what it made for Payment and Returns.
    for (const group of ["Payment", "Returns"]) {
      await expect(page.getByRole("radiogroup", { name: group, exact: true }).getByRole("radio", { checked: true })).toHaveCount(1);
    }
    await expectAccessible(page, { label: "Profile, eBay Set me up done, shipping still to pick" });

    // --- 9. The shipping picks: a changed pick saves; the last one finishes the setup -------------------
    const free20 = twentyPlus.getByRole("radio", { name: EBAY_POLICY.free.name, exact: true });
    const tracked20 = twentyPlus.getByRole("radio", { name: EBAY_POLICY.tracked.name, exact: true });
    await free20.click();
    await expect(free20).toBeChecked();
    await expect(said(/^Saved\.$/)).toBeVisible();
    await tracked20.click();
    await expect(tracked20).toBeChecked();
    await expect(twentyPlus.getByRole("radio", { checked: true })).toHaveCount(1);
    const freeUnder = underTwenty.getByRole("radio", { name: EBAY_POLICY.free.name, exact: true });
    await freeUnder.click();
    await expect(freeUnder).toBeChecked();
    await expect(underTwenty.getByRole("radio", { checked: true })).toHaveCount(1);
    await expect(allSet).toBeVisible();
    await expect(steps).toBeHidden();
    await expect(page.getByRole("heading", { level: 3, name: "Finish these and your boxes go up", exact: true })).toBeHidden();
    await expect(page.getByText("Everything in a listed box lists on eBay at your count.", { exact: true })).toBeVisible();
    await expectAccessible(page, { label: "Profile, eBay connected and set up" });

    // --- 10. Disconnect ------------------------------------------------------------------------------------
    await disconnect.click();
    const confirm = page.getByRole("dialog", { name: "Disconnect eBay?", exact: true });
    await expect(confirm).toBeVisible();
    await expectAccessible(page, { within: confirm, label: "Profile, Disconnect eBay confirm" });
    await confirm.getByRole("button", { name: "Yes, disconnect" }).click();
    await expect(said("Disconnected from eBay. Every listing NeonBinder put up there is down.")).toBeVisible();
    written.disconnected = true;
    await expect(confirm).toBeHidden();
    await expect(connect).toBeVisible();
    await expect(connectedLine).toBeHidden();
    await expect(page.getByText(CONSENT_HEADING, { exact: true })).toBeVisible();
  },
);
