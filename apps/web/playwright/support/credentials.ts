/**
 * Marketplace session warm-ups — specs: .maestro/flows/util/util-login-to-bsc.yaml
 * and util-login-to-sportlots.yaml.
 *
 * Both open /profile/credentials, check the worker is CONNECTED (fail fast,
 * by name, if not), press "Test Credentials" and wait for the live login to
 * report success. Both leave the page on /profile/credentials.
 */
import { expect, type Page } from "@playwright/test";
import { EBAY_POLICY, type EbayFake } from "./ebayFake";
import type { FlowEnv } from "./env";
import { expectAccessible, test } from "./fixtures";

/**
 * A live SportLots login is a real ~22 s Puppeteer/SSO round trip (the flows' 30 s).
 * SportLots only: BuySportsCards is the fake (NEO-552), whose sign-in steps measured
 * 1.3 s at most on the #487 merge-group run (GUIDE) and take the standard 7 s.
 */
export const LIVE_LOGIN = 30_000;

async function openCredentials(page: Page, gate = 10_000): Promise<void> {
  await page.goto("/profile/credentials");
  // An in-session navigation, not a cold launch: the flows' 10 s. A page that
  // has not loaded the app yet (a second page opened by a cleanup hook) passes
  // `LAUNCH_GATE`.
  await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible({
    timeout: gate,
  });
}

async function pressTest(page: Page): Promise<void> {
  // While another credential op holds the lock the button reads
  // "Testing..."; wait for the real label. BSC only (the fake's sign-in:
  // measured 5 ms at most on the #487 merge-group run (GUIDE)), so the standard 7 s.
  const test = page.getByRole("button", { name: "Test Credentials" });
  await expect(test).toBeVisible();
  await test.click();
}

async function testStoredSession(page: Page, success: RegExp): Promise<void> {
  await pressTest(page);
  await expect(page.getByText(success)).toBeVisible({ timeout: LIVE_LOGIN });
}

/**
 * What Test Credentials says when BuySportsCards accepts the stored session. The
 * store name is read from BSC's seller profile, which can stall (NEO-483), so the
 * line is one of:
 *  - "BSC account authenticated successfully": the store name was confirmed and a
 *    "Store: <name>" line sits under it;
 *  - with no store name to show: "Signed in to BuySportsCards. Couldn't confirm your
 *    store name right now; ..." (a live sign-in) or "Your saved BuySportsCards
 *    sign-in is in place ..." (the cached path).
 * All three are a success; a failure reads "Could not sign in to ..." and matches none.
 */
export const BSC_TEST_SUCCESS =
  /BSC account authenticated successfully|Signed in to BuySportsCards|Your saved BuySportsCards sign-in is in place/i;

/**
 * Waits for BSC's Test Credentials success (either branch above) and says which one
 * the press hit: it goes into the report as a `store-name` annotation
 * (`confirmed` / `unconfirmed`), and the "Store: <name>" line is asserted only on
 * the confirmed branch (an unconfirmed one has no store to show, and says so).
 *
 * Contract: ENTRY the Test press was taken. EXIT a success message is on screen.
 * The fake answers the sign-in at once (measured 2.8 s at most across the suite's Test
 * presses on the #487 merge-group run (GUIDE), one with a cold token), so the standard 7 s.
 */
export async function expectBscTestSuccess(page: Page, timeout = 7_000): Promise<"confirmed" | "unconfirmed"> {
  await expect(page.getByText(BSC_TEST_SUCCESS).first()).toBeVisible({ timeout });
  const outcome = (await page.getByText(/BSC account authenticated successfully/i).first().isVisible()) ? "confirmed" : "unconfirmed";
  try {
    test.info().annotations.push({ type: "store-name", description: outcome });
  } catch {
    // Not inside a test: nothing to annotate.
  }
  if (outcome === "confirmed") await expect(page.getByText(/Store: \S/)).toBeVisible();
  return outcome;
}

/** Open the BSC credentials page and check the worker is connected (no Test press). */
export async function openBscCredentials(page: Page): Promise<void> {
  await openCredentials(page);
  // BuySportsCards is the default tab.
  await expect(page.getByText("Connected to BuySportsCards")).toBeVisible();
}

/** util-login-to-bsc.yaml */
export async function loginToBsc(page: Page): Promise<void> {
  await openBscCredentials(page);
  await pressTest(page);
  await expectBscTestSuccess(page);
}

/** util-login-to-sportlots.yaml — two branches on the operator's pause switch. */
export async function loginToSportLots(page: Page, env: FlowEnv): Promise<void> {
  await openCredentials(page);
  const tab = page.getByRole("tab", { name: "SportLots" });
  await expect(tab).toBeVisible({ timeout: 10_000 });
  await tab.click();

  if (!env.SL_PAUSED) {
    await expect(page.getByText("Connected to SportLots")).toBeVisible();
    await testStoredSession(page, /Sportlots account authenticated successfully/i);
    return;
  }

  // Paused: the panel says so, and offers none of the live controls.
  await expect(page.getByRole("heading", { name: "SportLots Credentials" })).toBeVisible();
  await expect(page.getByText("SportLots is on pause", { exact: true })).toBeVisible();
  await expect(page.getByText(/^Sign-ins to SportLots are benched for now/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Test Credentials" })).toBeHidden();
  await expect(page.getByLabel(/SportLots Username/i)).toBeHidden();
}

/**
 * Saving a sign-in through the seed hop signs in to BuySportsCards (the fake since
 * NEO-552). Measured on the #487 merge-group run (GUIDE) that sized this: the longest hop took
 * 13.4 s (the fake's first token of a run is cold, 7.5-9 s at the seed), so
 * ceil(13.4 + 7) = 21 s. It was 90 s when the sign-in went to the real site.
 */
export const SEED_SIGN_IN = 21_000;

/**
 * Remove the worker's BuySportsCards sign-in on Profile (Clear Credentials,
 * confirmed). For NEO-370 this is how a collector STOPS listing: it also stops
 * the sales poll and clears the queue. Pair it with `saveBscSignIn` in a
 * `finally`, so a worker is never left without its sign-in (R7). `gate` is
 * the heading wait: `LAUNCH_GATE` on a page that has not loaded the app yet.
 */
export async function removeBscSignIn(page: Page, gate?: number): Promise<void> {
  await openCredentials(page, gate);
  // BuySportsCards is the default tab.
  await expect(page.getByText("Connected to BuySportsCards")).toBeVisible();
  // BSC only, measured 0.8 s and 1.3 s on the #487 merge-group run (GUIDE): the standard 7 s.
  const clear = page.getByRole("button", { name: "Clear Credentials" });
  await expect(clear).toBeVisible();
  await clear.click();
  await page.getByRole("button", { name: "Yes, Clear" }).click();
  await expect(page.getByText("Cleared your BuySportsCards connection.")).toBeVisible();
  await expect(page.getByLabel(/BuySportsCards Username/)).toBeVisible();
}

/**
 * Save the worker's BuySportsCards sign-in again, the way the bootstrap does:
 * the `/testing/seed-credentials` hop (no password ever typed, GUIDE hard
 * rule 7). The page must already be signed in. Lands on Profile → Credentials
 * showing "Connected to BuySportsCards".
 *
 * NEO-370 Rev 5: a saved sign-in syncs (counts pushed, sales polled), but the
 * hop marks a seeded one "not syncing" unless `listing: true` (`listing=on`),
 * so a worker's saved sign-in lists nowhere by default. Only `listing: true`
 * sets up real listing on BuySportsCards; pair it with `removeBscSignIn` +
 * `saveBscSignIn(page)` to stop it again. A real save through the Profile
 * form (never done in E2E: it needs a typed password) would also sync.
 */
export async function saveBscSignIn(page: Page, opts: { listing?: boolean } = {}): Promise<void> {
  const listing = opts.listing ? "&listing=on" : "";
  await page.goto(`/testing/seed-credentials?sites=buysportscards${listing}&redirect=/profile/credentials`);
  // The hop signs in to BuySportsCards (SEED_SIGN_IN, GUIDE hard rule 3).
  // A hop that FAILS prints "Seed failed (...)" and goes nowhere: throw its
  // reason now instead of idling to the budget on a heading that never comes.
  const landed = page.getByRole("heading", { name: "Profile Settings" });
  const seedFailed = page.getByText(/^\[testing-seed\] Seed failed/);
  await expect(landed.or(seedFailed)).toBeVisible({ timeout: SEED_SIGN_IN });
  if (await seedFailed.isVisible()) {
    throw new Error(`The BuySportsCards seed hop failed: ${(await seedFailed.innerText()).replace(/\s+/g, " ")}`);
  }
  await expect(page.getByText("Connected to BuySportsCards")).toBeVisible();
}

// ---------------------------------------------------------------------------
// NEO-415: eBay. It signs in by eBay's own consent screen, never a password.
// NEO-555: every test deployment's eBay is the fake (services/fake-bsc, one
// seller per test user), whose consent screen is NB's own testing page
// (`/testing/fake-ebay/authorize`), so a spec CAN connect through the UI
// (profile/ebay-connect-and-setup does). The seed hop below connects the
// worker's main fake seller the same way without the screen (the same
// `/testing/seed-credentials` route, `sites=ebay`: a consent code minted and
// exchanged server-side), for specs that are not about connecting. Profile ->
// Credentials -> eBay (its eBay tab; `/profile/ebay` forwards there) is where the
// connection is read, renewed and removed.
// ---------------------------------------------------------------------------

/** What Profile -> Credentials -> eBay says when the deployment has no eBay wiring. */
export const EBAY_NOT_HOOKED_UP = "eBay isn't hooked up on this NeonBinder yet.";

/**
 * NEO-555: the safety line every eBay spec asserts before it lists: this
 * deployment's eBay is the stand-in, so nothing reaches the real eBay.
 */
export const EBAY_TEST_MODE_LINE = "Test mode: this NeonBinder talks to a stand-in eBay, so nothing lists for real.";

/**
 * Wait until Profile -> Credentials -> eBay's connection card has settled into ONE of its
 * states (every state carries a Connect or a Disconnect button, the not-wired
 * one a disabled Connect), and FAIL LOUDLY, naming the missing setup, when the
 * deployment is not wired to eBay. A spec for eBay is never skipped for want
 * of its credentials (GUIDE hard rule 1): a deployment without them is a red
 * run that says what to set.
 */
export async function expectEbayHookedUp(page: Page): Promise<void> {
  const connect = page.getByRole("button", { name: /^Connect eBay/ });
  const disconnect = page.getByRole("button", { name: "Disconnect eBay", exact: true });
  // One of the card's controls is showing: the connection state has arrived.
  await expect(connect.or(disconnect).first()).toBeVisible();
  if (await page.getByText(EBAY_NOT_HOOKED_UP, { exact: true }).isVisible()) {
    throw new Error(
      "eBay is not configured on this deployment, so the eBay specs cannot run. " +
        "Set EBAY_ENVIRONMENT=fake on the Convex deployment (beside TESTING_RESET_SECRET and the fake " +
        "BuySportsCards wiring; `npx convex run fakeBsc:ebayTarget` says fake when it is wired). " +
        "This spec never skips for missing setup.",
    );
  }
}

/**
 * Connect the worker's main fake eBay seller the way the bootstrap saves the
 * other sign-ins: the `/testing/seed-credentials` hop (no password, GUIDE hard
 * rule 7). The page must already be signed in. Lands on Profile -> Credentials -> eBay.
 *
 * `listing: true` (`listing=on`) is what a collector's own Connect does:
 * connected IS listing. Without it the hop marks the connection "not syncing".
 * The eBay listing specs pass `listing: true`; pair it with `removeEbayConnection`.
 *
 * `gate` is the wait for the full page load the hop ends in (the caller's
 * `LAUNCH_GATE`: the hop is one token exchange with the fake, not a live sign-in).
 * A hop that FAILS prints "Seed failed (...)" and goes nowhere; that is thrown
 * here with its reason. A hop that SKIPS (eBay paused) lands on the page with
 * eBay not connected: the caller's next assertion names it. A deployment with
 * no eBay wiring throws from `expectEbayHookedUp`.
 */
export async function saveEbayConnection(page: Page, opts: { listing?: boolean; gate: number }): Promise<void> {
  const listing = opts.listing ? "&listing=on" : "";
  await page.goto(`/testing/seed-credentials?sites=ebay${listing}&redirect=/profile/ebay`);
  const landed = page.getByRole("heading", { name: "Profile Settings" });
  const seedFailed = page.getByText(/^\[testing-seed\] Seed failed/);
  await expect(landed.or(seedFailed)).toBeVisible({ timeout: opts.gate });
  if (await seedFailed.isVisible()) {
    throw new Error(`The eBay seed hop failed: ${(await seedFailed.innerText()).replace(/\s+/g, " ")}`);
  }
  await expectEbayHookedUp(page);
}

/**
 * Disconnect eBay through the product (Profile -> Credentials -> eBay -> Disconnect eBay,
 * confirmed): it takes down every listing NeonBinder put up on eBay, drops the
 * queue and the saved setup, and leaves the account not connected. Safe to call
 * when eBay is not connected (it then only opens the page and returns).
 * `gate` is the page-load wait (`LAUNCH_GATE` on a page that has not loaded the
 * app yet). The takedown gets the standard 7 s budget.
 */
export async function removeEbayConnection(page: Page, opts: { gate: number }): Promise<void> {
  await page.goto("/profile/ebay");
  await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible({ timeout: opts.gate });
  const connect = page.getByRole("button", { name: /^Connect eBay/ });
  const disconnect = page.getByRole("button", { name: "Disconnect eBay", exact: true });
  await expect(connect.or(disconnect).first()).toBeVisible();
  if (await disconnect.isVisible()) {
    await disconnect.click();
    await page.getByRole("dialog", { name: "Disconnect eBay?", exact: true }).getByRole("button", { name: "Yes, disconnect" }).click();
    await expect(disconnect).toBeHidden();
  }
  await expect(page.getByRole("button", { name: "Connect eBay", exact: true })).toBeVisible();
}

/**
 * NEO-555. Connect the worker's MAIN fake eBay seller with listing on and
 * finish its setup, for the specs whose subject is what happens once eBay
 * lists (the listing, over-80 and refusals specs). The connect-and-setup
 * spec proves each of these steps in full on the `alt` seller; this is the
 * same path with only the asserts each step needs to be known done.
 *
 *   1. The seller holds the two fixed shipping policies (`EBAY_POLICY`; seeded,
 *      or already there from an earlier spec on the worker: ./ebayFake.ts).
 *   2. The seed hop connects it, listing on. Connected, the test-mode line,
 *      "5 to go".
 *   3. Ships from saved (Enter in the last field); "4 to go".
 *   4. "Set me up" when offered (a seller with no payment or returns policy yet;
 *      an earlier spec on the worker made them, so it may not be): its answer
 *      line. Otherwise the hand-pick: Set me up gone and the seller's own
 *      Payment and Returns policies offered, nothing picked yet. The branch is
 *      taken only after the policy read has landed on one of the two (never an
 *      instant read of a page still loading). `setMeUp` pins the branch: a
 *      caller that KNOWS the seller's state (it set the seller up earlier in the
 *      same spec) passes "not offered", and the hand-pick is then proven, not
 *      merely allowed (the refusals spec does).
 *   5. NB Free Shipping for Cards under $20, NB Tracked for $20 and up, the
 *      first Payment and Returns policy: "You're all set".
 *
 * `seller: "alt"` connects the worker's second fake seller instead, through
 * eBay's consent screen ("Agree as another eBay account"; the seed hop knows
 * only the main one). `axeLabel` runs the axe check just before the first
 * pick, on the state the branch left: with `setMeUp: "not offered"` that is the
 * hand-pick (Payment and Returns offered, none picked).
 *
 * ENTRY the page is signed in, eBay not connected, every other box already
 * in-person (a connection that lists walks every card in a listed box). The
 * caller records "connected" for its cleanup BEFORE calling: the hop may
 * connect and still fail on the way back. EXIT on Profile -> Credentials ->
 * eBay, connected and set up. Every step the standard budget except the hop's
 * full page load (`gate`, the caller's LAUNCH_GATE).
 */
export async function connectEbayAndFinishSetup(
  page: Page,
  ebayFake: EbayFake,
  opts: { gate: number; setMeUp?: "offered" | "not offered"; seller?: "main" | "alt"; axeLabel?: string },
): Promise<void> {
  const said = (text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
  const steps = page.getByRole("status").filter({ hasText: /to go\. Nothing lists on eBay until they're done\.$/ });
  const seller = opts.seller ?? "main";
  await ebayFake.holdShippingPolicy(EBAY_POLICY.free, seller);
  await ebayFake.holdShippingPolicy(EBAY_POLICY.tracked, seller);
  if (seller === "main") {
    await saveEbayConnection(page, { listing: true, gate: opts.gate });
  } else {
    // eBay's consent screen, as the second account; home again on a full page load.
    await page.goto("/profile/ebay");
    await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible({ timeout: opts.gate });
    await page.getByRole("button", { name: "Connect eBay", exact: true }).click();
    await expect(page).toHaveURL(/\/testing\/fake-ebay\/authorize\?/, { timeout: opts.gate });
    const consent = page.getByRole("region", { name: "Stand-in eBay sign-in", exact: true });
    await expect(consent.getByRole("button", { name: "Agree", exact: true })).toBeFocused({ timeout: opts.gate });
    await consent.getByRole("button", { name: "Agree as another eBay account", exact: true }).click();
    await expect(page).toHaveURL(/\/profile\/credentials\?platform=ebay$/, { timeout: opts.gate });
  }
  await expect(
    page.getByText(/^Rockin' on eBay as .+ since .+\.$/),
    "eBay did not connect after the seed hop or the consent screen. Either the deployment's eBay is not the fake (EBAY_ENVIRONMENT=fake), " +
      "or eBay is paused here (NEONBINDER_PAUSED_PLATFORMS) while this runner's PAUSED_PLATFORMS does not name ebay.",
  ).toBeVisible();
  await expect(page.getByText(EBAY_TEST_MODE_LINE, { exact: true })).toBeVisible();
  await expect(steps).toHaveText("5 to go. Nothing lists on eBay until they're done.");

  // The seller's policies are read from eBay when the page opens. The read has
  // landed when one of the seller's own shipping policies is offered AND the
  // Payment and returns card shows its answer: "Set me up" (a payment or returns
  // policy missing) or the seller's own Payment policies. Both come from the
  // one read, so the branch below is settled by a web-first wait, not guessed.
  const underTwenty = page.getByRole("radiogroup", { name: "Cards under $20", exact: true });
  const free = underTwenty.getByRole("radio", { name: EBAY_POLICY.free.name, exact: true });
  await expect(free).toBeVisible();
  const setMeUp = page.getByRole("button", { name: "Set me up", exact: true });
  const paymentRadios = page.getByRole("radiogroup", { name: "Payment", exact: true }).getByRole("radio");
  await expect(setMeUp.or(paymentRadios.first()).first()).toBeVisible();
  const setMeUpOffered = await setMeUp.isVisible();
  if (opts.setMeUp !== undefined) {
    expect(setMeUpOffered ? "offered" : "not offered", "whether Set me up is offered to this seller").toBe(opts.setMeUp);
  }

  await page.getByRole("textbox", { name: "ZIP code", exact: true }).fill("53703");
  await page.getByRole("textbox", { name: "City", exact: true }).fill("Madison");
  await page.getByRole("textbox", { name: "State", exact: true }).fill("WI");
  await page.keyboard.press("Enter");
  await expect(said("Saved. Your cards ship from here.")).toBeVisible();
  await expect(steps).toHaveText("4 to go. Nothing lists on eBay until they're done.");

  if (setMeUpOffered) {
    await setMeUp.click();
    await expect(said(/^(Made \d+ on your eBay account|You already had everything)/)).toBeVisible();
  } else {
    // The hand-pick: nothing to make, so nothing offered to make it, and the
    // seller's own payment and returns policies are there to pick, none picked
    // yet (a fresh connection starts from an empty setup).
    await expect(setMeUp).toBeHidden();
    for (const group of ["Payment", "Returns"]) {
      const radios = page.getByRole("radiogroup", { name: group, exact: true });
      await expect(radios.getByRole("radio").first()).toBeVisible();
      await expect(radios.getByRole("radio", { checked: true })).toHaveCount(0);
    }
  }
  if (opts.axeLabel) await expectAccessible(page, { label: opts.axeLabel });
  await free.click();
  await expect(free).toBeChecked();
  const tracked = page.getByRole("radiogroup", { name: "$20 and up", exact: true }).getByRole("radio", { name: EBAY_POLICY.tracked.name, exact: true });
  await tracked.click();
  await expect(tracked).toBeChecked();
  for (const group of ["Payment", "Returns"]) {
    const radios = page.getByRole("radiogroup", { name: group, exact: true }).getByRole("radio");
    await radios.first().click();
    await expect(page.getByRole("radiogroup", { name: group, exact: true }).getByRole("radio", { checked: true })).toHaveCount(1);
  }
  await expect(page.getByRole("heading", { level: 3, name: "You're all set", exact: true })).toBeVisible();
  await expect(steps).toBeHidden();
}
