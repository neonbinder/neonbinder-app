// ONE FEATURE (NEO-645 Q1 = A, the career tier): a card that would save with no team, whose player
// has exactly ONE team in the career window of the set's year ([year - 1, year]), gets that team
// written by the commit itself. The card is not stopped for it: its Team tile is plain, names the
// team and carries the purple note "Team filled from the player's career". A player with TWO teams
// in the window gets nothing written, and his card's Team tile is pink, asking.
//
// The rule: convex/features/teamFillOnCommit.ts `planCardFill` (career tier) over
// convex/lib/teamFill.ts `careerTeamVerdict` ("oneTeamInWindow"), applied in the commit's insert path
// (selectorOptions.ts, "NEO-645 (Q1 = A)"), per player after the batch and stored tiers (main's
// order: batch, then stored, then career). Rule 8 is not exercised: the checklist's team cells are
// BLANK, which is no claim (a "No Team" cell would be one and would hold the fill back).
//
// Why card #1 is in the walk at all: the fill is a purple note and never a stop, so a filled card
// with nothing else is never shown (the note renders only in the walk's tiles). Card #1's filled
// team is a single token padded to 70 characters (the `CNAL` trick, SET-REGISTRY), so its listing
// title has to give the team up: a BLUE "Listing title" check, nothing pink. That blue item is the
// card's one reason to be in the walk; the Team tile is what this spec reads.
//
// Positive and negative (R2), one fetch:
//   - #1 `Ann Tfp<token>`: one stint, the long team, 2020-2025. One team in [2024, 2025]: FILLED.
//     Team tile not pink, group `Team <long team>`, the purple note, Save & next usable.
//   - #2 `Bob Tfq<token>`: two stints, `Tfm<token>` 2020-2025 and `Tfn<token>` 2025. Two teams in
//     the window (the commit passes no league rank, so nothing breaks the tie): NOT filled. Team
//     tile pink, both career teams offered as chips, no fill note. Both stints cover 2025 itself on
//     purpose: the tile's chips read the set year alone (`cardChecklist.suggestedTeamsForCard`), so
//     with a stint ending in 2024 the tile would offer the other team alone. This spec proves the
//     COMMIT's rule; which chips the tile preselects is the tile's own rule, not read here.
//   Both are read back in the card drawer: #1 carries the long team, #2 carries no team.
//
// FIXTURE (SET-REGISTRY.md "Custom sets", the `tfs`/`tfa` prefixes, and the `Tfl`/`Tfm`/`Tfn`/
// `Tfp`/`Tfq` name prefixes; R7a): a per-attempt sport `tfs<token>` › 2025 › Topps › `tfa<token>` ›
// Insert › Base, all hand-made with no marketplace id, so the Sync is checklist-only (a pasted
// two-row checklist, no Match Cards, no BSC) and nothing is looked up (a hand-made sport has no
// Wikidata mapping). The two players and their stints are made in Player Management; each team is
// born in the career editor's New Team dialog. Not fresh-only: every name is per attempt. Nothing
// is deleted.
//
// Back (house rule): the set builder -> Players is a navigation; Back returns to the set builder
// with the drill and the empty Base checklist restored.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { editCardButton } from "../../support/cards";
import { emptyListAndPickSport, expectPlayersLoaded } from "../../support/players";
import { usePastedChecklist } from "../../support/published-checklist";
import { drillToCustom, escapeRe, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import {
  expectCardSettled,
  expectCardsLeft,
  finishTidyWalk,
  mustFixLine,
  pinkTile,
  saveAndNext,
  settleWalkAfterCommit,
  skipCard,
  tidyFooterButton,
  tidyTile,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";
import type { Page } from "@playwright/test";

const YEAR = "2025";

/** The purple note on a card whose team the commit filled from the career (tidy/parts/copy.ts `teamFillText`). */
const CAREER_FILL_NOTE = "Team filled from the player's career";
/** Either fill note: the negative card must carry neither. */
const ANY_FILL_NOTE = /^Team filled from the player's (career|other cards)$/;

/**
 * On /admin/players (loaded): add `name` under `sport` and give him one stint per entry, each team
 * born in the career editor's New Team dialog. Contract: EXIT his detail panel shows every stint,
 * saved.
 */
async function addPlayerWithNewTeamStints(
  page: Page,
  name: string,
  sport: string,
  stints: ReadonlyArray<{ team: string; from: string; to: string }>,
): Promise<void> {
  await emptyListAndPickSport(page, sport);
  await page.getByRole("button", { name: "Add player" }).click();
  await expect(page.getByRole("heading", { name: "Add a player" })).toBeVisible();
  await page.getByRole("textbox", { name: "New player name" }).fill(name);
  await page.getByRole("button", { name: `Create player ${name}`, exact: true }).click();
  await expect(page.getByText(`Added ${name}`)).toBeVisible();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.getByText("No stints recorded yet.")).toBeVisible();

  for (const { team, from, to } of stints) {
    await page.getByRole("button", { name: "Add team" }).click();
    const search = page.getByRole("textbox", { name: "Search teams" });
    await search.fill(team);
    await expect(page.getByText("No matches.")).toBeVisible();
    await search.press("Enter");
    const dialog = page.getByRole("dialog", { name: `New team: ${team}` });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: `Create team ${team}` }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: `Remove team ${team}` })).toBeVisible();
    await page.getByLabel(/Stint from year/).fill(from);
    await page.getByLabel(/Stint to year/).fill(to);
    await page.getByRole("button", { name: "Add stint" }).click();
    await expect(page.getByRole("link", { name: `${team} · ${from}–${to}` })).toBeVisible();
  }
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(`Saved ${name}`)).toBeVisible();
}

test(
  "Tidy Up — a teamless card whose player has one team in the set year's window gets that team at the commit with a purple note and no stop; two teams in the window are left for the operator",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const SPORT = `tfs${T}`;
    const SET = `tfa${T}`;
    const ONE = `Ann Tfp${T}`; // one team in the window
    const TWO = `Bob Tfq${T}`; // two teams in the window
    // One token padded to 70 characters: the title can never hold it (the `CNAL` trick).
    const LONG = `Tfl${T}`.padEnd(70, "x");
    const EARLY = `Tfm${T}`;
    const LATE = `Tfn${T}`;

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── FIXTURE: the hand-made 2025 leaf, empty ──
    await drillToCustom(page, { sport: SPORT, year: YEAR, manufacturer: "Topps", set: SET, variantType: "Insert", variant: "Base" });
    const empty = page.getByText("No cards in this checklist yet.");
    await expect(empty).toBeVisible();

    // ── FIXTURE: the two players and their careers, in Player Management ──
    await page.getByRole("link", { name: "Players", exact: true }).click();
    await expectPlayersLoaded(page);
    await addPlayerWithNewTeamStints(page, ONE, SPORT, [{ team: LONG, from: "2020", to: "2025" }]);
    await addPlayerWithNewTeamStints(page, TWO, SPORT, [
      { team: EARLY, from: "2020", to: "2025" },
      { team: LATE, from: "2025", to: "2025" },
    ]);
    // Back: the set builder, on the same empty Base checklist.
    await page.goBack();
    await expect(setBuilderReady(page)).toBeVisible();
    await expect(empty).toBeVisible();

    // ── The checklist names both players and no team (blank cells: no claim) ──
    await usePastedChecklist(page, `number,player,team\n1,${ONE},\n2,${TWO},\n`, 2);
    await syncChecklistButton(page).click();
    const opened = await settleWalkAfterCommit(page, page.getByText(/^Saved 2 cards\./).first());
    expect(opened, "#1's cut title and #2's missing team open the walk").toBe(true);
    const walk = tidyWalk(page);
    await expect(walk).toHaveAccessibleName(tidyUpName({ year: YEAR, set: SET }));
    await expectCardsLeft(page, 2);

    // ── CARD #1: the commit wrote the one career team; the Team tile only says so ──
    await expect(walk.getByText(`#1 · ${ONE}`, { exact: true })).toBeVisible();
    await expectCardSettled(page);
    const team = tidyTile(page, "Team");
    await expect(team).toBeVisible();
    await expect(pinkTile(page, "Team"), "the filled team asks the operator nothing").toHaveCount(0);
    await expect(team).not.toHaveAccessibleDescription(/To fix/);
    const filled = team.getByRole("group", { name: `Team ${LONG}`, exact: true });
    await expect(filled.getByText(LONG, { exact: true })).toBeVisible();
    await expect(team.getByRole("note").filter({ hasText: ANY_FILL_NOTE })).toHaveText(CAREER_FILL_NOTE);
    await expect(team.getByRole("button", { name: "No team on this card", exact: true })).toHaveCount(0);
    // The card's one stop is the blue title cut, which the long team caused.
    await expect(tidyTile(page, "Listing title")).toHaveAccessibleDescription(/To check/);
    await expect(mustFixLine(page)).toHaveCount(0);
    await expect(tidyFooterButton(page, "saveAndNext", { usable: true }), "nothing on #1 is pink").toBeVisible();
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, a team filled from the player's career" });
    await saveAndNext(page);

    // ── CARD #2: two teams in the window, so nothing was written and the tile asks ──
    await expect(walk.getByText(`#2 · ${TWO}`, { exact: true })).toBeVisible();
    await expectCardsLeft(page, 1);
    await expect(pinkTile(page, "Team"), "no team was written, so the operator is asked").toHaveCount(1);
    await expect(team).toHaveAccessibleDescription(/To fix/);
    for (const name of [EARLY, LATE]) {
      await expect(
        team.getByRole("button", { name: new RegExp(`^${escapeRe(name)}( · .+)?$`) }),
        `${name} is offered from the career`,
      ).toBeVisible();
    }
    await expect(team.getByRole("note").filter({ hasText: ANY_FILL_NOTE })).toHaveCount(0);
    await expect(team.getByRole("button", { name: "No team on this card", exact: true })).toBeVisible();
    await expect(mustFixLine(page)).toBeVisible();
    await expect(tidyFooterButton(page, "saveAndNext", { usable: true })).toHaveCount(0);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, two career teams in the window, nothing filled" });
    await skipCard(page);
    await expect(walk.getByText(/^1 card skipped, not ready to list/)).toBeVisible();
    await finishTidyWalk(page);

    // ── Read back: #1 carries the long team, #2 carries none ──
    const drawer = page.getByRole("dialog");
    await editCardButton(page, "1").click();
    await expect(drawer.getByRole("button", { name: `Remove team ${LONG}`, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(drawer).toBeHidden();

    await editCardButton(page, "2").click();
    await expect(drawer.getByLabel("Team picker")).toBeVisible();
    await expect(drawer.getByRole("button", { name: /^Remove team / }), "#2 was saved with no team").toHaveCount(0);
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(drawer).toBeHidden();
  },
);
