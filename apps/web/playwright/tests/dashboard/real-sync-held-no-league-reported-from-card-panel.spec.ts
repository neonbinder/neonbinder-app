// R1 (NEO-569): a card an eBay sync held back because it has no league is
// reported to our crew from the card's own panel. eBay needs a League on every
// new listing; only an admin sets a card's league, so the collector is never
// asked to pick one. Sync status on the dashboard says so in a sentence, the
// card's panel (opened from it) carries the held notice with a Report button,
// and sending the report reads "Reported" in the panel and under the set on
// the dashboard. The report is then withdrawn (the crew's side of a report is
// proved by `real-sync-report-to-crew`, which this spec does not repeat).
//
// A held-back set is a state only a real sync produces, and the eBay sandbox
// seller is one shared account, so the spec seeds NB's own record of one with
// /testing/seed-dashboard?syncHeld=noLeague (`seedMyTestSync`,
// `clearMyTestDashboardSeeds`: the caller's own marked rows, refused off
// testing deployments; `noLeague` is written on eBay only, and nothing seeded
// makes NB call a marketplace). The spec never connects eBay.
//
// No isMobile branch: the dashboard is one column that wraps and the panel is
// a sheet; the Send action is asserted on screen (toBeInViewport) on both.
//
// R7/R7a: writes only the signed-in user's own rows: a box and one copy in it on
// one card of the seed's 2024 Topps Chrome Base (registered in SET-REGISTRY.md;
// the seventh ordinary row, the other dashboard specs on this account use the
// first six), the marked sync seed, and its own sync report. Self-cleaning: the
// report is withdrawn, the seed cleared, the copy removed and the box deleted
// through the UI; an afterEach does the same on a failure (the report and seed
// first: left behind they show on this account's dashboard and in every admin's
// queue). The box name is a single token minted from `env.ATTEMPT_TOKEN`.
import { createBox, deleteBoxNamed, deleteOpenBox, drillToCollectorBase, inventoryTabs, ordinaryBaseRows, shortNameOf } from "../../support/collection";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import type { Page } from "@playwright/test";

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What the body has written so far, so the failure hook can take it back. */
const written: { box?: string; card?: { short: string; number: string; player: string }; reported?: boolean } = {};

/** The card's panel, by its title ("2024 Topps Chrome #<number> <player>..."). */
const drawerOf = (page: Page, card: { number: string; player: string }) =>
  page.getByRole("dialog", { name: new RegExp(`^2024 Topps Chrome #${escapeRegExp(card.number)} ${escapeRegExp(card.player)}`) });

/** The eBay set on the dashboard's Sync status, by its heading ("<set> on eBay"). */
const ebaySet = (page: Page) =>
  page
    .getByRole("region", { name: "Sync status" })
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { level: 3, name: / on eBay$/ }) });

const REPORTED = "Reported. Our crew's on it.";
const WITHDRAW_REPORT = /^Withdraw report for /;
const NO_LEAGUE_SENTENCE = "eBay listings need a league, and this card doesn't have one yet. Report it and our crew sets it.";

// A failed run must not leave an open report, its seed, its copy or its box behind. Each step runs even when an
// earlier one fails, and the first failure is rethrown at the end.
test.afterEach(async ({ context }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const clean = await context.newPage();
  const failures: unknown[] = [];
  const attempt = async (step: () => Promise<void>) => {
    try {
      await step();
    } catch (error) {
      failures.push(error);
    }
  };
  try {
    if (written.reported) {
      await attempt(async () => {
        await clean.goto("/dashboard");
        await expect(clean.getByRole("heading", { level: 1, name: "Welcome back, slugger." })).toBeVisible();
        const reportedLine = ebaySet(clean).getByText(REPORTED);
        const reportButton = ebaySet(clean).getByRole("button", { name: /^Report to our crew about / });
        // The set settles on one of two: still reported (withdraw it), or the body already withdrew it.
        await expect(reportedLine.or(reportButton)).toBeVisible();
        if (await reportedLine.isVisible()) {
          await clean.getByRole("button", { name: WITHDRAW_REPORT }).click();
          await expect(reportButton).toBeVisible();
        }
      });
    }
    await attempt(async () => {
      await clean.goto("/testing/seed-dashboard?clear=1");
      await expect(clean).toHaveURL(/\/dashboard$/);
      await expect(clean.getByRole("heading", { level: 1, name: "Welcome back, slugger." })).toBeVisible();
    });
    const { card, box } = written;
    if (card) {
      await attempt(async () => {
        await clean.goto("/inventory?tab=checklists");
        const stock = await drillToCollectorBase(clean);
        const drawer = drawerOf(clean, card);
        await stock.getByRole("button", { name: `Details for ${card.short}`, exact: true }).click();
        const yourCopies = drawer.getByRole("region", { name: `Your copies of ${card.short}`, exact: true });
        const none = yourCopies.getByText("None yet. Fill in what you know below and add it.");
        const remove = yourCopies.getByRole("button", { name: `Remove ${card.short}, Raw, Excellent`, exact: true });
        // The body added one copy, or died before it did: the panel settles on one of the two.
        await expect(none.or(remove)).toBeVisible();
        if (await remove.isVisible()) {
          await remove.click();
          await expect(none).toBeVisible();
        }
        await drawer.getByRole("button", { name: "Close card detail" }).click();
        await expect(drawer).toBeHidden();
      });
    }
    if (box) await attempt(() => deleteBoxNamed(clean, box));
  } finally {
    await clean.close();
    written.box = undefined;
    written.card = undefined;
    written.reported = undefined;
  }
  if (failures.length > 0) throw failures[0];
});

test(
  "Dashboard: a card eBay held back for having no league says so in Sync status, and its panel carries the held notice with a Report button that reads Reported once sent",
  { tag: ["@dashboard"] },
  async ({ page, signIn, env }) => {
    const box = `NoLeague${env.ATTEMPT_TOKEN}`;
    const greeting = page.getByRole("heading", { level: 1, name: "Welcome back, slugger." });

    // --- A box with one card in it: what the held-back seed hangs on ----------
    // Any seed a broken earlier run left is cleared first (the page then forwards to the dashboard).
    await signIn("/testing/seed-dashboard?clear=1");
    await expect(greeting).toBeVisible({ timeout: LAUNCH_GATE });
    await page.goto("/inventory?tab=boxes");
    await expect(page.getByRole("list", { name: "Your boxes" })).toBeVisible();
    await createBox(page, box);
    written.box = box;
    await page.goto("/inventory?tab=checklists");
    await expect(inventoryTabs(page).getByRole("link", { name: "Checklists", exact: true })).toHaveAttribute("aria-current", "page");
    const stock = await drillToCollectorBase(page);
    // The seventh ordinary row: the other dashboard specs on this account use the first six.
    const row = ordinaryBaseRows(stock).nth(6);
    await expect(row).toBeVisible();
    const card = await shortNameOf(row);
    written.card = card;
    const drawer = drawerOf(page, card);
    await stock.getByRole("button", { name: `Details for ${card.short}`, exact: true }).click();
    const yourCopies = drawer.getByRole("region", { name: `Your copies of ${card.short}`, exact: true });
    await expect(yourCopies.getByText("None yet. Fill in what you know below and add it.")).toBeVisible();
    const addForm = drawer.getByRole("form", { name: "Add a copy", exact: true });
    await addForm.getByRole("combobox", { name: "Where it lives" }).selectOption({ label: `${box} (box, for sale)` });
    await addForm.getByRole("spinbutton", { name: "Price", exact: true }).fill("2");
    await addForm.getByRole("button", { name: "Add to inventory" }).click();
    await expect(drawer.getByRole("status").filter({ hasText: `Added ${card.short}, Raw, Excellent` })).toBeVisible();
    await drawer.getByRole("button", { name: "Close card detail" }).click();
    await expect(drawer).toBeHidden();

    // --- Seed a card eBay held back for its league, then the dashboard ---------
    await page.goto("/testing/seed-dashboard?syncHeld=noLeague");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(greeting).toBeVisible();

    // Sync status says why, in a sentence, and that the fix is the crew's (not a pick the collector makes).
    const set = ebaySet(page);
    await expect(set).toBeVisible();
    const heldCard = set
      .getByRole("link")
      .filter({ hasText: card.player })
      .filter({ hasText: `#${card.number}` });
    await expect(heldCard).toBeVisible();
    await expect(heldCard.getByText(NO_LEAGUE_SENTENCE)).toBeVisible();
    await expect(set.getByText("On our crew, not you.")).toBeVisible();
    await expectAccessible(page, { label: "Dashboard, a card held back for having no league" });

    // --- Open the card's panel over the dashboard: the held notice and Report ---
    await heldCard.click();
    await expect(page).toHaveURL(/\/dashboard\?detail=[^&]+&side=inventory&held=ebay\.noLeague$/);
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(/^Held back from eBay: listings there need a league/)).toBeVisible();
    await expect(drawer.getByText(/Report it and our crew sets it\.$/)).toBeVisible();
    // The Sync status under the panel has a same-named Report button behind the overlay: the panel's is the one in the dialog.
    const reportButton = page.getByRole("dialog").getByRole("button", { name: /^Report to our crew about .+ on eBay$/ });
    await expect(reportButton).toBeVisible();
    await expectAccessible(page, { label: "Dashboard, a no-league card's panel with Report" });

    // --- Send the report: the panel reads Reported ------------------------------
    await reportButton.click();
    const noteField = page.getByRole("dialog").getByRole("textbox", { name: /^Note for our crew \(optional\)/ });
    await expect(noteField).toBeFocused();
    await noteField.fill(`League${env.ATTEMPT_TOKEN}`);
    written.reported = true;
    const send = page.getByRole("dialog").getByRole("button", { name: /^Send report on / });
    // Reachability on both projects (a phone folds the panel into a sheet): the action is on screen.
    await send.scrollIntoViewIfNeeded();
    await expect(send).toBeInViewport();
    await send.click();
    await expect(page.getByRole("dialog").getByText(REPORTED)).toBeVisible();
    await expect(reportButton).toHaveCount(0);

    // Back closes the panel; the set under it reads Reported too, and "With our crew" lists the report.
    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(drawer).toBeHidden();
    await expect(set.getByText(REPORTED)).toBeVisible();
    const mine = page
      .getByRole("region", { name: "With our crew" })
      .getByRole("listitem")
      .filter({ hasText: "Sync report" })
      .filter({ hasText: "eBay" });
    await expect(mine).toBeVisible();

    // --- Withdraw the report (the crew's side is proved by real-sync-report-to-crew) ---
    const withdraw = mine.getByRole("button", { name: WITHDRAW_REPORT });
    await withdraw.scrollIntoViewIfNeeded();
    await expect(withdraw).toBeInViewport();
    await withdraw.click();
    await expect(page.getByRole("status").filter({ hasText: /^Withdrew the report on / })).toBeVisible();
    await expect(mine).toHaveCount(0);
    written.reported = false;
    await expect(set.getByRole("button", { name: /^Report to our crew about .+ on eBay$/ })).toBeVisible();
    await expect(set.getByText(REPORTED)).toHaveCount(0);

    // --- Clear the seed, then cleanup through the UI: remove the copy, delete the box ---
    await page.goto("/testing/seed-dashboard?clear=1");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(greeting).toBeVisible();
    await expect(page.getByRole("region", { name: "Sync status" }).getByRole("article")).toHaveCount(0);
    await page.goto("/inventory?tab=checklists");
    const again = await drillToCollectorBase(page);
    await again.getByRole("button", { name: `Details for ${card.short}`, exact: true }).click();
    await yourCopies.getByRole("button", { name: `Remove ${card.short}, Raw, Excellent`, exact: true }).click();
    await expect(yourCopies.getByText("None yet. Fill in what you know below and add it.")).toBeVisible();
    await drawer.getByRole("button", { name: "Close card detail" }).click();
    await expect(drawer).toBeHidden();
    await page.goto("/inventory?tab=boxes");
    await page.getByRole("list", { name: "Your boxes" }).getByLabel(new RegExp(`^${escapeRegExp(box)}, box, `)).click();
    await deleteOpenBox(page, box);
    await expect(page.getByRole("list", { name: "Your boxes" }).getByLabel(new RegExp(`^${escapeRegExp(box)}, box, `))).toHaveCount(0);
  },
);
