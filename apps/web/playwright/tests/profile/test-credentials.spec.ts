// Origin: .maestro/flows/profile/test-credentials.yaml (Maestro suite retired in NEO-341; see git history)
import { expectBscTestSuccess } from "../../support/credentials";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";

// The SportLots steps keep their live ceiling; BuySportsCards is the fake (NEO-552) and its steps
// take the standard 7 s (measured 30 ms at most on the #487 merge-group run (GUIDE)).
const LIVE = 30_000; // live SportLots round trip

test("BSC and SportLots credentials pass a live test", { tag: ["@credentials", "@profile"] }, async ({ page, signIn, env }) => {
  await signIn("/profile/credentials");
  await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible({
    timeout: LAUNCH_GATE,
  });

  // BuySportsCards is the default tab.
  await expect(page.getByRole("heading", { name: "BuySportsCards Credentials" })).toBeVisible();
  await expect(page.getByText("Connected to BuySportsCards")).toBeVisible();
  const testButton = page.getByRole("button", { name: "Test Credentials" });
  await expect(testButton).toBeVisible();
  await testButton.click();
  // Either success shape (NEO-483): the store name confirmed, or BSC's profile too slow to say.
  // The fake BuySportsCards (NEO-552) answers its profile at once, so it is the confirmed shape
  // here; the helper accepts the other too.
  await expectBscTestSuccess(page);
  await expectAccessible(page, { label: "Profile, BuySportsCards credentials, tested" });

  await page.getByRole("tab", { name: "SportLots" }).click();
  await expect(page.getByRole("heading", { name: "SportLots Credentials" })).toBeVisible({
    timeout: 10_000,
  });

  if (!env.SL_PAUSED) {
    await expect(page.getByText("Connected to SportLots")).toBeVisible();
    await expect(testButton).toBeVisible({ timeout: LIVE });
    await testButton.click();
    await expect(page.getByText(/Sportlots account authenticated successfully/i)).toBeVisible({
      timeout: LIVE,
    });
  } else {
    await expect(page.getByText("SportLots is on pause", { exact: true })).toBeVisible();
    await expect(page.getByText(/^Sign-ins to SportLots are benched for now/)).toBeVisible();
    await expect(testButton).toBeHidden();
    await expect(page.getByRole("button", { name: "Sign in again" })).toBeHidden();
  }
});
