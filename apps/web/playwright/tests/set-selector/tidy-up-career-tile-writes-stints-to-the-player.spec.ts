// ONE FEATURE (NEO-645, the Tidy Up walk's Career tile): the Career tile writes stints to the
// PLAYER. On a card whose player is already in NeonBinder but whose career has no stint for the
// card's team by the set's year (the blue career gap, NEO-574's career check on the walk), "Add to
// career" writes that stint at once and the gap is gone; "Keep as is" acts at once (no pressed
// state), closes the question and writes nothing; and Save & next with the gap still open takes
// main's default, adding the stint from the set's year (C8, the line "Save & next adds it to the
// career." says so beside every open gap). On a card
// whose player was just made from his Wikidata career, a career team NeonBinder lacks is created
// inline ("+ New team <team>", then "Create team <team> and add stint") and joins his career with
// Wikidata's years. Players admin and Team Management read every write back.
//
// Renamed from checklist-wizard-career-team-commits (NEO-645): the entry-review wizard's staged
// career teams and its "Career check" step are gone; the walk asks the same questions per card,
// on the Career tile. This spec also carries the NEO-574 career-check coverage the team-link spec
// (tidy-up-team-link-remembers-the-name) dropped: a gap line per uncovered card, a covered card
// with no line, Add to career, Keep as is and the Save & next default, read back in Players admin.
// A 2024 set is before the current year, so the stint written is the one season, "2024"
// (`defaultGapStint`).
//
// FIXTURE (R7a, SET-REGISTRY.md prefix `tcg`): ONE hand-made set per attempt, `tcg<token>`, under
// the REAL Baseball › 2024 › Topps (the cards' players and teams resolve against Baseball, where the
// catalogue's teams live and Wikidata answers from the recording), `Insert` › `Base`, no marketplace
// id anywhere: a pasted five-row checklist is the one source (no Match Cards, no BSC).
//   - P = Domingo E. Carrasquel: a real person whose Baseball lookup the enrichment recording holds
//     as a no-match (`result: null`, 1996 Line Up Venezuelan Winter League, retired fixture) and who
//     is in no pool of support/recorded-names.ts, on no committed checklist and not in the
//     catalogue (probed 2026-11-22, every sport). Made by hand in Players admin with ONE stint, the
//     catalogue's Seattle Mariners 2020-2024 (read only), BEFORE the sync, so the commit links his
//     four cards to him (exact name) and checks each card's team against his career:
//       #1 P · Seattle Mariners  covered: no gap, no walk card (only the purple "Linked for you")
//       #2 P · Colorado Rockies  gap -> "Add to career" (writes Colorado Rockies 2024)
//       #3 P · San Diego Padres  gap -> "Keep as is" (writes nothing, the card needs no one)
//       #4 P · Chicago Cubs      gap left open -> Save & next (writes Chicago Cubs 2024)
//   - #5 Roberto Espinoza · No Team: a real person NOT in the catalogue (probed, every sport) whose
//     recorded Wikidata career is EDA Rhinos 2015-2016 (a club NeonBinder lacks; its team lookup is
//     recorded too, so the inline form's lookup sends nothing live) and Tigres de Aragua with no
//     years (left alone here; the Wikidata-career spec owns "Add years").
// FRESH-ONLY: P, Roberto Espinoza and the EDA Rhinos team are global rows with real names, so a
// second run on the same seed finds them (P's admin create demotes to "... anyway"). CI reseeds each
// pass. Nothing is deleted (R7): the set, its cards, both players and the team stand; no catalogue
// row is written (the catalogue teams are only linked to).
import type { Page } from "@playwright/test";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { usePastedChecklist } from "../../support/published-checklist";
import { addPlayerByHand, expectPlayersLoaded, expectTeamsLoaded, PLAYERS_MATCHES, playersCounter } from "../../support/players";
import { drillToCustom, escapeRe, syncChecklistButton } from "../../support/set-builder";
import {
  createPlayerOnOpenRow,
  expectCardSettled,
  expectCardsLeft,
  finishTidyWalk,
  pinkTile,
  saveAndNext,
  settleWalkAfterCommit,
  tidyFooterButton,
  tidyTile,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";
import { LOOKUPS } from "../../support/recorded-names";

const YEAR = "2024";
/** P: a recorded Baseball no-match (see the header). */
const P = "Domingo E. Carrasquel";
/** The new player whose Wikidata career names a club NeonBinder lacks. */
const NEW_PLAYER = "Roberto Espinoza";
const MISSING_TEAM = "EDA Rhinos";
const MISSING_YEARS = "2015–2016";
/** Catalogue teams (read only). */
const COVERED = "Seattle Mariners";
const ADDED = "Colorado Rockies";
const KEPT = "San Diego Padres";
const DEFAULTED = "Chicago Cubs";

/** Players admin, one Baseball player's detail open. */
async function openPlayer(page: Page, name: string) {
  await page.goto("/admin/players");
  // A mid-flow reload, the flow's 30 s.
  await expectPlayersLoaded(page, 30_000);
  await page.getByRole("textbox", { name: "Filter players" }).fill(name);
  await expect(playersCounter(page, PLAYERS_MATCHES)).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`^${escapeRe(name)} Baseball\\b`) }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  return page.getByRole("list", { name: "Career history" }).getByRole("listitem");
}

test(
  "Tidy Up — the Career tile writes stints to the player: Add to career closes a career gap, Keep as is writes nothing, and a new player's missing Wikidata team is created inline with its stint",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const SET = `tcg${env.ATTEMPT_TOKEN}`;

    // ── FIXTURE 1: P, with one stint that covers card #1's team ──
    await signIn("/admin/players");
    await expectPlayersLoaded(page, LAUNCH_GATE);
    await addPlayerByHand(page, P, "Baseball");
    await page.getByRole("button", { name: "Add team" }).click();
    const teamSearch = page.getByRole("textbox", { name: "Search teams" });
    await teamSearch.fill(COVERED);
    await page
      .getByRole("listbox", { name: "Team typeahead results" })
      .getByRole("option", { name: new RegExp(`^Add ${COVERED}`) })
      .first()
      .click();
    await expect(page.getByRole("button", { name: `Remove team ${COVERED}` })).toBeVisible();
    await page.getByLabel(/Stint from year/).fill("2020");
    await page.getByLabel(/Stint to year/).fill(YEAR);
    await page.getByRole("button", { name: "Add stint" }).click();
    await expect(page.getByRole("link", { name: new RegExp(`${COVERED} · 2020.${YEAR}`) })).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(`Saved ${P}`)).toBeVisible();

    // ── FIXTURE 2: the hand-made leaf and its five-row checklist; the commit opens the walk ──
    await drillToCustom(page, { sport: "Baseball", year: YEAR, manufacturer: "Topps", set: SET, variantType: "Insert", variant: "Base" });
    // R2 precondition: a fresh per-attempt checklist with no card.
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
    const checklist =
      `number,player,team\n` +
      `1,${P},${COVERED}\n2,${P},${ADDED}\n3,${P},${KEPT}\n4,${P},${DEFAULTED}\n5,${NEW_PLAYER},No Team\n`;
    await usePastedChecklist(page, checklist, 5);
    await syncChecklistButton(page).click();
    const opened = await settleWalkAfterCommit(page, page.getByText(/Saved 5 cards\./).first());
    expect(opened, "three career gaps and a new name, so the walk opened").toBe(true);
    const walk = tidyWalk(page);
    await expect(walk).toHaveAccessibleName(tidyUpName({ year: YEAR, set: SET }));
    // #2, #3 and #4 (a blue gap each) and #5 (a pink name). #1's team is in P's career: no card.
    await expectCardsLeft(page, 4);

    const header = (n: string, who: string) => walk.getByText(`#${n} · ${who}`, { exact: true });
    const career = tidyTile(page, "Career");
    const gapRow = career.getByRole("group", { name: `Career ${P}`, exact: true });
    const addToCareer = gapRow.getByRole("button", { name: "Add to career", exact: true });
    const keepAsIs = gapRow.getByRole("button", { name: "Keep as is", exact: true });
    // C8: every open gap says what Save & next will do with it.
    const defaultLine = gapRow.getByText("Save & next adds it to the career.", { exact: true });

    // ── STEP 1: #2, the Rockies are not in P's career: a blue line, never pink ──
    await expect(header("2", P)).toBeVisible();
    await expect(walk.getByText(/^#1 · /), "#1's team is in the career, so the walk never shows it").toHaveCount(0);
    await expect(career).toHaveAccessibleDescription("To check");
    await expect(pinkTile(page, "Career")).toHaveCount(0);
    await expect(gapRow.getByText(`No ${ADDED} in the career by ${YEAR}.`, { exact: true })).toBeVisible();
    // The career on file is shown beside the question.
    const onFile = gapRow.getByRole("list", { name: `Career on file for ${P}` }).getByRole("listitem");
    await expect(onFile).toHaveText([`${COVERED} · 2020–${YEAR}`]);
    await expect(addToCareer).toBeVisible();
    await expect(keepAsIs).toBeVisible();
    await expect(defaultLine).toBeVisible();
    await expect(gapRow.getByRole("button", { name: `+ Add stint for ${P}`, exact: true })).toBeVisible();
    // Blue never holds the card: Save & next is usable.
    await expect(tidyFooterButton(page, "saveAndNext", { usable: true })).toBeVisible();
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, Career tile with a career gap" });

    // "Add to career" writes the stint from the set's year, and the gap is gone at once.
    await addToCareer.click();
    await expect(career, "the gap closed, so the card has no career question left").toHaveCount(0);
    await expect(header("2", P), "a tile answer never moves the walk").toBeVisible();
    await expectCardsLeft(page, 3);
    await saveAndNext(page);

    // ── STEP 2: #3, the Padres: "Keep as is" acts at once (no pressed state) and writes nothing ──
    await expect(header("3", P)).toBeVisible();
    const keptGap = gapRow.getByText(`No ${KEPT} in the career by ${YEAR}.`, { exact: true });
    await expect(keptGap).toBeVisible();
    // The Rockies stint just written is on file now (one season: a 2024 set is a past year).
    await expect(onFile).toHaveText([`${COVERED} · 2020–${YEAR}`, `${ADDED} · ${YEAR}`]);
    await keepAsIs.click();
    // Kept at once: the question is gone and the card needs no one; the walk stays on it.
    await expect(keptGap, "Keep as is closed the question").toHaveCount(0);
    await expect(career, "nothing else on the card asks about the career").toHaveCount(0);
    await expect(header("3", P), "a tile answer never moves the walk").toBeVisible();
    await expectCardsLeft(page, 2);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, card after Keep as is" });
    await saveAndNext(page);

    // ── STEP 3: #4, the Cubs: the gap left open, Save & next adds the stint (main's default) ──
    await expect(header("4", P)).toBeVisible();
    await expect(gapRow.getByText(`No ${DEFAULTED} in the career by ${YEAR}.`, { exact: true })).toBeVisible();
    // Keep as is wrote nothing: the career on file is still the two stints.
    await expect(onFile).toHaveText([`${COVERED} · 2020–${YEAR}`, `${ADDED} · ${YEAR}`]);
    await expect(defaultLine).toBeVisible();
    await expectCardsLeft(page, 2);
    await saveAndNext(page);

    // ── STEP 4: #5, the new player, and Back/Forward through the walk ──
    await expect(header("5", NEW_PLAYER)).toBeVisible();
    await expectCardsLeft(page, 1);
    await page.goBack();
    await expect(header("4", P), "Back returned to the card before").toBeVisible();
    await expect(header("5", NEW_PLAYER)).toHaveCount(0);
    await expectCardSettled(page);
    // The Save & next default wrote the Cubs stint: the gap is closed on the card passed.
    await expect(career, "the Cubs are in the career now, so #4 has no career question").toHaveCount(0);
    await page.goForward();
    await expect(header("5", NEW_PLAYER)).toBeVisible();
    await expectCardSettled(page);

    const playerRow = tidyTile(page, "Player").getByRole("group", { name: `Player ${NEW_PLAYER}`, exact: true });
    await expect(pinkTile(page, "Player")).toHaveCount(1);
    // His Wikidata career has loaded (a recorded lookup, but it waits in the deployment-wide
    // enrichment pool behind every other run's lookups: the batch-lookup ceiling, LOOKUPS).
    await expect(
      playerRow.getByRole("group", { name: "Career teams to add:" }).getByRole("checkbox", { name: `Include career team ${MISSING_TEAM} (${MISSING_YEARS})` }),
    ).toBeChecked({ timeout: LOOKUPS });
    expect(await createPlayerOnOpenRow(page)).toBe(`Player ${NEW_PLAYER}`);
    await expect(pinkTile(page, "Player")).toHaveCount(0);

    // The new player's career is a blue Career tile; the club NeonBinder lacks waits on the operator.
    const freshRow = career.getByRole("group", { name: `Career ${NEW_PLAYER}`, exact: true });
    await expect(career).toHaveAccessibleDescription("To check");
    await expect(freshRow.getByText("Career from Wikidata.", { exact: true })).toBeVisible();
    const line = freshRow
      .getByRole("list", { name: `Wikidata career for ${NEW_PLAYER}` })
      .getByRole("listitem")
      .filter({ hasText: `${MISSING_TEAM} · ${MISSING_YEARS}` });
    await expect(line.getByText("team not in NB", { exact: true })).toBeVisible();
    const newTeam = line.getByRole("button", { name: `+ New team ${MISSING_TEAM}`, exact: true });
    await newTeam.click();
    const form = line.getByRole("group", { name: `New team: ${MISSING_TEAM}` });
    await expect(form).toBeVisible();
    await expect(newTeam, "the form stands in for the line's buttons").toHaveCount(0);
    // The team's own lookup (recorded) answers before the create is pressed, so its details ride along.
    await expect(form.getByText("Checking for team details…")).toHaveCount(0);
    const create = form.getByRole("button", { name: `Create team ${MISSING_TEAM} and add stint`, exact: true, disabled: false });
    await expect(create).toBeVisible();
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, Career tile New team form for a Wikidata career team" });
    await create.click();
    // The team is made and the stint joins his career with Wikidata's years.
    await expect(form).toBeHidden();
    await expect(line.getByText("✓ in the career", { exact: true })).toBeVisible();
    await expect(line.getByText("team not in NB", { exact: true })).toHaveCount(0);
    await expect(line.getByRole("button", { name: `Not now ${MISSING_TEAM}` })).toHaveCount(0);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, Career tile with the new team in the career" });

    // Save & next marks his career seen; nothing is left.
    await saveAndNext(page);
    await expect(tidyFooterButton(page, "done")).toBeVisible();
    await finishTidyWalk(page);

    // ── READ BACK: P's career holds the added and defaulted stints and not the kept one ──
    const pCareer = await openPlayer(page, P);
    await expect(pCareer.filter({ hasText: `${COVERED} · 2020–${YEAR}` })).toHaveCount(1);
    await expect(pCareer.filter({ hasText: `${ADDED} · ${YEAR}` }), "Add to career wrote the Rockies").toHaveCount(1);
    await expect(pCareer.filter({ hasText: `${DEFAULTED} · ${YEAR}` }), "Save & next wrote the Cubs").toHaveCount(1);
    await expect(pCareer.filter({ hasText: KEPT }), "Keep as is wrote nothing").toHaveCount(0);
    await expect(pCareer).toHaveCount(3);

    // ...the new player's career holds the new club with Wikidata's years...
    const freshCareer = await openPlayer(page, NEW_PLAYER);
    await expect(freshCareer.filter({ hasText: `${MISSING_TEAM} · ${MISSING_YEARS}` })).toHaveCount(1);
    await expect(freshCareer).toHaveCount(1);
    await expectAccessible(page, { label: "Players admin, a career with a team made on the Career tile" });

    // ...and the club is a real team row.
    await page.goto("/admin/teams");
    await expectTeamsLoaded(page, 30_000);
    await page.getByRole("textbox", { name: "Filter teams" }).fill(MISSING_TEAM);
    await expect(page.getByRole("button", { name: new RegExp(`^${escapeRe(MISSING_TEAM)}\\b`) })).toBeVisible();
  },
);
