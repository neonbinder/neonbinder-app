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
// A SET OF ITS OWN (NEO-592). An admin's close settles every open report on the
// same variant and platform, whoever sent it (`syncReports.close`), and every
// test account is an admin. While this spec boxed a card of the seed's 2024 Topps
// Chrome Base, `real-sync-report-to-crew` (another worker, the same Base, eBay)
// closed this spec's report mid-run. So the held card is a hand-made card in a
// hand-made, per-attempt set (`nlg<token>`, SET-REGISTRY.md "Custom sets") under
// the real Baseball > 2024 > Topps: the seed hangs the hold on the copy's
// variant, so no other spec, worker or attempt can file or close a report on it.
// A hand-made card has no linked player, so the collector sees only its number.
//
// R7/R7a: writes the set, its Insert > Base rows and one hand-added card (no
// marketplace id anywhere beneath it; they stand after the run, per attempt), and
// the signed-in user's own rows: a box and one copy in it, the marked sync seed,
// and its own sync report. Self-cleaning: the report is withdrawn, the seed
// cleared, the copy removed (confirmed by the server, `confirmRemoved`) and the
// box deleted through the UI; an afterEach does the same on a failure (the report
// and seed first: left behind they show on this account's dashboard and in every
// admin's queue). Minted names are single tokens from `env.ATTEMPT_TOKEN`.
import { confirmRemoved, createBox, deleteBoxNamed, deleteOpenBox, drillToCollectorChecklist, inventoryTabs, type CollectorSet } from "../../support/collection";
import { addCardViaForm } from "../../support/cards";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { drillToCustom } from "../../support/set-builder";
import type { Page } from "@playwright/test";

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The card this attempt boxes: its set's name and its number, and how the collector names it. */
interface HeldCard {
  set: string;
  number: string;
  short: string;
}

/** What the body has written so far, so the failure hook can take it back. */
const written: { box?: string; card?: HeldCard; copied?: boolean; reported?: boolean } = {};

/** The set of its own, as the collector's cascade reaches it: Baseball > 2024 > Topps > set > Insert > Base. */
const ownChecklist = (set: string): CollectorSet => ({
  sport: "Baseball",
  year: "2024",
  manufacturer: "Topps",
  set,
  checklist: { type: "Insert", name: "Base" },
});

/** The card's panel, by its title ("2024 <set> ... #<number>"). */
const drawerOf = (page: Page, card: HeldCard) =>
  page.getByRole("dialog", { name: new RegExp(`^2024 ${escapeRegExp(card.set)}.*#${escapeRegExp(card.number)}`) });

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
    // Only once the add was pressed can a copy exist; before that the card is not
    // yet offered to the collector at all (a set is hidden until it holds a card).
    if (card && written.copied) {
      await attempt(async () => {
        await clean.goto("/inventory?tab=checklists");
        const stock = await drillToCollectorChecklist(clean, ownChecklist(card.set));
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
          await confirmRemoved(drawer, `Removed ${card.short}, Raw, Excellent`);
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
    written.copied = undefined;
    written.reported = undefined;
  }
  if (failures.length > 0) throw failures[0];
});

test(
  "Dashboard: a card eBay held back for having no league says so in Sync status, and its panel carries the held notice with a Report button that reads Reported once sent",
  { tag: ["@dashboard"] },
  async ({ page, signIn, env }) => {
    const box = `NoLeague${env.ATTEMPT_TOKEN}`;
    const setName = `nlg${env.ATTEMPT_TOKEN}`;
    const number = `569${env.ATTEMPT_TOKEN}`;
    const card: HeldCard = { set: setName, number, short: `#${number}` };
    const greeting = page.getByRole("heading", { level: 1, name: "Welcome back, slugger." });

    // --- A set of its own with one card: what the held-back seed hangs on ------
    // Any seed a broken earlier run left is cleared first (the page then forwards to the dashboard).
    await signIn("/testing/seed-dashboard?clear=1");
    await expect(greeting).toBeVisible({ timeout: LAUNCH_GATE });
    // Ends on the set's Insert > Base checklist with its add-card form closed.
    await drillToCustom(page, { sport: "Baseball", year: "2024", manufacturer: "Topps", set: setName, variantType: "Insert", variant: "Base" });
    await addCardViaForm(page, { cardNumber: number, playerName: `Held${env.ATTEMPT_TOKEN}` });
    written.card = card;

    // --- A box with that card in it ---------------------------------------------
    await page.goto("/inventory?tab=boxes");
    await expect(page.getByRole("list", { name: "Your boxes" })).toBeVisible();
    await createBox(page, box);
    written.box = box;
    await page.goto("/inventory?tab=checklists");
    await expect(inventoryTabs(page).getByRole("link", { name: "Checklists", exact: true })).toHaveAttribute("aria-current", "page");
    const stock = await drillToCollectorChecklist(page, ownChecklist(setName));
    const drawer = drawerOf(page, card);
    await stock.getByRole("button", { name: `Details for ${card.short}`, exact: true }).click();
    const yourCopies = drawer.getByRole("region", { name: `Your copies of ${card.short}`, exact: true });
    await expect(yourCopies.getByText("None yet. Fill in what you know below and add it.")).toBeVisible();
    const addForm = drawer.getByRole("form", { name: "Add a copy", exact: true });
    await addForm.getByRole("combobox", { name: "Where it lives" }).selectOption({ label: `${box} (box, for sale)` });
    await addForm.getByRole("spinbutton", { name: "Price", exact: true }).fill("2");
    written.copied = true;
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
    const heldCard = set.getByRole("link").filter({ hasText: card.short });
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
    const again = await drillToCollectorChecklist(page, ownChecklist(setName));
    await again.getByRole("button", { name: `Details for ${card.short}`, exact: true }).click();
    await yourCopies.getByRole("button", { name: `Remove ${card.short}, Raw, Excellent`, exact: true }).click();
    await expect(yourCopies.getByText("None yet. Fill in what you know below and add it.")).toBeVisible();
    // The server's answer, not the optimistic list: a copy left behind would ride into the worker's next spec.
    await confirmRemoved(drawer, `Removed ${card.short}, Raw, Excellent`);
    written.copied = false;
    await drawer.getByRole("button", { name: "Close card detail" }).click();
    await expect(drawer).toBeHidden();
    await page.goto("/inventory?tab=boxes");
    await page.getByRole("list", { name: "Your boxes" }).getByLabel(new RegExp(`^${escapeRegExp(box)}, box, `)).click();
    await deleteOpenBox(page, box);
    await expect(page.getByRole("list", { name: "Your boxes" }).getByLabel(new RegExp(`^${escapeRegExp(box)}, box, `))).toHaveCount(0);
  },
);
