// ONE FEATURE (R1, NEO-490 with NEO-574's year rule, on the NEO-645 Tidy Up walk): a printed
// player name that two players on file share is linked with no stop when exactly one of them
// has a stint on the card's printed team that began by the card's year. The card never asks
// "Which <name> is this?": the commit links that player, and the other namesake gets no card.
//
// Restores the coverage the same-name spec dropped (its old STEPS 6-8 needed a second fetch of
// a real set, and a fetch now saves the set before the walk opens).
//
// The rule (convex/players.ts `narrowSameNamePlayersByCardYear`, rule 6b), and why this fixture
// reaches it and nothing earlier:
//   - the set is 2020. NEAR has a stint at the printed team, 2010-2012; FAR has one at the same
//     team, 2024-2025. Both are outside 2020 +-2, so neither survives the year narrowing (rules
//     3-5 pick nobody), and neither is in the Hall of Fame (rule 6 picks nobody);
//   - 6b: both have a career on file, and only NEAR's stint at the card's team BEGAN by 2020. FAR's
//     began after the card was printed (NEO-574), so it does not count. Without the year rule both
//     would count, the exactly-one guard would fail, and the card would ask: STEP 1 fails by name.
// Card #2 prints a name nobody has, so the walk opens (the positive that it runs at all) and
// shows only that card.
//
// FIXTURE (SET-REGISTRY.md "Custom sets", the `crl`/`crs` prefixes; R7a): a per-attempt sport
// `crl<token>` › 2020 › Topps › `crs<token>` › Insert › Base, all hand-made with no marketplace id,
// so the Sync is checklist-only (a pasted two-row checklist, no Match Cards, no BSC) and nothing is
// looked up (a hand-made sport has no Wikidata mapping). The team `Crt<token>` is made in the
// career editor's New Team dialog; the two `Cal Crl<token>` players (b. 1990 and b. 1991, so the
// second is a fork, not an adoption) are made in Player Management. Not fresh-only: every name is
// per attempt. Nothing is deleted.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { emptyListAndPickSport, expectPlayersLoaded, PLAYERS_MATCHES, playersCounter } from "../../support/players";
import { usePastedChecklist } from "../../support/published-checklist";
import { drillToCustom, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import { escapeRe } from "../../support/cards";
import {
  expectCardsLeft,
  needsYouPill,
  pinkTile,
  saveForLater,
  settleWalkAfterCommit,
  tidyTile,
  tidyWalk,
} from "../../support/tidy-walk";
import { tidyUpName } from "../../support/wizard";
import type { Page } from "@playwright/test";

const YEAR = "2020";

/**
 * On /admin/players (loaded): add `name` under `sport` with a birth year, and give him one stint
 * at `team`. `newTeam` makes the team in the career editor's New Team dialog; otherwise the team
 * on file is picked. Contract: EXIT his detail panel shows the saved stint.
 */
async function addPlayerWithStint(
  page: Page,
  { name, sport, birthYear, team, newTeam, from, to }: {
    name: string;
    sport: string;
    birthYear: string;
    team: string;
    newTeam: boolean;
    from: string;
    to: string;
  },
): Promise<void> {
  await emptyListAndPickSport(page, sport);
  await page.getByRole("button", { name: "Add player" }).click();
  await expect(page.getByRole("heading", { name: "Add a player" })).toBeVisible();
  await page.getByRole("textbox", { name: "New player name" }).fill(name);
  await page.getByRole("spinbutton", { name: /^Birth year \(optional\)/ }).fill(birthYear);
  // The second namesake is the demoted "anyway" create (the first is on file, and his birth year
  // differs, so the server forks); the first is the plain one.
  await page.getByRole("button", { name: new RegExp(`^Create player ${escapeRe(name)}( anyway)?$`) }).click();
  await expect(page.getByText(`Added ${name}`)).toBeVisible();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.getByText("No stints recorded yet.")).toBeVisible();

  await page.getByRole("button", { name: "Add team" }).click();
  const search = page.getByRole("textbox", { name: "Search teams" });
  await search.fill(team);
  if (newTeam) {
    await expect(page.getByText("No matches.")).toBeVisible();
    await search.press("Enter");
    const dialog = page.getByRole("dialog", { name: `New team: ${team}` });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: `Create team ${team}` }).click();
    await expect(dialog).toBeHidden();
  } else {
    await page
      .getByRole("listbox", { name: "Team typeahead results" })
      .getByRole("option", { name: new RegExp(`^Add ${escapeRe(team)}`) })
      .click();
  }
  await expect(page.getByRole("button", { name: `Remove team ${team}` })).toBeVisible();
  await page.getByLabel(/Stint from year/).fill(from);
  await page.getByLabel(/Stint to year/).fill(to);
  await page.getByRole("button", { name: "Add stint" }).click();
  await expect(page.getByRole("link", { name: `${team} · ${from}–${to}` })).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(`Saved ${name}`)).toBeVisible();
}

test(
  "Tidy Up — a name two players share links with no stop to the one whose stint on the printed team began by the card's year",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const SPORT = `crl${T}`;
    const SET = `crs${T}`;
    const TEAM = `Crt${T}`;
    const NAME = `Cal Crl${T}`;
    const OTHER = `Oth Crl${T}`;
    const NEAR = { birthYear: "1990", from: "2010", to: "2012" };
    const FAR = { birthYear: "1991", from: "2024", to: "2025" };

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── FIXTURE: the hand-made leaf, empty ──
    await drillToCustom(page, { sport: SPORT, year: YEAR, manufacturer: "Topps", set: SET, variantType: "Insert", variant: "Base" });
    const empty = page.getByText("No cards in this checklist yet.");
    await expect(empty).toBeVisible();

    // ── FIXTURE: two players named NAME in the sport, each with a stint at TEAM ──
    await page.getByRole("link", { name: "Players", exact: true }).click();
    await expectPlayersLoaded(page);
    await addPlayerWithStint(page, { name: NAME, sport: SPORT, team: TEAM, newTeam: true, ...NEAR });
    await addPlayerWithStint(page, { name: NAME, sport: SPORT, team: TEAM, newTeam: false, ...FAR });
    // Both are on file under the one name (the filter matches any token, so the rows are pinned
    // by their birth years, not counted).
    await page.getByRole("textbox", { name: "Filter players" }).fill(NAME);
    await expect(playersCounter(page, PLAYERS_MATCHES)).toBeVisible();
    const nearRow = page.getByRole("button", { name: new RegExp(`^${escapeRe(NAME)} .*b\\. ${NEAR.birthYear}`) });
    const farRow = page.getByRole("button", { name: new RegExp(`^${escapeRe(NAME)} .*b\\. ${FAR.birthYear}`) });
    await expect(nearRow).toBeVisible();
    await expect(farRow).toBeVisible();

    // ── The checklist: #1 prints the shared name at TEAM; #2 a name nobody has ──
    await page.goBack();
    await expect(setBuilderReady(page)).toBeVisible();
    await expect(empty).toBeVisible();
    await usePastedChecklist(page, `number,player,team\n1,${NAME},${TEAM}\n2,${OTHER},No Team\n`, 2);
    await syncChecklistButton(page).click();
    const opened = await settleWalkAfterCommit(page, page.getByText(/Saved 2 cards\./).first());
    expect(opened, "card #2's unknown name opens the walk").toBe(true);
    const walk = tidyWalk(page);
    await expect(walk).toHaveAccessibleName(tidyUpName({ year: YEAR, set: SET }));

    // ── STEP 1: the walk holds only #2; the shared name made no stop ──
    // Positive: the walk is on #2, asking about its unknown name.
    await expect(walk.getByText(`#2 · ${OTHER}`, { exact: true })).toBeVisible();
    await expect(tidyTile(page, "Player").getByRole("group", { name: `Player ${OTHER}`, exact: true })).toBeVisible();
    await expect(pinkTile(page, "Player")).toHaveCount(1);
    // Negative, read against it: one card is left (#2), so #1 is not in the walk at all, and
    // nothing on screen asks which NAME it is.
    await expectCardsLeft(page, 1);
    await expect(walk.getByText(new RegExp(`^#1 · `))).toHaveCount(0);
    await expect(walk.getByText(`Which ${NAME} is this?`)).toHaveCount(0);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, a shared name linked by career team" });

    // The checklist agrees: one card needs a person.
    await saveForLater(page);
    await expect(needsYouPill(page)).toHaveAccessibleName("1 needs you");

    // ── STEP 2: the card is on NEAR's card list, and FAR has none ──
    await page.getByRole("link", { name: "Players", exact: true }).click();
    await expectPlayersLoaded(page);
    await page.getByRole("textbox", { name: "Filter players" }).fill(NAME);
    await expect(playersCounter(page, PLAYERS_MATCHES)).toBeVisible();
    await nearRow.click();
    await expect(page.getByRole("link", { name: `${TEAM} · ${NEAR.from}–${NEAR.to}` }), "NEAR's detail is open").toBeVisible();
    const nearCards = page.getByRole("list", { name: `Cards for ${NAME}` }).getByRole("listitem");
    await expect(nearCards).toHaveCount(1);
    await expect(nearCards).toContainText("#1");
    await expect(nearCards).toContainText(SET);

    await farRow.click();
    // Positive: FAR's own detail is open (his stint, his empty card list).
    await expect(page.getByRole("link", { name: `${TEAM} · ${FAR.from}–${FAR.to}` }), "FAR's detail is open").toBeVisible();
    await expect(page.getByText(`No cards link to ${NAME} yet. Link them from a set's checklist.`)).toBeVisible();
    // Negative: no card list, so the card went to NEAR alone.
    await expect(page.getByRole("list", { name: `Cards for ${NAME}` })).toHaveCount(0);
  },
);
