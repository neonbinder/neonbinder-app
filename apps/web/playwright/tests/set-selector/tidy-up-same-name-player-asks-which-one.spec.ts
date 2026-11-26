// ONE FEATURE (R1, NEO-332 on the NEO-645 Tidy Up walk): a printed player name that two players
// on file share never offers a plain "Add as new player". The card's Player row asks "Which
// <name> is this?" and lists both under "Players already filed under this name", each told apart
// in its accessible name. "Add as new player anyway" opens the plain create without writing
// anything (leaving the card and coming back brings the list back), and taking a candidate
// links THAT player, saved at once (J1): his own card list in Player Management shows the card.
//
// Renamed from checklist-wizard-same-name-pick-step: the entity-review wizard's pick step,
// "Create new" and "Back to the list" are gone; the walk's Player row carries the list.
//
// The ambiguity is made through the product. The NEO-330 reference catalogue (a prod snapshot)
// already holds a "Shuya Yamada" (Tigers from 2026, no birth year); the spec adds a second
// Baseball "Shuya Yamada" born 1851 (the form's floor is 1850). ONE row of our own, not two: on a
// catalogue preview the server refuses a second fork (`adoptOrForkOnCreate` forks past ONE undated
// rival but not past several). If a catalogue refresh drops that row, STEP 1 fails by name (no
// list): re-measure, do not hedge.
//
// The name is a REAL two-token checklist name, not a minted one (the exception to single-token
// names; SET-REGISTRY.md "BBM Rookie Edition Premium"): RP03 of 2024 BBM Rookie Edition Premium
// (36 cards, RP01-RP36, Hanshin Tigers). Sole writer of that set since NEO-645 (decision 10): the
// fetch saves the cards before the walk opens, so the set can no longer be read and left empty.
// FRESH-ONLY: it commits the checklist; re-seed before re-running. The drill is BBM's own brand
// row (a known brand, convex/knownBrands.ts, minted under 2024 by the seed's year-wide Sets sync).
//
// NEO-490's career-team link (the old spec's STEPS 6-8: the rival given a 2021-2022 Hanshin stint,
// then a SECOND fetch links him automatically) cannot ride here any more: the first fetch commits
// the set, and a re-sync of saved cards raises no name. It needs its own fixture.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { emptyListAndPickSport, expectPlayersLoaded, PLAYERS_MATCHES, playersCounter } from "../../support/players";
import { CHECKLISTS } from "../../support/published-checklist";
import {
  expectCardSettled,
  expectTidyWalkOpen,
  fetchChecklistToTidyWalk,
  pinkTile,
  saveForLater,
  skipCard,
  skipUntil,
  tidyTile,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";
import type { Page } from "@playwright/test";

const SET = "BBM Rookie Edition Premium";
const YEAR = "2024";
const TARGET = { manufacturer: "BBM", set: SET };
const NAME = "Shuya Yamada";
/** The card under test: its header line on the walk ("#<number> · <player>"). */
const CARD = `#RP03 · ${NAME}`;

/**
 * Add the b. 1851 Baseball Shuya Yamada, or open the row already on file (the add form adopts
 * him: "already exists"). Contract: ENTRY /admin/players is loaded. EXIT his detail is open and
 * the list is on Baseball.
 */
async function addOrOpenRival(page: Page): Promise<void> {
  await emptyListAndPickSport(page, "Baseball");
  const newName = page.getByRole("textbox", { name: "New player name" });
  const birthYear = page.getByRole("spinbutton", { name: /^Birth year \(optional\)/ });
  // With the catalogue's row on file creation is the demoted "anyway" control; without it (no
  // catalogue) the plain one. A second call adopts the b. 1851 row ("already exists"). A REFUSAL
  // renders neither result line, so this fails by name if the server will not file him.
  const create = page.getByRole("button", { name: new RegExp(`^Create player ${NAME}( anyway)?$`) });
  const result = page.getByText(new RegExp(`(Added ${NAME}\\.|That player already exists — opened it\\.)`));
  await page.getByRole("button", { name: "Add player" }).click();
  await expect(page.getByRole("heading", { name: "Add a player" })).toBeVisible();
  await newName.fill(NAME);
  await birthYear.fill("1851");
  await create.click();
  await expect(result).toBeVisible();
}

test(
  "Tidy Up — a printed name two players on file share asks which one it is, and the pick links that player",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    await signIn("/admin/players");
    // The list counter, not the heading: the heading paints before the list query answers.
    await expectPlayersLoaded(page, LAUNCH_GATE);

    // ── FIXTURE: a second Baseball Shuya Yamada, b. 1851, beside the catalogue's ──
    await addOrOpenRival(page);
    // Read back from the database (a server search). No count: the search matches ANY token.
    await page.getByRole("textbox", { name: "Filter players" }).fill(NAME);
    await expect(playersCounter(page, PLAYERS_MATCHES)).toBeVisible();
    await expect(page.getByText(/b\. 1851/).first()).toBeVisible();

    // ── The fetch: BSC plus the checklist, Match Cards confirmed, the cards saved, the walk open ──
    await fetchChecklistToTidyWalk(page, env, TARGET, { checklist: CHECKLISTS.bbmRookieEditionPremium, firstFetch: true });
    await expectTidyWalkOpen(page, { title: tidyUpName({ year: YEAR, set: SET }) });
    const walk = tidyWalk(page);
    const header = walk.getByText(CARD, { exact: true });
    // By the card, never by the list: the list waits on the name's lookups, and a check made
    // before it is up would skip the card.
    await skipUntil(page, header);

    // ── STEP 1: the question, with both players on file and no plain create ──
    const row = tidyTile(page, "Player").getByRole("group", { name: `Player ${NAME}`, exact: true });
    const pickList = row.getByRole("list", { name: "Players already filed under this name" });
    const question = row.getByText(`Which ${NAME} is this?`, { exact: true });
    const link1851 = pickList.getByRole("button", { name: `Link to ${NAME}, born 1851`, exact: true });
    // The catalogue's man: his name carries what is on file about him but no birth year, so "any
    // Shuya Yamada link that is not a dated one" cannot be the b. 1851 row.
    const linkCatalogue = pickList.getByRole("button", { name: new RegExp(`^Link to ${NAME}, (?!born ).+`) });
    const anyway = row.getByRole("button", { name: "Add as new player anyway", exact: true });
    const create = row.getByRole("button", { name: "Add as new player", exact: true });
    // The answered row's Edit carries the linked player's name, which both men share (NEO-645 C1).
    const change = row.getByRole("button", { name: `Edit ${NAME}`, exact: true });
    await expect(pickList).toBeVisible();
    await expect(question).toBeVisible();
    await expect(row.getByText("We've got 2 on file under that name. Pick the one on this card.", { exact: true })).toBeVisible();
    await expect(row.getByText("Printed on #RP03", { exact: true })).toBeVisible();
    await expect(pickList.getByRole("button")).toHaveCount(2);
    await expect(link1851).toBeVisible();
    await expect(linkCatalogue).toBeVisible();
    // NEO-462: the catalogue's man reads by his one stint on file.
    await expect(linkCatalogue).toContainText("Tigers 2026–present");
    await expect(anyway).toBeVisible();
    await expect(create, "a shared name never offers the plain create").toHaveCount(0);
    await expect(change).toHaveCount(0);
    await expect(pinkTile(page, "Player"), "an undecided shared name is a must-fix").toHaveCount(1);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, a name two players share" });

    // ── STEP 2: "Add as new player anyway" opens the plain create and decides nothing ──
    await anyway.click();
    await expect(create).toBeVisible();
    await expect(pickList).toHaveCount(0);
    await expect(question).toHaveCount(0);
    await expect(change).toHaveCount(0);
    await expect(pinkTile(page, "Player")).toHaveCount(1);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, the plain create opened from a shared name" });

    // ── STEP 3: leave the card and come back: nothing was written, the list is back ──
    await skipCard(page);
    await expect(header).toHaveCount(0);
    await page.goBack();
    await expect(header, "Back returned to the shared name's card").toBeVisible();
    await expectCardSettled(page);
    await expect(pickList).toBeVisible();
    await expect(link1851).toBeVisible();
    await expect(create).toHaveCount(0);
    await expect(change).toHaveCount(0);

    // ── STEP 4: take the b. 1851 man; saved at once, and the row says which ──
    await link1851.click();
    await expect(change).toBeVisible();
    await expect(pickList).toHaveCount(0);
    await expect(question).toHaveCount(0);
    // The answered row names the man by what is on file about him: only the rival has a birth year.
    await expect(row.getByText(NAME, { exact: true })).toBeVisible();
    await expect(row.getByText(/b\. 1851/)).toBeVisible();
    await expect(pinkTile(page, "Player")).toHaveCount(0);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, shared name linked to one player" });
    await saveForLater(page);

    // ── STEP 5: the card is on HIS card list ──
    await page.goto("/admin/players");
    // A mid-flow reload, the flow's 30 s.
    await expectPlayersLoaded(page, 30_000);
    await addOrOpenRival(page);
    const cards = page.getByRole("list", { name: `Cards for ${NAME}` });
    const linked = cards.getByRole("listitem").filter({ hasText: SET });
    await expect(linked).toHaveCount(1);
    await expect(linked).toContainText("#RP03");
  },
);
