// ONE FEATURE (R1, NEO-671 on the NEO-645 Tidy Up walk): a printed player name with a close
// spelling on file shows "Possible matches" on the Player tile, and the panel carries "Remember
// “<printed>” as a name for this player", checked by default, between its heading and the picks.
// Picking the close match with the box left on links the card to him AND keeps the printed
// spelling as one of his aliases (player data): Player Management's "Aliases" box shows it, and
// his card list holds the card.
//
// Why this fixture reaches the panel and nothing earlier (convex/players.ts `nearMatches`,
// convex/lib/entityNearMatch.ts `rankPlayerCandidates`): the card prints `Josh Pnm<token>` and
// the one player on file in the sport is `Joshua Pnm<token>`. Same surname, and "Josh" is a
// prefix of "Joshua" (the truncated-first-name rung of `playerNamesMatch`), so he is a CLOSE
// match, never an exact one: no one-tap exact link and no same-name pick step stand in front of
// the panel. A hand-made sport has no Wikidata mapping, so neither the hand-added player nor the
// printed name is looked up (no recording needed), and the panel is the only answer on offer.
//
// FIXTURE (SET-REGISTRY.md "Custom sets", the `pnm`/`pns` prefixes; R7a): a per-attempt sport
// `pnm<token>` › 2026 › Topps › `pns<token>` › Insert › Base, all hand-made with no marketplace id,
// so the Sync is checklist-only (a pasted one-row checklist: no Match Cards, no BSC). The player
// `Joshua Pnm<token>` is added by hand in Player Management, so his aliases start empty and the
// read-back is exact. Not fresh-only: every name is per attempt. Nothing is deleted.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { escapeRe } from "../../support/cards";
import { addPlayerByHand, expectPlayersLoaded, PLAYERS_MATCHES, playersCounter } from "../../support/players";
import { usePastedChecklist } from "../../support/published-checklist";
import { drillToCustom, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import {
  expectCardsLeft,
  pinkTile,
  saveForLater,
  settleWalkAfterCommit,
  tidyTile,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";

const YEAR = "2026";

test(
  "Tidy Up — picking a Possible match with the remember box on links the card and keeps the printed name as the player's alias",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const SPORT = `pnm${T}`;
    const SET = `pns${T}`;
    const SURNAME = `Pnm${T}`;
    const PRINTED = `Josh ${SURNAME}`;
    const ON_FILE = `Joshua ${SURNAME}`;

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── FIXTURE: the hand-made leaf, empty ──
    await drillToCustom(page, { sport: SPORT, year: YEAR, manufacturer: "Topps", set: SET, variantType: "Insert", variant: "Base" });
    const empty = page.getByText("No cards in this checklist yet.");
    await expect(empty).toBeVisible();

    // ── FIXTURE: the close spelling, on file in the sport, with no aliases ──
    await page.getByRole("link", { name: "Players", exact: true }).click();
    await expectPlayersLoaded(page);
    await addPlayerByHand(page, ON_FILE, SPORT);
    await page.goBack();
    await expect(setBuilderReady(page)).toBeVisible();
    await expect(empty).toBeVisible();

    // ── The checklist: one card printing the short spelling ──
    await usePastedChecklist(page, `number,player,team\n1,${PRINTED},No Team\n`, 1);
    await syncChecklistButton(page).click();
    const opened = await settleWalkAfterCommit(page, page.getByText(/Saved 1 card\./).first(), { opens: true });
    expect(opened, "the printed name is no player's, so the walk opened").toBe(true);
    const walk = tidyWalk(page);
    await expect(walk).toHaveAccessibleName(tidyUpName({ year: YEAR, set: SET }));
    await expectCardsLeft(page, 1);

    // ── STEP 1: the Player tile offers the close spelling under Possible matches, box on ──
    const row = tidyTile(page, "Player").getByRole("group", { name: `Player ${PRINTED}`, exact: true });
    await expect(pinkTile(page, "Player"), "an unknown printed player is a must-fix").toHaveCount(1);
    const matches = row.getByRole("list", { name: "Possible player matches", exact: true });
    const pick = matches.getByRole("button", { name: `Link to ${ON_FILE}`, exact: true });
    await expect(pick).toBeVisible();
    // A close match, not an exact one: no one-tap link to him stands outside the panel.
    await expect(row.getByRole("button", { name: `Link to ${ON_FILE}`, exact: true })).toHaveCount(1);
    const remember = row.getByRole("checkbox", {
      name: `Remember “${PRINTED}” as a name for this player`,
      exact: true,
    });
    await expect(remember).toBeVisible();
    await expect(remember, "the box is on by default").toBeChecked();
    // The box is the panel's, not one of its picks.
    await expect(matches.getByRole("checkbox")).toHaveCount(0);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, Possible matches with the remember box" });

    // ── STEP 2: the pick links the card, saved at once ──
    await pick.click();
    await expect(row.getByRole("button", { name: `Edit ${ON_FILE}`, exact: true })).toBeVisible();
    await expect(row.getByText(ON_FILE, { exact: true })).toBeVisible();
    await expect(matches).toHaveCount(0);
    await expect(pinkTile(page, "Player")).toHaveCount(0);
    await saveForLater(page);

    // ── STEP 3: Player Management: the card is his, and the printed spelling is now his alias ──
    await page.getByRole("link", { name: "Players", exact: true }).click();
    await expectPlayersLoaded(page);
    const sportPicker = page.getByRole("combobox", { name: "Sport", exact: true });
    await sportPicker.selectOption({ label: SPORT });
    await expect(sportPicker.getByRole("option", { selected: true })).toHaveText(SPORT);
    await page.getByRole("textbox", { name: "Filter players" }).fill(ON_FILE);
    await expect(playersCounter(page, PLAYERS_MATCHES)).toBeVisible();
    await page
      .getByRole("main")
      .getByRole("button", { name: new RegExp(`^${escapeRe(ON_FILE)}\\s*${escapeRe(SPORT)}`) })
      .click();
    const cards = page.getByRole("list", { name: `Cards for ${ON_FILE}` });
    await expect(cards.getByRole("listitem").filter({ hasText: SET })).toHaveCount(1);
    // Added by hand with no aliases, so the printed spelling is his one alias.
    await expect(page.getByRole("textbox", { name: "Aliases", exact: true })).toHaveValue(PRINTED);
    await expectAccessible(page, { label: "Player detail with the alias from the Possible matches pick" });

    // ── STEP 4: the browser's Back returns to the set builder on the same checklist ──
    await page.goBack();
    await expect(setBuilderReady(page)).toBeVisible();
    await expect(page.getByText(PRINTED).first()).toBeVisible();
  },
);
