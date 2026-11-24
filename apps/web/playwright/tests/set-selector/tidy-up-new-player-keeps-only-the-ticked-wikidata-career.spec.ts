// ONE FEATURE (NEO-645, the Tidy Up walk): a NEW player's Wikidata career is the operator's to
// review, before and after the player is made. On the Player tile, "Career teams to add:" lists
// Wikidata's dated teams, each ticked; an unticked one is left off the player at "Add as new
// player". On the Career tile that follows, every Wikidata line says where it stands ("✓ in the
// career", "✓ team in NB", "team not in NB"): "Add stints to <player>" adds the teams NeonBinder
// holds that are not in the career yet (the unticked one), a team NeonBinder lacks offers "+ New
// team <team>" (the inline form; this spec cancels it, the stint-writes spec creates one) or
// "Not now <team>" (writes nothing, the line goes), and a team Wikidata gave without years is
// asked for them ("Add years for <team>"): a backwards range is refused, and years for a team
// NeonBinder holds add the stint at once. Players admin reads the careers back.
//
// Renamed from checklist-wizard-career-team-entry (NEO-645): the entity-review wizard's career
// mini-form on a player row is gone; the walk's Player and Career tiles replace it.
//
// FIXTURE (R7a, SET-REGISTRY.md prefix `tcw`): ONE hand-made set per attempt, `tcw<token>`, under
// the REAL Baseball › 2024 › Topps (Wikidata answers in Baseball from the recording and the
// catalogue's teams resolve the career lines), `Insert` › `Base`, no marketplace id anywhere: a
// pasted two-row checklist is the one source (no Match Cards, no BSC). Both players are real
// people NOT in the catalogue in Baseball (probed 2026-11-22), on no committed checklist, whose
// recorded Wikidata careers are:
//   #1 Adam Walker: Yomiuri Giants 2022-2023 and Fukuoka SoftBank Hawks 2024 (both in the
//      catalogue), Kanagawa Future Dreams 2025, Oisix Niigata Albirex Baseball Club 2026 and
//      Rakuten Monkeys 2026- (none in NeonBinder; each team lookup recorded, so opening the inline
//      New team form sends nothing live); no years for Kansas City Monarchs and Milwaukee Milkmen
//      (their lookups are NOT recorded, so this spec never opens their New team form).
//   #2 Keisuke Honda: Saitama Seibu Lions 2016- (catalogue); no years for Orix Buffaloes
//      (catalogue). A Soccer Keisuke Honda is on file, so NeonBinder may offer him first ("Link to
//      Keisuke Honda (Soccer)"); the spec declines with "Add as new player anyway".
// The walk's card order follows each card's lookups, so the spec answers whichever card is up
// first (both branches assert the same things).
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
  finishTidyWalk,
  pinkTile,
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

/** Wikidata's dated teams for Adam Walker, as the Player tile's checkboxes and the Career tile's lines read them. */
const WALKER_CAREER = [
  { team: "Yomiuri Giants", box: "2022–2023", line: "2022–2023" },
  { team: "Fukuoka SoftBank Hawks", box: "2024–2024", line: "2024" },
  { team: "Kanagawa Future Dreams", box: "2025–2025", line: "2025" },
  { team: "Oisix Niigata Albirex Baseball Club", box: "2026–2026", line: "2026" },
  { team: "Rakuten Monkeys", box: "2026–present", line: "2026–" },
] as const;
const [UNTICKED, KNOWN, NOT_IN_NB, , NOT_NOW] = WALKER_CAREER;
/** A team Wikidata gave Adam Walker with no years (its lookup is not recorded: never opened as a New team form). */
const WALKER_UNDATED = "Kansas City Monarchs";
const HONDA_DATED = { team: "Saitama Seibu Lions", box: "2016–present", line: "2016–" };
/** A team Wikidata gave Keisuke Honda with no years, which the catalogue holds. */
const HONDA_UNDATED = "Orix Buffaloes";

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
  "Tidy Up — a new player's Wikidata career is reviewed on the Player and Career tiles: unticked teams stay off, Add stints adds the known ones, + New team or Not now for a team NeonBinder lacks, Add years for an undated one",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const SET = `tcw${env.ATTEMPT_TOKEN}`;

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── FIXTURE: the hand-made leaf and its two-row checklist; the commit opens the walk ──
    await drillToCustom(page, { sport: "Baseball", year: YEAR, manufacturer: "Topps", set: SET, variantType: "Insert", variant: "Base" });
    // R2 precondition: a fresh per-attempt checklist with no card.
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
    await usePastedChecklist(page, `number,player,team\n1,${WALKER},No Team\n2,${HONDA},No Team\n`, 2);
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
    const wikidataLines = (who: string) =>
      career
        .getByRole("group", { name: `Career ${who}`, exact: true })
        .getByRole("list", { name: `Wikidata career for ${who}` })
        .getByRole("listitem");
    const lineOf = (who: string, team: string, years: string) =>
      wikidataLines(who).filter({ hasText: `${team} · ${years}` });

    // ── Adam Walker: untick one, review every line, Add stints, + New team, Not now ──
    async function walkerCard() {
      await expect(header("1", WALKER)).toBeVisible();
      await expect(pinkTile(page, "Player")).toHaveCount(1);
      // His Wikidata career has loaded (a recorded lookup, but it waits in the deployment-wide
      // enrichment pool behind every other run's lookups: the batch-lookup ceiling, LOOKUPS).
      await expect(careerBoxes(WALKER)).toHaveCount(WALKER_CAREER.length, { timeout: LOOKUPS });
      for (const { team, box: years } of WALKER_CAREER) await expect(box(WALKER, team, years)).toBeChecked();
      await expectAccessible(page, { within: walk, label: "Tidy Up walk, a new player's Wikidata career teams to add" });
      // Untick one: it is left off the player when he is made.
      await box(WALKER, UNTICKED.team, UNTICKED.box).uncheck();
      await expect(box(WALKER, UNTICKED.team, UNTICKED.box)).not.toBeChecked();
      await expect(box(WALKER, KNOWN.team, KNOWN.box)).toBeChecked();
      expect(await createPlayerOnOpenRow(page)).toBe(`Player ${WALKER}`);
      await expect(pinkTile(page, "Player")).toHaveCount(0);

      // The Career tile: blue, one line per dated Wikidata team, each saying where it stands.
      await expect(career).toHaveAccessibleDescription("To check");
      await expect(career.getByText("From Wikidata · new player only", { exact: true })).toBeVisible();
      await expect(career.getByText("Career from Wikidata.", { exact: true })).toBeVisible();
      await expect(wikidataLines(WALKER)).toHaveCount(WALKER_CAREER.length);
      const unticked = lineOf(WALKER, UNTICKED.team, UNTICKED.line);
      await expect(unticked.getByText("✓ team in NB", { exact: true }), "the unticked team was left off him").toBeVisible();
      await expect(lineOf(WALKER, KNOWN.team, KNOWN.line).getByText("✓ in the career", { exact: true })).toBeVisible();
      for (const { team, line } of [NOT_IN_NB, WALKER_CAREER[3], NOT_NOW]) {
        const missing = lineOf(WALKER, team, line);
        await expect(missing.getByText("team not in NB", { exact: true })).toBeVisible();
        await expect(missing.getByRole("button", { name: `+ New team ${team}`, exact: true })).toBeVisible();
        await expect(missing.getByRole("button", { name: `Not now ${team}`, exact: true })).toBeVisible();
      }
      const addStints = career.getByRole("button", { name: `Add stints to ${WALKER}`, exact: true });
      await expect(addStints).toBeVisible();
      // Blue never holds the card.
      await expect(tidyFooterButton(page, "saveAndNext", { usable: true })).toBeVisible();
      await expectAccessible(page, { within: walk, label: "Tidy Up walk, Career tile with a new player's Wikidata career" });

      // "Not now" writes nothing and the line goes.
      await lineOf(WALKER, NOT_NOW.team, NOT_NOW.line).getByRole("button", { name: `Not now ${NOT_NOW.team}`, exact: true }).click();
      await expect(lineOf(WALKER, NOT_NOW.team, NOT_NOW.line)).toHaveCount(0);
      await expect(wikidataLines(WALKER)).toHaveCount(WALKER_CAREER.length - 1);

      // "+ New team" opens the inline form on the line, named for the team; Cancel puts the buttons back.
      const notInNb = lineOf(WALKER, NOT_IN_NB.team, NOT_IN_NB.line);
      const newTeam = notInNb.getByRole("button", { name: `+ New team ${NOT_IN_NB.team}`, exact: true });
      await newTeam.click();
      const form = notInNb.getByRole("group", { name: `New team: ${NOT_IN_NB.team}` });
      await expect(form).toBeVisible();
      await expect(form.getByRole("button", { name: /^Create team .+ and add stint$/ })).toBeVisible();
      await expect(newTeam).toHaveCount(0);
      await expectAccessible(page, { within: walk, label: "Tidy Up walk, Career tile New team form open on a Wikidata line" });
      await form.getByRole("button", { name: "Cancel new team", exact: true }).click();
      await expect(form).toBeHidden();
      await expect(newTeam).toBeVisible();
      await expect(notInNb.getByText("team not in NB", { exact: true })).toBeVisible();

      // "Add stints" adds the team NeonBinder holds that is not in the career yet: the unticked one.
      await addStints.click();
      await expect(unticked.getByText("✓ in the career", { exact: true })).toBeVisible();
      await expect(unticked.getByText("✓ team in NB", { exact: true })).toHaveCount(0);
      await expect(addStints, "nothing NeonBinder holds is left to add").toHaveCount(0);

      // An undated team asks for years; a backwards range is refused and nothing is written.
      await career.getByRole("button", { name: `Add years for ${WALKER_UNDATED}`, exact: true }).click();
      const years = career.getByRole("group", { name: `Years for ${WALKER_UNDATED}`, exact: true });
      await years.getByRole("spinbutton", { name: `From year for ${WALKER_UNDATED}` }).fill("2010");
      await years.getByRole("spinbutton", { name: `To year for ${WALKER_UNDATED} (optional)` }).fill("2005");
      await years.getByRole("button", { name: `Save years for ${WALKER_UNDATED}`, exact: true }).click();
      await expect(career.getByRole("alert").filter({ hasText: "End year can't come before the start year." })).toBeVisible();
      await expect(years).toBeVisible();
      await expectAccessible(page, { within: walk, label: "Tidy Up walk, Career tile years refused for an undated team" });
      await years.getByRole("button", { name: `Cancel years for ${WALKER_UNDATED}`, exact: true }).click();
      await expect(years).toBeHidden();
      await expect(career.getByRole("button", { name: `Add years for ${WALKER_UNDATED}`, exact: true })).toBeVisible();
      await expect(career.getByText("Also on Wikidata, no years yet", { exact: true })).toBeVisible();
    }

    // ── Keisuke Honda: one ticked team, and years for an undated team NeonBinder holds ──
    async function hondaCard() {
      await expect(header("2", HONDA)).toBeVisible();
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

      await expect(lineOf(HONDA, HONDA_DATED.team, HONDA_DATED.line).getByText("✓ in the career", { exact: true })).toBeVisible();
      await expect(wikidataLines(HONDA)).toHaveCount(1);
      // Years for an undated team NeonBinder holds join the career at once.
      const addYears = career.getByRole("button", { name: `Add years for ${HONDA_UNDATED}`, exact: true });
      await addYears.click();
      const years = career.getByRole("group", { name: `Years for ${HONDA_UNDATED}`, exact: true });
      await years.getByRole("spinbutton", { name: `From year for ${HONDA_UNDATED}` }).fill("2014");
      await years.getByRole("spinbutton", { name: `To year for ${HONDA_UNDATED} (optional)` }).fill("2015");
      await years.getByRole("button", { name: `Save years for ${HONDA_UNDATED}`, exact: true }).click();
      await expect(years).toBeHidden();
      await expect(addYears, "the team has its years now").toHaveCount(0);
      await expect(career.getByText("Also on Wikidata, no years yet", { exact: true })).toHaveCount(0);
      await expect(career.getByRole("group", { name: `New team: ${HONDA_UNDATED}` }), "a team NeonBinder holds is never made again").toHaveCount(0);
      await expect(lineOf(HONDA, HONDA_DATED.team, HONDA_DATED.line)).toBeVisible();
      await expectAccessible(page, { within: walk, label: "Tidy Up walk, Career tile after years were added" });
    }

    // Whichever card is up first (the order follows the cards' lookups), then the other.
    await expect(header("1", WALKER).or(header("2", HONDA)).first()).toBeVisible();
    await expectCardSettled(page);
    const walkerFirst = await header("1", WALKER).isVisible();
    const [first, second] = walkerFirst ? [walkerCard, hondaCard] : [hondaCard, walkerCard];
    const [firstHeader, secondHeader] = walkerFirst ? [header("1", WALKER), header("2", HONDA)] : [header("2", HONDA), header("1", WALKER)];
    await first();
    // Save & next with a career gap open adds a stint from the set's year (NEO-656 D14). Both cards
    // are pasted "No Team", but whatever team a fill puts on one could open a gap, so each card is
    // left with Skip (no write): the walk writes no stint beyond the ones this spec adds (the
    // header's "no catalogue row"). There is no "Keep as is" any more (B23).
    await skipCard(page);
    await expect(secondHeader).toBeVisible();
    await expectCardsLeft(page, 1);
    // The browser's Back walks back to the first card, its answers still on it; Forward returns.
    await page.goBack();
    await expect(firstHeader).toBeVisible();
    await expect(secondHeader).toHaveCount(0);
    await expectCardSettled(page);
    await expect(pinkTile(page, "Player")).toHaveCount(0);
    await page.goForward();
    await expect(secondHeader).toBeVisible();
    await expectCardSettled(page);
    await second();
    await skipCard(page);
    await expect(tidyFooterButton(page, "done")).toBeVisible();
    await finishTidyWalk(page);

    // ── READ BACK: each career holds what was added, and nothing that was not ──
    const walker = await openPlayer(page, WALKER);
    await expect(walker.filter({ hasText: `${UNTICKED.team} · ${UNTICKED.line}` })).toHaveCount(1);
    await expect(walker.filter({ hasText: `${KNOWN.team} · ${KNOWN.line}` })).toHaveCount(1);
    await expect(walker.filter({ hasText: NOT_IN_NB.team }), "a team NeonBinder lacks is never guessed into the career").toHaveCount(0);
    await expect(walker.filter({ hasText: NOT_NOW.team })).toHaveCount(0);
    await expect(walker.filter({ hasText: WALKER_UNDATED }), "refused years wrote nothing").toHaveCount(0);
    await expect(walker).toHaveCount(2);
    await expectAccessible(page, { label: "Players admin, a new player's career reviewed on the Career tile" });

    const honda = await openPlayer(page, HONDA);
    await expect(honda.filter({ hasText: `${HONDA_DATED.team} · ${HONDA_DATED.line}` })).toHaveCount(1);
    await expect(honda.filter({ hasText: `${HONDA_UNDATED} · 2014–2015` })).toHaveCount(1);
    await expect(honda).toHaveCount(2);
  },
);
