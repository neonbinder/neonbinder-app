// ONE FEATURE (R1, NEO-602 on the NEO-645 Tidy Up walk): when a card's printed team name fits two
// eras of a club, the card's PLAYER picks the era, not the set's year. The commit links the era he
// played for with no stop, and the Team tile shows that link as NeonBinder's ("Linked for you"),
// with Change offered.
//
// The Rickey Henderson case, minted: `Loc<token> Ath<token>` (1968–2024) holds the printed name as
// its own, and `Ath<token>` (2025–present) wears it as an ALIAS. A 2025 set's year covers only the
// newer row, so the year alone would link the newer team. The player has one stint, on the OLDER
// row (1979–1984), and every card printing the name is his, so the players' row stands against
// the year (lib/teams/team-era.ts `pickCardTeam`, rule 3). Because it is not the year's pick, the
// link is a visible one (an auto answer, reason careerTeam), not a silent one.
//
// Why the card also prints a second team name: a card whose names all link has nothing to ask
// and never enters the walk, so the tile that shows the link would never be on screen. The
// checklist's team cell is `Loc<token> Ath<token> / Ahx<token>` (split on "/" into two printed
// teams); `Ahx<token>` is no team on file, which keeps the card in the walk. The era rule reads
// one printed name at a time, so the second name changes nothing about the first. It is answered
// "Not a team" here, so the card ends with exactly the player's era.
//
// Why the eras have different own names (memory: same-name-team-eras-unprovable-on-a-card): no
// card surface prints a team's era, so only different names let the drawer prove WHICH era the
// card carries.
//
// FIXTURE (SET-REGISTRY.md "Custom sets", the `aes`/`aer` prefixes; R7a): its OWN per-attempt
// sport `aes<token>` › 2025 › Topps › `aer<token>` › Insert › Base, all hand-made with no
// marketplace id, so the Sync is checklist-only (a pasted one-row checklist, no Match Cards, no
// BSC). The player and both teams are made in Player Management (a minted player in a sport with
// no Wikidata mapping makes no lookup; teams are never looked up on creation). The newer team is
// made first, wearing the older one's full name as an alias; the older one is then made under it,
// which the era-aware check allows once the dialog's second Create is pressed. Not fresh-only:
// every name carries the attempt token. Nothing is deleted.
//
// Back (house rule): set builder → Players is a navigation; Back returns to the empty checklist.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { editCardButton, escapeRe } from "../../support/cards";
import { usePastedChecklist } from "../../support/published-checklist";
import { addPlayerByHand, createTeamInCareerEditor, expectPlayersLoaded, teamChip } from "../../support/players";
import { drillToCustom, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import {
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

const YEAR = "2025";

test(
  "Tidy Up — a printed team name that fits two eras is linked, with no stop, to the era the card's player played for, not the one the set's year covers",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const SPORT = `aes${T}`;
    const SET = `aer${T}`;
    const PLAYER = `Rick Ahp${T}`;
    const NEW = `Ath${T}`; // 2025–present: the printed name is its alias
    const OLD = `Loc${T} ${NEW}`; // 1968–2024: the printed name is its own
    const NOT_A_TEAM = `Ahx${T}`;

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── FIXTURE: the hand-made 2025 leaf, empty ──
    await drillToCustom(page, { sport: SPORT, year: YEAR, manufacturer: "Topps", set: SET, variantType: "Insert", variant: "Base" });
    const empty = page.getByText("No cards in this checklist yet.");
    await expect(empty).toBeVisible();

    // ── FIXTURE: the player, the two eras, and his stint on the older one ──
    await page.getByRole("link", { name: "Players", exact: true }).click();
    await expectPlayersLoaded(page);
    await addPlayerByHand(page, PLAYER, SPORT);
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
    // His one stint, 1979–1984, on the older team, saved.
    await page.getByRole("button", { name: "Add team" }).click();
    // The token finds both eras; the older one is picked by its whole name.
    await page.getByRole("textbox", { name: "Search teams" }).fill(NEW);
    await page
      .getByRole("listbox", { name: "Team typeahead results" })
      .getByRole("option", { name: new RegExp(`^Add ${escapeRe(OLD)}`) })
      .click();
    await expect(teamChip(page, OLD)).toBeVisible();
    await page.getByLabel(/Stint from year/).fill("1979");
    await page.getByLabel(/Stint to year/).fill("1984");
    await page.getByRole("button", { name: "Add stint" }).click();
    const stints = page.getByRole("list", { name: "Career history" }).getByRole("listitem");
    await expect(stints).toHaveCount(1);
    await expect(stints.first()).toContainText(`${OLD} · 1979–1984`);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(new RegExp(`Saved ${escapeRe(PLAYER)}`))).toBeVisible();

    // Back: the set builder, on the same empty checklist.
    await page.goBack();
    await expect(setBuilderReady(page)).toBeVisible();
    await expect(empty).toBeVisible();

    // ── The card: one row, his name, the older team's name plus a name nobody holds ──
    await usePastedChecklist(page, `number,player,team\n1,${PLAYER},${OLD} / ${NOT_A_TEAM}\n`, 1);
    await syncChecklistButton(page).click();
    const opened = await settleWalkAfterCommit(page, page.getByText(/Saved 1 card/).first());
    expect(opened, `the unknown printed name ${NOT_A_TEAM} opens the walk`).toBe(true);
    const walk = tidyWalk(page);
    await expect(walk).toHaveAccessibleName(tidyUpName({ year: YEAR, set: SET }));
    await expectCardsLeft(page, 1);
    await expect(tidyCardHeader(page, `#1 · ${PLAYER}`)).toBeVisible();

    // ── STEP 1: the Team tile shows the player's era, linked for the operator ──
    const team = tidyTile(page, "Team");
    const oldRow = team.getByRole("group", { name: `Team ${OLD}`, exact: true });
    const otherRow = team.getByRole("group", { name: `Team ${NOT_A_TEAM}`, exact: true });
    // Positive: the printed name is answered with the OLDER team, NeonBinder's link (the purple
    // note), and the operator can Change it.
    await expect(oldRow.getByText(OLD, { exact: true })).toBeVisible();
    await expect(oldRow.getByRole("note")).toHaveText(/^Linked for you/);
    await expect(
      oldRow.getByRole("button", { name: new RegExp(`^Change team ${escapeRe(OLD)}$`), disabled: false }),
    ).toBeVisible();
    // Negative, read against it: nothing asks about that name (no era choice, no "Not a team"),
    // and the year's own pick, the newer team, is nowhere on the tile.
    await expect(oldRow.getByText(/^Which team: /)).toHaveCount(0);
    await expect(oldRow.getByRole("button", { name: /^Not a team/ })).toHaveCount(0);
    await expect(team.getByText(NEW, { exact: true })).toHaveCount(0);
    // The tile is pink only for the other printed name.
    await expect(pinkTile(page, "Team")).toHaveCount(1);
    await expect(otherRow.getByText(`“${NOT_A_TEAM}” isn't linked to a team yet.`)).toBeVisible();
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, a two-era team name linked to the player's era" });

    // The other name is no team: the tile stops being pink, and the card is done.
    await otherRow.getByRole("button", { name: `Not a team ${NOT_A_TEAM}`, exact: true }).click();
    await expect(otherRow.getByText(`${NOT_A_TEAM} is not a team.`)).toBeVisible();
    await expect(pinkTile(page, "Team")).toHaveCount(0);
    await saveAndNext(page);
    await expect(walk.getByText("All tidy. Nothing on this checklist needs you.")).toBeVisible();
    await finishTidyWalk(page);

    // ── STEP 2: the commit wrote the older team onto the card, and only it ──
    await editCardButton(page, "1").click();
    const drawer = page.getByRole("dialog");
    await expect(teamChip(drawer, OLD)).toBeVisible();
    await expect(teamChip(drawer, NEW)).toHaveCount(0);
    await expect(teamChip(drawer, NOT_A_TEAM)).toHaveCount(0);
    await expectAccessible(page, { within: drawer, label: "Card drawer, the player's era on the card" });
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(drawer).toBeHidden();
  },
);
