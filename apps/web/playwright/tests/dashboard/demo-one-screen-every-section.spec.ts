// R1: the dashboard is ONE screen (NEO-464, Jason 2026-11-10): it shows every
// section the collector's data fills, with no dealer/collector switch. The
// public demo draws that same screen on a fake collector who has a bit of
// everything, so every section shows, an order waiting to ship leads, and the
// Hopper holds one block per open run, each linked to the Add cards tab that
// finishes it (here, the demo's Inventory side), and Out the Door links to the
// Pick List where its orders are pulled (NEO-539); an order NB holds no card for is named by its
// listing title, never called unmatched (NEO-590). Signed out, fake data, read-only (R7).
// With no binder open, the first stands shut where the pocket page opens; its
// cover opens it. The panels the screen opens (a binder's pocket page, an order's cards) are
// checked for accessibility OPEN, as well as the closed page: the open state is
// what a keyboard or screen-reader user spends their time in, and so is a
// card's panel, which opens over the dashboard; its ↓ steps through the run of
// cards it was opened from, and what it holds agrees with what the dashboard
// said (a New Listing's box). Needs a Look has nothing to
// open (a plain list), so there is no open state of it to check.
import { test, expect, expectAccessible } from "../../support/fixtures";
import { pickList } from "../../support/pick-list";

test(
  "Dashboard demo: one screen with every section, and a hopper run opens Add cards where it is finished",
  { tag: ["@smoke", "@dashboard"] },
  async ({ page }) => {
    // Signed out: every test starts in a fresh browser context (R4).
    await page.goto("/demo");
    await expect(page.getByRole("heading", { level: 1, name: "Welcome back, slugger." })).toBeVisible();

    // One screen: no "Viewing as" switch beside the demo's own Light / Dark control.
    const controls = page.getByRole("region", { name: "Demo controls" });
    await expect(controls).toBeVisible();
    await expect(controls.getByRole("radiogroup", { name: "Viewing as" })).toHaveCount(0);

    // Every section the fake collector's data fills.
    const section = (name: string) => page.getByRole("heading", { level: 2, name, exact: true });
    // The fake collector has boxes in use, so the shelf is "Your binders and boxes" (review round 4).
    for (const name of [
      "Sync status",
      "Out the Door",
      "In the Hopper",
      "Needs a Look",
      "On the Bubble",
      "Your binders and boxes",
      "New Listings",
      "Odds and Ends",
      "New on NeonBinder",
    ]) {
      await expect(section(name), name).toBeVisible();
    }

    // The fake collector finished the 1989 Score set today: the cheer names the
    // card that closed it, and every card it shows opens its panel.
    await expect(page.getByRole("heading", { level: 3, name: "Every bulb lit! 1989 Score is done." })).toBeVisible();
    await expect(page.getByText(/^All 330 in the binder\./)).toBeVisible();
    const cheered = page.getByRole("list", { name: "1989 Score, every card" });
    await expect(cheered.getByRole("link").first()).toBeVisible();
    // Today's pulls hold the card that closed it, and it is on the Want List (graded): the dashed pull.
    const freshPulls = page.getByRole("region", { name: "Fresh Pulls" });
    // Its title is the listing title's (NEO-609: a base card says "Base" after its set while it fits).
    await expect(
      freshPulls.getByRole("link", { name: /^1989 Score Base Barry Sanders #257 RC Detroit Lions Rookie Football\b.*On your Want List$/ }),
    ).toBeVisible();
    // The demo's box lines carry their prices; a few wait on a price.
    const newListings = page.getByRole("region", { name: "New Listings" });
    await expect(newListings.getByRole("link").filter({ hasText: /\$\d+\.\d{2}/ }).first()).toBeVisible();

    // The one ordering rule: orders are waiting to ship, so Out the Door comes before the boards.
    const sections = page.getByRole("heading", { level: 2 });
    const order = await sections.allInnerTexts();
    expect(order.indexOf("Out the Door")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("Out the Door")).toBeLessThan(order.indexOf("On the Bubble"));

    // The hopper leads with what waits on the collector, then one block per run still open (NEO-539).
    // The fake collector's two runs: Show pickups (into a box: Inventory) and Garage shoebox (a binder:
    // Collection). The demo adds a Want List guess to Show pickups, so it waits on one more yes.
    const hopper = page.getByRole("region", { name: "In the Hopper" });
    // A line's parts are joined by a dot on screen and a comma for a reader ("... yes · , 18 ..." in its text).
    await expect(hopper.getByText(/^3 scans need your yes · , 18 to identify$/)).toBeVisible();
    const runs = hopper.getByRole("list", { name: "Runs to finish", exact: true });
    const blockOf = (title: string) =>
      runs.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3, name: title, exact: true }) });
    const pickups = blockOf("Show pickups on Inventory");
    const shoebox = blockOf("Garage shoebox on Collection");
    await expect(pickups).toBeVisible();
    await expect(shoebox).toBeVisible();
    await expect(runs.getByRole("heading", { level: 3 })).toHaveCount(2);
    await expect(pickups.getByText(/^1 needs your yes · , 2 to identify$/)).toBeVisible();
    await expect(shoebox.getByText(/^2 need your yes · , 16 to identify$/)).toBeVisible();
    // Each block's link names its run and its screen, and goes to that screen's Add cards tab.
    const finishPickups = pickups.getByRole("link", { name: "Finish this run into Show pickups on Inventory", exact: true });
    await expect(finishPickups).toHaveAttribute("href", "/demo/inventory?side=inventory&tab=add");
    await expect(shoebox.getByRole("link", { name: "Finish this run into Garage shoebox on Collection", exact: true })).toHaveAttribute(
      "href",
      "/demo/collection?tab=add",
    );
    // A run sorted is only counted, never a row; no "N of M done" progress is left anywhere.
    await expect(hopper.getByText("3 runs sorted this week", { exact: true })).toBeVisible();
    await expect(hopper.getByText(/all-time/)).toHaveCount(0);
    await expect(page.getByText(/\d+ of \d+ scans? done/)).toHaveCount(0);
    await expect(hopper.getByText(/still being identified/)).toHaveCount(0);
    await expect(hopper.getByText(/scans? processing/)).toHaveCount(0);

    // The demo's Want List guess waits in Show pickups: the block says so, and the guess opens its card panel.
    // The flag's star is a hidden span inside it, so its text reads "★ On your Want List": one pattern
    // for both, and the positive one first, so the zero count below cannot pass on a pattern that finds nothing.
    const wantFlag = /^★?\s*On your Want List$/;
    await expect(pickups.getByText(wantFlag)).toBeVisible();
    await expect(shoebox.getByText(wantFlag)).toHaveCount(0);
    // Each run's guesses are a list of their own, named for the run and its screen.
    const wantedTitle = "1996 Playoff Contenders Base Deion Sanders #13 Dallas Cowboys Football";
    const pickupGuesses = pickups.getByRole("list", { name: "Best guesses for Show pickups on Inventory", exact: true });
    const wantedGuess = pickupGuesses.getByRole("link", { name: `${wantedTitle}, on your Want List`, exact: true });
    await expect(wantedGuess).toBeVisible();
    const shoeboxGuesses = shoebox.getByRole("list", { name: "Best guesses for Garage shoebox on Collection", exact: true });
    await expect(shoeboxGuesses.getByRole("link")).toHaveCount(2);
    await expect(shoeboxGuesses.getByRole("link", { name: /, on your Want List$/ })).toHaveCount(0);
    await expectAccessible(page, { label: "Dashboard demo" });
    await wantedGuess.click();
    await expect(page).toHaveURL(/\/demo\?(.*&)?detail=[^&]+/);
    const guessPanel = page.getByRole("dialog");
    await expect(guessPanel.getByRole("button", { name: "Close card detail" })).toBeVisible();
    await page.goBack();
    await expect(guessPanel).toBeHidden();
    await expect(page).toHaveURL(/\/demo$/);

    // A run going into a box is finished on Inventory's Add cards tab, and Back comes home.
    await finishPickups.click();
    await expect(page).toHaveURL(/\/demo\/inventory\?(.*&)?tab=add/);
    await expect(page.getByLabel("Put them in this box")).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/demo$/);
    await expect(hopper).toBeVisible();

    // Orders wait to ship, so Out the Door links to the Pick List where they are pulled; Back comes home.
    const orders = page.getByRole("region", { name: "Out the Door" });
    const pullThem = orders.getByRole("link", { name: "Pull them on the Pick List", exact: true });
    await expect(pullThem).toHaveAttribute("href", "/demo/inventory?side=inventory&tab=pick");
    await pullThem.click();
    await expect(page).toHaveURL(/\/demo\/inventory\?side=inventory&tab=pick$/);
    await expect(pickList(page).heading).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/demo$/);
    await expect(orders).toBeVisible();

    // NEO-590: an eBay order whose only line NB holds no card for is named by its listing title and counted
    // in items; all that matters is that it sold, so Out the Door never says a line is not matched (hidden
    // lines counted too, DEMO-1003's title-only second line among them). Needs a Look still shows above,
    // for the demo's oversold order.
    const titleOnly = orders.getByRole("article", { name: "eBay order #12-34567-89099", exact: true });
    await expect(titleOnly.getByText("2023 Topps Chrome #121 Gunnar Henderson RC Orioles", { exact: true })).toBeVisible();
    await expect(titleOnly.getByText("1 item. Sold today.", { exact: true })).toBeVisible();
    await expect(orders.getByText(/matched/i)).toHaveCount(0);
    // One line of several copies (DEMO-1001 sold 4 of one card) shows its quantity, not "and 3 more".
    const oneLine = orders.getByRole("article", { name: "BuySportsCards order #DEMO-1001", exact: true });
    await expect(oneLine.getByText("×4", { exact: true })).toBeVisible();
    await expect(oneLine.getByText(/^and \d+ more/)).toHaveCount(0);

    // An order opens to every card on it: check the opened order. DEMO-1003 is a BuySportsCards order, whose
    // lines are always cards, so it counts cards even with its title-only line (only eBay counts items).
    const mixed = orders.getByRole("article", { name: "BuySportsCards order #DEMO-1003", exact: true });
    await expect(mixed.getByText("2 cards. Sold today.", { exact: true })).toBeVisible();
    const showCards = mixed.getByRole("button", { name: "Show all 2 cards in BuySportsCards order DEMO-1003", exact: true });
    await showCards.click();
    // The button's words flip with the state, so the open one is found by its new name.
    await expect(mixed.getByRole("button", { name: /^Hide the cards/, expanded: true })).toBeVisible();
    await expect(mixed.getByText("2024 Score #333 Rome Odunze RC", { exact: true })).toBeVisible();

    // NEO-590: an eBay order whose FIRST line is a listing NB holds no card for, sold with no title, beside a
    // card. The row leads with the card (the order's first card, not its first line), so "A sale with no
    // title" (the lead of an order with no card at all) never shows here; eBay counts items, and the opened
    // list names the untitled line "An item with no title". The card link is the positive beside each
    // absence (R2). NEO-609: a base card says "Base" after its set.
    const untitled = orders.getByRole("article", { name: "eBay order #12-34567-89123", exact: true });
    await expect(
      untitled.getByRole("link", { name: "1989 Score Base Troy Aikman #270 RC Dallas Cowboys Rookie Football", exact: true }),
    ).toBeVisible();
    await expect(untitled.getByText("2 items. Sold yesterday.", { exact: true })).toBeVisible();
    await expect(untitled.getByText("A sale with no title", { exact: true })).toHaveCount(0);
    await untitled.getByRole("button", { name: "Show all 2 items in eBay order 12-34567-89123", exact: true }).click();
    await expect(
      untitled.getByRole("button", { name: "Hide the items in eBay order 12-34567-89123", exact: true, expanded: true }),
    ).toBeVisible();
    await expect(untitled.getByText("An item with no title", { exact: true })).toBeVisible();
    await expect(untitled.getByText("A sale with no title", { exact: true })).toHaveCount(0);
    await expectAccessible(page, { within: orders, label: "Dashboard demo, an order opened" });

    // With none open, the first binder on the shelf stands shut beside it; its cover
    // opens it to a pocket page, as its spine would: check the opened page.
    const shelf = page.getByRole("list", { name: "Binders on the shelf" });
    const spine = shelf.getByRole("button", { name: /^.+, \d+ cards?, / }).first();
    await expect(spine).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("button", { name: /^Crack open / }).click();
    await expect(spine).toHaveAttribute("aria-expanded", "true");
    const pocketPage = page.getByRole("list", { name: /, page 1 of \d+$/ });
    await expect(pocketPage).toBeVisible();
    await expectAccessible(page, { within: pocketPage, label: "Dashboard demo, a binder's pocket page open" });

    // A card opens its card panel over the dashboard (a Back step), on the demo's own collection: a
    // Fresh Pull here. Checked open, then Back closes it with the keyboard on the pull.
    const pull = page.getByRole("region", { name: "Fresh Pulls" }).getByRole("link").first();
    await pull.click();
    await expect(page).toHaveURL(/\/demo\?(.*&)?detail=[^&]+$/);
    const panel = page.getByRole("dialog");
    await expect(panel.getByRole("button", { name: "Close card detail" })).toBeVisible();
    await expectAccessible(page, { label: "Dashboard demo, a Fresh Pull's card panel open" });
    // ↓ steps through the batch the pull came from, in place: one Back still closes the panel.
    const opened = new URL(page.url()).searchParams.get("detail");
    await expect(panel.getByText(/^Card 1 of \d+/)).toBeVisible();
    await panel.getByRole("button", { name: "Next card" }).click();
    await expect(panel.getByText(/^Card 2 of \d+/)).toBeVisible();
    expect(new URL(page.url()).searchParams.get("detail")).not.toBe(opened);
    await page.goBack();
    await expect(panel).toBeHidden();
    await expect(page).not.toHaveURL(/detail=/);
    await expect(page.getByRole("heading", { level: 1, name: "Welcome back, slugger." })).toBeVisible();
    await expect(pull).toBeFocused();

    // The demo's cards say what their panels say: a New Listing's panel holds the copies in the box
    // its tile names.
    const listing = page.getByRole("region", { name: "New Listings" }).getByRole("link").first();
    const box = (await listing.innerText()).match(/\d+ in (.+)$/m)?.[1];
    expect(box).toBeTruthy();
    await listing.click();
    await expect(page).toHaveURL(/[?&]detail=[^&]+&side=inventory$/);
    await expect(panel.getByText(box!, { exact: false }).first()).toBeVisible();
    await page.goBack();
    await expect(panel).toBeHidden();
  },
);
