/**
 * NEO-528: the collector's side of a cameo, shared by the two specs that make a
 * smart binder take in a player's cameos on a real set
 * (`collection/smart-binder-secondary-player`, 1984 Topps Football #355, and
 * `set-selector/every-card-cameo-before-fetch-reaches-committed-cards`, 2026
 * Topps Profiles): a checklist searched for one card, the card's short name,
 * holding it in Main, removing the copy again, and deleting the binder.
 *
 * Every write here is the signed-in collector's own (binders and copies).
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { confirmRemoved, drillToCollectorChecklist, nameOf, type CollectorSet } from "./collection";
import { LAUNCH_GATE } from "./fixtures";
import { escapeRe } from "./set-builder";

/** `<player> is a cameo on this card`: the Cameo tag's words on Find cards, the checklist and a pocket's name. */
export const cameoPhrase = (player: string): string => `${player} is a cameo on this card`;

/** `target`'s checklist on Collection > Checklists, searched for `query` (its region). */
export async function openCollectorChecklist(page: Page, target: CollectorSet, query: string): Promise<Locator> {
  await page.goto("/collection?tab=checklists");
  await expect(page.getByRole("heading", { level: 1, name: "Collection" })).toBeVisible();
  const checklist = await drillToCollectorChecklist(page, target);
  await checklist.getByRole("searchbox", { name: "Search this checklist" }).fill(query);
  return checklist;
}

/** A card's short name on the collector's checklist ("#355 Fred Dean"), read off its Details button. */
export async function shortOf(checklist: Locator, number: string): Promise<string> {
  const name = await nameOf(
    checklist.getByRole("button", { name: new RegExp(`^Details for #${escapeRe(number)}(?![0-9A-Za-z-])`) }),
  );
  return name.replace(/^Details for /, "");
}

/**
 * Mark card `number` Have in Main from its open checklist. The toggle is
 * optimistic; the "Added ... to Main" notice is the server's answer.
 * `onWrite` runs right before the write, with the card's short name (a spec
 * records it there for its failure hook). EXIT the copy is saved.
 */
export async function holdInMain(
  page: Page,
  checklist: Locator,
  number: string,
  onWrite: (short: string) => void,
): Promise<string> {
  const short = await shortOf(checklist, number);
  await checklist.getByRole("combobox", { name: "Binder" }).selectOption({ label: "Main" });
  onWrite(short);
  await checklist.getByRole("button", { name: `Have ${short}`, exact: true, pressed: false }).click();
  await expect(checklist.getByRole("button", { name: `Have ${short}, Raw, Excellent`, exact: true, pressed: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: `Added ${short} to Main` })).toBeVisible();
  return short;
}

/**
 * Remove the collector's copy of `short` through its card detail, if it has
 * one: the detail settles on "None yet" or on the copy's Remove, and the
 * "Removed" line is the server's answer.
 */
export async function removeCopy(page: Page, checklist: Locator, short: string): Promise<void> {
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

/** Delete the binder `name` if it is on the shelf (its cards go back to Main). */
export async function deleteBinder(page: Page, name: string): Promise<void> {
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
