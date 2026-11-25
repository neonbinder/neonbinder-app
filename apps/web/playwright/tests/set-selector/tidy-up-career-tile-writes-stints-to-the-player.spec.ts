// ONE FEATURE (NEO-645, NEO-656 J6: the Tidy Up walk's Career tile): the Career tile writes stints
// to the PLAYER, and the gap it shows is read live from his career against the card's team and the
// set's year. On a card whose player is in NeonBinder but whose career has no stint for the card's
// team by the set's year, the tile is blue "To check": "Add to career" writes that stint at once and
// the gap is gone; a Team-tile Change to a team the career covers closes the gap with nothing
// written, and so does a swap pill (NEO-672: under the gap team, a list "Swap <gap team> for" with
// one pill per career team whose stints cover the set's year and the year before and that is not
// already on the card, newest first; the gap row says "Or swap the card's team below."); and Save &
// next with the gap still open takes main's default, adding the stint from the set's year (the line
// "Save & next adds it to the career." says so), which clears the gap on EVERY card of his with that
// team, so the walk goes on to the next card that still needs you. There is no "Keep as is" (B23):
// Skip writes nothing and the card stays blue. Players admin reads the career back.
//
// Renamed from checklist-wizard-career-team-commits (NEO-645). NEO-656 (J6) dropped the stored
// career check and the new player's Wikidata review on the Career tile (B24): the inline "+ New
// team" a new player's career offered is gone, so this spec's new-player card went with it (the
// Player tile's ticked career is tidy-up-new-player-keeps-only-the-ticked-wikidata-career). A 2024
// set is before the current year, so the stint written is the one season, "2024"
// (`defaultGapStint`). NEO-672 added card #7 so the swap pill has a card of its own before Skip.
//
// FIXTURE (R7a, SET-REGISTRY.md prefix `tcg`): ONE hand-made set per attempt, `tcg<token>`, under
// the REAL Baseball › 2024 › Topps (the cards' players and teams resolve against Baseball, where the
// catalogue's teams live), `Insert` › `Base`, no marketplace id anywhere: a pasted seven-row
// checklist is the one source (no Match Cards, no BSC).
//   - P = Domingo E. Carrasquel: a real person whose Baseball lookup the enrichment recording holds
//     as a no-match, in no pool of support/recorded-names.ts, on no committed checklist and not in
//     the catalogue (probed 2026-11-22, every sport). Made by hand in Players admin with ONE stint,
//     the catalogue's Seattle Mariners 2020-2024 (read only), BEFORE the sync, so the commit links
//     his seven cards to him (exact name) and the walk reads each card's team against his career:
//       #1 P · Seattle Mariners  covered: no gap, no walk card
//       #2 P · Colorado Rockies  gap -> "Add to career" (writes Colorado Rockies 2024)
//       #3 P · San Diego Padres  gap -> swap pills Rockies, Mariners (newest first); Team-tile
//                                Change to the Mariners (writes no stint)
//       #4 P · Chicago Cubs      gap left open -> Save & next (writes Chicago Cubs 2024)...
//       #5 P · Chicago Cubs      ...which clears this card too: the walk never shows it
//       #6 P · San Diego Padres  gap -> swap pills Rockies, Cubs, Mariners (2024 ties keep career
//                                order); the Cubs pill swaps the card's team (writes no stint)
//       #7 P · San Diego Padres  gap -> Skip (writes nothing; stays blue, "1 needs you")
// FRESH-ONLY: P is a global row with a real name, so a second run on the same seed finds him (his
// admin create demotes to "... anyway"). CI reseeds each pass. Nothing is deleted (R7): the set, its
// cards and P stand; no catalogue row is written (the catalogue teams are only linked to).
// The swap pills' years are the Career chips' (`stintYears`): "2020–2024", one season "2024". No
// card here carries a career team, so the "already on the card, no pill" rule is unit-covered
// (career-swap.test.tsx), not here.
import type { Page } from "@playwright/test";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { usePastedChecklist } from "../../support/published-checklist";
import { addPlayerByHand, expectPlayersLoaded, PLAYERS_MATCHES, playersCounter } from "../../support/players";
import { drillToCustom, escapeRe, syncChecklistButton } from "../../support/set-builder";
import {
  expectCardSettled,
  expectCardsLeft,
  expectTidyEndScreen,
  finishTidyWalk,
  needsYouPill,
  pinkTile,
  saveAndNext,
  settleWalkAfterCommit,
  skipCard,
  tidyFooterButton,
  tidyTile,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";

const YEAR = "2024";
/** P: a recorded Baseball no-match (see the header). */
const P = "Domingo E. Carrasquel";
/** Catalogue teams (read only). */
const COVERED = "Seattle Mariners";
const ADDED = "Colorado Rockies";
const CHANGED = "San Diego Padres";
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
  "Tidy Up — the Career tile writes stints to the player: Add to career, a team change or a Swap for pill to a team the career covers closes a gap, Save & next adds the default stint and clears his other cards, and Skip leaves the gap blue",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env, isMobile }) => {
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

    // ── FIXTURE 2: the hand-made leaf and its seven-row checklist; the commit opens the walk ──
    await drillToCustom(page, { sport: "Baseball", year: YEAR, manufacturer: "Topps", set: SET, variantType: "Insert", variant: "Base" });
    // R2 precondition: a fresh per-attempt checklist with no card.
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
    const checklist =
      `number,player,team\n` +
      `1,${P},${COVERED}\n2,${P},${ADDED}\n3,${P},${CHANGED}\n4,${P},${DEFAULTED}\n5,${P},${DEFAULTED}\n6,${P},${CHANGED}\n` +
      `7,${P},${CHANGED}\n`;
    await usePastedChecklist(page, checklist, 7);
    await syncChecklistButton(page).click();
    // Six career gaps and nothing else: the walk opens once the live career-gap query answers,
    // after the saved line, so the open is awaited (`opens: true`), never read with the line.
    const opened = await settleWalkAfterCommit(page, page.getByText(/Saved 7 cards\./).first(), { opens: true });
    expect(opened, "six career gaps, so the walk opened").toBe(true);
    const walk = tidyWalk(page);
    await expect(walk).toHaveAccessibleName(tidyUpName({ year: YEAR, set: SET }));
    // #2-#7, a live blue gap each. #1's team is in P's career: no card.
    await expectCardsLeft(page, 6);

    const header = (n: string, who: string) => walk.getByText(`#${n} · ${who}`, { exact: true });
    const career = tidyTile(page, "Career");
    const gapRow = career.getByRole("group", { name: `Career ${P}`, exact: true });
    const gapText = (team: string) => gapRow.getByText(`No ${team} in the career by ${YEAR}.`, { exact: true });
    const addToCareer = gapRow.getByRole("button", { name: "Add to career", exact: true });
    // C8: every open gap says what Save & next will do with it.
    const defaultLine = gapRow.getByText("Save & next adds it to the career.", { exact: true });
    // NEO-672: a gap the Team tile offers swap pills for points at them.
    const orSwapLine = gapRow.getByText("Or swap the card's team below.", { exact: true });
    // The career on file is shown beside the question.
    const onFile = gapRow.getByRole("list", { name: `Career on file for ${P}` }).getByRole("listitem");
    // NEO-672: the Team tile's group for the gap team offers the covering career teams as pills,
    // in a list named for the gap team, newest covering stint first.
    const teamTile = tidyTile(page, "Team");
    const gapTeam = teamTile.getByRole("group", { name: `Team ${CHANGED}`, exact: true });
    const swapPills = gapTeam.getByRole("list", { name: `Swap ${CHANGED} for`, exact: true }).getByRole("button");
    const swapName = (team: string, years: string) => `Swap ${CHANGED} for ${team} · ${years}`;
    const swapPill = (team: string, years: string) =>
      gapTeam.getByRole("button", { name: swapName(team, years), exact: true });
    // The pills' names, in order (the visible text has no separator between team and years).
    const expectSwapPills = async (pills: Array<[team: string, years: string]>, why: string) => {
      await expect(swapPills, why).toHaveCount(pills.length);
      for (const [i, [team, years]] of pills.entries()) {
        await expect(swapPills.nth(i), why).toHaveAccessibleName(swapName(team, years));
      }
    };
    // The walk's live region says what a swap did (the sr-only status line beside the footer).
    const swapped = (to: string) =>
      walk.getByRole("status").filter({ hasText: `Swapped ${CHANGED} for ${to}.` });

    // ── STEP 1: #2, the Rockies are not in P's career: a blue line, never pink ──
    await expect(header("2", P)).toBeVisible();
    await expect(walk.getByText(/^#1 · /), "#1's team is in the career, so the walk never shows it").toHaveCount(0);
    await expect(career).toHaveAccessibleDescription("To check");
    await expect(pinkTile(page, "Career")).toHaveCount(0);
    await expect(gapText(ADDED)).toBeVisible();
    await expect(onFile).toHaveText([`${COVERED} · 2020–${YEAR}`]);
    await expect(addToCareer).toBeVisible();
    await expect(defaultLine).toBeVisible();
    await expect(gapRow.getByRole("button", { name: `+ Add stint for ${P}`, exact: true })).toBeVisible();
    // J6/B23: nothing records a look, so there is no "Keep as is".
    await expect(career.getByRole("button", { name: /Keep as is/ })).toHaveCount(0);
    // Blue never holds the card: Save & next is usable.
    await expect(tidyFooterButton(page, "saveAndNext", { usable: true })).toBeVisible();
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, Career tile with a career gap" });

    // "Add to career" writes the stint from the set's year, and the gap is gone at once.
    await addToCareer.click();
    await expect(career, "the gap closed, so the card has no career question left").toHaveCount(0);
    await expect(header("2", P), "a tile answer never moves the walk").toBeVisible();
    await expectCardsLeft(page, 5);
    await saveAndNext(page);

    // ── STEP 2: #3, the Padres: a Team-tile Change to a team his career covers closes the gap ──
    await expect(header("3", P)).toBeVisible();
    await expect(gapText(CHANGED)).toBeVisible();
    // The Rockies stint just written is on file now (one season: a 2024 set is a past year).
    await expect(onFile).toHaveText([`${COVERED} · 2020–${YEAR}`, `${ADDED} · ${YEAR}`]);
    // NEO-672: one pill per career team whose stints cover 2023-2024 (the set's year and the one
    // before), the latest start first: the Rockies (2024) lead the Mariners (2020-2024).
    await expectSwapPills(
      [
        [ADDED, YEAR],
        [COVERED, `2020–${YEAR}`],
      ],
      "exactly his two career teams, newest first",
    );
    await expect(orSwapLine, "the gap row points at the pills").toBeVisible();
    await gapTeam.getByRole("button", { name: `Edit ${CHANGED}`, exact: true }).click();
    const teamSearchBox = teamTile.getByRole("textbox", { name: "Search existing teams" });
    await expect(teamSearchBox).toBeVisible();
    await expect(swapPills, "the pills step aside while Edit's search is open").toHaveCount(0);
    await teamSearchBox.fill("Mariners");
    const mariners = teamTile.getByRole("option", { name: `Link to ${COVERED}`, exact: true });
    await expect(mariners, "one Seattle Mariners to change to").toHaveCount(1);
    await mariners.click();
    await expect(teamTile.getByRole("group", { name: `Team ${COVERED}`, exact: true })).toBeVisible();
    await expect(swapped(COVERED), "the change is announced as a swap").toHaveText(`Swapped ${CHANGED} for ${COVERED}.`);
    await expect(gapTeam).toHaveCount(0);
    await expect(career, "the Mariners are in his career, so the card has no career question").toHaveCount(0);
    await expect(header("3", P), "a tile answer never moves the walk").toBeVisible();
    await expectCardsLeft(page, 4);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, card after a team change closed the career gap" });
    await saveAndNext(page);

    // ── STEP 3: #4, the Cubs: the gap left open, Save & next adds the stint (main's default) ──
    await expect(header("4", P)).toBeVisible();
    await expect(gapText(DEFAULTED)).toBeVisible();
    // The change wrote no stint: the career on file is still the two.
    await expect(onFile).toHaveText([`${COVERED} · 2020–${YEAR}`, `${ADDED} · ${YEAR}`]);
    await expect(defaultLine).toBeVisible();
    // #4, #5 (the Cubs again), #6 and #7 (the Padres).
    await expectCardsLeft(page, 4);
    await saveAndNext(page);

    // ── STEP 4: the stint cleared #5 as well, so the walk goes on to #6, where a Swap for pill closes the gap ──
    await expect(header("6", P), "Save & next skipped #5: the Cubs stint covers it now").toBeVisible();
    await expect(header("5", P)).toHaveCount(0);
    // #6 and #7.
    await expectCardsLeft(page, 2);
    await expect(gapText(CHANGED)).toBeVisible();
    await expect(career).toHaveAccessibleDescription("To check");
    await expect(onFile).toHaveCount(3);
    await expect(onFile.filter({ hasText: `${DEFAULTED} · ${YEAR}` }), "Save & next wrote the Cubs").toHaveCount(1);
    // Back returns to the card before (the walk never showed #5), its gap gone; Forward returns.
    await page.goBack();
    await expect(header("4", P), "Back returned to the card before").toBeVisible();
    await expect(header("6", P)).toHaveCount(0);
    await expectCardSettled(page);
    await expect(career, "the Cubs are in the career now, so #4 has no career question").toHaveCount(0);
    await page.goForward();
    await expect(header("6", P)).toBeVisible();
    await expectCardSettled(page);
    await expect(gapText(CHANGED)).toBeVisible();

    // NEO-672: the Padres gap now offers all three career teams, the Cubs just written among them;
    // the two 2024 starts keep career order (Rockies, then Cubs) ahead of the Mariners.
    await expectSwapPills(
      [
        [ADDED, YEAR],
        [DEFAULTED, YEAR],
        [COVERED, `2020–${YEAR}`],
      ],
      "exactly his three career teams, newest first",
    );
    if (isMobile) {
      // The longest pill wraps inside a phone's width: scrolled to, it is wholly on screen.
      const longest = swapPill(COVERED, `2020–${YEAR}`);
      await longest.scrollIntoViewIfNeeded();
      await expect(longest, "the pill is not clipped at 412px").toBeInViewport({ ratio: 1 });
    }
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, Team tile offering career swaps for a gap team" });
    // The Cubs pill swaps the card's team: the gap closes, and nothing is written to the player
    // (#7's Career tile below still shows the three stints on file; READ BACK proves it too).
    await swapPill(DEFAULTED, YEAR).click();
    // The visible half of the confirmation, in the tile for about 6 s (aria-hidden: the walk's
    // status below is the spoken half), so it is read straight after the click.
    await expect(
      teamTile.getByText(`Swapped ${CHANGED} for ${DEFAULTED}.`, { exact: true }),
      "the swap is shown in the Team tile",
    ).toBeVisible();
    await expect(teamTile.getByRole("group", { name: `Team ${DEFAULTED}`, exact: true })).toBeVisible();
    await expect(swapped(DEFAULTED), "the pill's swap is announced").toHaveText(`Swapped ${CHANGED} for ${DEFAULTED}.`);
    await expect(gapTeam).toHaveCount(0);
    await expect(career, "the Cubs are in his career, so the card has no career question").toHaveCount(0);
    await expect(header("6", P), "a tile answer never moves the walk").toBeVisible();
    await expectCardsLeft(page, 1);
    await saveAndNext(page);

    // ── STEP 5: #7, the Padres again: Skip writes nothing; the gap stays blue ──
    await expect(header("7", P)).toBeVisible();
    await expect(gapText(CHANGED)).toBeVisible();
    await expect(career).toHaveAccessibleDescription("To check");
    // The swap on #6 wrote no stint: the career on file is still the three.
    await expect(onFile).toHaveText([`${COVERED} · 2020–${YEAR}`, `${ADDED} · ${YEAR}`, `${DEFAULTED} · ${YEAR}`]);
    await skipCard(page);
    // #2, #3, #4 and #6 fixed; #7 still blue.
    await expectTidyEndScreen(page, { fixed: 4, stillToCheck: 1 });
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, end screen with a card still to check" });
    await finishTidyWalk(page);
    // The checklist marks #7 blue, and nothing else.
    const marks = page.getByRole("img", { name: /^Card [0-9]+(, .*)? (needs attention|is worth a check): / });
    await expect(
      page.getByRole("img", { name: /^Card 7(, .*)? is worth a check: team is missing from the player's career$/ }),
    ).toBeVisible();
    await expect(marks).toHaveCount(1);
    await expect(needsYouPill(page)).toHaveText("1 needs you");

    // ── READ BACK: P's career holds the added and defaulted stints, and nothing for the Padres ──
    const pCareer = await openPlayer(page, P);
    await expect(pCareer.filter({ hasText: `${COVERED} · 2020–${YEAR}` })).toHaveCount(1);
    await expect(pCareer.filter({ hasText: `${ADDED} · ${YEAR}` }), "Add to career wrote the Rockies").toHaveCount(1);
    await expect(pCareer.filter({ hasText: `${DEFAULTED} · ${YEAR}` }), "Save & next wrote the Cubs once").toHaveCount(1);
    await expect(pCareer.filter({ hasText: CHANGED }), "the team change, the swap and Skip wrote nothing").toHaveCount(0);
    await expect(pCareer).toHaveCount(3);
    await expectAccessible(page, { label: "Players admin, a career written on the Career tile" });
  },
);
