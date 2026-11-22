// ONE FEATURE (R1, NEO-602 on the NEO-645 Tidy Up walk, the Orioles fix): when a printed team name
// fits two eras, a card whose player has NO stint on either abstains, so long as the cards that do
// speak point at the era the set's year covers. The commit links the name to that era on every
// card with no stop: no card's Team tile asks ("Which team:"), and no "Linked for you" note marks
// it (the year's own pick is silent). The walk still opens, on the silent card ALONE, for its blue
// Career check (its player has no career on file, NEO-574); "Keep as is" plus Save & next writes
// nothing, and both cards carry the current era.
//
// The Orioles shape, minted: `Bal<token> Ori<token>` (1954–present) is the current era and holds
// the printed name as its own; `Mil<token> Bre<token>` (1901–1902) is the past era and answers to
// the same name as an ALIAS. A 2025 set prints `Bal<token> Ori<token>` on two cards: #1's player
// has a stint on the current era (a voter), #2's player has no stints at all (a recent trade whose
// stints lag). The voter's era is the year's own pick, so the silent card abstains
// (lib/teams/team-era.ts `pickCardTeam`, rule 3) and nothing is asked. The asked shapes are
// tidy-up-two-era-team-name-is-asked-on-the-team-tile-when-the-player-cannot-tell; the player's era
// against the year is tidy-up-team-name-on-two-eras-links-the-players-era-with-no-stop.
//
// Why the past era holds the name as an ALIAS (memory: same-name-team-eras-unprovable-on-a-card):
// no card surface prints a team's era, so only different own names let the drawer prove WHICH era
// the cards carry. The rule reads eras and stints only, never how the name was reached.
//
// Proven able to fail by a one-fact counter-fixture (memory: career-team-link-fixture-and-counter-
// fixture-proof): give the silent player a 1901–1902 stint on the past era. He then votes against
// the voter, the players disagree, and both cards are asked ("Which team:"), so the spec goes red
// at "1 card left".
//
// FIXTURE (SET-REGISTRY.md "Custom sets", the `aeo`/`aeu` prefixes; R7a): its OWN per-attempt
// sport `aeo<token>` › 2025 › Topps › `aeu<token>` › Insert › Base, all hand-made with no
// marketplace id, so the Sync is checklist-only (a pasted two-row checklist: no Match Cards, no
// BSC). Both players and both teams are made in Player Management (a minted player in a sport with
// no Wikidata mapping makes no lookup; teams are never looked up on creation). Not fresh-only:
// every name carries the attempt token. Nothing is deleted.
//
// Back (house rule): set builder → Players is a navigation; Back returns to the empty checklist.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { editCardButton, escapeRe } from "../../support/cards";
import { usePastedChecklist } from "../../support/published-checklist";
import { addCareerStint, addPlayerByHand, createTeamInCareerEditor, expectPlayersLoaded, teamChip } from "../../support/players";
import { drillToCustom, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import {
  expectCardsLeft,
  finishTidyWalk,
  pinkTile,
  saveAndNext,
  settleWalkAfterCommit,
  tidyCardHeader,
  tidyTile,
  tidyWalk,
} from "../../support/tidy-walk";
import { tidyUpName } from "../../support/wizard";

const YEAR = "2025";

test(
  "Tidy Up — a printed team name that fits two eras links silently to the year's era when the only players with stints played there, and a card whose player has none abstains and is walked only for its Career check",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const SPORT = `aeo${T}`;
    const SET = `aeu${T}`;
    const VOTER = `Cur Aho${T}`; // a stint on the current era
    const SILENT = `Sil Aho${T}`; // no stints at all
    const CURRENT = `Bal${T} Ori${T}`; // 1954–present: the printed name is its own
    const PAST = `Mil${T} Bre${T}`; // 1901–1902: the printed name is its alias

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── FIXTURE: the hand-made 2025 leaf, empty ──
    await drillToCustom(page, { sport: SPORT, year: YEAR, manufacturer: "Topps", set: SET, variantType: "Insert", variant: "Base" });
    const empty = page.getByText("No cards in this checklist yet.");
    await expect(empty).toBeVisible();

    // ── FIXTURE: the two eras, a player with a stint on the current one, a player with none ──
    await page.getByRole("link", { name: "Players", exact: true }).click();
    await expectPlayersLoaded(page);
    await addPlayerByHand(page, VOTER, SPORT);
    await expect(page.getByText("No stints recorded yet.")).toBeVisible();
    // The past era, wearing the current era's full name as an alias (no row holds it yet).
    await createTeamInCareerEditor(page, { search: `Bre${T}`, location: `Mil${T}`, from: "1901", to: "1902", aliases: CURRENT });
    // The current era: its tokens now find the past era (by its alias), so the search types one
    // nothing answers to and the dialog's Name is retyped; the dialog names the alias holder and
    // Create goes twice.
    await createTeamInCareerEditor(page, {
      search: `Zzz${T}`,
      name: `Ori${T}`,
      location: `Bal${T}`,
      from: "1954",
      aliasHeldBy: `${PAST} · 1901–1902`,
    });
    // The voter's stint on the current era, 2023–2025, saved.
    await addCareerStint(page, { search: `Ori${T}`, full: CURRENT, from: "2023", to: "2025" });
    await expect(page.getByRole("list", { name: "Career history" }).getByRole("listitem")).toHaveCount(1);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(new RegExp(`Saved ${escapeRe(VOTER)}`))).toBeVisible();
    // The silent player: no stints at all.
    await addPlayerByHand(page, SILENT, SPORT);
    await expect(page.getByText("No stints recorded yet.")).toBeVisible();

    // Back: the set builder, on the same empty checklist.
    await page.goBack();
    await expect(setBuilderReady(page)).toBeVisible();
    await expect(empty).toBeVisible();

    // ── The cards: two print the name; the walk opens on the silent card alone ──
    const facts = await usePastedChecklist(page, `number,player,team\n1,${VOTER},${CURRENT}\n2,${SILENT},${CURRENT}\n`, 2);
    expect(facts.rows).toBe(2);
    await syncChecklistButton(page).click();
    const opened = await settleWalkAfterCommit(page, page.getByText(/^Saved 2 cards\./).first());
    expect(opened, `${SILENT}'s empty career opens the walk for its Career check`).toBe(true);
    const walk = tidyWalk(page);
    await expect(walk).toHaveAccessibleName(tidyUpName({ year: YEAR, set: SET }));
    // Positive: one card to walk, the silent one. Negative: the voter's card is not in the walk.
    await expectCardsLeft(page, 1);
    await expect(tidyCardHeader(page, `#2 · ${SILENT}`)).toBeVisible();
    await expect(tidyCardHeader(page, `#1 · ${VOTER}`)).toHaveCount(0);

    // ── STEP 1: the Team tile shows the current era, linked with no stop and no note ──
    const team = tidyTile(page, "Team");
    const row = team.getByRole("group", { name: `Team ${CURRENT}`, exact: true });
    await expect(row.getByText(CURRENT, { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: /^Change team/, disabled: false })).toBeVisible();
    // Negatives, read against it: nothing asked about the name, no "Linked for you" (the year's own
    // pick is silent), the past era nowhere on the tile, and the tile not pink.
    await expect(team.getByText(/^Which team: /)).toHaveCount(0);
    await expect(team.getByRole("button", { name: /^Not a team/ })).toHaveCount(0);
    await expect(team.getByRole("note")).toHaveCount(0);
    await expect(team.getByText(PAST)).toHaveCount(0);
    await expect(pinkTile(page, "Team")).toHaveCount(0);

    // ── STEP 2: the Career tile is the card's one question, blue, about the silent player ──
    const career = tidyTile(page, "Career");
    await expect(career).toHaveAccessibleDescription(/To check/);
    const line = career.getByRole("group", { name: `Career ${SILENT}`, exact: true });
    await expect(line).toContainText("No career on file yet.");
    await expect(career.getByRole("group", { name: `Career ${VOTER}`, exact: true })).toHaveCount(0);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, Career check after a silent two-era link" });
    // "Keep as is" writes nothing (Save & next marks the blue item seen).
    const keep = line.getByRole("button", { name: /^Keep as is/ });
    await keep.click();
    await expect(keep).toHaveAttribute("aria-pressed", "true");
    await saveAndNext(page);
    await expect(walk.getByText("All tidy. Nothing on this checklist needs you.")).toBeVisible();
    await finishTidyWalk(page);

    // ── STEP 3: both cards carry the current era, the silent card included ──
    const drawer = page.getByRole("dialog");
    for (const number of ["1", "2"]) {
      await editCardButton(page, number).click();
      await expect(teamChip(drawer, CURRENT)).toBeVisible();
      await expect(teamChip(drawer, PAST)).toHaveCount(0);
      if (number === "2") await expectAccessible(page, { within: drawer, label: "Card drawer, the silent card on the year's era" });
      await page.getByRole("button", { name: "Done editing card" }).click();
      await expect(drawer).toBeHidden();
    }
  },
);
