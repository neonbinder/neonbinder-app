// ONE FEATURE (NEO-424 rule F, as NEO-602 leaves it, on the NEO-645 Tidy Up walk): a printed
// team name that no catalogue row settles for the set's year is linked, at the commit, to the
// team a SAVED card of the same set already carries. Nobody is asked: the team never makes a
// walk stop, and where the card is in the walk for something else its Team tile says why, in
// the purple note "Linked for you: another card in this set is already linked to them".
//
// Renamed from checklist-wizard-set-history-links-a-team (NEO-645): the entity-review wizard and
// its Decided list ("· already on another card in this set", Change) are gone; the walk's Team
// tile carries the link and its reason (the note), and Match Cards' commit saves before any walk.
//
// NEO-602 (Jason, 2026-11-19): a name several eras answer to is the players' stints' to settle,
// or the operator's, never set history's (the across-variants spec proves that on the Browns).
// Set history still answers the two shapes no other rule settles, and this spec proves both in
// one fetch:
//   (a) a lone row whose era starts AFTER the set's year: `Fut<token>`, active from 2026, printed
//       on a 2025 card. A card never shows a team's future, so the year refuses it
//       (lib/teams/team-era.ts `pickTeamForYear`); one row is never put to the players (the
//       player-aware rule reads stints only past two candidates), so the set's saved card is
//       what links it;
//   (b) a name no row holds as its full name or alias, but a saved card's team answers to as its
//       NICKNAME: `Lcn<token> Nic<token>`, printed as `Nic<token>` (the hobby's "Orioles" for
//       "Baltimore Orioles"). No row, no candidates, nothing for the players to answer.
//
// The walk (positive and negative, R2): the player `Sol Ahs<token>` is on file before the sync,
// so the commit checks each card's team against his career (J2). His ONE stint, `Fut<token>`
// from 2025, covers card #1: #1 has nothing to ask and is never in the walk (the drawer proves
// its team). Card #2's `Lcn<token> Nic<token>` is not in his career, so #2 is in the walk for
// that blue Career check ALONE: its Team tile is not pink, asks nothing, names the linked team
// and carries the purple set-history note. The walk holds exactly one card.
//
// Fixtures through the UI (GUIDE "Fixtures come from the UI"), all in this attempt's private
// sport `aeh<token>` (SET-REGISTRY "Custom sets"), year 2025, brand Topps, ONE set `aeg<token>`
// with two Insert-type variants, all hand-made with no marketplace id:
// - the player `Sol Ahs<token>` in Player Management (a minted player in a sport with no
//   `sportConfig.wikidata` makes no lookup);
// - variant A, `Base`: card `1`, added by hand, carrying BOTH teams, each born in the card
//   drawer's New Team dialog (teams are never looked up on creation);
// - the player's one stint, `Fut<token>` 2025-, added in Player Management once the team exists;
// - variant B, `aei<token>`: two cards from a pasted publisher's checklist, fetched with the
//   checklist as its only source (NEO-496 D10, so no Match Cards), `1` printing `Fut<token>` and
//   `2` printing `Nic<token>`, both naming the player.
// Every name carries the attempt token, so the spec re-runs on the same seed.
//
// Back (house rule): the set builder -> Players is a navigation; Back returns to the set builder
// with the drill and the empty Base checklist restored.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { addCardViaForm, editCardButton } from "../../support/cards";
import { usePastedChecklist } from "../../support/published-checklist";
import { addPlayerByHand, expectPlayersLoaded, PLAYERS_MATCHES, playersCounter } from "../../support/players";
import { drillToCustom, escapeRe, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import {
  expectCardSettled,
  expectCardsLeft,
  finishTidyWalk,
  pinkTile,
  saveAndNext,
  settleWalkAfterCommit,
  tidyTile,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";
import type { Page } from "@playwright/test";

/** The purple note a team linked from the set's saved cards carries (tidy/parts/copy.ts `linkedForText`). */
const SET_HISTORY_NOTE = "Linked for you: another card in this set is already linked to them";

/** In the open card drawer: create `search` as a new team through the New Team dialog and put it on the card. */
async function createTeamOnCard(
  page: Page,
  search: string,
  fields: { location?: string; from?: string },
  fullName: string,
): Promise<void> {
  await page.getByRole("button", { name: "Add team" }).click();
  await page.getByRole("textbox", { name: "Search teams" }).fill(search);
  await page.getByRole("button", { name: `New team ${search}` }).click();
  const dialog = page.getByRole("dialog", { name: `New team: ${search}` });
  await expect(dialog).toBeVisible();
  if (fields.location) await dialog.getByRole("textbox", { name: "New team location (optional)" }).fill(fields.location);
  if (fields.from) await dialog.getByLabel("New team active from (optional)").fill(fields.from);
  await dialog.getByRole("button", { name: `Create team ${fullName}` }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: `Remove team ${fullName}`, exact: true })).toBeVisible();
}

test(
  "Tidy Up — a printed team name no catalogue row settles for the set's year (a team from a later year, or a bare nickname) links to the team a saved card of the set carries, with no stop; the walk's Team tile says why",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const SPORT = `aeh${T}`;
    const SET = `aeg${T}`;
    const INSERT = `aei${T}`;
    const PLAYER = `Sol Ahs${T}`;
    const FUTURE = `Fut${T}`; // active from 2026; the set is 2025
    const NICK = `Nic${T}`; // printed bare
    const NICK_FULL = `Lcn${T} ${NICK}`; // the team's full name

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── PART 1: the hand-made 2025 set, its Base checklist empty ──
    const target = (variant: string) => ({ sport: SPORT, year: "2025", manufacturer: "Topps", set: SET, variantType: "Insert", variant });
    await drillToCustom(page, target("Base"));
    const empty = page.getByText("No cards in this checklist yet.");
    await expect(empty).toBeVisible();

    // ── PART 2: the checklist's player, with no stints yet ──
    await page.getByRole("link", { name: "Players", exact: true }).click();
    await expectPlayersLoaded(page);
    await addPlayerByHand(page, PLAYER, SPORT);
    await expect(page.getByText("No stints recorded yet.")).toBeVisible();
    // Back: the set builder, on the same empty Base checklist.
    await page.goBack();
    await expect(setBuilderReady(page)).toBeVisible();
    await expect(empty).toBeVisible();

    // ── PART 3: variant A's saved card carries both teams ──
    await addCardViaForm(page, { cardNumber: "1", playerName: PLAYER });
    await editCardButton(page, "1").click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByLabel("Team picker")).toBeVisible();
    await createTeamOnCard(page, FUTURE, { from: "2026" }, FUTURE);
    await createTeamOnCard(page, NICK, { location: `Lcn${T}` }, NICK_FULL);
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(drawer).toBeHidden();

    // ── PART 4: the player's one stint, `Fut<token>` from 2025, covers card #1 of the fetch ──
    await page.getByRole("link", { name: "Players", exact: true }).click();
    await expectPlayersLoaded(page);
    const sportPicker = page.getByRole("combobox", { name: "Sport", exact: true });
    await sportPicker.selectOption({ label: SPORT });
    await expect(sportPicker.getByRole("option", { selected: true })).toHaveText(SPORT);
    await page.getByRole("textbox", { name: "Filter players" }).fill(PLAYER);
    await expect(playersCounter(page, PLAYERS_MATCHES)).toBeVisible();
    await page
      .getByRole("main")
      .getByRole("button", { name: new RegExp(`^${escapeRe(PLAYER)}\\s*${escapeRe(SPORT)}`) })
      .click();
    await expect(page.getByRole("heading", { name: PLAYER, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Add team" }).click();
    await page.getByRole("textbox", { name: "Search teams" }).fill(FUTURE);
    await page
      .getByRole("listbox", { name: "Team typeahead results" })
      .getByRole("option", { name: new RegExp(`^Add ${escapeRe(FUTURE)}`) })
      .first()
      .click();
    await expect(page.getByRole("button", { name: `Remove team ${FUTURE}` })).toBeVisible();
    await page.getByLabel(/Stint from year/).fill("2025");
    await page.getByRole("button", { name: "Add stint" }).click();
    await expect(page.getByRole("link", { name: new RegExp(`^${escapeRe(FUTURE)} · 2025`) })).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(`Saved ${PLAYER}`)).toBeVisible();
    // Back: the set builder again, the drill intact (its Base checklist now holds card 1).
    await page.goBack();
    await expect(setBuilderReady(page)).toBeVisible();
    await expect(editCardButton(page, "1")).toBeVisible();

    // ── PART 5: variant B's checklist prints both names; set history links them at the commit ──
    await drillToCustom(page, target(INSERT));
    await expect(empty).toBeVisible();
    const facts = await usePastedChecklist(page, `number,player,team\n1,${PLAYER},${FUTURE}\n2,${PLAYER},${NICK}`, 2);
    expect(facts.rows).toBe(2);
    await syncChecklistButton(page).click();
    const opened = await settleWalkAfterCommit(page, page.getByText(/^Saved 2 cards\./).first());
    expect(opened, "card #2's team is not in the player's career, so the walk opened for that check").toBe(true);
    const walk = tidyWalk(page);
    await expect(walk).toHaveAccessibleName(tidyUpName({ year: "2025", set: SET, variant: INSERT }));
    // Positive: #2 alone. Negative: #1 (its team linked, covered by the stint) is never a stop.
    await expectCardsLeft(page, 1);
    await expect(walk.getByText(`#2 · ${PLAYER}`, { exact: true })).toBeVisible();
    await expect(walk.getByText(/^#1 · /), "#1's linked team asks nothing, so the walk never shows it").toHaveCount(0);
    await expectCardSettled(page);

    // The Team tile: nothing to fix, no question, the linked team and why it was linked.
    const team = tidyTile(page, "Team");
    await expect(team).toBeVisible();
    await expect(pinkTile(page, "Team"), "the team set history linked asks the operator nothing").toHaveCount(0);
    const nickRow = team.getByRole("group", { name: `Team ${NICK}`, exact: true });
    await expect(nickRow.getByText(NICK_FULL, { exact: true })).toBeVisible();
    await expect(nickRow.getByRole("note")).toHaveText(SET_HISTORY_NOTE);
    await expect(nickRow.getByRole("button", { name: `Edit ${NICK_FULL}`, exact: true })).toBeVisible();
    await expect(team.getByRole("button", { name: /^Not a team/ })).toHaveCount(0);
    // The one stop on this card is the blue career check (J2), never pink.
    const career = tidyTile(page, "Career");
    await expect(career).toHaveAccessibleDescription(/To check/);
    await expect(career.getByText(`No ${NICK_FULL} in the career by 2025.`, { exact: true })).toBeVisible();
    await expect(pinkTile(page, "Career")).toHaveCount(0);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, a printed team linked from the set's saved card" });

    // Nothing pink, so Save & next is usable; it marks the check seen and the walk runs out.
    await saveAndNext(page);
    await expect(walk.getByText("All tidy. Nothing on this checklist needs you.")).toBeVisible();
    await finishTidyWalk(page);

    // ── PART 6: the commit put each linked team on its card, and only that team ──
    for (const [number, teamName, other] of [
      ["1", FUTURE, NICK_FULL],
      ["2", NICK_FULL, FUTURE],
    ] as const) {
      await expect(editCardButton(page, number)).toBeVisible();
      await editCardButton(page, number).click();
      await expect(drawer.getByRole("button", { name: `Remove team ${teamName}`, exact: true })).toBeVisible();
      await expect(drawer.getByRole("button", { name: `Remove team ${other}`, exact: true })).toHaveCount(0);
      if (number === "1") await expectAccessible(page, { within: drawer, label: "Card drawer, a future-era team linked from the set's saved card" });
      await page.getByRole("button", { name: "Done editing card" }).click();
      await expect(drawer).toBeHidden();
    }
  },
);
