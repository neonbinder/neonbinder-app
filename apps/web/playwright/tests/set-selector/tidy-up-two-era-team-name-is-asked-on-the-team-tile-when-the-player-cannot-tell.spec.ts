// ONE FEATURE (R1, NEO-602 on the NEO-645 Tidy Up walk): when a card's player cannot say which of
// two eras a printed team name means, nothing links it. The card's Team tile is pink and ASKS
// ("Which team: <printed>"), offering both existing eras as one-click links (newest first), with
// the team search kept below as the fallback; the card then carries only the era the operator
// picks, and that pick wears no "Linked for you" note.
//
// The two-era club, minted as in tidy-up-team-name-on-two-eras-links-the-players-era-with-no-stop:
// `Loc<token> Ath<token>` (1968–2024, the printed name is its own) and `Ath<token>` (2025–present,
// which wears that name as an ALIAS). Every card is in a 2025 set and prints the OLDER team's full
// name. The two outcomes the rule leaves to the operator (lib/teams/team-era.ts `pickCardTeam`):
//   (a) the player has NO stints. The year alone would pick the newer team, but only through its
//       alias while the older team holds the name as its own, so the rule refuses the guess;
//   (b) the player has stints on BOTH eras: the players' evidence is a tie.
// Each is its own one-card set: a name answer is scoped to the leaf that printed it (NEO-645 D2),
// so one leaf could carry only one of the two answers, and each outcome must be proved alone. In
// each, the negatives (no note, no "isn't linked to a team yet" new-team row, Save & next held) are
// read against the positive (the "Which team:" row); the operator then picks a DIFFERENT era in
// each case (the one-click link in (a), the search in (b)), and the drawer proves the card carries
// exactly that era. (The players' era against the year is the sibling spec named above; a silent
// card abstaining is tidy-up-two-era-team-name-links-silently-when-a-card-with-no-career-abstains.)
//
// Proven able to fail by a one-value counter-fixture (memory: career-team-link-fixture-and-counter-
// fixture-proof): YEAR 2025 -> 2020 makes the older era the year's own pick (the newer one did not
// exist yet), so the name links by itself and the spec goes red at "Which team:".
//
// FIXTURE (SET-REGISTRY.md "Custom sets", the `aeq`/`aen`/`aeb` prefixes; R7a): its OWN
// per-attempt sport `aeq<token>` › 2025 › Topps with two sets, `aen<token>` and `aeb<token>`, each
// `Insert` › `Base`, all hand-made with no marketplace id, so each Sync is checklist-only (a pasted
// one-row checklist: no Match Cards, no BSC). Both players and both teams are made in Player
// Management (a minted player in a sport with no Wikidata mapping makes no lookup; teams are never
// looked up on creation). Not fresh-only: every name carries the attempt token. Nothing is deleted.
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
  mustFixLine,
  pinkTile,
  saveAndNext,
  settleWalkAfterCommit,
  tidyCardHeader,
  tidyFooterButton,
  tidyTile,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";
import type { Locator, Page } from "@playwright/test";

const YEAR = "2025";

/**
 * Sync the open (empty) checklist from one pasted row printing `printed`, and prove the walk ASKS
 * about it on the card's pink Team tile: "Which team:", both eras offered newest first, nothing
 * linked, Save & next held. Returns the printed name's row on the tile.
 */
async function syncAndExpectTheTeamAsked(
  page: Page,
  o: { set: string; player: string; printed: string; newer: string; axeLabel: string },
): Promise<Locator> {
  const facts = await usePastedChecklist(page, `number,player,team\n1,${o.player},${o.printed}\n`, 1);
  expect(facts.rows).toBe(1);
  await syncChecklistButton(page).click();
  const opened = await settleWalkAfterCommit(page, page.getByText(/Saved 1 card/).first());
  expect(opened, `the unsettled ${o.printed} opens the walk`).toBe(true);
  const walk = tidyWalk(page);
  await expect(walk).toHaveAccessibleName(tidyUpName({ year: YEAR, set: o.set }));
  await expectCardsLeft(page, 1);
  await expect(tidyCardHeader(page, `#1 · ${o.player}`)).toBeVisible();

  // Positive: the printed name's own row asks which team. Two rows answer to the name, so it is a
  // choice between them, not a new team.
  const row = tidyTile(page, "Team").getByRole("group", { name: `Team ${o.printed}`, exact: true });
  await expect(row.getByText(`Which team: ${o.printed}`, { exact: true })).toBeVisible();
  await expect(row.getByText("Printed on #1", { exact: true })).toBeVisible();
  const offered = row.getByRole("list", { name: "We've got 2 teams by that name. Pick the one on this card." }).getByRole("button");
  await expect(offered).toHaveCount(2);
  await expect(offered.nth(0)).toHaveAccessibleName(new RegExp(`^Link to ${escapeRe(o.newer)} · 2025.present$`));
  await expect(offered.nth(1)).toHaveAccessibleName(new RegExp(`^Link to ${escapeRe(o.printed)} · 1968.2024$`));
  await expect(row.getByRole("combobox", { name: "Search all teams" })).toBeVisible();
  // Negatives, read against it: not the new-team row, nothing linked for the operator (no note, no
  // Edit: an answered row's "Edit <team>", NEO-645 C1), the tile pink and Save & next held while it is.
  await expect(row.getByText(/isn't linked to a team yet\.$/)).toHaveCount(0);
  await expect(row.getByRole("note")).toHaveCount(0);
  await expect(row.getByRole("button", { name: /^Edit (?!cameo )/ })).toHaveCount(0);
  await expect(pinkTile(page, "Team")).toHaveCount(1);
  await expect(tidyTile(page, "Team")).toHaveAccessibleDescription(/To fix/);
  await expect(mustFixLine(page)).toBeVisible();
  await expect(tidyFooterButton(page, "saveAndNext", { usable: true })).toHaveCount(0);
  await expectAccessible(page, { within: walk, label: o.axeLabel });
  return row;
}

/** Untick "Remember …", so the link is the card's claim and no alias is saved. */
async function untickRemember(row: Locator, printed: string): Promise<void> {
  const remember = row.getByRole("checkbox", { name: `Remember “${printed}” as a name for this team` });
  await remember.uncheck();
  await expect(remember).not.toBeChecked();
}

/**
 * The row is answered with `picked` by the operator: the team named, its Edit offered, no "Linked
 * for you" note, nothing asked; the tile is no longer pink. Then Save & next to the end screen.
 */
async function expectPickedAndFinish(page: Page, row: Locator, picked: string): Promise<void> {
  await expect(row.getByText(picked, { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: `Edit ${picked}`, exact: true, disabled: false })).toBeVisible();
  await expect(row.getByText(/^Which team: /)).toHaveCount(0);
  await expect(row.getByRole("note")).toHaveCount(0);
  await expect(pinkTile(page, "Team")).toHaveCount(0);
  await saveAndNext(page);
  await expect(tidyWalk(page).getByText("All tidy. Nothing on this checklist needs you.")).toBeVisible();
  await finishTidyWalk(page);
}

/** The committed card #1 carries `has` and not `hasNot`. */
async function expectCardTeam(page: Page, has: string, hasNot: string, axeLabel: string): Promise<void> {
  await editCardButton(page, "1").click();
  const drawer = page.getByRole("dialog");
  await expect(teamChip(drawer, has)).toBeVisible();
  await expect(teamChip(drawer, hasNot)).toHaveCount(0);
  await expectAccessible(page, { within: drawer, label: axeLabel });
  await page.getByRole("button", { name: "Done editing card" }).click();
  await expect(drawer).toBeHidden();
}

test(
  "Tidy Up — a printed team name that fits two eras is asked on the card's Team tile when its player has no stints, or stints on both, and the card gets only the era picked",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const SPORT = `aeq${T}`;
    const SET_NONE = `aen${T}`;
    const SET_BOTH = `aeb${T}`;
    const NO_STINTS = `Nos Ahq${T}`;
    const BOTH_ERAS = `Bot Ahq${T}`;
    const NEW = `Ath${T}`; // 2025–present: the printed name is its alias
    const OLD = `Loc${T} ${NEW}`; // 1968–2024: the printed name is its own
    const target = (set: string) => ({ sport: SPORT, year: YEAR, manufacturer: "Topps", set, variantType: "Insert", variant: "Base" });

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── FIXTURE: the first hand-made 2025 leaf, empty ──
    await drillToCustom(page, target(SET_NONE));
    const empty = page.getByText("No cards in this checklist yet.");
    await expect(empty).toBeVisible();

    // ── FIXTURE: the two eras, a player with a stint on each, and a player with none ──
    await page.getByRole("link", { name: "Players", exact: true }).click();
    await expectPlayersLoaded(page);
    await addPlayerByHand(page, BOTH_ERAS, SPORT);
    await expect(page.getByText("No stints recorded yet.")).toBeVisible();
    // The newer team, wearing the older team's full name as an alias (no row holds that name yet).
    await createTeamInCareerEditor(page, { search: NEW, from: "2025", aliases: OLD });
    // The older team: its token now finds the newer team, so the search types one nothing answers
    // to and the dialog's Name is retyped; the dialog names the alias holder and Create goes twice.
    await createTeamInCareerEditor(page, {
      search: `Zzz${T}`,
      name: NEW,
      location: `Loc${T}`,
      from: "1968",
      to: "2024",
      aliasHeldBy: `${NEW} · 2025–present`,
    });
    // His stints, one on each era, saved.
    await addCareerStint(page, { search: NEW, full: NEW, from: "2025", to: "2025" });
    await addCareerStint(page, { search: NEW, full: OLD, from: "1979", to: "1984" });
    await expect(page.getByRole("list", { name: "Career history" }).getByRole("listitem")).toHaveCount(2);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(new RegExp(`Saved ${escapeRe(BOTH_ERAS)}`))).toBeVisible();
    // The player with no stints at all.
    await addPlayerByHand(page, NO_STINTS, SPORT);
    await expect(page.getByText("No stints recorded yet.")).toBeVisible();

    // Back: the set builder, on the first set's empty checklist.
    await page.goBack();
    await expect(setBuilderReady(page)).toBeVisible();
    await expect(empty).toBeVisible();

    // ── STEP 1 (a): no stints. Asked; the operator links the older era by its one-click button ──
    const rowNone = await syncAndExpectTheTeamAsked(page, {
      set: SET_NONE,
      player: NO_STINTS,
      printed: OLD,
      newer: NEW,
      axeLabel: "Tidy Up walk, two-era team name asked (player with no stints)",
    });
    await untickRemember(rowNone, OLD);
    await rowNone.getByRole("button", { name: new RegExp(`^Link to ${escapeRe(OLD)} · 1968.2024$`) }).click();
    await expectPickedAndFinish(page, rowNone, OLD);
    await expectCardTeam(page, OLD, NEW, "Card drawer, the operator's era (no stints)");

    // ── STEP 2 (b): stints on both eras. Asked; the operator finds the newer era by the search ──
    await drillToCustom(page, target(SET_BOTH));
    await expect(empty).toBeVisible();
    const rowBoth = await syncAndExpectTheTeamAsked(page, {
      set: SET_BOTH,
      player: BOTH_ERAS,
      printed: OLD,
      newer: NEW,
      axeLabel: "Tidy Up walk, two-era team name asked (player on both eras)",
    });
    await untickRemember(rowBoth, OLD);
    // The search types the newer team's own name; its option starts with it, the older team's
    // starts with its location.
    const combo = rowBoth.getByRole("combobox", { name: "Search all teams" });
    await combo.fill(NEW);
    await expect(combo).toHaveValue(NEW);
    await page.getByRole("option", { name: new RegExp(`^${escapeRe(NEW)}`) }).click();
    await expectPickedAndFinish(page, rowBoth, NEW);
    await expectCardTeam(page, NEW, OLD, "Card drawer, the operator's era (both eras)");
  },
);
