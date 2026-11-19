// NEO-415 (R1), on the stand-in eBay since NEO-555: eBay's consent round trip,
// the two ways it ends without a connection.
//   1. A collector who presses Connect on Profile -> Credentials -> eBay is sent
//      to eBay's consent page, asking for what NeonBinder needs (a code grant for
//      this app, the way back, a one-time state and the sell scopes). On a test
//      deployment that page is the fake's (`/testing/fake-ebay/authorize`, NB's
//      own origin), so the leg is followed for real: no route is stubbed.
//   2. They press Decline. eBay's "no" comes back (`error=access_denied` with the
//      state), and NeonBinder says so in its own words, as a status, not an
//      error: nothing connected, the code-free address, Connect ready again; Back
//      never lands on the spent consent screen or the answer.
//   3. A return NeonBinder did not start (a code with a state it never issued)
//      is refused in NeonBinder's words, as an alert, with the code and the
//      state scrubbed from the address bar so a refresh or Back cannot replay them.
// Agreeing (the connection itself) is `profile/ebay-connect-and-setup`.
//
// Needs the deployment's eBay to be the fake (it FAILS loudly, naming the missing
// setup, when eBay is not wired at all: `expectEbayHookedUp`). Under an eBay pause
// (`env.EBAY_PAUSED`) the page offers no Connect, so the paused branch asserts
// that and stops (R2: both branches end in hard asserts).
//
// R7: it connects nothing and removes nothing. Pressing Connect leaves a
// one-time hookup note on the worker's own eBay settings, which the declined
// return spends and the next per-user reset clears.
import { EBAY_TEST_MODE_LINE, expectEbayHookedUp } from "../../support/credentials";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";

const PAUSED_LINE = "eBay is on a break. Your changes wait here and go up when it's back.";
/** What a return with a state NeonBinder never issued is told (NONCE_STALE in convex/ebayConnect.ts). */
const STALE_HOOKUP = "That eBay hookup timed out. Press Connect again.";
/** What a collector who said no on eBay's page is told (EbayPanel, the declined phase). */
const DECLINED = "No worries, eBay isn't connected. Connect whenever you're ready.";
/** The stand-in eBay's consent page: where Connect sends the collector on a test deployment. */
const STAND_IN_AUTHORIZE = /\/testing\/fake-ebay\/authorize\?/;
const CREDENTIALS = /\/profile\/credentials\?platform=ebay$/;

test(
  "Profile -> Credentials -> eBay: Connect leaves for eBay's consent page, Decline comes back not connected, and a return with a state NeonBinder never issued is refused clean",
  { tag: ["@profile", "@credentials"] },
  async ({ page, signIn, env }) => {
    const connect = page.getByRole("button", { name: "Connect eBay", exact: true });
    const connectedLine = page.getByText(/^Rockin' on eBay as /);

    await signIn("/profile/ebay");
    await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible({ timeout: LAUNCH_GATE });
    // Fails loudly, naming the setup, when this deployment has no eBay wiring.
    await expectEbayHookedUp(page);

    if (env.EBAY_PAUSED) {
      await expect(page.getByText(PAUSED_LINE, { exact: true })).toBeVisible();
      await expect(connect).toBeHidden();
      await expectAccessible(page, { label: "Profile, eBay on a break" });
      return;
    }

    await expect(
      page.getByText(EBAY_TEST_MODE_LINE, { exact: true }),
      "this spec follows Connect to the stand-in eBay's consent page; it runs only on a deployment wired to the fake eBay (EBAY_ENVIRONMENT=fake)",
    ).toBeVisible();
    await expect(connect).toBeVisible();

    // --- 1. Connect: off to eBay's consent page --------------------------------------------
    await connect.click();
    await expect(page).toHaveURL(STAND_IN_AUTHORIZE);
    const consent = page.getByRole("region", { name: "Stand-in eBay sign-in", exact: true });
    // A full page load of the consent screen (it is its own route, outside the app shell).
    await expect(consent.getByRole("heading", { level: 1, name: "Stand-in eBay sign-in" })).toBeVisible({ timeout: LAUNCH_GATE });
    // What NeonBinder asks eBay for: a code grant for this app, handed back with the one-time note it kept.
    const asked = new URL(page.url());
    expect(asked.searchParams.get("response_type"), "an authorization-code grant").toBe("code");
    expect(asked.searchParams.get("client_id"), "this app's id").toBeTruthy();
    expect(asked.searchParams.get("redirect_uri"), "where eBay sends the collector back").toBeTruthy();
    expect(asked.searchParams.get("state"), "the one-time note NeonBinder checks on the way back").toBeTruthy();
    const scopes = (asked.searchParams.get("scope") ?? "").split(" ");
    for (const wanted of ["sell.inventory", "sell.account", "sell.fulfillment"]) {
      expect(scopes.some((scope) => scope.endsWith(`/${wanted}`)), `the consent asks for ${wanted}`).toBe(true);
    }
    // eBay's three answers; Agree holds the keyboard, the default answer.
    const agree = consent.getByRole("button", { name: "Agree", exact: true });
    await expect(agree).toBeFocused();
    await expect(consent.getByRole("button", { name: "Agree as another eBay account", exact: true })).toBeVisible();
    const decline = consent.getByRole("button", { name: "Decline", exact: true });
    await expectAccessible(page, { label: "Stand-in eBay consent page" });

    // --- 2. Decline: eBay's "no" comes home, nothing connected ------------------------------------
    await decline.click();
    await expect(page).toHaveURL(CREDENTIALS);
    await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: DECLINED })).toBeVisible();
    // A "no" is not an error: no alert, nothing connected, Connect ready again.
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
    await expect(connectedLine).toBeHidden();
    await expect(connect).toBeVisible();
    await expect(page).not.toHaveURL(/code=|state=|error=/);
    await expectAccessible(page, { label: "Profile, eBay consent declined" });
    // Back steps past the consent screen and the answer (each replaced the last):
    // the page Connect was pressed on, Connect ready.
    await page.goBack();
    await expect(page).toHaveURL(CREDENTIALS);
    await expect(page).not.toHaveURL(/code=|state=|error=/);
    await expect(connect).toBeVisible();

    // --- 3. A return NeonBinder did not start: refused, scrubbed, still not connected -----------
    // (A full page load, as eBay's redirect is.)
    await page.goto("/profile/ebay?code=x&state=bogus");
    await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible({ timeout: LAUNCH_GATE });
    const refusal = page.getByRole("alert").filter({ hasText: STALE_HOOKUP });
    await expect(refusal).toBeVisible();
    // The code and the state are gone from the address bar (replaced, so Back cannot land on them).
    await expect(page).toHaveURL(CREDENTIALS);
    // Nothing connected, and the keyboard is on Connect to try again.
    await expect(connectedLine).toBeHidden();
    await expect(page.getByText("Heads up: connecting starts listing", { exact: true })).toBeVisible();
    await expect(connect).toBeFocused();
    await expectAccessible(page, { label: "Profile, eBay return refused" });
    await page.goBack();
    await expect(page).toHaveURL(CREDENTIALS);
    await expect(page).not.toHaveURL(/code=|state=/);
  },
);
