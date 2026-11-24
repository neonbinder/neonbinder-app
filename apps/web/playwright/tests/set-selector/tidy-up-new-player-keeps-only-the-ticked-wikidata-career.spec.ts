// ONE FEATURE (NEO-645, NEO-656 J6: the Tidy Up walk): a NEW player is made with the Wikidata
// career the operator ticked, and that career, as written, is what the Career tile checks. On the
// Player tile, "Career teams to add:" lists Wikidata's dated teams, each ticked; "Add as new player"
// writes the ticked teams NeonBinder holds as his stints, leaves an unticked one off, and never
// invents a team NeonBinder lacks. The Career tile then reads his new career against the card's
// team and the set's year, live: a card whose team was unticked is blue "To check" (the gap), a card
// whose team was ticked has no Career tile. Skip writes nothing, so the gap stays blue (there is no
// "Keep as is", B23). Players admin reads the careers back.
//
// Renamed from tidy-up-career-tile-reviews-a-new-players-wikidata-career (NEO-656): J6/B24 retired
// the Career tile's review of a new player's Wikidata career: its lines, Add stints, the inline
// `+ New team`, `Not now`, and `Add years` with its refusal of a backwards range. None of that UI
// remains in components/SetSelector/tidy. The career is now picked once, at player creation (the
// Player tile's ticked teams), and the Career tile computes its gaps live from that career like any
// other. Before that, renamed from checklist-wizard-career-team-entry (NEO-645).
//
// FIXTURE (R7a, SET-REGISTRY.md prefix `tcw`): ONE hand-made set per attempt, `tcw<token>`, under
// the REAL Baseball › 2024 › Topps (Wikidata answers in Baseball from the recording and the
// catalogue's teams resolve the career), `Insert` › `Base`, no marketplace id anywhere: a pasted
// two-row checklist is the one source (no Match Cards, no BSC). Both players are real people NOT in
// the catalogue in Baseball (probed 2026-11-22), on no committed checklist, whose recorded Wikidata
// careers are:
//   #1 Adam Walker · Fukuoka SoftBank Hawks: Yomiuri Giants 2022-2023 and Fukuoka SoftBank Hawks
//      2024 (both in the catalogue), Kanagawa Future Dreams 2025, Oisix Niigata Albirex Baseball
//      Club 2026 and Rakuten Monkeys 2026- (none in NeonBinder). The spec unticks the Hawks, the
//      card's own team, so the card is blue once he is made.
//   #2 Keisuke Honda · Saitama Seibu Lions: Saitama Seibu Lions 2016- (catalogue), ticked, so the
//      card has no Career tile. A Soccer Keisuke Honda is on file, so NeonBinder may offer him first
//      ("Link to Keisuke Honda (Soccer)"); the spec declines with "Add as new player anyway".
// FRESH-ONLY: both players are global rows with real names, so a second run on the same seed links
// to them. CI reseeds each pass. Nothing is deleted (R7): the set, its cards and both players stand;
// no team is created and no catalogue row is written.
import type { Page } from "@playwright/test";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { usePastedChecklist } from "../../support/published-checklist";
import { expectPlayersLoaded, PLAYERS_MATCHES, playersCounter } from "../../support/players";
import { drillToCustom, escapeRe, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import {
  createPlayerOnOpenRow,
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
import { LOOKUPS } from "../../support/recorded-names";

const YEAR = "2024";
const WALKER = "Adam Walker";
const HONDA = "Keisuke Honda";

/** Wikidata's dated teams for Adam Walker, as the Player tile's checkboxes read them. */
const WALKER_CAREER = [
  { team: "Yomiuri Giants", box: "2022–2023" },
  { team: "Fukuoka SoftBank Hawks", box: "2024–2024" },
  { team: "Kanagawa Future Dreams", box: "2025–2025" },
  { team: "Oisix Niigata Albirex Baseball Club", box: "2026–2026" },
  { team: "Rakuten Monkeys", box: "2026–present" },
] as const;
const [KEPT, UNTICKED, ...NOT_IN_NB] = WALKER_CAREER;
const HONDA_DATED = { team: "Saitama Seibu Lions", box: "2016–present" };

/** Players admin, one Baseball player's detail open; returns his career lines. */
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
  "Tidy Up — a new player keeps only the Wikidata career teams ticked on the Player tile, and the Career tile checks the card against that career",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const SET = `tcw${env.ATTEMPT_TOKEN}`;

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── FIXTURE: the hand-made leaf and its two-row checklist; the commit opens the walk ──
    await drillToCustom(page, { sport: "Baseball", year: YEAR, manufacturer: "Topps", set: SET, variantType: "Insert", variant: "Base" });
    // R2 precondition: a fresh per-attempt checklist with no card.
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
    await usePastedChecklist(page, `number,player,team\n1,${WALKER},${UNTICKED.team}\n2,${HONDA},${HONDA_DATED.team}\n`, 2);
    await syncChecklistButton(page).click();
    const opened = await settleWalkAfterCommit(page, page.getByText(/Saved 2 cards\./).first());
    expect(opened, "two names to answer, so the walk opened").toBe(true);
    const walk = tidyWalk(page);
    await expect(walk).toHaveAccessibleName(tidyUpName({ year: YEAR, set: SET }));
    await expectCardsLeft(page, 2);

    const header = (n: string, who: string) => walk.getByText(`#${n} · ${who}`, { exact: true });
    const career = tidyTile(page, "Career");
    const careerBoxes = (who: string) =>
      tidyTile(page, "Player")
        .getByRole("group", { name: `Player ${who}`, exact: true })
        .getByRole("group", { name: "Career teams to add:" })
        .getByRole("checkbox");
    const box = (who: string, team: string, years: string) =>
      careerBoxes(who).and(page.getByRole("checkbox", { name: `Include career team ${team} (${years})`, exact: true }));
    const gapRow = (who: string) => career.getByRole("group", { name: `Career ${who}`, exact: true });
    const onFile = (who: string) => gapRow(who).getByRole("list", { name: `Career on file for ${who}` }).getByRole("listitem");

    // ── #1 Adam Walker: untick the card's own team, make him; the Career tile checks what was written ──
    // NEO-656 B4: the walk's order is the card number; the name lookups run when a card opens.
    await expect(header("1", WALKER)).toBeVisible();
    await expectCardSettled(page);
    await expect(pinkTile(page, "Player")).toHaveCount(1);
    // No player on the card yet, so there is no career to check.
    await expect(career).toHaveCount(0);
    // His Wikidata career has loaded (a recorded lookup, but it waits in the deployment-wide
    // enrichment pool behind every other run's lookups: the batch-lookup ceiling, LOOKUPS).
    await expect(careerBoxes(WALKER)).toHaveCount(WALKER_CAREER.length, { timeout: LOOKUPS });
    for (const { team, box: years } of WALKER_CAREER) await expect(box(WALKER, team, years)).toBeChecked();
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, a new player's Wikidata career teams to add" });
    // Untick the Hawks: they are left off the player when he is made.
    await box(WALKER, UNTICKED.team, UNTICKED.box).uncheck();
    await expect(box(WALKER, UNTICKED.team, UNTICKED.box)).not.toBeChecked();
    await expect(box(WALKER, KEPT.team, KEPT.box)).toBeChecked();
    expect(await createPlayerOnOpenRow(page)).toBe(`Player ${WALKER}`);
    await expect(pinkTile(page, "Player")).toHaveCount(0);

    // The Career tile reads his career as written: the Giants (ticked, in NeonBinder) and nothing
    // else, so the card's Hawks are a blue gap.
    await expect(career).toHaveAccessibleDescription("To check");
    await expect(pinkTile(page, "Career")).toHaveCount(0);
    await expect(gapRow(WALKER).getByText(`No ${UNTICKED.team} in the career by ${YEAR}.`, { exact: true })).toBeVisible();
    await expect(onFile(WALKER), "the ticked team NeonBinder holds, and only it").toHaveText([`${KEPT.team} · ${KEPT.box}`]);
    // J6/B24: no Wikidata review on the Career tile any more, and no "Keep as is" (B23).
    await expect(career.getByText("Career from Wikidata.", { exact: true })).toHaveCount(0);
    await expect(career.getByRole("list", { name: `Wikidata career for ${WALKER}` })).toHaveCount(0);
    await expect(career.getByRole("button", { name: /Keep as is/ })).toHaveCount(0);
    // Blue never holds the card.
    await expect(tidyFooterButton(page, "saveAndNext", { usable: true })).toBeVisible();
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, Career tile checking a new player's career" });

    // Skip writes nothing: the gap stays.
    await skipCard(page);
    await expect(header("2", HONDA)).toBeVisible();
    await expectCardsLeft(page, 1);
    // The browser's Back walks back to #1, still blue (Skip wrote no stint); Forward returns.
    await page.goBack();
    await expect(header("1", WALKER)).toBeVisible();
    await expect(header("2", HONDA)).toHaveCount(0);
    await expectCardSettled(page);
    await expect(pinkTile(page, "Player")).toHaveCount(0);
    await expect(career).toHaveAccessibleDescription("To check");
    await expect(gapRow(WALKER).getByText(`No ${UNTICKED.team} in the career by ${YEAR}.`, { exact: true })).toBeVisible();
    await page.goForward();
    await expect(header("2", HONDA)).toBeVisible();
    await expectCardSettled(page);

    // ── #2 Keisuke Honda: his one dated team, ticked, is the card's team: no Career tile ──
    await expect(pinkTile(page, "Player")).toHaveCount(1);
    const row = tidyTile(page, "Player").getByRole("group", { name: `Player ${HONDA}`, exact: true });
    // Settled: his lookup has answered (LOOKUPS, as above). Its answer either shows his career
    // teams to add, or first offers the Soccer Keisuke Honda (NEO-424), which the spec declines.
    const anyway = row.getByRole("button", { name: "Add as new player anyway", exact: true });
    await expect(careerBoxes(HONDA).or(anyway).first()).toBeVisible({ timeout: LOOKUPS });
    if (await anyway.isVisible()) {
      await expect(row.getByRole("button", { name: `Link to ${HONDA} (Soccer)`, exact: true })).toBeVisible();
      await anyway.click();
      await expect(anyway).toHaveCount(0);
    }
    await expect(careerBoxes(HONDA)).toHaveCount(1);
    await expect(box(HONDA, HONDA_DATED.team, HONDA_DATED.box)).toBeChecked();
    expect(await createPlayerOnOpenRow(page)).toBe(`Player ${HONDA}`);
    await expect(pinkTile(page, "Player")).toHaveCount(0);
    // His card is clear: the Team tile still shows the card's team, and no career question.
    await expect(tidyTile(page, "Team").getByRole("group", { name: `Team ${HONDA_DATED.team}`, exact: true })).toBeVisible();
    await expect(career, "the Lions are in the career he was made with").toHaveCount(0);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, a new player whose career covers the card" });
    await saveAndNext(page);

    // ── END: Honda's card fixed, Walker's still to check ──
    await expectTidyEndScreen(page, { fixed: 1, stillToCheck: 1 });
    await finishTidyWalk(page);
    const marks = page.getByRole("img", { name: /^Card [0-9]+(, .*)? (needs attention|is worth a check): / });
    await expect(
      page.getByRole("img", { name: /^Card 1(, .*)? is worth a check: team is missing from the player's career$/ }),
    ).toBeVisible();
    await expect(marks).toHaveCount(1);
    await expect(needsYouPill(page)).toHaveText("1 needs you");

    // ── READ BACK: each career holds the ticked teams NeonBinder holds, and nothing else ──
    const walker = await openPlayer(page, WALKER);
    await expect(walker.filter({ hasText: `${KEPT.team} · ${KEPT.box}` })).toHaveCount(1);
    await expect(walker.filter({ hasText: UNTICKED.team }), "the unticked team was left off him").toHaveCount(0);
    for (const { team } of NOT_IN_NB) {
      await expect(walker.filter({ hasText: team }), "a team NeonBinder lacks is never guessed into the career").toHaveCount(0);
    }
    await expect(walker).toHaveCount(1);
    await expectAccessible(page, { label: "Players admin, a new player's career from the ticked Wikidata teams" });

    const honda = await openPlayer(page, HONDA);
    await expect(honda.filter({ hasText: `${HONDA_DATED.team} · 2016–` })).toHaveCount(1);
    await expect(honda).toHaveCount(1);
  },
);
