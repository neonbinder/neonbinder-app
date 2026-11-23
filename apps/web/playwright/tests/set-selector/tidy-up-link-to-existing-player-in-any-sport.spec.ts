// ONE FEATURE (R1, NEO-645 Tidy Up walk): a printed player name NeonBinder does not know is
// linked to a player already on file through the Player tile's "Link to existing…" search, in
// the set's sport or, after the row's "Sport for this name" switch, in another one. Each link is
// saved the moment it is picked (J1) and lands on the card: the player's own card list in Player
// Management shows it, and a card linked across sports keeps its own sport's tag.
//
// Merges `checklist-wizard-link-commits` and `checklist-wizard-link-to-existing-player` (NEO-645
// decision 20): both proved "link to an existing player", and the second one's fixture (fetch a
// real set, then Cancel → Discard) no longer exists, because Match Cards' Confirm saves the cards
// before the walk opens.
//
// Sole writer of the 1995 San Antonio Iguanas CHL set (SET-REGISTRY.md), BSC plus its publisher's
// checklist (Match Cards, then the commit); fresh-only: it commits the checklist. Re-seed before
// re-running. Approved by Jason 2026-10-10 (NEO-330). Every printed name is unknown to the
// reference catalogue, and each prints on one card only, so no answer fans out to another card.
//
// The in-sport link target shares the SET'S sport (the link search is scoped to the row's sport),
// so it is a Hockey player from the catalogue: Wayne Gretzky, the one row of that name ("Gretzky"
// also finds Brent Gretzky, another accessible name). If a bundle refresh drops him or adds a
// second one, change the literal to another single-row Hockey player. The cross-sport target is a
// REAL name the catalogue does not hold in any sport (NEO-413, support/recorded-names.ts): its
// Football lookup is a recorded no-match, so the add sends nothing to Wikidata.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { CHECKLISTS } from "../../support/published-checklist";
import { addPlayerByHand, expectPlayersLoaded, PLAYERS_MATCHES, playersCounter } from "../../support/players";
import { recordedNoMatchName } from "../../support/recorded-names";
import { escapeRe } from "../../support/set-builder";
import {
  expectCardSettled,
  expectTidyWalkOpen,
  fetchOneMarketplaceSetChecklistToTidyWalk,
  pinkTile,
  saveForLater,
  skipCard,
  skipUntil,
  tidyCardIdentity,
  tidyTile,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";
import type { Page } from "@playwright/test";

const SET = "San Antonio Iguanas CHL";
const YEAR = "1995";
const LINK_EXISTING = "Link to existing…";
const GRETZKY = "Wayne Gretzky";

/** The open card's Player rows that still wait for an answer: each offers "Link to existing…". */
function openPlayerRows(page: Page) {
  return tidyTile(page, "Player")
    .getByRole("group", { name: /^Player / })
    .filter({ has: page.getByRole("button", { name: LINK_EXISTING, exact: true }) });
}

/** One Player row by its whole name ("Player <printed>"). */
function playerRow(page: Page, rowName: string) {
  return tidyTile(page, "Player").getByRole("group", { name: rowName, exact: true });
}

/** Player Management, filtered to `name`, with that player's detail (and its card list) open. */
async function openPlayerCards(page: Page, name: string, sport: string) {
  await page.goto("/admin/players");
  // A mid-flow reload, the flow's 30 s (as the other admin read-backs).
  await expectPlayersLoaded(page, 30_000);
  const sportPicker = page.getByRole("combobox", { name: "Sport", exact: true });
  await sportPicker.selectOption({ label: sport });
  await expect(sportPicker.getByRole("option", { selected: true })).toHaveText(sport);
  await page.getByRole("textbox", { name: "Filter players" }).fill(name);
  await expect(playersCounter(page, PLAYERS_MATCHES)).toBeVisible();
  await page
    .getByRole("main")
    .getByRole("button", { name: new RegExp(`^${escapeRe(name)}\\s*${escapeRe(sport)}`) })
    .click();
  const cards = page.getByRole("list", { name: `Cards for ${name}` });
  await expect(cards).toBeVisible();
  return cards;
}

test(
  "Tidy Up — Link to existing links a printed name to a player on file, in the set's sport or another one, and the card keeps the link",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const gw = recordedNoMatchName(env, "checklist-wizard-link-commits");

    await signIn("/admin/players");
    await expectPlayersLoaded(page, LAUNCH_GATE);
    // ── FIXTURE: a Football player to link a Hockey name to, across sports ──
    await addPlayerByHand(page, gw, "Football");

    // ── The fetch: BSC plus the checklist, Match Cards confirmed, the cards saved, the walk open ──
    await fetchOneMarketplaceSetChecklistToTidyWalk(page, env, { set: SET, checklist: CHECKLISTS.sanAntonioIguanas });
    await expectTidyWalkOpen(page, { title: tidyUpName({ year: YEAR, set: SET }) });
    const walk = tidyWalk(page);

    // ── STEP 1: link the first unknown name to a Hockey player on file, by search ──
    await skipUntil(page, openPlayerRows(page));
    const firstName = (await openPlayerRows(page).first().getAttribute("aria-label")) ?? "";
    expect(firstName, "the open row is named for its printed player").toMatch(/^Player .+/);
    const first = playerRow(page, firstName);
    await expect(pinkTile(page, "Player"), "an unknown printed player is a must-fix").toHaveCount(1);
    // The row's sport is the set's until someone switches it.
    await expect(first.getByRole("button", { name: "Sport for this name: Hockey", exact: true })).toBeVisible();
    await first.getByRole("button", { name: LINK_EXISTING, exact: true }).click();
    const search = first.getByRole("textbox", { name: "Search existing players" });
    await expect(search).toBeVisible();
    // The search stands in for the row's buttons while it is open.
    await expect(first.getByRole("button", { name: LINK_EXISTING })).toHaveCount(0);
    await search.fill("Gretzky");
    const linkGretzky = first.getByRole("option", { name: `Link to ${GRETZKY}`, exact: true });
    await expect(linkGretzky).toBeVisible();
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, Link to existing search results" });
    await linkGretzky.click();
    // Saved at once (J1): the row reads answered ("Edit <linked name>", NEO-645 C1), names him, and the tile is no longer pink.
    await expect(first.getByRole("button", { name: `Edit ${GRETZKY}`, exact: true })).toBeVisible();
    await expect(first.getByText(GRETZKY, { exact: true })).toBeVisible();
    await expect(first.getByRole("button", { name: LINK_EXISTING })).toHaveCount(0);
    await expect(pinkTile(page, "Player")).toHaveCount(0);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, printed name linked to a player on file" });

    // ── STEP 2: the next unknown name moves to Football, then links to the Football player ──
    await skipCard(page);
    await skipUntil(page, openPlayerRows(page));
    const secondName = (await openPlayerRows(page).first().getAttribute("aria-label")) ?? "";
    expect(secondName, "a different printed name").not.toBe(firstName);
    const second = playerRow(page, secondName);
    const secondCard = await tidyCardIdentity(page).allTextContents();
    const sportHockey = second.getByRole("button", { name: "Sport for this name: Hockey", exact: true });
    const sportFootball = second.getByRole("button", { name: "Sport for this name: Football", exact: true });
    await sportHockey.click();
    const chooser = walk.getByRole("listbox", { name: "Choose a sport" });
    await expect(chooser).toBeVisible();
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, sport chooser open" });
    await chooser.getByRole("option", { name: /^Football/ }).click();
    await expect(chooser).toBeHidden();
    // The switch is saved on the name: the row now reads Football, and offers to add the set's
    // sport to the player it links (off by default: a one-off appearance).
    await expect(sportFootball).toBeVisible();
    await expect(sportHockey).toHaveCount(0);
    await expect(second.getByRole("checkbox", { name: "Also add Hockey to their sports" })).not.toBeChecked();
    await expect(pinkTile(page, "Player"), "switching the sport answers nothing").toHaveCount(1);

    await second.getByRole("button", { name: LINK_EXISTING, exact: true }).click();
    await second.getByRole("textbox", { name: "Search existing players" }).fill(gw);
    await second.getByRole("option", { name: `Link to ${gw}`, exact: true }).click();
    await expect(second.getByRole("button", { name: `Edit ${gw}`, exact: true })).toBeVisible();
    await expect(second.getByText(gw, { exact: true })).toBeVisible();
    await expect(pinkTile(page, "Player")).toHaveCount(0);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, printed name linked across sports" });

    // ── STEP 3: the browser's Back walks back to the cross-sport card, still linked ──
    await skipCard(page);
    await page.goBack();
    await expect(tidyCardIdentity(page), "Back returned to the card linked across sports").toHaveText(secondCard);
    await expectCardSettled(page);
    await expect(second.getByText(gw, { exact: true })).toBeVisible();
    await expect(second.getByRole("button", { name: `Edit ${gw}`, exact: true })).toBeVisible();
    await expect(second.getByRole("button", { name: LINK_EXISTING })).toHaveCount(0);

    // ── STEP 4: the switch was that name's alone: the next unknown name is still on Hockey ──
    await skipCard(page);
    await skipUntil(page, openPlayerRows(page));
    const third = playerRow(page, (await openPlayerRows(page).first().getAttribute("aria-label")) ?? "");
    await expect(third.getByRole("button", { name: "Sport for this name: Hockey", exact: true })).toBeVisible();
    await expect(third.getByRole("button", { name: "Sport for this name: Football", exact: true })).toHaveCount(0);
    // Nothing is left to write: every answer above was saved as it was given.
    await saveForLater(page);

    // ── STEP 5: each player's card list holds the card it was linked to ──
    const gretzkyCards = await openPlayerCards(page, GRETZKY, "Hockey");
    // His own sport: the card carries no sport tag.
    await expect(gretzkyCards.getByRole("listitem").filter({ hasText: SET })).toHaveCount(1);
    await expect(gretzkyCards.getByRole("listitem").filter({ hasText: SET })).not.toContainText("Hockey");

    const gwCards = await openPlayerCards(page, gw, "Football");
    const gwCard = gwCards.getByRole("listitem").filter({ hasText: SET });
    await expect(gwCard).toHaveCount(1);
    // Linked across sports: the card keeps its own sport, and says so.
    await expect(gwCard).toContainText("Hockey");
    await expectAccessible(page, { label: "Player detail with the cross-sport linked card" });
  },
);
