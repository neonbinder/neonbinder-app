// ONE FEATURE (R1, NEO-307/NEO-330 on the NEO-645 Tidy Up walk): a retro card can show a team's
// PAST. A printed club held ONCE, in an era that ended long before the set's year, links by itself;
// a printed club held in SEVERAL past eras, none covering the set's year and none the card's
// player played for, is asked on the Team tile ("Which team: …", every era by its label), and the
// era the operator picks is the team the card carries. Jason, 2026-10-10: the operator's past-era
// link belongs where several same-name clubs are held and none covers the set's year; a club held
// once links by itself.
//
// The rule (lib/teams/team-era.ts): one row → `pickTeamForYear` with the card's past-era
// allowance (a 2025 card may show a 1932–1957 club). Several rows → the players decide when one
// played for a row; this player has NO stints, so the year decides, and two closed eras both
// before 2025 are a question, never a guess (`pickTeamForYear`: "Never guess").
// (The players deciding against the year is the sibling
// tidy-up-team-name-on-two-eras-links-the-players-era-with-no-stop.)
//
// Why the second era has a different own name (memory: same-name-team-eras-unprovable-on-a-card):
// no card surface prints a team's era, so the drawer could not tell two rows of one full name
// apart. `Kan<token> Pea<token>` (1955–1967) wears the printed name `Phi<token> Pea<token>`
// (1901–1954) as an ALIAS; both rows are candidates for the printed name, and the operator picks
// the alias holder, so the drawer proves the pick, not a name match.
//
// Card #2 is the "by itself" half. Its player has no career on file, so the commit also leaves a
// blue career check on it (NEO-645: a pre-made player whose career does not cover the card's
// team); that is what puts the card in the walk, where its Team tile shows the link with nothing
// to ask.
//
// FIXTURE (SET-REGISTRY.md "Custom sets", the `pes`/`per` prefixes; R7a): its OWN per-attempt
// sport `pes<token>` › 2025 › Topps › `per<token>` › Insert › Base, all hand-made with no
// marketplace id, so the Sync is checklist-only (a pasted two-row checklist, no Match Cards, no
// BSC). The player `Jim Pef<token>` and the three teams are made in Player Management (a minted
// player in a sport with no Wikidata mapping makes no lookup; teams are never looked up on
// creation); every team chip is taken off again, so he has no stints. Replaces the real-set
// fixture Baseball › 2025 › Topps Welcome to the Club: 3X MVP (a fetch now saves before the walk
// opens, and a hand-made sport re-runs on one seed). Not fresh-only. Nothing is deleted.
//
// Back (house rule): set builder → Players is a navigation, and the walk's cards are history
// entries: Back from card #2 returns to card #1 with the operator's answer kept.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { editCardButton, escapeRe } from "../../support/cards";
import { usePastedChecklist } from "../../support/published-checklist";
import { addPlayerByHand, createTeamInCareerEditor, expectPlayersLoaded, teamChip } from "../../support/players";
import { drillToCustom, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import {
  expectCardSettled,
  expectCardsLeft,
  finishTidyWalk,
  pinkTile,
  saveAndNext,
  settleWalkAfterCommit,
  tidyCardHeader,
  tidyTile,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";
import type { Locator, Page } from "@playwright/test";

const YEAR = "2025";

/** A candidate era's one-click link ("Link to <full> · <era>"); a glyph before the words is allowed. */
function eraLink(scope: Locator, full: string, era: string): Locator {
  return scope.getByRole("button", { name: new RegExp(`^[^\\p{L}]*Link to ${escapeRe(`${full} · ${era}`)}$`, "u") });
}

/** The answered row's "Change team". */
function changeTeam(scope: Locator): Locator {
  return scope.getByRole("button", { name: /^Change team$/, disabled: false });
}

test(
  "Tidy Up — a past-era club held once links by itself; one held in several past eras is asked on the Team tile, and the era picked is the card's team",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const SPORT = `pes${T}`;
    const SET = `per${T}`;
    const PLAYER = `Jim Pef${T}`;
    const CLUB = `Pea${T}`;
    const PRINTED = `Phi${T} ${CLUB}`; // 1901–1954, the printed name is its own
    const LATER = `Kan${T} ${CLUB}`; // 1955–1967, wears the printed name as an alias
    const ONCE = `Bro${T} Ped${T}`; // 1932–1957, the only row of its name

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── FIXTURE: the hand-made 2025 leaf, empty ──
    await drillToCustom(page, { sport: SPORT, year: YEAR, manufacturer: "Topps", set: SET, variantType: "Insert", variant: "Base" });
    const empty = page.getByText("No cards in this checklist yet.");
    await expect(empty).toBeVisible();

    // ── FIXTURE: the player (no stints) and the three past-era teams ──
    await page.getByRole("link", { name: "Players", exact: true }).click();
    await expectPlayersLoaded(page);
    await addPlayerByHand(page, PLAYER, SPORT);
    await expect(page.getByText("No stints recorded yet.")).toBeVisible();
    await createTeamInCareerEditor(page, { search: `Ped${T}`, location: `Bro${T}`, from: "1932", to: "1957" });
    // The later era first, wearing the printed name as an alias (no row holds that name yet)...
    await createTeamInCareerEditor(page, { search: CLUB, location: `Kan${T}`, from: "1955", to: "1967", aliases: PRINTED });
    // ...then the earlier era under it: the token now finds the later era, so the search types one
    // nothing answers to and the Name is retyped; the dialog names the alias holder, Create twice.
    await createTeamInCareerEditor(page, {
      search: `Zzz${T}`,
      name: CLUB,
      location: `Phi${T}`,
      from: "1901",
      to: "1954",
      aliasHeldBy: `${LATER} · 1955–1967`,
    });
    // Every chip came off: he has no career, so no player can say which era a card means.
    await expect(page.getByText("No stints recorded yet.")).toBeVisible();

    // Back: the set builder, on the same empty checklist.
    await page.goBack();
    await expect(setBuilderReady(page)).toBeVisible();
    await expect(empty).toBeVisible();

    // ── The checklist: #1 prints the club held in two past eras, #2 the club held once ──
    await usePastedChecklist(page, `number,player,team\n1,${PLAYER},${PRINTED}\n2,${PLAYER},${ONCE}\n`, 2);
    await syncChecklistButton(page).click();
    const opened = await settleWalkAfterCommit(page, page.getByText(/Saved 2 cards\./).first());
    expect(opened, "card #1's club needs the operator, so the walk opens").toBe(true);
    const walk = tidyWalk(page);
    await expect(walk).toHaveAccessibleName(tidyUpName({ year: YEAR, set: SET }));
    await expectCardsLeft(page, 2);

    const team = tidyTile(page, "Team");
    const header1 = tidyCardHeader(page, `#1 · ${PLAYER}`);
    const header2 = tidyCardHeader(page, `#2 · ${PLAYER}`);
    const askedRow = team.getByRole("group", { name: `Team ${PRINTED}`, exact: true });
    const onceRow = team.getByRole("group", { name: `Team ${ONCE}`, exact: true });

    /** Card #2: the club held once is linked by itself, nothing asked; only the career is blue. */
    const expectCard2LinkedByItself = async (p: Page) => {
      await expect(header2).toBeVisible();
      await expectCardSettled(p);
      // Positive: the team is on the card, with Change offered.
      await expect(onceRow.getByText(ONCE, { exact: true })).toBeVisible();
      await expect(changeTeam(onceRow)).toBeVisible();
      // Negative: the tile asks nothing (not pink, no era choice, no "Not a team").
      await expect(team).not.toHaveAccessibleDescription(/To fix/);
      await expect(onceRow.getByText(/^Which team: /)).toHaveCount(0);
      await expect(onceRow.getByRole("button", { name: /^Not a team/ })).toHaveCount(0);
      // The card is here for its blue career check, not for its team.
      await expect(tidyTile(p, "Career")).toHaveAccessibleDescription(/To check/);
      await expect(pinkTile(p, "Team")).toHaveCount(0);
    };

    // The walk orders cards whose lookups have landed first, so either card can open it.
    await expect(header1.or(header2).first()).toBeVisible();
    const card2First = await header2.isVisible();
    if (card2First) {
      await expectCard2LinkedByItself(page);
      await expectAccessible(page, { within: walk, label: "Tidy Up walk, a past-era club linked by itself" });
      await saveAndNext(page);
    }

    // ── STEP 1: card #1 asks which era, offering both by their labels ──
    await expect(header1).toBeVisible();
    await expect(pinkTile(page, "Team")).toHaveCount(1);
    await expect(askedRow.getByText(`Which team: ${PRINTED}`, { exact: true })).toBeVisible();
    const eras = askedRow.getByRole("list", { name: /^We've got 2 teams by that name/ });
    const later = eraLink(eras, LATER, "1955–1967");
    const earlier = eraLink(eras, PRINTED, "1901–1954");
    await expect(later).toBeVisible();
    await expect(earlier).toBeVisible();
    // Negative: nothing linked it (no "Linked for you", no Change yet).
    await expect(team.getByRole("note")).toHaveCount(0);
    await expect(changeTeam(askedRow)).toHaveCount(0);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, which past era is this club" });

    // Untick "Remember … as a name" once it has settled (held while the place check runs, then
    // ticked): the pick must write the team and nothing else.
    const remember = askedRow.getByRole("checkbox", { name: `Remember “${PRINTED}” as a name for this team` });
    await expect(remember).toBeEnabled();
    await expect(remember).toBeChecked();
    await remember.uncheck();
    await expect(remember).not.toBeChecked();

    // The operator picks the LATER era, the one that only wears the printed name as an alias.
    await later.click();
    await expect(askedRow.getByText(LATER, { exact: true })).toBeVisible();
    await expect(changeTeam(askedRow)).toBeVisible();
    await expect(askedRow.getByText(/^Which team: /)).toHaveCount(0);
    await expect(pinkTile(page, "Team")).toHaveCount(0);
    // The operator's own answer is not "linked for you".
    await expect(askedRow.getByRole("note")).toHaveCount(0);

    if (!card2First) {
      // Card #1 opened the walk: Save & next reaches card #2, and Back returns to #1 with the
      // answer kept (a tile saves as it is answered).
      await saveAndNext(page);
      await expectCard2LinkedByItself(page);
      await expectAccessible(page, { within: walk, label: "Tidy Up walk, a past-era club linked by itself" });
      await page.goBack();
      await expect(header1).toBeVisible();
      await expect(header2).toHaveCount(0);
      await expect(askedRow.getByText(LATER, { exact: true })).toBeVisible();
      await expect(pinkTile(page, "Team")).toHaveCount(0);
      await saveAndNext(page);
      await expect(header2).toBeVisible();
    }
    // The last card (#2's blue check seen, or #1 answered) and the walk runs out.
    await saveAndNext(page);
    await expect(walk.getByText("All tidy. Nothing on this checklist needs you.")).toBeVisible();
    await finishTidyWalk(page);

    // ── STEP 2: each card carries its club; #1 the era picked, never the printed name's own row ──
    const drawer = page.getByRole("dialog");
    await editCardButton(page, "1").click();
    await expect(teamChip(drawer, LATER)).toBeVisible();
    await expect(teamChip(drawer, PRINTED)).toHaveCount(0);
    await expectAccessible(page, { within: drawer, label: "Card drawer, the past era the operator picked" });
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(drawer).toBeHidden();

    await editCardButton(page, "2").click();
    await expect(teamChip(drawer, ONCE)).toBeVisible();
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(drawer).toBeHidden();
  },
);
