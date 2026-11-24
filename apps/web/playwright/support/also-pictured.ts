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
 * need") are a different screen: the tag's phrase is `cameoPhrase` in
 * `support/cameo-binder.ts`, the rest stays in the spec that reads it; the
 * card detail's term is the drawer's heading (`ALSO_PICTURED.heading`).
 *
 * Used by `collection/smart-binder-secondary-player`,
 * `set-selector/player-on-every-card`,
 * `set-selector/every-card-player-before-fetch-leaves-named-cards-blank` and
 * `set-selector/every-card-cameo-before-fetch-reaches-committed-cards`.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { editCardButton } from "./cards";
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
 * Open the set builder's Attributes panel for the row on screen. It remembers
 * whether it was left open, so it is opened only if it is not. EXIT the
 * "Player on every card" section (returned) is on screen.
 */
export async function openEveryCardPlayer(page: Page): Promise<Locator> {
  const panel = page.getByRole("region", { name: "Set attributes panel" });
  const edit = panel.getByRole("button", { name: "Edit attributes" });
  const hide = panel.getByRole("button", { name: "Hide attributes" });
  await expect(edit.or(hide)).toBeVisible();
  if (await edit.isVisible()) await edit.click();
  await expect(hide).toBeVisible();
  const section = page.getByRole("region", { name: EVERY_CARD_PLAYER.region, exact: true });
  await expect(section).toBeVisible();
  return section;
}

/**
 * Store `name` in the open "Player on every card" section, as the row's player
 * or as a cameo, on a row with NO cards beneath it (so it saves with no
 * confirm). Idempotent: a value already stored there (a red run that stopped
 * after storing it) is left as it is. EXIT the stored chip is on screen.
 */
export async function storeEveryCardValue(
  page: Page,
  section: Locator,
  name: string,
  as: "player" | "cameo",
): Promise<void> {
  const stored = section.getByRole("button", {
    name: as === "player" ? EVERY_CARD_PLAYER.stopPlayer(name) : EVERY_CARD_PLAYER.stopCameo(name),
    exact: true,
  });
  const trigger = section.getByRole("button", { name: EVERY_CARD_PLAYER.trigger, exact: true });
  // The section has loaded its stored values once its picker is drawn and "Checking…" is gone.
  await expect(trigger).toBeVisible();
  await expect(section.getByText(EVERY_CARD_PLAYER.checking, { exact: true })).toHaveCount(0);
  if (await stored.isVisible()) return;
  await trigger.click();
  await page.getByRole("textbox", { name: EVERY_CARD_PLAYER.search, exact: true }).fill(name);
  await page.getByRole("option", { name: EVERY_CARD_PLAYER.option(name), exact: true }).click();
  await expect(section.getByRole("button", { name: EVERY_CARD_PLAYER.clearPick(name), exact: true })).toBeVisible();
  const action = section.getByRole("button", {
    name: as === "player" ? EVERY_CARD_PLAYER.addPlayer : EVERY_CARD_PLAYER.addCameo,
    exact: true,
  });
  await expect(action).toBeEnabled();
  await action.click();
  const saved = as === "player" ? EVERY_CARD_PLAYER.saved(name) : EVERY_CARD_PLAYER.savedCameo(name);
  await expect(section.getByRole("status").filter({ hasText: saved })).toBeVisible();
  await expect(stored).toBeVisible();
}

/**
 * The card drawer's "Also on this card" chip row. It is labelled but has no role
 * (as the Players picker beside it, "Player picker"), so it is found by its
 * label.
 */
export function alsoPicturedGroup(drawer: Locator): Locator {
  return drawer.getByLabel(ALSO_PICTURED.group, { exact: true });
}

/**
 * Open card `number`'s drawer from the set builder's open checklist (its search
 * narrows a long list first). EXIT the drawer is up with both its pickers drawn
 * (its players and its "Also on this card").
 */
export async function openCardDrawer(page: Page, number: string): Promise<Locator> {
  await page.getByRole("searchbox", { name: "Search cards" }).fill(number);
  await editCardButton(page, number).click();
  const drawer = page.getByRole("dialog", { name: `Card #${number}`, exact: true });
  await expect(drawer.getByRole("button", { name: ALSO_PICTURED.trigger, exact: true })).toBeVisible();
  return drawer;
}

/** Close a set builder card drawer. */
export async function closeCardDrawer(drawer: Locator): Promise<void> {
  await drawer.getByRole("button", { name: "Done editing card", exact: true }).click();
  await expect(drawer).toBeHidden();
}

/**
 * Card `number`'s drawer holds exactly `teams` (one "Remove team <name>" chip
 * each), read from the stored card: the persistence proof for a team written
 * anywhere else (the Tidy Up walk's Team tile, its Apply to all). An empty
 * list proves the card holds none. ENTRY the open checklist lists the card.
 * EXIT the drawer is closed again. 7 s each.
 */
export async function expectDrawerTeams(page: Page, number: string, teams: string[]): Promise<void> {
  const drawer = await openCardDrawer(page, number);
  for (const team of teams) {
    await expect(drawer.getByRole("button", { name: `Remove team ${team}`, exact: true })).toBeVisible();
  }
  await expect(drawer.getByRole("button", { name: /^Remove team / }), `card #${number} holds ${teams.length} team(s)`).toHaveCount(teams.length);
  await closeCardDrawer(drawer);
}

/**
 * The drawer's description, which the server writes with the card's cameos
 * ("Cameo: <name>.") while nobody has edited it. It arrives with the card
 * itself, so it settles before the chips (whose names load on their own).
 */
export function cardDescription(drawer: Locator): Locator {
  return drawer.getByRole("textbox", { name: "Card description", exact: true });
}

/**
 * The drawer's "Card title": the listing title the server writes at the commit
 * (the card's own players, then its cameos while the title has room, and the
 * cameos are the first meaningful words cut when it is over 80 characters).
 */
export function cardTitle(drawer: Locator): Locator {
  return drawer.getByRole("textbox", { name: "Card title", exact: true });
}

/** The drawer's "Cameo: <name>" line, as a pattern over its description. */
export function cameoLine(name: string): RegExp {
  // Not a word boundary: a name can end in punctuation ("Ken Griffey Jr."), and the line ends with it.
  return new RegExp(`Cameo: ${escapeRe(name)}(?![\\w])`);
}

/** The drawer's Players chip for `name` (its × button, the PlayerPicker's name). */
export function playerChip(drawer: Locator, name: string): Locator {
  return drawer.getByRole("button", { name: `Remove player ${name}`, exact: true });
}

/** Any Players chip at all in the drawer. */
export function anyPlayerChip(drawer: Locator): Locator {
  return drawer.getByRole("button", { name: /^Remove player / });
}

/** `name`'s chip under "Also on this card" (its × button). */
export function cameoChip(drawer: Locator, name: string): Locator {
  return alsoPicturedGroup(drawer).getByRole("button", { name: ALSO_PICTURED.remove(name), exact: true });
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
