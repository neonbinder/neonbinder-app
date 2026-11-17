// Origin: .maestro/flows/set-selector/checklist-wizard-career-team-commits.yaml (Maestro suite retired in NEO-341; see git history)
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { CHECKLISTS, checklistFacts, expectTeamsFromChecklist } from "../../support/published-checklist";
import { setBuilderReady } from "../../support/set-builder";
import { expectPlayersLoaded, expectTeamsLoaded, PLAYERS_MATCHES, playersCounter, teamsCounter } from "../../support/players";
import { recordedNoMatchName } from "../../support/recorded-names";
import {
  answerPlayerAsNew,
  advanceToSave,
  fetchOneMarketplaceSetChecklistToWizard,
  readStep,
  reviewWizard,
  stepCounter,
  walkToPlayerRow,
} from "../../support/wizard";

// Sole writer of the 1995 Memphis RiverKings CHL set (SET-REGISTRY.md), BSC
// only; fresh-only (it commits the checklist). Approved by Jason 2026-10-10
// (NEO-330), replacing Topps Baltimore Orioles: the reference catalogue knows
// every Orioles player, so that fetch committed straight through with no
// wizard. MEASURED on PR #314's preview: 18 cards, 15 unknown names, all
// players, 0 teams; since the uploaded checklist names the club, "Memphis
// RiverKings" is a New Team step too (measured NEO-574), which this spec adds.
// Re-seed before re-running.
// NEO-413: the staged career team is looked up when it stages, so it is a
// real club from support/recorded-names.ts (a hurling club, one word) that the
// recording holds as a Hockey no-match and the reference catalogue does not
// hold: the lookup sends nothing to Wikidata, the step still reads "New Team",
// and Team Management's filter finds this one row. One name per worker.
const SET = "Memphis RiverKings CHL";
// NEO-574: what the New player step's career form opens with on this set: the team
// every card prints, by the name its New Team step creates it under (the catalogue
// holds no such club, so the walk adds it), and the set's year.
const CARD_TEAM = "Memphis RiverKings";
const SET_YEAR = "1995";
/**
 * NEO-574 multi-team prefill: card #1's player, and two cards only the upload names for him
 * (kept in Match Cards): one more on the club (so the club is his majority team) and one on a
 * catalogue NHL club (read only), the quick pick.
 */
const PREFILL_PLAYER = "Scott Brower";
const OTHER_TEAM = "Dallas Stars";
/** Two checklist-only rows for the prefill player, kept in Match Cards: one on the club, one not. */
const EXTRA_ROWS = [
  { number: "901", player: PREFILL_PLAYER, team: CARD_TEAM },
  { number: "902", player: PREFILL_PLAYER, team: OTHER_TEAM },
] as const;

// NEO-574 rides this fixture too: the career form opens PREFILLED with the team most of the
// player's own cards print and the set's year, offers his other card teams as quick picks
// ("Fill in <team>", which fill the form and add nothing), prefills the next team not yet added
// after + Add, and a prefill nobody presses + Add on never reaches the career.
test(
  "Entity review — a hand-staged career team survives the commit and becomes a real team row",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env, isMobile }) => {
    const team = recordedNoMatchName(env, "checklist-wizard-career-team-commits");

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });
    await fetchOneMarketplaceSetChecklistToWizard(page, env, {
      set: SET,
      checklist: CHECKLISTS.memphisRiverKings,
      extraRows: EXTRA_ROWS,
    });
    const wizard = reviewWizard(page);
    await expect(stepCounter(page)).toHaveText(/^Step 1 of [0-9]+$/);
    // readyToCreate: this spec creates the player, so the walk also passes any
    // player whose create is held by a career team it skipped. creatingTeams
    // (NEO-574): the catalogue does not hold the club the checklist names, so its
    // New Team step is ADDED, not skipped: a team ruled "not a team" is never
    // offered to the career form, and the prefill below is the point.
    await walkToPlayerRow(page, { creatingTeams: true, readyToCreate: true });

    // NEO-574: the career form OPENS on the team this player's cards print, in the
    // set's year (every Memphis card prints the club; the text is the name its New
    // Team step creates it under). A prefill, not an entry: nothing is staged
    // until + Add, which this spec never presses on it (the save's read-back below
    // proves it never reached the player's career).
    const careerName = wizard.getByRole("combobox", { name: "Career team name" });
    const fromYear = wizard.getByRole("spinbutton", { name: "From year" });
    const staged = wizard.getByRole("list", { name: "Staged career teams" });
    const quickPicks = wizard.getByRole("group", { name: "Also on the cards" });
    const fillOther = quickPicks.getByRole("button", { name: `Fill in ${OTHER_TEAM}` });
    const playerName = ((await wizard.getByRole("heading", { level: 3 }).textContent()) ?? "").trim();
    expect(playerName, "the walk stops on card #1's player, whose cards the upload adds to").toBe(PREFILL_PLAYER);
    // His majority team (#1 and #901 print the club, #902 the NHL club) and the set's year.
    await expect(careerName).toHaveValue(CARD_TEAM);
    await expect(fromYear).toHaveValue(SET_YEAR);
    await expect(wizard.getByRole("spinbutton", { name: /^To year/ })).toHaveValue("");
    await expect(staged).toBeHidden();
    await expect(wizard.getByRole("button", { name: "Add career team" })).toBeEnabled();
    // The other team on his cards is one press away.
    await expect(fillOther).toBeVisible();
    await expect(quickPicks.getByRole("button")).toHaveCount(1);
    if (isMobile) {
      // A phone tap target (WCAG 2.5.5's 44 px; the chip is min-h-11 below the sm breakpoint).
      const box = await fillOther.boundingBox();
      expect(box?.height ?? 0, "the quick pick is a 44 px tap target at phone width").toBeGreaterThanOrEqual(44);
    }
    await expectAccessible(page, { within: wizard, label: "Entity review wizard, career team entry prefilled, with a quick pick" });
    // A quick pick FILLS the form and adds nothing.
    await fillOther.click();
    await expect(careerName).toHaveValue(OTHER_TEAM);
    await expect(fromYear).toHaveValue(SET_YEAR);
    await expect(staged).toBeHidden();
    // Back to the club by hand, and + Add: it is staged, and the form prefills the next team
    // not yet added, the NHL club, with no quick pick left.
    await careerName.fill(CARD_TEAM);
    // Typing opens the existing-team suggestions over the row; take the club from them.
    await wizard.getByRole("listbox", { name: "Existing team suggestions" }).getByRole("option", { name: `Use ${CARD_TEAM}` }).click();
    await expect(careerName).toHaveValue(CARD_TEAM);
    await wizard.getByRole("button", { name: "Add career team" }).click();
    await expect(staged.getByText(new RegExp(`^${CARD_TEAM} \\(${SET_YEAR}`))).toBeVisible();
    await expect(careerName).toHaveValue(OTHER_TEAM);
    await expect(fromYear).toHaveValue(SET_YEAR);
    await expect(quickPicks).toBeHidden();

    // Stage a career team by hand on the first player row, over the prefill (the NHL club, which
    // is therefore never added).
    await careerName.fill(team);
    await fromYear.fill("2001");
    await wizard.getByRole("spinbutton", { name: /^To year/ }).fill("2005");
    await wizard.getByRole("button", { name: "Add career team" }).click();

    // The new name is looked up (a recorded no-match since NEO-413: no live
    // request), then raised as its own New Team step. The ceiling stays the
    // walk util's lookup ceiling: the lookup still waits in the shared pool.
    const lookingUp = wizard.getByText(/still looking up/);
    const newTeam = wizard.getByRole("heading", { name: `New Team: ${team}` });
    await expect(newTeam.or(lookingUp).first()).toBeVisible();
    await expect(lookingUp).toBeHidden({ timeout: 180_000 });
    await expect(newTeam).toBeVisible();
    await expectAccessible(page, { within: wizard, label: "Entity review wizard, New Team step for a career team" });
    await wizard.getByRole("button", { name: "Add as New Team" }).click();

    // Back on the player row (one decision write plus the walk's return: 7 s,
    // no external round trip). Since NEO-330 the walk comes BACK to the player
    // the team was typed on, not the first undecided player in batch order. The
    // chip renders only on the row it was typed on and keeps its years across
    // the hop, so this chip IS the proof the presented row is the same player.
    await expect(wizard.getByRole("combobox", { name: "Career team name" })).toBeVisible();
    await expect(wizard.getByText(new RegExp(`${team} \\(2001.2005\\)`))).toBeVisible();

    // "Add as New Player" records exactly ONE decision: the header's "Step x of
    // y" has x = decided + 1 on a name step, so x moves by exactly one. Pin x,
    // not y (y grows as staged steps arrive); the pattern is anchored at both
    // ends, so "Step 5" cannot answer for "Step 15".
    const { x: stepBefore } = await readStep(page);
    await answerPlayerAsNew(page);
    await expect(stepCounter(page)).toHaveText(new RegExp(`^Step ${stepBefore + 1} of [0-9]+$`));

    await wizard.getByRole("button", { name: /Skip remaining names \([0-9]+\)/ }).click();
    // The walk already waited every lookup out, so the bulk is one mutation of
    // our own: 7 s (R5; measured 0.34 s on PR #314's preview). Past the names
    // come the teams / titles steps (NEO-335): this spec's feature is the staged
    // team, so they stay on their defaults and the walk goes to the Save step.
    await advanceToSave(page);
    const confirmSave = wizard.getByRole("button", { name: /Confirm & Save/ });
    await expect(confirmSave).toBeVisible();
    // The Save step's summary omits a zero line, so this one is present only
    // because the create above (and the team step's) landed; everything else
    // was skipped.
    await expect(wizard.getByText("New players and teams", { exact: true })).toBeVisible();
    await expectAccessible(page, { within: wizard, label: "Entity review wizard, summary" });
    await confirmSave.click();
    // The result line stays on screen after the save too. The two kept checklist-only rows are
    // cards now, each with its checklist row's team, so the line counts them with the matched ones.
    const base = checklistFacts(CHECKLISTS.memphisRiverKings);
    const saved = base.rows + EXTRA_ROWS.length;
    await expect(page.getByText(`Saved ${saved} cards.`)).toBeVisible();
    await expectTeamsFromChecklist(page, { ...base, matched: base.matched + EXTRA_ROWS.length });

    // The staged team is now a real row in Team Management.
    await page.goto("/admin/teams");
    await expectTeamsLoaded(page, 30_000);
    await page.getByRole("textbox", { name: "Filter teams" }).fill(team);
    // The debounced server search narrows the list to exactly this team
    // (measured 0.35 s on PR #314's preview).
    await expect(teamsCounter(page, "1 match")).toBeVisible();
    await expect(page.getByRole("button", { name: new RegExp(team) })).toBeVisible();
    await expectAccessible(page, { label: "Team Management filtered to the new career team" });

    // NEO-574: the created player's career holds the two teams added (the club from the set's
    // year, and the hand-staged one) and NOT the NHL club: a prefill nobody added is never written.
    await page.goto("/admin/players");
    await expectPlayersLoaded(page, 30_000);
    await page.getByRole("textbox", { name: "Filter players" }).fill(playerName);
    await expect(playersCounter(page, PLAYERS_MATCHES)).toBeVisible();
    await page.getByRole("button", { name: playerName }).first().click();
    await expect(page.getByRole("heading", { name: playerName, exact: true })).toBeVisible();
    const career = page.getByRole("list", { name: "Career history" }).getByRole("listitem");
    await expect(career.filter({ hasText: `${team} · 2001–2005` })).toHaveCount(1);
    await expect(career.filter({ hasText: `${CARD_TEAM} · ${SET_YEAR}` })).toHaveCount(1);
    await expect(career.filter({ hasText: OTHER_TEAM })).toHaveCount(0);
    await expect(career).toHaveCount(2);
  },
);
