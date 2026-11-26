// NEO-645 (R1): the Tidy Up walk's Player tile adds a cameo to a card ("+ Cameo", then a player on
// file), and the cameo's own Edit removes it again; each write retitles the card at once.
//
// The operator meets it like this:
//   1. A card whose player is answered offers "+ Cameo" beside "+ Another player".
//   2. "+ Cameo" opens the player search; picking a player on file adds the group "Cameo <name>"
//      with its "Edit cameo <name>" button, and the Listing title tile now names the cameo after
//      the card's player ("<player> & <cameo>"): the write regenerates the title (NEO-645 C7).
//   3. "Edit cameo <name>" opens the search again with "Remove cameo <name>"; Remove takes the
//      group away, focus lands on "+ Cameo" (the opener left with the row), and the title drops
//      the cameo again.
//   4. The browser's Back walks back to the card before; Save for later closes the walk, and the
//      pill counts the card still pink (its blank team).
//
// FIXTURE (SET-REGISTRY.md, the `tcm`/`tcn` prefixes; R7a): a per-attempt sport `tcm<token>` with
// year 2026, brand Topps and ONE set `tcn<token>` with `Insert` › `Base`, all hand-made with no
// marketplace id anywhere, so the Sync is checklist-only (the pasted two-row checklist is the one
// source: no Match Cards, no BSC) and nothing is looked up (a hand-made sport has no Wikidata
// mapping). Card #1 prints the cameo-to-be `Cmb Tcm<token>` (No Team): the walk adds him as a new
// player, so he is on file in the set's sport for the cameo search. Card #2 prints `Cma
// Tcm<token>` with a BLANK team cell, so it stays pink (no team) for the whole spec and the walk
// never leaves it. Minted names are per attempt, so the spec is not fresh-only. Nothing is
// deleted: the sport, its rows, the two cards and the two players stand; the cameo is removed by
// the spec itself.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { usePastedChecklist } from "../../support/published-checklist";
import { drillToCustom, escapeRe, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import {
  createPlayerOnOpenRow,
  expectCardSettled,
  expectCardsLeft,
  needsYouPill,
  pinkTile,
  saveAndNext,
  saveForLater,
  settleWalkAfterCommit,
  tidyTile,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";

const YEAR = "2026";

test(
  "Tidy Up — the Player tile's + Cameo adds a player on file as a cameo, its Edit cameo removes it, and each write retitles the card",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const SPORT = `tcm${T}`;
    const SET = `tcn${T}`;
    const SUBJECT = `Cma Tcm${T}`;
    const CAMEO = `Cmb Tcm${T}`;

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── FIXTURE: the hand-made leaf and its two-row checklist ──
    await drillToCustom(page, { sport: SPORT, year: YEAR, manufacturer: "Topps", set: SET, variantType: "Insert", variant: "Base" });
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
    // #2's blank team cell claims nothing, so #2 has no team: pink until the spec ends.
    await usePastedChecklist(page, `number,player,team\n1,${CAMEO},No Team\n2,${SUBJECT},\n`, 2);
    await syncChecklistButton(page).click();

    const opened = await settleWalkAfterCommit(page, page.getByText(/Saved 2 cards\./).first());
    expect(opened, "two cards with unanswered names, so the walk opened").toBe(true);
    const walk = tidyWalk(page);
    await expect(walk).toHaveAccessibleName(tidyUpName({ year: YEAR, set: SET }));
    await expectCardsLeft(page, 2);
    const header = (number: string, who: string) => walk.getByText(`#${number} · ${who}`, { exact: true });

    // ── FIXTURE, in the walk: #1's name becomes a player on file ──
    await expect(header("1", CAMEO)).toBeVisible();
    expect(await createPlayerOnOpenRow(page)).toBe(`Player ${CAMEO}`);
    await saveAndNext(page);

    // ── STEP 1: #2's player answered, the tile offers + Cameo ──
    await expect(header("2", SUBJECT)).toBeVisible();
    expect(await createPlayerOnOpenRow(page)).toBe(`Player ${SUBJECT}`);
    const playerTile = tidyTile(page, "Player");
    const addCameo = playerTile.getByRole("button", { name: "+ Cameo", exact: true });
    await expect(addCameo).toBeVisible();
    await expect(playerTile.getByRole("button", { name: "+ Another player", exact: true })).toBeVisible();
    const cameoRow = playerTile.getByRole("group", { name: `Cameo ${CAMEO}`, exact: true });
    await expect(cameoRow).toHaveCount(0);
    // The stored title names the card's player alone.
    const titleTile = tidyTile(page, "Listing title");
    const titleWithCameo = titleTile.getByText(new RegExp(`\\b${escapeRe(`${SUBJECT} & ${CAMEO}`)} #2\\b`));
    const titleWithout = titleTile.getByText(new RegExp(`\\b${escapeRe(SUBJECT)} #2\\b`));
    await expect(titleWithout).toBeVisible();
    await expect(titleWithCameo).toHaveCount(0);

    // ── STEP 2: + Cameo, then a player on file ──
    await addCameo.click();
    const search = playerTile.getByRole("textbox", { name: "Search existing players" });
    await expect(search).toBeVisible();
    await search.fill(CAMEO);
    await playerTile.getByRole("option", { name: `Link to ${CAMEO}`, exact: true }).click();
    await expect(cameoRow).toBeVisible();
    await expect(cameoRow.getByText(CAMEO, { exact: true })).toBeVisible();
    const editCameo = cameoRow.getByRole("button", { name: `Edit cameo ${CAMEO}`, exact: true });
    await expect(editCameo).toBeVisible();
    await expect(search).toHaveCount(0);
    // The write regenerated the title: the cameo follows the card's player.
    await expect(titleWithCameo).toBeVisible();
    // A cameo is not a subject: the card's own player row still reads answered, and nothing new is pink.
    await expect(playerTile.getByRole("button", { name: `Edit ${SUBJECT}`, exact: true })).toBeVisible();
    await expect(pinkTile(page, "Player")).toHaveCount(0);

    // ── STEP 3: Edit cameo opens the search with Remove cameo; Remove takes the cameo off ──
    await editCameo.click();
    const remove = playerTile.getByRole("button", { name: `Remove cameo ${CAMEO}`, exact: true });
    await expect(remove).toBeVisible();
    await expect(playerTile.getByRole("textbox", { name: "Search existing players" })).toBeVisible();
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, a cameo open for editing" });
    await remove.click();
    await expect(cameoRow).toHaveCount(0);
    // The opener left with its row, so focus lands on + Cameo (R2: the product's stated contract,
    // PlayerTile's `fallbackRef`; asserted as it should be, never loosened to the tile).
    await expect(addCameo).toBeFocused();
    await expect(titleWithout).toBeVisible();
    await expect(titleWithCameo).toHaveCount(0);

    // ── STEP 4: Back walks back to #1; Save for later counts the one card still pink (#2, no team) ──
    await page.goBack();
    await expect(header("1", CAMEO)).toBeVisible();
    await expect(header("2", SUBJECT)).toHaveCount(0);
    await expectCardSettled(page);
    await saveForLater(page);
    await expect(needsYouPill(page)).toHaveAccessibleName("1 needs you, 1 to fix");
  },
);
