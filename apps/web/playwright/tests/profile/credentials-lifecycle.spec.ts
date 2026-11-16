// Origin: .maestro/flows/profile/credentials-lifecycle.yaml (Maestro suite retired in NEO-341; see git history)
// Isolated "new-profile" account. Per platform: connect (seeded: the fake
// BuySportsCards account of this user, SportLots' real one), test, clear, then a
// rejected sign-in with bad creds (nothing saved: the sign-in form is still
// showing), re-connect, test, clear.
import type { Page } from "@playwright/test";
import { expectBscTestSuccess } from "../../support/credentials";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";

// SportLots is the one live marketplace here: its steps keep their ceilings. BuySportsCards is
// the fake (NEO-552) and takes the standard 7 s: the longest BSC step on the #487 merge-group run (GUIDE)
// took 2.8 s (the seed hop), so `forSite` gives it no timeout of its own.
const SEED_BUDGET = 90_000; // seed-credentials performs a real SportLots sign-in
const LIVE = 30_000; // live SportLots round trip
const REJECTED = 120_000; // a rejected live SportLots sign-in
const forSite = (label: string, sportLotsMs: number): number | undefined => (label === "SportLots" ? sportLotsMs : undefined);
/** NEO-552: the fake BuySportsCards' rejected-credentials pair: a well-formed fake user and the password it always refuses. */
const FAKE_BSC_REJECTED_USER = "nb+e2e-rejected@fake.invalid";
const FAKE_BSC_REJECTED_PASSWORD = "wrong-password";

async function seedAndOpen(page: Page, site: string, label: string): Promise<void> {
  await page.goto(`/testing/seed-credentials?sites=${site}&redirect=/profile/credentials`);
  await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible({
    timeout: forSite(label, SEED_BUDGET),
  });
  await selectSite(page, label);
}

async function selectSite(page: Page, label: string): Promise<void> {
  // BuySportsCards is the default tab; SportLots needs a click.
  if (label === "SportLots") {
    await page.getByRole("tab", { name: "SportLots" }).click();
  }
  await expect(page.getByRole("heading", { name: `${label} Credentials` })).toBeVisible();
}

async function testStoredSession(page: Page, label: string, success: RegExp | "bsc"): Promise<void> {
  await expect(page.getByText(`Connected to ${label}`)).toBeVisible();
  const testButton = page.getByRole("button", { name: "Test Credentials" });
  await expect(testButton).toBeVisible({ timeout: forSite(label, LIVE) });
  await testButton.click();
  if (success === "bsc") await expectBscTestSuccess(page);
  else await expect(page.getByText(success)).toBeVisible({ timeout: LIVE });
  await expectAccessible(page, { label: `Profile, ${label} credentials, tested` });
}

async function clearConnection(page: Page, label: string): Promise<void> {
  const clear = page.getByRole("button", { name: "Clear Credentials" });
  await expect(clear).toBeVisible({ timeout: forSite(label, LIVE) });
  await clear.click();
  await page.getByRole("button", { name: "Yes, Clear" }).click();
  await expect(page.getByText(`Cleared your ${label} connection.`)).toBeVisible({ timeout: forSite(label, LIVE) });
}

async function failedSignIn(
  page: Page,
  label: string,
  user: string,
  pass: string,
  rejection: RegExp,
): Promise<void> {
  const username = page.getByLabel(new RegExp(`${label} Username`));
  await expect(username).toBeVisible({ timeout: forSite(label, LIVE) });
  await username.fill(user);
  await page.getByLabel(new RegExp(`${label} Password`)).fill(pass);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText(rejection)).toBeVisible({ timeout: forSite(label, REJECTED) });
  await expectAccessible(page, { label: `Profile, ${label} sign-in rejected` });
  // Nothing was saved: the form only renders while the account is unconnected.
  await expect(username).toBeVisible();
}

test(
  "Credentials lifecycle — connect, rejected sign-in, recover, clear (BSC + SportLots)",
  { tag: ["@credentials", "@profile"] },
  async ({ page, signIn, env }) => {
    await signIn("/profile/credentials", { account: "new-profile" });
    await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible({
      timeout: LAUNCH_GATE,
    });

    // ---- BuySportsCards ----
    const bsc = "BuySportsCards";
    await seedAndOpen(page, "buysportscards", bsc);
    await testStoredSession(page, bsc, "bsc");
    await clearConnection(page, bsc);

    await failedSignIn(
      page,
      bsc,
      // NEO-552: BuySportsCards is the fake; a user it knows with its one rejected password
      // (services/fake-bsc/CONTRACT.md, "Accounts") gets B2C's rejected-credentials answer, the
      // same path a real wrong password takes. Neither value is a secret.
      FAKE_BSC_REJECTED_USER,
      FAKE_BSC_REJECTED_PASSWORD,
      /Could not sign in to BuySportsCards.*Nothing was saved/s,
    );

    // Recover: re-connect real creds and prove the session works.
    await seedAndOpen(page, "buysportscards", bsc);
    await testStoredSession(page, bsc, "bsc");

    // A fresh load still shows the connection; clear it for good.
    await page.goto("/profile/credentials");
    await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible();
    await expect(page.getByRole("heading", { name: `${bsc} Credentials` })).toBeVisible();
    await clearConnection(page, bsc);
    await expect(page.getByLabel(/BuySportsCards Username/)).toBeVisible();

    // ---- SportLots ----
    const sl = "SportLots";
    if (!env.SL_PAUSED) {
      await seedAndOpen(page, "sportlots", sl);
      await testStoredSession(page, sl, /SportLots account authenticated successfully/i);
      await clearConnection(page, sl);

      await page.goto("/profile/credentials");
      await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible({
        timeout: LIVE,
      });
      await selectSite(page, sl);
      // NEO-288: SportLots refuses the sign-in site-side.
      await failedSignIn(
        page,
        sl,
        "e2e-fake-sl-user",
        "e2e-fake-sl-pass",
        /SportLots wouldn't let us in the door/,
      );

      await seedAndOpen(page, "sportlots", sl);
      await testStoredSession(page, sl, /SportLots account authenticated successfully/i);

      await page.goto("/profile/credentials");
      await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible({
        timeout: LIVE,
      });
      await selectSite(page, sl);
      await clearConnection(page, sl);
      await expect(page.getByLabel(/SportLots Username/)).toBeVisible();
    } else {
      await page.goto("/testing/seed-credentials?sites=sportlots&redirect=/profile/credentials");
      await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible({
        timeout: LIVE,
      });
      await selectSite(page, sl);
      await expect(page.getByText("SportLots is on pause", { exact: true })).toBeVisible();
      await expect(page.getByText(/^Sign-ins to SportLots are benched for now/)).toBeVisible();
      await expect(page.getByLabel(/SportLots Username/)).toBeHidden();
      await expect(page.getByRole("button", { name: "Connect", exact: true })).toBeHidden();
      await expect(page.getByRole("button", { name: "Test Credentials" })).toBeHidden();
      await expect(page.getByRole("button", { name: "Sign in again" })).toBeHidden();
    }
  },
);
