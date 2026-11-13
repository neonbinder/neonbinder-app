/**
 * NEO-528: the set builder's "Also on this card" handles (players on a card
 * besides its main player), one place for every accessible name the
 * card drawer's second player picker and the Attributes panel's bulk control
 * give them, so a copy change is a change here. The names come from
 * `components/SetSelector/player-picker-labels.ts` (`ALSO_PICTURED_PICKER_LABELS`,
 * `BULK_ALSO_PICTURED_PICKER_LABELS`) and `AlsoPicturedBulkControl.tsx`.
 *
 * The collector's words for the same thing (the binder's "Include cameos",
 * the Cameo tag, "<name> is a cameo on this card", "Cameos: N have, N
 * need") are a different screen and stay in the spec that reads them; the
 * card detail's term is the drawer's heading (`ALSO_PICTURED.heading`).
 *
 * Used by `collection/smart-binder-secondary-player` and
 * `set-selector/also-pictured-bulk-every-card`.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { escapeRe } from "./set-builder";

/** The card drawer's field, as its words read (heading "Also on this card"). */
export const ALSO_PICTURED = {
  /** The field's heading, in the drawer and on the collector's card detail (a term there). */
  heading: "Also on this card",
  /** The chip row's label. */
  group: "Others on this card",
  trigger: "Add someone else to this card",
  search: "Find someone else for this card",
  option: (name: string) => `Include ${name}`,
  chip: (name: string) => `On this card too: ${name}`,
  remove: (name: string) => `Take ${name} off this card's cameos`,
  saved: "Saved Also on this card",
} as const;

/** The Attributes panel's bulk control, as its words read. */
export const ALSO_PICTURED_BULK = {
  region: "Also on every card",
  trigger: "Choose who to change on every card",
  search: "Find who to change on every card",
  option: (name: string) => `Choose ${name}`,
  add: "Add to every card",
  remove: "Take off every card",
  /** The confirm dialog's title begins so; it goes on to name the checklists. */
  askAdd: (name: string) => new RegExp(`^Add ${escapeRe(name)} to every card in `),
  askRemove: (name: string) => new RegExp(`^Take ${escapeRe(name)} off every card in `),
  yesAdd: (name: string) => `Yes, add ${name}`,
  yesRemove: (name: string) => `Yes, take ${name} off`,
  added: (name: string, cards: string) => `Added ${name} to ${cards}`,
  tookOff: (name: string, cards: string) => `Took ${name} off ${cards}`,
  /** The finished run's ledger button (it reads "Dismiss"; this is its name). */
  dismiss: "Dismiss this run",
} as const;

/**
 * The card drawer's "Also on this card" chip row. It is labelled but has no role
 * (as the Players picker beside it, "Player picker"), so it is found by its
 * label.
 */
export function alsoPicturedGroup(drawer: Locator): Locator {
  return drawer.getByLabel(ALSO_PICTURED.group, { exact: true });
}

/**
 * In an open card drawer, add `player` (a real catalogue player, exact name)
 * to "Also on this card" through its picker, and wait for the save: the chip, then the
 * drawer's "Saved Also on this card" toast.
 */
export async function addAlsoPictured(page: Page, drawer: Locator, player: string): Promise<void> {
  await drawer.getByRole("button", { name: ALSO_PICTURED.trigger, exact: true }).click();
  const search = page.getByRole("textbox", { name: ALSO_PICTURED.search, exact: true });
  await search.fill(player);
  await page.getByRole("option", { name: ALSO_PICTURED.option(player), exact: true }).click();
  await expect(alsoPicturedGroup(drawer).getByRole("button", { name: ALSO_PICTURED.remove(player), exact: true })).toBeVisible();
  // The drawer's toast (a status line drawn outside the dialog) is the
  // server's answer; the chip above shows at once, before the save lands.
  await expect(page.getByRole("status").filter({ hasText: ALSO_PICTURED.saved })).toBeVisible();
}
