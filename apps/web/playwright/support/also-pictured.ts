/**
 * NEO-528: the set builder's "Also on this card" handles (players on a card
 * besides its main player) and the Attributes panel's "Player on every card"
 * section, one place for every accessible name they carry, so a copy change
 * is a change here. The names come from
 * `components/SetSelector/player-picker-labels.ts` (`ALSO_PICTURED_PICKER_LABELS`,
 * `EVERY_CARD_PLAYER_PICKER_LABELS`, `EVERY_CARD_PLAYER_ACTION_LABELS`) and
 * `EveryCardPlayerControl.tsx` (its status line, confirms, the run ledger).
 *
 * The collector's words for the same thing (the binder's "Include cameos",
 * the Cameo tag, "<name> is a cameo on this card", "Cameos: N have, N
 * need") are a different screen and stay in the spec that reads them; the
 * card detail's term is the drawer's heading (`ALSO_PICTURED.heading`).
 *
 * Used by `collection/smart-binder-secondary-player` and
 * `set-selector/player-on-every-card`.
 */
import { expect, type Locator, type Page } from "@playwright/test";

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

/**
 * The Attributes panel's "Player on every card" section (round 3: a stored
 * player and cameos on the row, at any level, that every new card beneath is
 * born with), as its words read. Its hint and its cameo confirm quote the
 * drawer's heading ("Also on this card", in quotes), so locate by role, never
 * by that text.
 */
export const EVERY_CARD_PLAYER = {
  /** The section's heading, and its region's name. */
  region: "Player on every card",
  /** The stored lines' labels (plain text, beside the chips). */
  playerLine: "Player:",
  cameoLine: "Cameos:",
  /** A chosen pick not stored yet: this label, then the picker's outlined chip. */
  pickedLine: "Picked:",
  /** The picker: trigger (visible "+ Choose who"), its search, an option, and its chip's ×. */
  trigger: "Choose who goes on every card",
  search: "Find who goes on every card",
  option: (name: string) => `Choose ${name}`,
  clearPick: (name: string) => `Clear ${name} as the choice`,
  /** Green: store the pick as the row's player. Blue outline: as a cameo. */
  addPlayer: "Add to every card",
  addCameo: "Add as cameo",
  /** The × on a stored chip. Absent on an inherited line. */
  stopPlayer: (name: string) => `Stop putting ${name} on new cards`,
  stopCameo: (name: string) => `Stop adding ${name} as a cameo on new cards`,
  /** A value stored on a row above, muted, with no × ("Ken Griffey Jr. (from 2024 Topps)"); one text node. */
  inherited: (fromRow: string, names: string) => `${names} (from ${fromRow})`,
  /**
   * Confirm titles (cards beneath; the title names the player) and their yes
   * buttons (green, beside a pink Cancel). Worded apart from the two actions.
   */
  askPlayer: (name: string, scope: string) => `Add ${name} to every card in ${scope}?`,
  askCameo: (name: string, scope: string) => `Add ${name} as a cameo on every card in ${scope}?`,
  yesPlayer: "Yes, add them to every card",
  yesCameo: "Yes, add them as a cameo",
  /** The section's status line while its stored values load; both actions wait. */
  checking: "Checking…",
  /** The section's notes, on its status line beside the actions. */
  saved: (name: string) => `Saved, every new card gets ${name}`,
  savedCameo: (name: string) => `Saved, every new card gets ${name} as a cameo`,
  cleared: (name: string) => `Cleared, new cards won't get ${name}; cards that have them keep them`,
  /** A finished run's ledger: a region named by its heading. */
  added: (name: string, cards: string) => `Added ${name} to ${cards}`,
  addedCameo: (name: string, cards: string) => `Added ${name} as a cameo on ${cards}`,
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
