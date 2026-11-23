// NEO-645 (R1): on the Tidy Up walk's Team tile, "Apply to all" offers a card's team to the cards
// on the same line (main's Tidy Up wizard rule, `cardTakesLineTeams`): the same checklist, the same
// player set and claim, and still waiting for a team. The server writes it at once, with no career
// check, and the status line says how many cards took it ("Applied to 2 cards.").
//
// The operator meets it like this, on ONE player printed on five cards:
//   1. #1 opens the walk with the player still a name. "Add as new player" answers it on every card
//      that prints it. #1's Team tile stays pink (blank cell: no team).
//   2. A team made on #1's tile ("+ New team", then Save team) puts the offer up: "Apply to all 2
//      other <player> cards" (#2 and #3). #4 is NOT offered: its team cell names another team
//      (rule 8, a data claim holds back a guess, and a claim is its own line). #5 is NOT offered
//      either: it prints the player and a second, still-unknown person, so it is still waiting on a
//      name and takes no line's answer.
//   3. Pressed once: "Applied to 2 cards." (#2 and #3 took it; nothing was left as it was, so no
//      "left as" tail; the tail itself is held by the tile's unit test, applyOutcomeText).
//   4. What Apply to all left: Save & next from #1 lands on #4 (#2 and #3 have nothing left and drop
//      out), whose claimed team still stops it; Skip lands on #5, still pink for its second name and
//      its team.
//   5. Read back in each card's drawer: #1, #2, #3 hold the team; #4 and #5 hold none.
//
// R2: each walk move is proved by the card that lands and what it shows; every negative sits
// beside a positive. The Apply button stays on the page after it is pressed (it keeps focus).
//
// FIXTURE (SET-REGISTRY.md, the `ata`/`atb` prefixes; R7a): a per-attempt sport `ata<token>` with
// year 2026, brand Topps and ONE set `atb<token>` with `Insert` › `Base`, all hand-made with no
// marketplace id anywhere, so the Sync is checklist-only (a pasted five-row checklist is the one
// source: no Match Cards, no BSC) and nothing is looked up (a hand-made sport has no Wikidata
// mapping). Minted names are single tokens per attempt (`Apl Ata<token>`, `Two Ata<token>`, teams
// `ATT<token>`, `ATC<token>`), so the spec is not fresh-only. Nothing is deleted: the sport, its
// rows, the five cards, the one new player and the one new team stand.
import type { Locator } from "@playwright/test";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { expectDrawerTeams } from "../../support/also-pictured";
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
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";

const YEAR = "2026";

test(
  "Tidy Up — Apply to all on the Team tile fills the player's other teamless cards on the first press, says how many it changed, and leaves a claimed or still-unsettled card asking",
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
    await expect(teamGroup(TEAM).getByRole("button", { name: `Edit ${TEAM}`, exact: true })).toBeVisible();
    // #2 and #3 are offered; #4 (its cell names another team) and #5 (a second name nobody has
    // answered) are not.
    await expect(applyButton).toHaveText(`Apply to all 2 other ${PLAYER} cards`);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, Team tile offering Apply to all" });

    // ── STEP 3: one press fills the two teamless cards, with no career stint needed ──
    await applyButton.click();
    const outcome = teamTile.getByText("Applied to 2 cards.", { exact: true });
    await expect(outcome).toBeVisible();
    await expect(teamTile.getByText("No cards changed.", { exact: true })).toHaveCount(0);
    // The button stays beside its line (holding focus), whatever it offers now.
    await expect(applyButton).toHaveCount(1);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, Apply to all reported its counts" });

    // ── STEP 4: what Apply to all left — #2 and #3 are done; #4 and #5 still stop ──
    await saveAndNext(page);
    await expect(header("4")).toBeVisible();
    await expect(walk.getByText(/^#[23]( · .+)?$/), "#2 and #3 took the team, so the walk never shows them").toHaveCount(0);
    // #4: its checklist's team holds the fill back and still asks (rule 8).
    await expect(pinkTile(page, "Team")).toHaveCount(1);
    await expect(teamGroup(CLAIMED)).toBeVisible();
    await expect(teamGroup(TEAM)).toHaveCount(0);
    await skipCard(page);
    // #5: the second person is still a name, and it was never offered the team.
    await expect(header("5")).toBeVisible();
    await expect(pinkTile(page, "Player")).toHaveCount(1);
    await expect(tidyTile(page, "Player").getByRole("group", { name: new RegExp(`^Player ${escapeRe(SECOND)}( |$)`) })).toBeVisible();
    await expect(pinkTile(page, "Team")).toHaveCount(1);
    await expect(teamGroup(TEAM)).toHaveCount(0);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, a card Apply to all did not offer" });
    // Navigation lives in the URL: Back is #4 again, Forward #5.
    await page.goBack();
    await expect(header("4")).toBeVisible();
    await expect(header("5")).toHaveCount(0);
    await page.goForward();
    await expect(header("5")).toBeVisible();
    await expectCardSettled(page);
    await saveForLater(page);

    // ── STEP 5: read back from the stored cards ──
    await expectDrawerTeams(page, "1", [TEAM]);
    await expectDrawerTeams(page, "2", [TEAM]);
    await expectDrawerTeams(page, "3", [TEAM]);
    await expectDrawerTeams(page, "4", []);
    await expectDrawerTeams(page, "5", []);
  },
);
