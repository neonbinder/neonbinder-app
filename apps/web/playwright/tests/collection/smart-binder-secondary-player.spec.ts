// NEO-528 (R1): a smart binder can take in a player's cameos. An admin lists
// a player P under "Also on this card" on a card he is not the subject of; a
// collector's smart binder whose rule is "Player = P" leaves that card out
// until its "Include cameos" option is on (off by default), then Find cards offers it
// beside P's own card, tagged Cameo, and the binder counts cameos on a line of
// their own.
//
// The flow:
// - P is the player of the first ordinary row of the seed's 2024 Topps Chrome
//   Base (read only: his row is never written). The collector marks that card
//   Have in Main.
// - As admin, a hand-made card in a per-attempt hand-made set gets P under
//   "Also on this card" in its drawer. The collector marks it Have in Main
//   too, and its card detail lists P under "Also on this card" (Back closes
//   the detail).
// - A new smart binder, rule "Player = P, and Set = 2024 Topps Chrome or the
//   hand-made set" (a line naming sets gives it a checklist the dashboard
//   counts): "Include cameos" is shown and OFF, and Find cards offers P's own
//   card only.
// - Binder settings: the rule is edited to include cameos ("..., cameos
//   included"); Find cards offers both, and only the hand-made card carries the
//   Cameo tag ("P is a cameo on this card"). Both are added. Sorted by
//   checklist with empty slots, the held cameo pocket's name says it is a
//   cameo, P's own pocket does not, and the cover counts cameos apart:
//   "Cameos: 1 have, 0 need".
// - Checklists, looking through the binder with "Fits <binder>": the cameo
//   row wears the tag, P's own row does not. The cameo copy is removed: its row
//   stays in the fits list.
// - The dashboard, cameo unfiled: the binder's pocket title reads "Cameos: 0 of
//   1" and its checklist percent counts P's own cards alone (with the cameo in
//   them it would fall).
// - The binder: the cameo's empty slot is named "..., P is a cameo on this
//   card, need. Add it" and the cover reads "Cameos: 0 have, 1 need"; its Add
//   files a copy ("1 have, 0 need"). The dashboard then reads "Cameos: 1 of 1"
//   at the same percent.
// - Binder settings again: with cameos on, Line 1 turned from Player to Set
//   takes the "Include cameos" option away and says so ("Include cameos is off
//   now: ..."); saved without the player line, the rule no longer says
//   "cameos included".
//
// R7/R7a: the hand-made set `cmo<token>` (single token, per attempt,
// SET-REGISTRY.md) sits under the REAL Baseball > 2024 > Topps (the drawer's
// player search starts on the set's sport, Baseball, P's sport) with no
// marketplace id anywhere beneath it; its one card `528-<attempt>` is DELETED
// at the end, which takes its "Also on this card" link with it. The collector
// writes only the signed-in user's own binder and copies (the cameo copy is
// removed once mid-run and filed again from its empty slot). Self-cleaning: the
// binder is deleted (its cards go back to Main), both copies are removed, then
// the hand-made card is deleted (a card a collector holds cannot be).
//
// R3: the collector cascade goes through `support/collection.ts`, the set
// builder drill through `support/set-builder.ts` / `support/cards.ts`, and the
// set builder's "Also on this card" names through `support/also-pictured.ts`
// (one place, for the copy). The set builder's "Player on every card" control
// is `set-selector/player-on-every-card`.
import type { Locator, Page } from "@playwright/test";
import { ALSO_PICTURED, addAlsoPictured } from "../../support/also-pictured";
import { addCardViaForm, confirmDeleteCardButton, deleteCardButton, editCardButton, escapeRe } from "../../support/cards";
import { collectorCascade, confirmRemoved, drillToCollectorBase, ordinaryBaseRows, shortNameOf } from "../../support/collection";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { drillToCustom, type CustomTarget } from "../../support/set-builder";

/** The hand-made set's Base checklist on the collector's Checklists tab (its region). */
async function openMyChecklist(page: Page, setName: string): Promise<Locator> {
  await page.goto("/collection?tab=checklists");
  await expect(page.getByRole("heading", { level: 1, name: "Collection" })).toBeVisible();
  const { drill } = collectorCascade(page);
  await drill("Sports", "Baseball", "Years");
  await drill("Years", "2024", "Brands");
  await drill("Brands", "Topps", "Sets");
  await drill("Sets", setName, "Variant Types");
  await drill("Variant Types", "Insert", "Insert");
  await drill("Insert", "Base");
  const checklist = page.getByRole("region", { name: `2024 ${setName} Base`, exact: true });
  await expect(checklist.getByRole("heading", { level: 3, name: `2024 ${setName} Base` })).toBeVisible();
  return checklist;
}

/** The seed's 2024 Topps Chrome Base on the collector's Checklists tab (its region). */
async function openBase(page: Page): Promise<Locator> {
  await page.goto("/collection?tab=checklists");
  await expect(page.getByRole("heading", { level: 1, name: "Collection" })).toBeVisible();
  return drillToCollectorBase(page);
}

/**
 * Remove the collector's copy of `short` through its card detail, if it has
 * one: the detail settles on "None yet" or on the copy's Remove, and the
 * "Removed" line is the server's answer.
 */
async function removeCopy(page: Page, checklist: Locator, short: string): Promise<void> {
  await checklist.getByRole("button", { name: `Details for ${short}`, exact: true }).click();
  const drawer = page.getByRole("dialog").filter({ has: page.getByRole("region", { name: `Your copies of ${short}`, exact: true }) });
  const yourCopies = drawer.getByRole("region", { name: `Your copies of ${short}`, exact: true });
  const none = yourCopies.getByText("None yet. Fill in what you know below and add it.");
  const remove = yourCopies.getByRole("button", { name: `Remove ${short}, Raw, Excellent`, exact: true });
  await expect(none.or(remove)).toBeVisible();
  if (await remove.isVisible()) {
    await remove.click();
    // This card's own notice first, then the shared wait-and-dismiss (R3).
    await expect(drawer.getByRole("status").filter({ hasText: `Removed ${short}, Raw, Excellent` })).toBeVisible();
    await confirmRemoved(drawer);
    await expect(none).toBeVisible();
  }
  await drawer.getByRole("button", { name: "Close card detail" }).click();
  await expect(drawer).toBeHidden();
}

/** Delete the smart binder `name` if it is on the shelf (its cards go back to Main). */
async function deleteBinder(page: Page, name: string): Promise<void> {
  await page.goto("/collection?tab=binders");
  const shelf = page.getByRole("list", { name: "Your binders" });
  // Main is always on the shelf: once its spine shows, the shelf has loaded.
  await expect(shelf.getByRole("button", { name: /^Main, / })).toBeVisible({ timeout: LAUNCH_GATE });
  const spine = shelf.getByRole("button", { name: new RegExp(`^${escapeRe(name)}, `) });
  if ((await spine.count()) === 0) return;
  await spine.click();
  await expect(page.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Binder settings", exact: true }).click();
  await page.getByRole("button", { name: `Rename or delete ${name}`, exact: true }).click();
  await page
    .getByRole("dialog", { name: `Rename or delete ${name}`, exact: true })
    .getByRole("button", { name: "Delete this binder" })
    .click();
  const confirm = page.getByRole("dialog", { name: `Delete ${name}?`, exact: true });
  await confirm.getByRole("button", { name: "Yes, delete it" }).click();
  await expect(confirm).toBeHidden();
  await expect(spine).toHaveCount(0);
}

/** Delete the hand-made card (its "Also on this card" link goes with it). */
async function deleteCard(page: Page, build: CustomTarget, number: string): Promise<void> {
  await drillToCustom(page, build);
  await deleteCardButton(page, number).click();
  await confirmDeleteCardButton(page, number).click();
  await expect(editCardButton(page, number)).toBeHidden();
  await expect(page.getByRole("button", { name: "Open add card form" })).toBeVisible();
}

/**
 * What the body wrote, each set right BEFORE its write (the card once its row
 * is confirmed: until then it carries no one else), and cleared once the
 * body's own cleanup has removed it.
 */
const written: {
  binder?: string;
  baseCopy?: string;
  mineCopy?: { setName: string; short: string };
  card?: { build: CustomTarget; number: string };
} = {};

// A failed run must not leave the binder, the two copies or the hand-made card
// (whose "Also on this card" link would make P a cameo need on the worker's next
// run). Each step runs even when an earlier one fails; the first failure is
// rethrown at the end (R7).
// A page of its own, so the failure's screenshot and ARIA snapshot still show
// where the body stopped. Brought to the front: left behind the test's page,
// it stalled on the phone project (a 7 s step took minutes to time out).
test.afterEach(async ({ context }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const clean = await context.newPage();
  await clean.bringToFront();
  const failures: unknown[] = [];
  const attempt = async (step: () => Promise<void>) => {
    try {
      await step();
    } catch (error) {
      failures.push(error);
    }
  };
  try {
    const { binder, baseCopy, mineCopy, card } = written;
    if (binder) await attempt(() => deleteBinder(clean, binder));
    if (baseCopy) await attempt(async () => removeCopy(clean, await openBase(clean), baseCopy));
    if (mineCopy) await attempt(async () => removeCopy(clean, await openMyChecklist(clean, mineCopy.setName), mineCopy.short));
    if (card) await attempt(() => deleteCard(clean, card.build, card.number));
  } finally {
    await clean.close();
    for (const key of Object.keys(written) as Array<keyof typeof written>) delete written[key];
  }
  if (failures.length > 0) throw failures[0];
});

test(
  "Collection: a smart binder for a player takes in his cameos only once Include cameos is on, tags them Cameo and counts them apart",
  { tag: ["@collection"] },
  async ({ page, signIn, env }) => {
    const A = env.ATTEMPT_ID;
    const setName = `cmo${env.ATTEMPT_TOKEN}`;
    const number = `528-${A}`;
    const cardName = `Cameo${env.ATTEMPT_TOKEN}`;
    const binder = `Cameos${env.ATTEMPT_TOKEN}`;
    const build: CustomTarget = { sport: "Baseball", year: "2024", manufacturer: "Topps", set: setName, variantType: "Insert", variant: "Base" };

    await signIn("/collection");
    await expect(page.getByRole("heading", { level: 1, name: "Collection" })).toBeVisible({ timeout: LAUNCH_GATE });
    const tabs = page.getByRole("navigation", { name: "Collection sections" });
    const toChecklists = async () => {
      await tabs.getByRole("link", { name: "Checklists", exact: true }).click();
      await expect(page).toHaveURL(/[?&]tab=checklists/);
    };
    const toBinders = async () => {
      await tabs.getByRole("link", { name: "My Binders", exact: true }).click();
      await expect(page).toHaveURL(/[?&]tab=binders/);
    };
    const added = (short: string) => page.getByRole("status").filter({ hasText: `Added ${short} to Main` });

    // --- P, and P's own card into Main -------------------------------------
    await toChecklists();
    const base = await drillToCollectorBase(page);
    await base.getByRole("combobox", { name: "Binder" }).selectOption({ label: "Main" });
    const own = await shortNameOf(ordinaryBaseRows(base).first());
    const P = own.player;
    written.baseCopy = own.short;
    await base.getByRole("button", { name: `Have ${own.short}`, exact: true, pressed: false }).click();
    await expect(base.getByRole("button", { name: `Have ${own.short}, Raw, Excellent`, exact: true, pressed: true })).toBeVisible();
    // The toggle is optimistic; the notice is the server's answer.
    await expect(added(own.short)).toBeVisible();

    // --- As admin: a hand-made card that pictures P ------------------------
    await drillToCustom(page, build);
    await addCardViaForm(page, { cardNumber: number, playerName: cardName });
    written.card = { build, number };
    await editCardButton(page, number).click();
    const editor = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Done editing card", exact: true }) });
    await expect(editor.getByRole("textbox", { name: "Card name", exact: true })).toBeVisible();
    await addAlsoPictured(page, editor, P);
    // The chip shows him under "Also on this card", and the card's own Players stay empty.
    await expect(editor.getByLabel(ALSO_PICTURED.chip(P), { exact: true })).toBeVisible();
    await expect(editor.getByRole("button", { name: `Remove player ${P}`, exact: true })).toHaveCount(0);
    await expectAccessible(page, { within: editor, label: "Card drawer with someone also on the card" });
    await editor.getByRole("button", { name: "Done editing card", exact: true }).click();
    await expect(editor).toBeHidden();

    // --- The collector holds the hand-made card; its detail says who else is on it
    const mine = await openMyChecklist(page, setName);
    // A hand-made card has no linked player: the collector sees only its number.
    const cameoShort = `#${number}`;
    await mine.getByRole("combobox", { name: "Binder" }).selectOption({ label: "Main" });
    written.mineCopy = { setName, short: cameoShort };
    await mine.getByRole("button", { name: `Have ${cameoShort}`, exact: true, pressed: false }).click();
    await expect(mine.getByRole("button", { name: `Have ${cameoShort}, Raw, Excellent`, exact: true, pressed: true })).toBeVisible();
    await expect(added(cameoShort)).toBeVisible();

    await mine.getByRole("button", { name: `Details for ${cameoShort}`, exact: true }).click();
    const detail = page.getByRole("dialog", { name: new RegExp(`^2024 ${escapeRe(setName)}.*#${escapeRe(number)}`) });
    await expect(detail.getByText(ALSO_PICTURED.heading, { exact: true })).toBeVisible();
    await expect(detail.getByRole("definition").filter({ hasText: new RegExp(`^${escapeRe(P)}$`) })).toBeVisible();
    // The detail lives in the address: Back closes it onto the checklist.
    await page.goBack();
    await expect(detail).toBeHidden();
    await expect(mine.getByRole("button", { name: `Details for ${cameoShort}`, exact: true })).toBeVisible();

    // --- A smart binder for P: cameos are off by default -------------------
    await toBinders();
    const shelf = page.getByRole("list", { name: "Your binders" });
    await shelf.getByRole("button", { name: "New binder", exact: true }).click();
    const newDialog = page.getByRole("dialog", { name: "New binder", exact: true });
    await newDialog.getByRole("textbox", { name: "Binder name" }).fill(binder);
    await newDialog.getByRole("radio", { name: /^Smart: a rule helps fill it/ }).check();
    await newDialog.getByRole("combobox", { name: "Line 1" }).selectOption({ label: "Player" });
    await newDialog.getByRole("combobox", { name: "Players" }).fill(P);
    await newDialog.getByRole("option", { name: `${P} · Baseball`, exact: true }).click();
    await expect(newDialog.getByRole("button", { name: `Remove ${P}`, exact: true })).toBeVisible();
    // A line naming sets: the binder's checklist, which the dashboard counts
    // (a rule of players alone has none).
    await newDialog.getByRole("button", { name: "Add a line", exact: true }).click();
    await newDialog.getByRole("combobox", { name: "Line 2" }).selectOption({ label: "Set" });
    const sets = newDialog.getByRole("combobox", { name: "Sets" });
    for (const set of ["2024 Topps Chrome", `2024 ${setName}`]) {
      await sets.fill(set);
      await newDialog.getByRole("option", { name: set, exact: true }).click();
      await expect(newDialog.getByRole("button", { name: `Remove ${set}`, exact: true })).toBeVisible();
    }
    const includeCameos = newDialog.getByRole("checkbox", { name: "Include cameos", exact: true });
    await expect(includeCameos).toBeVisible();
    await expect(includeCameos).not.toBeChecked();
    await expectAccessible(page, { within: newDialog, label: "New smart binder for a player, Include cameos off" });
    written.binder = binder;
    await newDialog.getByRole("button", { name: "Put it on the shelf" }).click();
    await expect(newDialog).toBeHidden();

    // Find cards opens by itself: P's own card, never the card he is only pictured on.
    const find = page.getByRole("dialog", { name: `Find cards for ${binder}`, exact: true });
    const ownLabel = `2024 Topps Chrome #${escapeRe(own.number)} ${escapeRe(P)}`;
    const cameoLabel = `2024 ${escapeRe(setName)}\\b.*#${escapeRe(number)}`;
    // Page-rooted, so each also works as a `has` filter inside a row (GUIDE gotcha).
    const addOwnButton = page.getByRole("button", { name: new RegExp(`^Add ${ownLabel}\\b.* from Main$`) });
    const addCameoButton = page.getByRole("button", { name: new RegExp(`^Add ${cameoLabel}\\b.* from Main$`) });
    const addOwn = find.getByRole("button", { name: new RegExp(`^Add ${ownLabel}\\b.* from Main$`) });
    const addCameo = find.getByRole("button", { name: new RegExp(`^Add ${cameoLabel}\\b.* from Main$`) });
    await expect(addOwn).toBeVisible();
    await expect(addCameo).toHaveCount(0);
    await find.getByRole("button", { name: "Done" }).click();
    await expect(find).toBeHidden();
    await expect(page.getByRole("heading", { level: 2, name: binder, exact: true })).toBeVisible();

    // --- Binder settings: include cameos, keep it sorted with empty slots ---
    await page.getByRole("button", { name: "Binder settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: `${binder} settings`, exact: true });
    await settings.getByRole("button", { name: "Edit the rule", exact: true }).click();
    const settingsCameos = settings.getByRole("checkbox", { name: "Include cameos", exact: true });
    await expect(settingsCameos).not.toBeChecked();
    await settingsCameos.check();
    await expect(settingsCameos).toBeChecked();
    await expectAccessible(page, { within: settings, label: "Smart rule editor, Include cameos on" });
    await settings.getByRole("button", { name: "Save the rule", exact: true }).click();
    const ruleSummary = settings.getByText(/^Takes /);
    await expect(ruleSummary).toHaveText(new RegExp(`^Takes ${escapeRe(P)}, and .*2024 Topps Chrome.*, cameos included\\.$`));
    await settings.getByRole("radio", { name: /^Keep sorted by checklist/ }).check();
    await expect(settings.getByRole("radio", { name: /^Keep sorted by checklist/ })).toBeChecked();
    const emptySlots = settings.getByRole("checkbox", { name: /^Include empty slots/ });
    await emptySlots.check();
    await expect(emptySlots).toBeChecked();
    await settings.getByRole("button", { name: "Find cards", exact: true }).click();

    // --- Find cards: both, and only the hand-made one is a cameo ------------
    await expect(addOwn).toBeVisible();
    await expect(addCameo).toBeVisible();
    const cameoPhrase = `${P} is a cameo on this card`;
    const cameoRow = find.getByRole("listitem").filter({ has: addCameoButton });
    const ownRow = find.getByRole("listitem").filter({ has: addOwnButton });
    await expect(cameoRow.getByText(cameoPhrase, { exact: true })).toBeVisible();
    await expect(ownRow).toBeVisible();
    await expect(ownRow.getByText(cameoPhrase, { exact: true })).toHaveCount(0);
    await expectAccessible(page, { within: find, label: "Find cards with a cameo" });
    await addOwn.click();
    await expect(addOwn).toHaveCount(0);
    await addCameo.click();
    await expect(addCameo).toHaveCount(0);
    await find.getByRole("button", { name: "Done" }).click();
    await expect(find).toBeHidden();
    // Settings stays open behind Find cards when it opened it; close it if so.
    await expect(settings.or(page.getByRole("heading", { level: 2, name: binder, exact: true }))).toBeVisible();
    if (await settings.isVisible()) {
      await settings.getByRole("button", { name: "Done" }).click();
      await expect(settings).toBeHidden();
    }

    // --- The cover and the pockets ------------------------------------------
    // Two counts: P's own cards, then the cameos on a line of their own (how
    // many own cards P has in the catalogue is the seed's, so only the cameo
    // line is exact). On a desktop they sit on the binder's inside cover, on a
    // phone above the page: found on the page, not in the cover.
    const ownCount = page.getByText(/^1 have, \d+ need$/);
    await expect(ownCount).toBeVisible();
    // P's own checklist, for the dashboard's percent below: 1 of (1 + need).
    const ownNeed = Number(/(\d+) need$/.exec((await ownCount.textContent()) ?? "")?.[1]);
    expect(Number.isInteger(ownNeed), "the cover's own count reads 1 have, N need").toBe(true);
    const ownPercent = Math.floor(100 / (1 + ownNeed));
    await expect(page.getByText("Cameos: 1 have, 0 need", { exact: true })).toBeVisible();
    const cover = page.getByRole("region", { name: `${binder}, open`, exact: true });
    // Sorted by checklist, the hand-made set's page comes first. The held
    // cameo's name says whose cameo it is.
    const cameoPage = cover.getByRole("group", { name: new RegExp(`^Page 1, 2024 ${escapeRe(setName)} Base$`) });
    const heldCameo = cameoPage.getByRole("button", { name: new RegExp(`^${cameoLabel}\\b.*, ${escapeRe(cameoPhrase)}$`) });
    await expect(heldCameo).toBeVisible();
    await expectAccessible(page, { label: "Smart binder holding a cameo, its cover counting cameos apart" });
    // P's own card, on the Topps Chrome page (a Base page is named for the
    // set alone): its name ends at the card's team, no cameo appended.
    // "Next pages" on a desktop spread, "Next page" on a phone.
    await page.getByRole("button", { name: /^Next pages?$/ }).click();
    const chromePage = page.getByRole("group", { name: /^Page \d+, 2024 Topps Chrome$/ });
    await expect(chromePage.getByRole("button", { name: new RegExp(`^${ownLabel}(, [^,]+)?$`) })).toBeVisible();
    await expect(page.getByRole("button", { name: new RegExp(`^${ownLabel}\\b.*cameo`) })).toHaveCount(0);

    // --- Checklists, looking through the binder: the cameo row wears the tag
    /** Look through the binder, at the cards that fit it. */
    const fitsOnly = async (checklist: Locator) => {
      await checklist.getByRole("combobox", { name: "Binder" }).selectOption({ label: binder });
      const fits = checklist.getByRole("radio", { name: `Fits ${binder}`, exact: true });
      await fits.click();
      await expect(fits).toHaveAttribute("aria-checked", "true");
      return fits;
    };
    const mineScoped = await openMyChecklist(page, setName);
    const mineFits = await fitsOnly(mineScoped);
    const cameoItem = mineScoped
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: `Details for ${cameoShort}`, exact: true }) });
    await expect(cameoItem.getByText(cameoPhrase, { exact: true })).toBeVisible();
    await expectAccessible(page, { within: mineScoped, label: "Checklist through a smart binder, a cameo row tagged" });
    // The cameo copy leaves the collection: the card still fits the rule, so
    // its row stays in the fits list, tagged, now a need.
    await removeCopy(page, mineScoped, cameoShort);
    delete written.mineCopy;
    await expect(mineFits).toHaveAttribute("aria-checked", "true");
    await expect(mineScoped.getByRole("button", { name: `Have ${cameoShort}`, exact: true, pressed: false })).toBeVisible();
    await expect(cameoItem.getByText(cameoPhrase, { exact: true })).toBeVisible();
    // P's own row fits the same binder and wears no tag.
    const baseScoped = await openBase(page);
    await fitsOnly(baseScoped);
    const ownItem = baseScoped
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: `Details for ${own.short}`, exact: true }) });
    await expect(ownItem).toBeVisible();
    await expect(ownItem.getByText(cameoPhrase, { exact: true })).toHaveCount(0);

    // --- The dashboard, the cameo unfiled -----------------------------------
    // The binder's checklist percent counts P's own cards alone: 1 of
    // (1 + need) as the cover counted them. With the unfiled cameo among them
    // it would fall (1 of 2 + need).
    const openOnDashboard = async () => {
      await page.goto("/dashboard");
      await expect(page.getByRole("heading", { level: 1, name: "Welcome back, slugger." })).toBeVisible();
      const dashSpine = page
        .getByRole("list", { name: "Binders on the shelf" })
        .getByRole("button", { name: new RegExp(`^${escapeRe(binder)}, smart binder, `) });
      await expect(dashSpine).toHaveAccessibleName(new RegExp(`, ${ownPercent}% of the checklist$`));
      await dashSpine.click();
      await expect(dashSpine).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("heading", { level: 3, name: binder, exact: true })).toBeVisible();
      return dashSpine;
    };
    const dashSpine = await openOnDashboard();
    await expect(page.getByText("Cameos: 0 of 1", { exact: true })).toBeVisible();
    await expect(page.getByText(`${ownPercent}% of the checklist.`, { exact: true })).toBeVisible();
    // The open binder lives in the address: Back shuts it.
    await page.goBack();
    await expect(dashSpine).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("heading", { level: 3, name: binder, exact: true })).toHaveCount(0);

    // --- The binder: the cameo's empty slot, and its Add ---------------------
    const openOnShelf = async () => {
      await page.goto("/collection?tab=binders");
      await expect(page.getByRole("heading", { level: 1, name: "Collection" })).toBeVisible();
      await page
        .getByRole("list", { name: "Your binders" })
        .getByRole("button", { name: new RegExp(`^${escapeRe(binder)}, `) })
        .click();
      await expect(page.getByRole("heading", { level: 2, name: binder, exact: true })).toBeVisible();
    };
    await openOnShelf();
    const needCameo = cameoPage.getByRole("button", {
      name: new RegExp(`^${cameoLabel}\\b.*, ${escapeRe(cameoPhrase)}, need\\. Add it$`),
    });
    await expect(needCameo).toBeVisible();
    await expect(page.getByText("Cameos: 0 have, 1 need", { exact: true })).toBeVisible();
    await expectAccessible(page, { label: "Smart binder with a cameo's empty slot" });
    written.mineCopy = { setName, short: cameoShort };
    await needCameo.click();
    // The pocket is optimistic; the notice is the server's answer.
    await expect(page.getByRole("status").filter({ hasText: `Added ${cameoShort} to ${binder}` })).toBeVisible();
    await expect(page.getByText("Cameos: 1 have, 0 need", { exact: true })).toBeVisible();
    await expect(heldCameo).toBeVisible();
    await expect(needCameo).toHaveCount(0);

    // --- The dashboard, the cameo filed -------------------------------------
    await openOnDashboard();
    await expect(page.getByText("Cameos: 1 of 1", { exact: true })).toBeVisible();
    await expect(page.getByText(`${ownPercent}% of the checklist.`, { exact: true })).toBeVisible();
    await expectAccessible(page, { label: "Dashboard, a smart binder counting its cameos apart" });

    // --- The rule loses its player line: Include cameos goes, and says so ----
    await openOnShelf();
    await page.getByRole("button", { name: "Binder settings", exact: true }).click();
    await settings.getByRole("button", { name: "Edit the rule", exact: true }).click();
    await expect(settingsCameos).toBeChecked();
    await settings.getByRole("combobox", { name: "Line 1" }).selectOption({ label: "Set" });
    await expect(settingsCameos).toHaveCount(0);
    await expect(
      settings.getByRole("status").filter({ hasText: "Include cameos is off now: no line names a player or Hall of Famers." }),
    ).toBeVisible();
    await expectAccessible(page, { within: settings, label: "Smart rule editor, Include cameos dropped with the player line" });
    // Line 1 is an empty Set line now: take it out, leaving the sets line.
    await settings.getByRole("button", { name: "Remove line 1", exact: true }).click();
    await expect(settings.getByRole("combobox", { name: "Line 2" })).toHaveCount(0);
    await settings.getByRole("button", { name: "Save the rule", exact: true }).click();
    await expect(ruleSummary).toHaveText(/^Takes .*2024 Topps Chrome.*\.$/);
    await expect(ruleSummary).not.toContainText("cameos included");
    await settings.getByRole("button", { name: "Done" }).click();
    await expect(settings).toBeHidden();

    // --- Cleanup: delete the binder, remove both copies, delete the card ----
    await page.getByRole("button", { name: "Back to the shelf" }).click();
    const spine = page.getByRole("list", { name: "Your binders" }).getByRole("button", { name: `${binder}, 2 cards`, exact: true });
    await expect(spine).toBeVisible();
    await deleteBinder(page, binder);
    delete written.binder;
    await removeCopy(page, await openMyChecklist(page, setName), cameoShort);
    delete written.mineCopy;
    await removeCopy(page, await openBase(page), own.short);
    delete written.baseCopy;
    await deleteCard(page, build, number);
    delete written.card;
  },
);
