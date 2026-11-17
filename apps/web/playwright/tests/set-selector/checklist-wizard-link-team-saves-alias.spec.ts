// Origin: .maestro/flows/set-selector/checklist-wizard-link-team-saves-alias.yaml (Maestro suite retired in NEO-341; see git history)
//
// ONE FEATURE (NEO-284): linking a checklist TEAM row to an existing team in
// the entity-review wizard remembers the row's raw spelling as one of that
// team's aliases (default on), the commit writes it, and Team Management lists
// it. Also covered, as the flow does: a New Team name that is another team's
// alias is refused (NEO-307).
//
// NEO-307's past-era claims (a card resolving a club whose era ended before the
// set's year, or the operator's link of one) moved out in NEO-330 to
// checklist-wizard-past-era-team-link-commits: this set's clubs are absent
// from the reference catalogue, so it has neither shape (Jason, 2026-10-10).
//
// Sole writer of the 1996 New Haven Ravens Rally Raffle set (BSC only, filed
// under the year's Unknown row and reached through the All Brands view;
// SET-REGISTRY.md); fresh-only (it mints the fixture team and commits the
// set). Re-seed before re-running. NEO-475: it replaced the 300-card 1996 Line
// Up Venezuelan Winter League (200 new players + 8 new clubs) with a 9-card
// set (one an NNO raffle entry card). Chosen by a read-only probe with
// SportLots PAUSED (BSC only, 2026-11-09): ONE unknown club, the row under
// test, and two unknown players (Edgard Velazquez, Rodney Pedraza); the
// catalogue holds no "New Haven Ravens". The recording answers the club's
// lookup with no match, so its New Team step opens with the whole name in
// "New team name" (no location to split off), which the NEO-307 check reads.
// The wizard counts and the time to settle are NOT yet measured on the UI.
//
// THE RAFFLE CARD SAYS "No Team" (NEO-489, Jason 2026-11-11). Its row in the uploaded
// checklist reads `No Team`, the publisher's claim that the card has none, so the card is
// ANSWERED: it is never asked of BSC, never a line on the wizard's "Cards with no team"
// step, and it saves as a confirmed no-team card that no attention badge flags. The step
// after the names is therefore not "Cards with no team" (the other eight cards name the
// club the walk links), and the spec checks that and the saved card. The count line,
// "Teams from your checklist: N of M", takes its N from the file (9: the claim counts).
//
// THE ROW UNDER TEST IS NAMED, not "whichever comes first": the walk reads
// each team/league step's heading, acts on the checklist club "New Haven
// Ravens" and skips every other step (a skip creates nothing, R7).
//
// NEO-574 RIDES THIS FIXTURE: the "Career check" step. It needs a real set that commits (a
// hand-made set never reaches the commit path) and a player of the spec's own, so it uses this
// sole writer's set, its per-worker career-editor player (P, below) and its per-attempt club.
//   - P gets ONE dated stint, on the fixture club, 1994-1996 (PART 1).
//   - The upload adds three rows BSC has no card for, each P's (#901 on the fixture club, #902 on
//     the Colorado Rockies, #903 on the Florida Marlins); Match Cards keeps all three, so they are
//     cards only the checklist names. Two catalogue teams, read only: no row of theirs is written.
//   - The step lists #902 and #903 ("No Rockies in the career by 1996.") and NOT #901, whose
//     team P's stint covers. The catalogue's players on the linked club are listed too: the
//     club is minted per attempt, so no catalogue career holds it.
//   - Answers: #902 "Add to career" with the prefilled year and a typed end year (read back in
//     Players admin; a To year before From holds Next first, and the answer survives Back);
//     #903 "Keep as is" (P's career has no Marlins); Jamey Wright's line (#21) "Wrong player"
//     -> P, and Todd Helton's (#22) "Fix card's team" -> the Marlins (he never played there, so
//     the nested "Career for Todd Helton" prompt comes up), each read back on the saved card.
//     A catalogue player's career is never written: "Wrong player" puts P on the card, and
//     Helton's prompt stays on "Keep as is".
// Fresh-only like the rest of the spec (committed cards are never checked again).
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { editCardButton } from "../../support/cards";
import { CHECKLISTS } from "../../support/published-checklist";
import { expectPlayersLoaded, expectTeamsLoaded, PLAYERS_MATCHES, playersCounter, teamsCounter } from "../../support/players";
import { recordedNoMatchPlayer } from "../../support/recorded-names";
import {
  advanceToSave,
  careerLine,
  confirmSaveButton,
  expectStepLeft,
  fetchOneMarketplaceSetChecklistToWizard,
  nextStepButton,
  readStep,
  reviewWizard,
  stepCounter,
} from "../../support/wizard";
import type { Locator, Page } from "@playwright/test";

const SET = "New Haven Ravens Rally Raffle";
const ROW = "New Haven Ravens";
/** NEO-574: the set's year, what a career line is read against. */
const SET_YEAR = "1996";
/** NEO-574: two catalogue clubs for the checklist-only cards (read only). */
const ROCKIES = "Colorado Rockies";
const MARLINS = "Florida Marlins";

/** The admin Team Management page, filtered to `query`. */
async function openTeams(page: Page, query: string) {
  await page.goto("/admin/teams");
  // A mid-flow reload, the flow's 30 s.
  await expectTeamsLoaded(page, 30_000);
  await page.getByRole("textbox", { name: "Filter teams" }).fill(query);
  await expect(teamsCounter(page, "1 match")).toBeVisible();
}

test(
  "Entity review — linking a checklist TEAM to an existing team remembers the checklist's spelling as one of that team's names",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const FIXTURE_TEAM = `Loc${T} Ali${T}`;

    await signIn("/admin/players");
    await expectPlayersLoaded(page, LAUNCH_GATE);

    // ── PART 1: the fixture teams, created through a player's career editor ──
    await page.getByRole("textbox", { name: "Filter players" }).fill("zzzznotaplayer");
    await expect(page.getByText("No players match that filter.")).toBeVisible();
    const sport = page.getByRole("combobox", { name: "Sport" });
    await sport.selectOption("Baseball");
    await expect(sport.getByRole("option", { selected: true })).toHaveText("Baseball");
    await expect(page.getByText("0 matches", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Add player" }).click();
    // The career editor's player: a REAL person whose Baseball lookup the
    // enrichment recording holds as a no-match (support/recorded-names.ts), so
    // the add makes no live Wikidata call and the row stays bare. The pool is
    // the retired Venezuelan set's roster, none of whom is on this checklist;
    // the walk skips every player row either way.
    const scaffold = recordedNoMatchPlayer(env, "checklist-wizard-link-team-saves-alias");
    await page.getByRole("textbox", { name: "New player name" }).fill(scaffold);
    await page.getByRole("button", { name: `Create player ${scaffold}` }).click();
    await expect(page.getByRole("heading", { name: scaffold, exact: true })).toBeVisible();
    await expect(page.getByText(`Added ${scaffold}`)).toBeVisible();
    await expect(page.getByText("No stints recorded yet.")).toBeVisible();
    await expectAccessible(page, { label: "Player detail, new player with no stints" });

    const addTeam = page.getByRole("button", { name: "Add team" });
    const teamSearch = page.getByRole("textbox", { name: "Search teams" });

    // The fixture team: Location + Name, no league.
    await addTeam.click();
    await teamSearch.fill(`Ali${T}`);
    await expect(page.getByText("No matches.")).toBeVisible();
    await teamSearch.press("Enter");
    const newAli = page.getByRole("dialog", { name: `New team: Ali${T}` });
    await expect(newAli).toBeVisible();
    await newAli.getByRole("textbox", { name: "New team location (optional)" }).fill(`Loc${T}`);
    // The alias holder for the NEO-307 refusal below: inert, no checklist carries it.
    await newAli.getByRole("textbox", { name: "New team aliases (optional)" }).fill(`Pca${T}`);
    await expectAccessible(page, { within: newAli, label: "New team dialog, location and name" });
    // The Create button's name is the composed full name: Location then Name.
    await newAli.getByRole("button", { name: `Create team ${FIXTURE_TEAM}` }).click();
    await expect(page.getByRole("button", { name: `Remove team ${FIXTURE_TEAM}` })).toBeVisible();

    // NEO-574: P's one dated stint, on the fixture club, covering the set's year.
    await page.getByLabel(/Stint from year/).fill("1994");
    await page.getByLabel(/Stint to year/).fill(SET_YEAR);
    await page.getByRole("button", { name: "Add stint" }).click();
    await expect(page.getByRole("link", { name: new RegExp(`${FIXTURE_TEAM} · 1994.${SET_YEAR}`) })).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(`Saved ${scaffold}`)).toBeVisible();

    // ── PART 2: the set; decline SportLots (it does not carry this set), fetch BSC only ──
    await fetchOneMarketplaceSetChecklistToWizard(page, env, {
      sport: "Baseball",
      year: SET_YEAR,
      set: SET,
      checklist: CHECKLISTS.newHavenRavens,
      // NEO-574: P's three checklist-only cards, kept in Match Cards.
      extraRows: [
        { number: "901", player: scaffold, team: FIXTURE_TEAM },
        { number: "902", player: scaffold, team: ROCKIES },
        { number: "903", player: scaffold, team: MARLINS },
      ],
    });
    const wizard = reviewWizard(page);

    // ── PART 3: walk the team and league steps, acting on one club by name ──
    // NEO-335's counter: on a name step x is the decided count plus one, so
    // nothing decided is "Step 1 of N" (a full match: not "Step 11 of ...").
    await expect(stepCounter(page)).toHaveText(/^Step 1 of [0-9]+$/);
    // Wait the batch's lookups out so every step the walk reads is settled and
    // nothing that settles later out-ranks the row under test (leagues before
    // teams before players). Marketplace-class wait: one lookup per unknown
    // name through the deployment-wide pool (the flow's 180 s, set when the
    // fixture was the 300-card Venezuelan set: ~144 s live for 211 rows). The
    // NEO-289 recording answers this batch's lookups (three names here, plus
    // any career teams they stage), so this stays the live-lane ceiling until
    // a CI run measures the recorded one; NEO-475 left the number alone.
    await expect(wizard.getByText(/still looking up/)).toBeHidden({ timeout: 180_000 });

    const teamSkip = wizard.getByRole("button", { name: /^Skip .* — not a team$/ });
    const leagueSkip = wizard.getByRole("button", { name: /^Skip .* — this team has no league$/ });
    const personSkip = wizard.getByRole("button", { name: /^Skip .* — not a person$/ });
    const stepHeading = wizard.getByRole("heading", { name: /^New (Team|League): / });

    // A player row coming up is the product saying there are no more team steps.
    let aliasDone = false;
    for (let i = 0; i < 20; i++) {
      const anyStepSkip = teamSkip.or(leagueSkip);
      await expect(personSkip.or(anyStepSkip)).toBeVisible();
      if (await personSkip.isVisible()) break;
      const heading = ((await stepHeading.textContent()) ?? "").trim();
      if (heading !== `New Team: ${ROW}`) {
        // Another club, a league or a staged career team: skip (creates nothing).
        // THE SKIP NAMES THE ROW IT READ (NEO-335): the heading and the click are
        // separate reads, so a click aimed at "whatever skip is up" could land on
        // the NEXT row after the previous skip finished landing, and that could be
        // the row under test, skipped unseen. The control is built from the heading
        // just read; if the row moved on in between it matches nothing, and the
        // loop comes round and reads the new heading. A league's control ends
        // "— this team has no league", a team's "— not a team".
        const stepName = heading.replace(/^New (Team|League): /, "");
        const skipThis = wizard.getByRole("button", {
          name: new RegExp(`^Skip ${stepName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} . (not a team|this team has no league)$`),
        });
        if ((await skipThis.count()) === 0) continue;
        const skipName = (await skipThis.getAttribute("aria-label")) ?? "";
        await skipThis.click();
        await expect(wizard.getByRole("button", { name: skipName, exact: true })).toBeHidden();
        continue;
      }

        // ── PART 4: link, with the remember-box on ──
      const linkSection = wizard.getByRole("group", { name: "Link to existing team" });
      const searchAll = linkSection.getByRole("combobox", { name: "Search all teams" });
      await expect(searchAll).toBeVisible();
      // Opens EMPTY (NEO-326): no pre-fill with the row's name.
      await expect(searchAll).toHaveValue("");
      await expect(searchAll).toHaveAttribute("placeholder", "Type a team name");
      const remember = linkSection.getByRole("checkbox", {
        name: `Remember “${ROW}” as a name for this team`,
      });
      await expect(remember).toBeVisible();
      // Default on. (Maestro cannot read a checkbox; it proves this through the
      // "remembered as" read-back below, which is asserted too.)
      await expect(remember).toBeChecked();
      await expectAccessible(page, { within: wizard, label: "Entity review wizard, team step with the link section" });

      // NEO-307: a New Team name that is another team's alias is refused.
      const teamName = wizard.getByRole("textbox", { name: "New team name" });
      await expect(teamName).toHaveValue(ROW);
      await teamName.fill(`Pca${T}`);
      await expect(
        wizard
          .getByText(
            `${FIXTURE_TEAM} already answers to this name as an alias — remove it there before a team can take the name.`,
          )
          .first(),
      ).toBeVisible();
      await expect(wizard.getByRole("button", { name: `Link to ${FIXTURE_TEAM}` })).toBeVisible();
      const { x: stepBefore } = await readStep(page);
      await expect(wizard.getByRole("button", { name: "Add as New Team" })).toBeDisabled();
      await expect(wizard.getByRole("heading", { name: `New Team: ${ROW}` })).toBeVisible();
      await expectAccessible(page, { within: wizard, label: "Entity review wizard, new team name refused as an alias" });

      // Link through the search: the typed token finds the fixture by name.
      await searchAll.fill(`Ali${T}`);
      await expect(searchAll).toHaveValue(`Ali${T}`);
      // Still undecided: the refused create recorded nothing.
      await expect(stepCounter(page)).toHaveText(new RegExp(`^Step ${stepBefore} of [0-9]+$`));
      await page.getByRole("option", { name: new RegExp(`^${FIXTURE_TEAM}`) }).click();
      await expect(wizard.getByRole("heading", { name: `New Team: ${ROW}` })).toBeHidden();

      // Read the decision back: "· remembered as" exists only for a team link
      // whose remember-box was on.
      await wizard.getByRole("button", { name: "Back to previous decision" }).click();
      const decision = wizard.getByRole("group", { name: `Decision for ${ROW}` });
      await expect(decision).toBeVisible();
      await expect(decision).toContainText(`Linked to ${FIXTURE_TEAM} · remembered as “${ROW}”`);
      await expectAccessible(page, { within: wizard, label: "Entity review wizard, decided team link" });
      await decision.getByRole("button", { name: "Next" }).click();
      aliasDone = true;
    }
    await expect(personSkip).toBeVisible();
    expect(aliasDone, `the "${ROW}" team step must be presented`).toBe(true);

    await wizard.getByRole("button", { name: /Skip remaining names \([0-9]+\)/ }).click();
    // THE RAFFLE CARD IS NEVER ASKED (NEO-489). Skipping the rest of the names lands on the
    // first screen after them, which is where "Cards with no team" would be: the eight cards
    // name the club the walk linked and the raffle card's row says "No Team", so no card is
    // teamless and the wizard is on a later step or already on Save. The footer's forward
    // control is the positive the hidden title is read against.
    await expect(nextStepButton(page).or(confirmSaveButton(page))).toBeVisible();

    // ── PART 5a (NEO-574): the Career check ──
    // The step after the names. Next is held while the careers are read; the lines are the
    // positive that the read landed (a line names its player and team: "<player> on <team>").
    const careerHeading = wizard.getByRole("heading", { level: 3, name: /^Career check/ });
    const lineRockies = careerLine(page, scaffold, ROCKIES);
    const lineMarlins = careerLine(page, scaffold, MARLINS);
    const lineWright = careerLine(page, "Jamey Wright", FIXTURE_TEAM);
    const lineHelton = careerLine(page, "Todd Helton", FIXTURE_TEAM);
    await expect(careerHeading).toBeVisible();
    await expect(lineRockies).toBeVisible();
    // Six catalogue players on the linked club (all six on its eight BSC cards that resolve: the
    // other two names are unknown and skipped) and P's two uncovered cards (measured NEO-574).
    await expect(careerHeading).toHaveText("Career check · 8 to look at");
    await expect(lineMarlins).toBeVisible();
    await expect(lineWright).toBeVisible();
    await expect(lineHelton).toBeVisible();
    // #901 is P on the club his stint covers: no line for it.
    await expect(careerLine(page, scaffold, FIXTURE_TEAM)).toHaveCount(0);
    await expect(wizard.getByText(/#901\b/)).toHaveCount(0);
    // A line's list item, found by the line's group. The inner locator of `has` is matched INSIDE
    // the item, so it is the bare group (`page.getByRole`), not the wizard-rooted `careerLine`.
    const itemOf = (player: string, team: string) =>
      wizard.getByRole("listitem").filter({ has: page.getByRole("radiogroup", { name: `${player} on ${team}`, exact: true }) });
    await expect(itemOf(scaffold, ROCKIES).getByText(`No Rockies in the career by ${SET_YEAR}.`, { exact: true })).toBeVisible();
    await expect(itemOf(scaffold, ROCKIES).getByText("Cards #902", { exact: true })).toBeVisible();
    await expect(itemOf(scaffold, MARLINS).getByText(`No Marlins in the career by ${SET_YEAR}.`, { exact: true })).toBeVisible();
    // Every line opens on "Keep as is", so one Next would pass the screen writing nothing. Each
    // answer is on screen at phone width too (e2e-mobile, 412 px): scrolled to, in the viewport.
    for (const line of [lineRockies, lineMarlins, lineWright, lineHelton]) {
      await expect(line.getByRole("radio", { name: "Keep as is" })).toBeChecked();
      for (const answer of ["Keep as is", "Add to career", "Wrong player", /^Fix card.s team$/]) {
        const radio = line.getByRole("radio", { name: answer });
        await radio.scrollIntoViewIfNeeded();
        await expect(radio).toBeInViewport();
      }
    }
    await expectAccessible(page, { within: wizard, label: "Entity review wizard, Career check" });

    // #902: "Add to career", the team and the set's year already in; an end year typed.
    await lineRockies.getByRole("radio", { name: "Add to career" }).click();
    await expect(lineRockies.getByRole("radio", { name: "Add to career" })).toBeChecked();
    await expect(wizard.getByRole("spinbutton", { name: `From year for ${scaffold}, ${ROCKIES}` })).toHaveValue(SET_YEAR);
    const toRockies = wizard.getByRole("spinbutton", { name: `To year (optional) for ${scaffold}, ${ROCKIES}` });
    await expect(toRockies).toHaveValue("");
    // Years that are not a stint hold Next. A press on the held Next (Enter on it, as the checklist
    // step's spec presses its own) is refused: the footer says why and focus goes back to the years.
    await toRockies.fill("1990");
    await expect(nextStepButton(page)).toBeDisabled();
    await nextStepButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(wizard.getByText("Fix the years first — then Next.", { exact: true })).toBeVisible();
    await expect(careerHeading).toBeVisible();
    await expect(wizard.getByRole("spinbutton", { name: `From year for ${scaffold}, ${ROCKIES}` })).toBeFocused();
    await expectAccessible(page, { within: wizard, label: "Entity review wizard, Career check, Next held by the years" });
    await toRockies.fill("1997");
    await expect(nextStepButton(page)).toBeEnabled();
    // The answer and its years survive Back out of the step and the way in again.
    await wizard.getByRole("button", { name: "Back to previous step" }).click();
    await expect(careerHeading).toBeHidden();
    await wizard.getByRole("button", { name: /^Next( \(Enter\))?$/ }).first().click();
    await expect(careerHeading).toBeVisible();
    await expect(lineRockies.getByRole("radio", { name: "Add to career" })).toBeChecked();
    await expect(wizard.getByRole("spinbutton", { name: `From year for ${scaffold}, ${ROCKIES}` })).toHaveValue(SET_YEAR);
    await expect(toRockies).toHaveValue("1997");

    // #21: "Wrong player" -> P, through "Someone else…". P's stint covers the club: said, no ask.
    await lineWright.getByRole("radio", { name: /^Wrong player$/ }).click();
    await wizard.getByRole("button", { name: "Someone else for Jamey Wright" }).click();
    const playerSearch = wizard.getByRole("textbox", { name: "Search existing players" });
    await expect(playerSearch).toBeVisible();
    await expectAccessible(page, { within: wizard, label: "Entity review wizard, Career check, player search open" });
    await playerSearch.fill(scaffold);
    await wizard.getByRole("option", { name: `Link to ${scaffold}` }).click();
    await expect(itemOf("Jamey Wright", FIXTURE_TEAM).getByText(`${scaffold} played for the Ali${T}.`, { exact: true })).toBeVisible();

    // #22: "Fix card's team" -> the Marlins, a club Todd Helton never played for, so the re-check
    // asks again about HIS career (the nested prompt). His career is not this spec's to write: the
    // prompt stays on "Keep as is".
    await lineHelton.getByRole("radio", { name: /^Fix card.s team$/ }).click();
    await wizard.getByRole("button", { name: "Pick a team for Todd Helton" }).click();
    const careerTeamSearch = wizard.getByRole("textbox", { name: "Search existing teams" });
    await expect(careerTeamSearch).toBeVisible();
    await expectAccessible(page, { within: wizard, label: "Entity review wizard, Career check, team search open" });
    await careerTeamSearch.fill(MARLINS);
    await wizard.getByRole("option", { name: `Link to ${MARLINS}` }).click();
    await expect(wizard.getByRole("button", { name: "Pick another team for Todd Helton" })).toBeVisible();
    await expect(
      itemOf("Todd Helton", FIXTURE_TEAM).getByText(`No Marlins in Todd Helton’s career by ${SET_YEAR} either.`, { exact: true }),
    ).toBeVisible();
    const heltonFollowUp = wizard.getByRole("radiogroup", { name: "Career for Todd Helton" });
    await expect(heltonFollowUp.getByRole("radio", { name: "Keep as is" })).toBeChecked();
    await expect(heltonFollowUp.getByRole("radio", { name: "Add to career" })).not.toBeChecked();
    await expectAccessible(page, { within: wizard, label: "Entity review wizard, Career check, follow-up for a re-teamed card" });
    // #903 stays on "Keep as is".
    await expect(lineMarlins.getByRole("radio", { name: "Keep as is" })).toBeChecked();
    await expectAccessible(page, { within: wizard, label: "Entity review wizard, Career check answered" });

    const { x: careerStep } = await readStep(page);
    await nextStepButton(page).click();
    await expectStepLeft(page, careerStep);
    await expect(wizard.getByText(/^(Card titles|Autographed cards|Ready to save)$/)).toBeVisible();
    await expect(wizard.getByText("Cards with no team", { exact: true })).toBeHidden();
    // The teams / titles steps stay on their defaults; this spec's feature is the alias.
    await advanceToSave(page);
    const confirmSave = wizard.getByRole("button", { name: /Confirm & Save/ });
    await expect(confirmSave).toBeVisible();
    await confirmSave.click();
    await expect(page.getByText(/Saved [0-9]+ cards/)).toBeVisible();

    // ── PART 5b: the raffle card saved as a card with no team, and nothing flags it (NEO-489) ──
    // The committed list is up (its edit control is the positive), and no card of the set is
    // badged "no team on this card yet" nor counted under the header's "N need you".
    await expect(editCardButton(page, "NNO")).toBeVisible();
    await expect(page.getByRole("img", { name: /needs attention: no team on this card yet$/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^([0-9]+ need you|1 needs you)$/ })).toHaveCount(0);
    // Its drawer shows the team picker (Add team) with no team chip: a stored no-team card.
    await editCardButton(page, "NNO").click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("button", { name: "Add team", exact: true })).toBeVisible();
    await expect(drawer.getByRole("button", { name: /^Remove team / })).toHaveCount(0);
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(drawer).toBeHidden();

    // ── PART 5c (NEO-574): the career answers, read back where they landed ──
    // "Wrong player": #21 is P's card now, not Jamey Wright's.
    await editCardButton(page, "21").click();
    await expect(drawer.getByRole("button", { name: `Remove player ${scaffold}`, exact: true })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Remove player Jamey Wright", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(drawer).toBeHidden();
    // "Fix card's team": #22 is on the Marlins now, not the linked club.
    await editCardButton(page, "22").click();
    await expect(drawer.getByRole("button", { name: `Remove team ${MARLINS}`, exact: true })).toBeVisible();
    await expect(drawer.getByRole("button", { name: `Remove team ${FIXTURE_TEAM}`, exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(drawer).toBeHidden();
    // P's career: the stint he came with, the one "Add to career" added (the prefilled year and the
    // typed end), and no Marlins ("Keep as is" wrote nothing).
    await page.goto("/admin/players");
    await expectPlayersLoaded(page, 30_000);
    await page.getByRole("textbox", { name: "Filter players" }).fill(scaffold);
    await expect(playersCounter(page, PLAYERS_MATCHES)).toBeVisible();
    await page.getByRole("button", { name: scaffold }).first().click();
    await expect(page.getByRole("heading", { name: scaffold, exact: true })).toBeVisible();
    const career = page.getByRole("list", { name: "Career history" }).getByRole("listitem");
    await expect(career.filter({ hasText: `${FIXTURE_TEAM} · 1994–${SET_YEAR}` })).toHaveCount(1);
    await expect(career.filter({ hasText: `${ROCKIES} · ${SET_YEAR}–1997` })).toHaveCount(1);
    await expect(career.filter({ hasText: MARLINS })).toHaveCount(0);
    await expect(career).toHaveCount(2);

    // ── PART 6: Team Management shows the alias ──
    await openTeams(page, `Ali${T}`);
    await page.getByRole("button", { name: new RegExp(`Ali${T}`) }).click();
    const aka = page.getByRole("textbox", { name: "Also known as" });
    const currentAliases = page.getByRole("list", { name: "Current aliases" });
    // The box holds every alias: the fixture team's own `Pca<token>` (PART 1)
    // and the checklist spelling the link remembered.
    await expect(aka).toHaveValue(`Pca${T}, ${ROW}`);
    await expect(currentAliases).toBeVisible();
    await expect(currentAliases.getByText(ROW, { exact: true })).toBeVisible();
    await expectAccessible(page, { label: "Team Management, team detail with its remembered alias" });

    // ── PART 7: take it back out, and prove the removal persisted ──
    await aka.clear();
    await expect(currentAliases).toBeHidden();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(`Saved ${FIXTURE_TEAM}`)).toBeVisible();

    await openTeams(page, `Ali${T}`);
    await page.getByRole("button", { name: new RegExp(`Ali${T}`) }).click();
    await expect(aka).toHaveValue("");
    await expect(page.getByPlaceholder("LSU, Louisiana State, LSU Tigers baseball")).toBeVisible();
    await expect(currentAliases).toBeHidden();
  },
);
