// ONE FEATURE (NEO-657 on a two-player card, NEO-656 merge delta D1): on a card that names TWO
// players and exactly one team NeonBinder holds, each player made new on that card ("Add as new
// player") gets the Career tile's "+ Add stint" already filled with the card's team and the set's
// year, and Save & next writes both stints. Jason, 2026-11-23: "When adding a new player IF we know
// the team on the card we should automatically create a new stint for the player for the year of
// the card. It should be open and editable so that if that is not the right years the admin can
// fix it." The prefill needs one team on the card, not one player; the live career gap is
// one-player only, so on a two-player card the prefill is the Career tile's only content. A card
// with TWO NB teams names no one team, so it opens no prefilled form. Players admin reads back.
// The single-player prefill (+ Add, Enter, edited years, Esc, no team) is the sibling spec
// `tidy-up-career-tile-prefills-a-new-players-stint-from-the-card-team`.
//
// FIXTURE (R7a, SET-REGISTRY.md prefix `tcp`): ONE hand-made set per attempt, `tcp<token>`, under
// the REAL Baseball › 2024 › Topps (the cards' teams resolve against Baseball's catalogue teams),
// `Insert` › `Base`, no marketplace id anywhere: a pasted two-row checklist is the one source (no
// Match Cards, no BSC). A cell naming several players or teams splits on "/".
//   #1 Bob Humphryes CO / Carlos Moreno CO · Seattle Mariners          both new, both prefilled
//   #2 Gilberto Marcano CO / Mike Trout · Chicago Cubs / Colorado Rockies   Marcano new, no form
// The three "CO" names are coaches as the 1996 Line Up Venezuelan Winter League set printed them:
// each Baseball lookup is a recorded no-match (`result: null`) in no pool of
// support/recorded-names.ts and on no committed checklist, so "Add as new player" sends nothing to
// Wikidata and leaves the career empty. Mike Trout is the catalogue's own player, linked by name at
// the commit and only read (no stint is written to him: card #2 shows no career form at all).
// FRESH-ONLY: the three new players are global rows with real names, so a second run on the same
// seed links to them. CI reseeds each pass. Nothing is deleted (R7): the set, its cards and the
// players stand; no team is created and no catalogue row is written.
import type { Locator, Page } from "@playwright/test";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { usePastedChecklist } from "../../support/published-checklist";
import { expectPlayersLoaded, PLAYERS_MATCHES, playersCounter } from "../../support/players";
import { drillToCustom, escapeRe, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import {
  EDIT,
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
/** Card #1: two new players, one NB team. */
const PAIR = ["Bob Humphryes CO", "Carlos Moreno CO"] as const;
const PAIR_TEAM = "Seattle Mariners";
/** Card #2: one new player beside a catalogue player, two NB teams. */
const LONE = "Gilberto Marcano CO";
const CATALOGUE_PLAYER = "Mike Trout";
const TWO_TEAMS = ["Chicago Cubs", "Colorado Rockies"] as const;

/** Players admin, one Baseball player's detail open; returns his career lines. */
async function openPlayer(page: Page, name: string): Promise<Locator> {
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
  "Tidy Up — on a two-player card with one team, each new player's Career row opens + Add stint prefilled with the card's team and year, Save & next writes both; a card with two teams opens no form",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const SET = `tcp${env.ATTEMPT_TOKEN}`;

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── FIXTURE: the hand-made leaf and its two-row checklist; the commit opens the walk ──
    await drillToCustom(page, { sport: "Baseball", year: YEAR, manufacturer: "Topps", set: SET, variantType: "Insert", variant: "Base" });
    // R2 precondition: a fresh per-attempt checklist with no card.
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
    const csv =
      "number,player,team\n" +
      `1,${PAIR.join(" / ")},${PAIR_TEAM}\n` +
      `2,${LONE} / ${CATALOGUE_PLAYER},${TWO_TEAMS.join(" / ")}\n`;
    await usePastedChecklist(page, csv, 2);
    await syncChecklistButton(page).click();
    const opened = await settleWalkAfterCommit(page, page.getByText(/Saved 2 cards\./).first());
    expect(opened, "three new names to answer, so the walk opened").toBe(true);
    const walk = tidyWalk(page);
    await expect(walk).toHaveAccessibleName(tidyUpName({ year: YEAR, set: SET }));
    await expectCardsLeft(page, 2);

    const face = (n: string) => walk.getByRole("img", { name: new RegExp(`^Card #${n},`) });
    const playerTile = tidyTile(page, "Player");
    const teamTile = tidyTile(page, "Team");
    const career = tidyTile(page, "Career");
    /** Any prefilled stint form on the open card (the plain form is unnamed). */
    const anyPrefilled = walk.getByRole("group", { name: /^New stint for .+, prefilled from the card$/ });

    /** Answer one printed name as a new player on the open card. */
    async function makeNewPlayer(who: string) {
      const row = playerTile.getByRole("group", { name: `Player ${who}`, exact: true });
      // On a card with several names each button carries the printed name.
      const suffix = `( ${escapeRe(who)})?$`;
      const create = row.getByRole("button", { name: new RegExp(`^Add as new player${suffix}`), disabled: false });
      const anyway = row.getByRole("button", { name: new RegExp(`^Add as new player anyway${suffix}`), disabled: false });
      // His lookup has answered (a recorded no-match that waits in the deployment-wide enrichment
      // pool behind every other run's lookups: the batch-lookup ceiling, LOOKUPS). A same-name
      // player of another sport on file is offered first, and declined with "... anyway" (NEO-424).
      await expect(create.or(anyway).first()).toBeVisible({ timeout: LOOKUPS });
      if (await anyway.isVisible()) {
        await anyway.click();
        await expect(anyway).toHaveCount(0);
      }
      await create.click();
      await expect(row.getByRole("button", { name: EDIT }), `${who} was answered`).toBeVisible();
    }

    // ══ #1: two new players, one NB team: each gets the prefilled form ══
    await expect(face("1")).toBeVisible();
    await expectCardSettled(page);
    await expect(pinkTile(page, "Player")).toHaveCount(1);
    for (const who of PAIR) await makeNewPlayer(who);
    await expect(pinkTile(page, "Player")).toHaveCount(0);
    await expect(teamTile.getByRole("button", { name: `Edit ${PAIR_TEAM}`, exact: true })).toBeVisible();
    // Blue, a row per new player, each its own form holding the card's team and the set's year.
    await expect(career).toHaveAccessibleDescription("To check");
    for (const who of PAIR) {
      const row = career.getByRole("group", { name: `Career ${who}`, exact: true });
      await expect(row.getByRole("group", { name: `New stint for ${who}, prefilled from the card`, exact: true })).toBeVisible();
      await expect(row.getByRole("combobox", { name: `Career team name for ${who}`, exact: true })).toHaveValue(PAIR_TEAM);
      await expect(row.getByRole("spinbutton", { name: `From year for ${who}`, exact: true })).toHaveValue(YEAR);
      await expect(row.getByRole("spinbutton", { name: `To year (optional) for ${who}`, exact: true })).toHaveValue(YEAR);
      await expect(row.getByRole("button", { name: `Add career team for ${who}`, exact: true })).toBeEnabled();
    }
    await expect(anyPrefilled).toHaveCount(PAIR.length);
    // Blue never holds the card.
    await expect(tidyFooterButton(page, "saveAndNext", { usable: true })).toBeVisible();
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, two new players' prefilled stints on one card" });
    // Save & next with both forms open writes both stints (read back in Players admin below).
    await saveAndNext(page);

    // ══ #2: two NB teams on the card: no one team to prefill, so no form ══
    await expect(face("2")).toBeVisible();
    await expectCardsLeft(page, 1);
    // Navigation lives in the URL: Back is card #1 again, its players answered; Forward returns.
    await page.goBack();
    await expect(face("1")).toBeVisible();
    await expectCardSettled(page);
    await expect(pinkTile(page, "Player")).toHaveCount(0);
    await page.goForward();
    await expect(face("2")).toBeVisible();
    await expectCardSettled(page);

    // The catalogue player linked by name at the commit; only the coach waits.
    await expect(playerTile.getByRole("button", { name: `Edit ${CATALOGUE_PLAYER}`, exact: true })).toBeVisible();
    await expect(pinkTile(page, "Player")).toHaveCount(1);
    await makeNewPlayer(LONE);
    await expect(pinkTile(page, "Player")).toHaveCount(0);
    // R2 positive beside the negative: the card holds both NB teams, and it can save.
    for (const team of TWO_TEAMS) await expect(teamTile.getByRole("button", { name: `Edit ${team}`, exact: true })).toBeVisible();
    await expect(tidyFooterButton(page, "saveAndNext", { usable: true })).toBeVisible();
    await expect(anyPrefilled, "two teams on the card name no one team, so no stint is prefilled").toHaveCount(0);
    await expect(career, "a two-player card has no career gap, and no prefill here: no Career tile").toHaveCount(0);
    await saveAndNext(page);
    await expect(tidyFooterButton(page, "done")).toBeVisible();
    await finishTidyWalk(page);

    // ── READ BACK: card #1's two players each hold the prefilled stint, and card #2's none ──
    for (const who of PAIR) {
      const lines = await openPlayer(page, who);
      await expect(lines.filter({ hasText: `${PAIR_TEAM} · ${YEAR}` }), `Save & next wrote ${who}'s prefilled stint`).toHaveCount(1);
      await expect(lines).toHaveCount(1);
    }
    await expectAccessible(page, { label: "Players admin, a new player's career from a two-player card's prefilled stint" });
    // openPlayer asserts his detail is up (the positive), so an empty career is a real empty.
    const lone = await openPlayer(page, LONE);
    await expect(lone, `${LONE}: nothing was added`).toHaveCount(0);
  },
);
