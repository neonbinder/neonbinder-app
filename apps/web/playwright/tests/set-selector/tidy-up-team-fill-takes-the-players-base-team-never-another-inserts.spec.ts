// ONE FEATURE (NEO-645 Q1 = A, the stored tier; production rule, kept by Jason 2026-11-24 on
// NEO-656): an insert card the checklist gives no team gets, at the commit, the team the SAME
// player's card in the set's Base carries. It is never a stop: the filled card is not in the walk.
// A player whose only printed team is on ANOTHER insert gets nothing: another insert is not
// evidence ("Brett Favre could be a Jet in one insert and a Packer in another"), so his card is
// left teamless and its Team tile asks.
//
// The rule: convex/features/teamFillOnCommit.ts `planCardFill` over the stored evidence
// (convex/cardChecklist.ts `storedTeamEvidence`: this node, the node a parallel copies, the set's
// Base; first tier to answer wins; convex/lib/teamFill.ts "What is deliberately NOT evidence"),
// applied in the commit's insert path (selectorOptions.ts, "NEO-645 (Q1 = A)").
//
// Why the careers are TIES: each player has two teams covering 2025, so the career tier
// (`careerTeamVerdict` "oneTeamInWindow") answers nothing for either. Only the Base tier can fill
// Ann's insert card; if it stops answering, her card is left teamless (red). Bob's card would be
// filled with `Tby…` only if the other insert counted. Each card the Base and the other insert
// print names a team in its player's career, so neither of those commits has a Career gap.
//
// Positive and negative (R2), one fetch of the insert under test:
//   - #1 `Ann Tbp<token>`: Base card #1 prints `Tbx<token>`. FILLED with it, no stop: the walk
//     holds only #2, and the card drawer reads `Tbx<token>` back.
//   - #2 `Bob Tbq<token>`: the other insert's card #1 prints `Tby<token>`. NOT filled: Team tile
//     pink, his two career teams offered under the tie heading, none suggested; the drawer reads
//     no team back.
//
// FIXTURE (SET-REGISTRY.md "Custom sets", the `tbs`/`tbb` prefixes, and the `Tbx`/`Tbw`/`Tby`/
// `Tbv` team, `Tbp`/`Tbq` player and `Tbi`/`Tbj` insert prefixes; R7a): a per-attempt sport
// `tbs<token>` › 2025 › Topps › `tbb<token>` with `Base` and `Insert` › `Tbj<token>` (the other
// insert) and `Insert` › `Tbi<token>` (the one under test), all hand-made with no marketplace id,
// so every Sync is checklist-only (pasted checklists, no Match Cards, no BSC) and nothing is looked
// up (a hand-made sport has no Wikidata mapping). The players and teams are made in Player
// Management. Not fresh-only: every name is per attempt. Nothing is deleted.
//
// Back (house rule): the set builder -> Players is a navigation; Back returns to the set builder
// with the drill and the empty Base checklist restored.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { editCardButton } from "../../support/cards";
import {
  addCareerStint,
  addPlayerByHand,
  createTeamInCareerEditor,
  expectPlayersLoaded,
  teamChip,
} from "../../support/players";
import { usePastedChecklist } from "../../support/published-checklist";
import { drillToCustom, escapeRe, selectOrCreate, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import {
  expectCardsLeft,
  expectTidyEndScreen,
  finishTidyWalk,
  mustFixLine,
  pinkTile,
  settleWalkAfterCommit,
  skipCard,
  tidyFooterButton,
  tidyTile,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";
import type { Page } from "@playwright/test";

const YEAR = "2025";

/** The Team tile's career heading when two teams cover the season (tidy/parts/copy.ts `TIE_HEADING`). */
const TIE_HEADING = "From the career. More than one team that season, so pick the one on the card.";

/**
 * On /admin/players (loaded): add `name` under `sport`, make both teams in the career editor's
 * New Team dialog, and give him a stint on each (`a` 2020-2025, `b` 2025-2025: two teams in the
 * 2025 window, a career tie). Contract: EXIT the player is saved with both stints.
 */
async function addPlayerWithACareerTie(page: Page, name: string, sport: string, a: string, b: string): Promise<void> {
  await addPlayerByHand(page, name, sport);
  await expect(page.getByText("No stints recorded yet.")).toBeVisible();
  await createTeamInCareerEditor(page, { search: a });
  await createTeamInCareerEditor(page, { search: b });
  await addCareerStint(page, { search: a, full: a, from: "2020", to: "2025" });
  await addCareerStint(page, { search: b, full: b, from: "2025", to: "2025" });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(`Saved ${name}`)).toBeVisible();
}

test(
  "Tidy Up — a teamless insert card takes the team its player's Base card prints, with no stop; a team only another insert prints is not used",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const SPORT = `tbs${T}`;
    const SET = `tbb${T}`;
    const UNDER_TEST = `Tbi${T}`; // the insert whose blank cells are filled (or not)
    const OTHER_INSERT = `Tbj${T}`;
    const ANN = `Ann Tbp${T}`; // her Base card prints BASE_TEAM
    const BOB = `Bob Tbq${T}`; // only the other insert prints a team for him
    const BASE_TEAM = `Tbx${T}`;
    const ANN_TIE = `Tbw${T}`;
    const INSERT_TEAM = `Tby${T}`;
    const BOB_TIE = `Tbv${T}`;

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── FIXTURE: the hand-made 2025 set's Base, empty ──
    await drillToCustom(page, { sport: SPORT, year: YEAR, manufacturer: "Topps", set: SET });
    await selectOrCreate(page, "Variant Types", "Base", { via: "list" });
    await expect(page.getByRole("button", { name: "Open add card form" })).toBeVisible();
    const empty = page.getByText("No cards in this checklist yet.");
    await expect(empty).toBeVisible();

    // ── FIXTURE: the two players, each with a career tie, in Player Management ──
    await page.getByRole("link", { name: "Players", exact: true }).click();
    await expectPlayersLoaded(page);
    await addPlayerWithACareerTie(page, ANN, SPORT, BASE_TEAM, ANN_TIE);
    await addPlayerWithACareerTie(page, BOB, SPORT, INSERT_TEAM, BOB_TIE);
    // Back: the set builder, on the same empty Base checklist.
    await page.goBack();
    await expect(setBuilderReady(page)).toBeVisible();
    await expect(empty).toBeVisible();

    // ── FIXTURE: the Base prints Ann on BASE_TEAM (in her career, so no stop) ──
    await usePastedChecklist(page, `number,player,team\n1,${ANN},${BASE_TEAM}\n`, 1);
    await syncChecklistButton(page).click();
    expect(
      await settleWalkAfterCommit(page, page.getByText(/^Saved 1 card\./).first()),
      "the Base card needs nobody",
    ).toBe(false);

    // ── FIXTURE: the other insert prints Bob on INSERT_TEAM (in his career, so no stop) ──
    await drillToCustom(page, { sport: SPORT, year: YEAR, manufacturer: "Topps", set: SET, variantType: "Insert", variant: OTHER_INSERT });
    await expect(empty).toBeVisible();
    await usePastedChecklist(page, `number,player,team\n1,${BOB},${INSERT_TEAM}\n`, 1);
    await syncChecklistButton(page).click();
    expect(
      await settleWalkAfterCommit(page, page.getByText(/^Saved 1 card\./).first()),
      "the other insert's card needs nobody",
    ).toBe(false);

    // ── The insert under test names both players and no team (blank cells: no claim) ──
    await drillToCustom(page, { sport: SPORT, year: YEAR, manufacturer: "Topps", set: SET, variantType: "Insert", variant: UNDER_TEST });
    await expect(empty).toBeVisible();
    await usePastedChecklist(page, `number,player,team\n1,${ANN},\n2,${BOB},\n`, 2);
    await syncChecklistButton(page).click();
    const opened = await settleWalkAfterCommit(page, page.getByText(/^Saved 2 cards\./).first());
    expect(opened, "#2's missing team opens the walk").toBe(true);
    const walk = tidyWalk(page);
    await expect(walk).toHaveAccessibleName(tidyUpName({ year: YEAR, set: SET, variant: UNDER_TEST }));

    // ── #1 was filled from her Base card, so it is no stop: the walk holds #2 alone ──
    await expect(walk.getByText(`#2 · ${BOB}`, { exact: true })).toBeVisible();
    await expectCardsLeft(page, 1);
    await expect(walk.getByText(/^#1 · /), "Ann's filled card is not in the walk").toHaveCount(0);

    // ── #2: the other insert's team is not evidence, the career is a tie, so the tile asks ──
    const team = tidyTile(page, "Team");
    await expect(pinkTile(page, "Team"), "no team was written, so the operator is asked").toHaveCount(1);
    await expect(team).toHaveAccessibleDescription(/To fix/);
    await expect(team.getByText(TIE_HEADING, { exact: true })).toBeVisible();
    for (const name of [INSERT_TEAM, BOB_TIE]) {
      await expect(
        team.getByRole("button", { name: new RegExp(`^${escapeRe(name)}( · .+)?$`) }),
        `${name} is offered from the career`,
      ).toBeVisible();
    }
    await expect(team.getByRole("button", { name: /, suggested( · .+)?$/ }), "nothing is suggested").toHaveCount(0);
    await expect(mustFixLine(page)).toBeVisible();
    await expect(tidyFooterButton(page, "saveAndNext", { usable: true })).toHaveCount(0);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, a team only another insert prints, nothing filled" });
    await skipCard(page);
    await expectTidyEndScreen(page, { fixed: 0, skipped: 1 });
    await finishTidyWalk(page);

    // ── Read back: #1 carries her Base card's team, #2 carries none ──
    const drawer = page.getByRole("dialog");
    await editCardButton(page, "1").click();
    await expect(teamChip(drawer, BASE_TEAM), "#1 took the Base card's team").toBeVisible();
    await expect(drawer.getByRole("button", { name: /Remove team / }), "and only that team").toHaveCount(1);
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(drawer).toBeHidden();

    await editCardButton(page, "2").click();
    await expect(drawer.getByLabel("Team picker")).toBeVisible();
    await expect(drawer.getByRole("button", { name: /Remove team / }), "#2 was saved with no team").toHaveCount(0);
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(drawer).toBeHidden();
  },
);
