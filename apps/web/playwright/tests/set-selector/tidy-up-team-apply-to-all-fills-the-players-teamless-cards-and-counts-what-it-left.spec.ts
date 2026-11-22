// NEO-645 (R1): on the Tidy Up walk's Team tile, "Apply to all" offers a card's team to the same
// player's other teamless cards; the server writes it only where the player's career names that
// team for the set's year and nothing on the card names or rules out a team, and the status line
// says how many cards took it and how many were left as they were.
//
// The operator meets it like this, on ONE player printed on five cards:
//   1. #1 opens the walk with the player still a name. "Add as new player" answers it on every card
//      that prints it. #1's Team tile stays pink (blank cell: no team).
//   2. A team made on #1's tile ("+ New team", then Save team) puts the offer up: "Apply to all 3
//      other <player> cards". #4 is NOT offered: its team cell names another team (rule 8, a data
//      claim holds back a guess), so it is never proposed. #5 IS offered: it prints the player and a
//      second, still-unknown person, and only the server knows to leave it alone.
//   3. Pressed before the player's career holds the team, the server refuses every card: "No cards
//      changed." (the client proposes, the server checks the career).
//   4. "+ Add stint" on #1's Career tile puts the team in the player's career from the set's year.
//      Pressed again: "Applied to 2 cards. 1 left as it was." (#2 and #3 took it; #5 did not).
//   5. The walk: Save & next from #1 lands on #4 (#2 and #3 have nothing left and drop out), whose
//      claimed team still stops it; Skip lands on #5, still pink for its second name and its team.
//   6. Read back in each card's drawer: #1, #2, #3 hold the team; #4 and #5 hold none.
//
// R2: each walk move is proved by the card that lands and what it shows; every negative sits
// beside a positive. Coming a11y renames are matched by tolerant regexes ("Change" / "Change
// team"; an Apply button that stays on the page after it is pressed).
//
// FIXTURE (SET-REGISTRY.md, the `ata`/`atb` prefixes; R7a): a per-attempt sport `ata<token>` with
// year 2026, brand Topps and ONE set `atb<token>` with `Insert` › `Base`, all hand-made with no
// marketplace id anywhere, so the Sync is checklist-only (a pasted five-row checklist is the one
// source: no Match Cards, no BSC) and nothing is looked up (a hand-made sport has no Wikidata
// mapping). Minted names are single tokens per attempt (`Apl Ata<token>`, `Two Ata<token>`, teams
// `ATT<token>`, `ATC<token>`), so the spec is not fresh-only. Nothing is deleted: the sport, its
// rows, the five cards, the one new player and the one new team stand.
import type { Locator, Page } from "@playwright/test";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { closeCardDrawer, openCardDrawer } from "../../support/also-pictured";
import { escapeRe } from "../../support/cards";
import { usePastedChecklist } from "../../support/published-checklist";
import { drillToCustom, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import {
  createPlayerOnOpenRow,
  expectCardSettled,
  pinkTile,
  saveAndNext,
  saveForLater,
  settleWalkAfterCommit,
  skipCard,
  tidyTile,
  tidyWalk,
} from "../../support/tidy-walk";
import { tidyUpName } from "../../support/wizard";

const YEAR = "2026";

/** Card `number`'s drawer holds exactly `teams` (one "Remove team <name>" chip each), read from the stored card. */
async function expectDrawerTeams(page: Page, number: string, teams: string[]): Promise<void> {
  const drawer = await openCardDrawer(page, number);
  for (const team of teams) {
    await expect(drawer.getByRole("button", { name: `Remove team ${team}`, exact: true })).toBeVisible();
  }
  await expect(drawer.getByRole("button", { name: /^Remove team / }), `card #${number} holds ${teams.length} team(s)`).toHaveCount(teams.length);
  await closeCardDrawer(drawer);
}

test(
  "Tidy Up — Apply to all on the Team tile fills the player's other teamless cards where his career names the team, leaves a claimed or still-unsettled card alone, and says how many it left",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const SPORT = `ata${T}`;
    const SET = `atb${T}`;
    const PLAYER = `Apl Ata${T}`;
    const SECOND = `Two Ata${T}`;
    const TEAM = `ATT${T}`;
    const CLAIMED = `ATC${T}`;

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── FIXTURE: the hand-made leaf and its five-row checklist ──
    await drillToCustom(page, { sport: SPORT, year: YEAR, manufacturer: "Topps", set: SET, variantType: "Insert", variant: "Base" });
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
    // A BLANK team cell claims nothing (no team: pink). #4's cell names another team (a claim).
    // #5 prints the player and a second person (a "/" in the player cell is two names).
    const checklist =
      `number,player,team\n` +
      `1,${PLAYER},\n2,${PLAYER},\n3,${PLAYER},\n4,${PLAYER},${CLAIMED}\n5,${PLAYER} / ${SECOND},\n`;
    await usePastedChecklist(page, checklist, 5);
    await syncChecklistButton(page).click();

    const opened = await settleWalkAfterCommit(page, page.getByText(/Saved 5 cards\./).first());
    expect(opened, "five cards with an unanswered name, so the walk opened").toBe(true);
    const walk = tidyWalk(page);
    await expect(walk).toHaveAccessibleName(tidyUpName({ year: YEAR, set: SET }));
    const header = (number: string) => walk.getByText(new RegExp(`^#${number}( · .+)?$`)).first();
    const teamTile = tidyTile(page, "Team");
    const teamGroup = (name: string) => teamTile.getByRole("group", { name: new RegExp(`^Team ${escapeRe(name)}( |$)`) });
    const applyButton: Locator = teamTile.getByRole("button", {
      name: new RegExp(`^Apply to (all [0-9]+ other|the other) ${escapeRe(PLAYER)} cards?$`),
    });

    // ── STEP 1: #1, the player answered on every card that prints him ──
    await expect(header("1")).toBeVisible();
    await expectCardSettled(page);
    expect(await createPlayerOnOpenRow(page)).toBe(`Player ${PLAYER}`);
    await expect(pinkTile(page, "Player")).toHaveCount(0);
    // R2 precondition: no team on #1 yet, so the tile asks, and nothing is offered.
    await expect(pinkTile(page, "Team")).toHaveCount(1);
    await expect(applyButton).toHaveCount(0);

    // ── STEP 2: a team made on #1's tile, and the offer it puts up ──
    await teamTile.getByRole("button", { name: "+ New team", exact: true, disabled: false }).click();
    const form = teamTile.getByRole("group", { name: /^New team: / });
    await expect(form).toBeVisible();
    await form.getByRole("textbox", { name: "New team name" }).fill(TEAM);
    await form.getByRole("button", { name: `Create team ${TEAM}`, exact: true, disabled: false }).click();
    await expect(form).toBeHidden();
    await expect(teamTile.getByRole("button", { name: new RegExp(`^${escapeRe(TEAM)}$`), pressed: true })).toBeVisible();
    await teamTile.getByRole("button", { name: "Save team", exact: true, disabled: false }).click();
    await expect(pinkTile(page, "Team"), "the team landed on #1").toHaveCount(0);
    await expect(teamGroup(TEAM).getByRole("button", { name: /^Change( team)?( .+)?$/ })).toBeVisible();
    // #2, #3 and #5 are offered; #4 (its cell names another team) is not.
    await expect(applyButton).toHaveText(`Apply to all 3 other ${PLAYER} cards`);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, Team tile offering Apply to all" });

    // ── STEP 3: the server checks the career, not the client's offer ──
    await applyButton.click();
    await expect(teamTile.getByText("No cards changed.", { exact: true })).toBeVisible();
    // Nothing was written, so the same three cards are still offered.
    await expect(applyButton).toHaveText(`Apply to all 3 other ${PLAYER} cards`);

    // ── STEP 4: the team joins the player's career from the set's year, then Apply ──
    const career = tidyTile(page, "Career").getByRole("group", { name: `Career ${PLAYER}`, exact: true });
    await career.getByRole("button", { name: `+ Add stint for ${PLAYER}`, exact: true }).click();
    const careerTeam = career.getByRole("combobox", { name: `Career team name for ${PLAYER}`, exact: true });
    // The whole name of a team on file IS the pick: the list steps aside (NEO-574) and + Add
    // unlocks once the year is in (it stays held for a name NeonBinder does not hold).
    await careerTeam.fill(TEAM);
    await career.getByRole("spinbutton", { name: `From year for ${PLAYER}`, exact: true }).fill(YEAR);
    await career.getByRole("button", { name: `Add career team for ${PLAYER}`, exact: true, disabled: false }).click();
    // The stint is written and the entry closes.
    await expect(careerTeam).toBeHidden();
    await expect(career.getByRole("button", { name: `+ Add stint for ${PLAYER}`, exact: true })).toBeVisible();

    await applyButton.click();
    const outcome = teamTile.getByText("Applied to 2 cards. 1 left as it was.", { exact: true });
    await expect(outcome).toBeVisible();
    await expect(teamTile.getByText("No cards changed.", { exact: true })).toHaveCount(0);
    // The button stays beside its line (holding focus), whatever it offers now.
    await expect(applyButton).toHaveCount(1);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, Apply to all reported its counts" });

    // ── STEP 5: the walk — #2 and #3 are done; #4 and #5 still stop ──
    await saveAndNext(page);
    await expect(header("4")).toBeVisible();
    await expect(walk.getByText(/^#[23]( · .+)?$/), "#2 and #3 took the team, so the walk never shows them").toHaveCount(0);
    // #4: its checklist's team holds the fill back and still asks (rule 8).
    await expect(pinkTile(page, "Team")).toHaveCount(1);
    await expect(teamGroup(CLAIMED)).toBeVisible();
    await expect(teamGroup(TEAM)).toHaveCount(0);
    await skipCard(page);
    // #5: the second person is still a name, and its team was left as it was.
    await expect(header("5")).toBeVisible();
    await expect(pinkTile(page, "Player")).toHaveCount(1);
    await expect(tidyTile(page, "Player").getByRole("group", { name: new RegExp(`^Player ${escapeRe(SECOND)}( |$)`) })).toBeVisible();
    await expect(pinkTile(page, "Team")).toHaveCount(1);
    await expect(teamGroup(TEAM)).toHaveCount(0);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, a card Apply to all left as it was" });
    // Navigation lives in the URL: Back is #4 again, Forward #5.
    await page.goBack();
    await expect(header("4")).toBeVisible();
    await expect(header("5")).toHaveCount(0);
    await page.goForward();
    await expect(header("5")).toBeVisible();
    await expectCardSettled(page);
    await saveForLater(page);

    // ── STEP 6: read back from the stored cards ──
    await expectDrawerTeams(page, "1", [TEAM]);
    await expectDrawerTeams(page, "2", [TEAM]);
    await expectDrawerTeams(page, "3", [TEAM]);
    await expectDrawerTeams(page, "4", []);
    await expectDrawerTeams(page, "5", []);
  },
);
