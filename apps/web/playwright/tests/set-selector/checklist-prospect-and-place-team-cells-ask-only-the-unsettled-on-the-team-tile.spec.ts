// NEO-591 on the NEO-645 walk (R1): a checklist team cell "Prospect" or "Prospect (X)" makes the
// card a Prospect Card and X is the card's printed TEAM, read like any other team cell (Jason,
// 2026-11-19); a team cell printed as a PLACE settles only when exactly one team in the set's
// league, in any era, is located there, else the card's player's stints decide, else the operator
// is asked (never the set year; Jason, 2026-11-20). The Tidy Up walk asks ONLY what nothing
// settled, each on the card's Team tile:
//   - "Prospect" alone (#1): the card is No Team, a claim, never asked (no walk stop);
//   - "Prospect (Oklahoma Sooners)" (#2): X is a team the catalogue has, so the card links it
//     without asking (its Team tile is plain; the card is in the walk only for its blue Career
//     check: Colt Keith never played for the Sooners);
//   - "Prospect (Dbp<token>)" (#3): X is a team NB has no row for, so it is a pink printed-name row
//     like any unknown team, answered by "+ New team" (the form opens on X) and "Create team";
//   - "Cincinnati Reds / Prospect (Oklahoma Sooners)" (#6): a mixed cell. The preview reads it as
//     printed (before 1a4def6c it read "Prospect (Cincinnati Reds / Oklahoma Sooners)"), and the
//     card carries both teams and is a Prospect Card (plain Team tile, blue Career check);
//   - "Seattle" (#4): two MLB teams are located in Seattle (the 1969 Pilots and the Mariners); the
//     card's player has a Mariners stint, so the card commits with the Seattle Mariners and makes
//     no walk stop;
//   - "Chicago" on a second Seiya Suzuki card (#7): five MLB teams are located there and his one
//     stint among them is the Cubs, so his card commits with the Chicago Cubs and makes no walk
//     stop (NEO-645: a link NeonBinder made is a purple note at most, never a stop);
//   - "New York" (#5): several MLB teams are located there and Seiya Suzuki (a Cub) has a stint on
//     none of them, so nothing settles it. The Team tile asks "Which team: New York" with the
//     place's MLB teams of every era (the Mets and the Yankees, which the set year would not
//     choose between, and the Giants), nothing linked, its "Remember" box settled UNTICKED (a bare
//     place is not a name to remember). Answered "Not a team", the card is a no-team card with no
//     team claim left (NEO-639: only a team the data names holds a guess back), so his one career
//     team in the year, the Cubs, is PRESELECTED ("Seiya Suzuki played here"), never written: the
//     tile stays pink and Save & next held until "Save team". The operator skips it; it commits
//     teamless and stays badged (the commit wrote no Cubs either: "New York" was a claim then).
// The leaf's checklist preview reads each claim as printed, never "We'll look it up": none of
// these cards is looked up.
// R2: the walk's stops are proved by the exact set of card numbers it shows AND its count
// ("N cards left"), each move by the card that lands; Back from the end screen returns to the
// last card.
//
// The fixture is the 5-row CSV fixtures/checklists/prospect-team-cells.csv of catalogue players
// the seed already holds (2024 Topps Chrome Base names, each one player on file, so no player
// row and no lookup), uploaded EDITED in memory (the committed file is pinned by the parser's
// golden snapshot): #2's X is the catalogue's full team name, #3's X is minted per attempt, #5's
// place is New York (the file's "Chicago" is one his stints settle, so it moves to #7), a sixth row
// (#6, Matt McLain) carries the mixed cell and a seventh (#7, Seiya Suzuki again) prints Chicago.
// Uploaded through the leaf's "Add the official checklist" and synced: a checklist-only fetch (the
// set has no marketplace id; the checklist is the one source), so the Sync commits the cards and
// the walk opens on its own. The blue Career checks are left with Save & next (it writes only the
// card's "seen" marks): the catalogue players' careers are not this spec's to write.
//
// FIXTURE (R7a, SET-REGISTRY.md prefix `psp`): ONE hand-made set per attempt, `psp<token>`, under
// the REAL `Baseball` › 2024 › `Topps` (the team and player lookups read the set's sport and
// league, so not a custom sport), `Insert` › `Base`. No marketplace id anywhere beneath it. The
// seven cards are COMMITTED, read back and DELETED at the end; one team is minted per attempt
// (`Dbp<token>`, created on #3's Team tile; it stays, like every minted row); the catalogue's
// players, the Oklahoma Sooners, the Cincinnati Reds, the Seattle Mariners and the Chicago Cubs
// are only read. The set and its rows stand (per attempt, read by no other spec). Re-runnable.
//
// Desktop and mobile: one spec, no branch (role and label locators; click() scrolls).
import { readFileSync } from "node:fs";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import {
  drillToCustom,
  escapeRe,
  setBuilderReady,
  syncChecklistButton,
} from "../../support/set-builder";
import { confirmDeleteCardButton, deleteCardButton, editCardButton } from "../../support/cards";
import {
  matchCardsDialog,
  previewRowCount,
  publishersChecklistButton,
  publishersChecklistChip,
  publishersChecklistDialog,
} from "../../support/published-checklist";
import { tidyUpName } from "../../support/wizard";
import {
  expectCardsLeft,
  expectCardSettled,
  finishTidyWalk,
  mustFixLine,
  pinkTile,
  saveAndNext,
  settleWalkAfterCommit,
  skipCard,
  tidyCardIdentity,
  tidyFooterButton,
  tidyTile,
  tidyWalk,
} from "../../support/tidy-walk";

const FILE = new URL("../../fixtures/checklists/prospect-team-cells.csv", import.meta.url).pathname;
/** The catalogue team a known X names (NCAA; the set's league is MLB, so only its full name links). */
const SOONERS = "Oklahoma Sooners";
/** An answered row's Change: "Change", or "Change team" once the accessibility pass lands (decision 22). */
const CHANGE = /^Change( team)?$/;

/**
 * The committed file with this attempt's edits: #2's X is the catalogue's full team name, #3's X
 * is `minted`, #5's place is one its player never played in, and #6 (the mixed cell) and #7 (a
 * place its player's stint settles) are appended.
 * Throws if the file no longer has the rows the edits name, so a changed fixture fails here by name.
 */
function editedChecklist(minted: string): string {
  const lines = readFileSync(FILE, "utf8").trimEnd().split("\n");
  const cell: Record<string, string> = { "2": `Prospect (${SOONERS})`, "3": `Prospect (${minted})`, "5": "New York" };
  let edited = 0;
  const out = lines.map((line) => {
    const [number, player] = line.split(",");
    if (!(number in cell)) return line;
    edited++;
    return `${number},${player},${cell[number]}`;
  });
  if (edited !== 3) throw new Error(`prospect-team-cells.csv: expected rows #2, #3 and #5, edited ${edited}`);
  return [...out, `6,Matt McLain,Cincinnati Reds / Prospect (${SOONERS})`, "7,Seiya Suzuki,Chicago"].join("\n") + "\n";
}

test(
  "Checklist Prospect and place team cells — a Prospect row is a Prospect Card with X as its team; the walk asks only an unknown X and a place nothing settles, on the Team tile, and every settled cell makes no stop (NEO-591, NEO-645)",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const set = `psp${env.ATTEMPT_TOKEN}`;
    /** The team an unknown X names: minted per attempt, so no catalogue row answers to it. */
    const minted = `Dbp${env.ATTEMPT_TOKEN}`;
    const BARE = { number: "1", player: "Gunnar Henderson", cell: "Prospect" };
    const KNOWN = { number: "2", player: "Colt Keith", cell: `Prospect (${SOONERS})` };
    const UNKNOWN = { number: "3", player: "Bobby Witt Jr.", cell: `Prospect (${minted})` };
    const PLACE = { number: "4", player: "J.P. Crawford", cell: "Seattle", team: "Seattle Mariners" };
    const AMBIGUOUS = { number: "5", player: "Seiya Suzuki", cell: "New York" };
    const MIXED = { number: "6", player: "Matt McLain", cell: `Cincinnati Reds / Prospect (${SOONERS})` };
    const BY_PLAYER = { number: "7", player: "Seiya Suzuki", cell: "Chicago", team: "Chicago Cubs" };
    const CARDS = [BARE, KNOWN, UNKNOWN, PLACE, AMBIGUOUS, MIXED, BY_PLAYER];
    const ROWS = CARDS.length;
    /** The cards the walk stops on: the two team names nothing settled, and the two blue Career checks. */
    const STOPS = [KNOWN, UNKNOWN, AMBIGUOUS, MIXED].map((c) => c.number);
    const target = { sport: "Baseball", year: "2024", manufacturer: "Topps", set, variantType: "Insert", variant: "Base" };
    // A checklist row is one run of text: "#<number> <name> <team or No Team> ...". The list's own
    // text joins every row, so the match stops at the next row's "#" (as set-no-team-* do). The
    // player is read off the row's Edit button.
    const rowSays = (n: string, text: string) => page.getByText(new RegExp(`#${n}[^#]*${escapeRe(text)}`));
    const needsTeam = (n: string, player: string) =>
      page.getByRole("img", { name: `Card ${n}, ${player} needs attention: no team on this card yet` });

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });
    await drillToCustom(page, target);
    // R2 precondition: a fresh per-attempt checklist with no card.
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();

    // ── 1. The leaf's official checklist: each row's Teams cell is the claim as printed ──
    await publishersChecklistButton(page).click();
    const dialog = publishersChecklistDialog(page);
    await expect(dialog).toBeVisible();
    await dialog
      .getByLabel("Choose a file")
      .setInputFiles({ name: "prospect-team-cells.csv", mimeType: "text/csv", buffer: Buffer.from(editedChecklist(minted)) });
    await expect(previewRowCount(dialog, ROWS)).toBeVisible();
    const previewRows = dialog.getByRole("table", { name: "Preview of the rows the sync will use" });
    // Each row found by its own name (number, player, team cell), then its cells exactly. The mixed
    // cell reads as printed: the Prospect bracket holds only the team it held in the file.
    for (const card of CARDS) {
      const row = previewRows.getByRole("row", { name: `${card.number} ${card.player} ${card.cell}`, exact: true });
      await expect(row.getByRole("cell")).toHaveText([card.number, card.player, card.cell]);
    }
    await expect(previewRows.getByText(`Prospect (Cincinnati Reds / ${SOONERS})`)).toHaveCount(0);
    await expect(previewRows.getByText("We'll look it up")).toHaveCount(0);
    await expectAccessible(page, { within: dialog, label: "Official checklist preview with Prospect, mixed and place team cells" });
    await dialog.getByRole("button", { name: "Use this checklist" }).click();
    await expect(dialog).toBeHidden();
    await expect(publishersChecklistChip(page, ROWS)).toBeVisible();

    // ── 2. Sync: one source, so no Match Cards. The cards are saved, then the walk opens ──
    await syncChecklistButton(page).click();
    // The count includes checklist-named teams the operator still settles (New York), as it counts
    // unresolved checklist teams: intended.
    const saved = page.getByText(`Saved ${ROWS} cards. Teams from your checklist: ${ROWS} of ${ROWS} cards.`);
    await expect(saved).toBeVisible();
    expect(await settleWalkAfterCommit(page, saved), "two team names are unsettled, so the walk opened").toBe(true);
    const walk = tidyWalk(page);
    await expect(walk).toHaveAccessibleName(tidyUpName({ year: target.year, set }));
    await expect(matchCardsDialog(page)).toHaveCount(0);
    // #1 (a No Team claim), #4 (Seattle, its one team by his stint) and #7 (Chicago, by his Cubs
    // stint) make no stop.
    await expectCardsLeft(page, STOPS.length);

    // ── 3. The walk, card by card. Its order is (lookups landed, number), so each card is
    //       handled by the number it shows; the set of numbers shown is asserted after. ──
    const seen: string[] = [];
    let lastIdentity: string[] = [];
    for (let i = 0; i < STOPS.length; i++) {
      await expectCardSettled(page);
      const identity = await tidyCardIdentity(page).allTextContents();
      const number = /^#(\S+)/.exec(identity[0] ?? "")?.[1] ?? "";
      expect(STOPS, `the walk stopped on #${number}, which should make no stop`).toContain(number);
      expect(seen, `the walk showed #${number} twice`).not.toContain(number);
      seen.push(number);
      lastIdentity = identity;
      const teamTile = tidyTile(page, "Team");

      if (number === KNOWN.number || number === MIXED.number) {
        // A known X (and the mixed cell's two teams) linked without asking: the Team tile is plain.
        // The card is here for its blue Career check alone.
        const teams = number === KNOWN.number ? [SOONERS] : ["Cincinnati Reds", SOONERS];
        for (const team of teams) {
          await expect(teamTile.getByRole("group", { name: new RegExp(`^Team ${escapeRe(team)}$`) })).toBeVisible();
        }
        await expect(pinkTile(page, "Team")).toHaveCount(0);
        await expect(tidyTile(page, "Career")).toHaveAccessibleDescription(/To check/);
        await expect(mustFixLine(page)).toHaveCount(0);
        await saveAndNext(page);
        continue;
      }

      if (number === UNKNOWN.number) {
        // X is the card's team, asked like any team NB has no row for: the New team form opens with
        // X as the new team's whole name. Created here, it is the card's team.
        await expect(pinkTile(page, "Team")).toHaveCount(1);
        const row = teamTile.getByRole("group", { name: `Team ${minted}`, exact: true });
        await expect(row.getByText(`“${minted}” isn't linked to a team yet.`, { exact: true })).toBeVisible();
        await expect(row.getByText("Checking for teams by that name…")).toHaveCount(0);
        await expectAccessible(page, { within: walk, label: "Tidy Up walk, a Prospect (X) team NB does not have" });
        await row.getByRole("button", { name: "+ New team", exact: true, disabled: false }).click();
        const form = row.getByRole("group", { name: `New team: ${minted}`, exact: true });
        await expect(form.getByRole("textbox", { name: "New team name" })).toHaveValue(minted);
        await form.getByRole("button", { name: /^Create team( .+)?$/, disabled: false }).click();
        await expect(form).toHaveCount(0);
        await expect(row.getByRole("button", { name: CHANGE })).toBeVisible();
        await expect(row.getByRole("button", { name: "Not a team", exact: true })).toHaveCount(0);
        await expect(pinkTile(page, "Team")).toHaveCount(0);
        await saveAndNext(page);
        continue;
      }

      // #5, New York: the place's in-league teams of every era are offered and none is chosen: the
      // two the set year covers (the year never decides between them) and a past era.
      await expect(pinkTile(page, "Team")).toHaveCount(1);
      const place = teamTile.getByRole("group", { name: `Team ${AMBIGUOUS.cell}`, exact: true });
      await expect(place.getByText(`Which team: ${AMBIGUOUS.cell}`, { exact: true })).toBeVisible();
      const placeTeams = place.getByRole("list", { name: /^We've got [0-9]+ teams from New York\. Pick the one on this card\.$/ });
      for (const team of ["New York Mets · 1962–present", "New York Yankees · 1913–present", "New York Giants · 1885–1957"]) {
        await expect(
          placeTeams.getByRole("button", { name: new RegExp(`^Link to ${escapeRe(team)} · (MLB|Major League Baseball)$`) }),
        ).toBeVisible();
      }
      // The box is held while the place's near-match read runs, then settles unticked: a place is no team's name.
      const rememberPlace = place.getByRole("checkbox", { name: `Remember “${AMBIGUOUS.cell}” as a name for this team`, exact: true });
      await expect(rememberPlace).toBeEnabled();
      await expect(rememberPlace).not.toBeChecked();
      await expect(tidyFooterButton(page, "saveAndNext")).toBeDisabled();
      await expect(mustFixLine(page)).toBeVisible();
      await expectAccessible(page, { within: walk, label: "Tidy Up walk, a team printed as an ambiguous place" });

      // "Not a team": New York is the operator's ruling. The card is now a card with no team and no
      // team claim, so his one career team in the year is preselected, with its provenance. A
      // preselect is not a write: the tile stays pink and Save & next held until "Save team" (or
      // "No team on this card") is pressed.
      await place.getByRole("button", { name: "Not a team", exact: true }).click();
      await expect(place.getByText(`${AMBIGUOUS.cell} is not a team.`, { exact: true })).toBeVisible();
      await expect(place.getByRole("button", { name: CHANGE })).toBeVisible();
      await expect(placeTeams).toHaveCount(0);
      await expect(teamTile.getByText("Suggested from career history.", { exact: true })).toBeVisible();
      const cubs = teamTile.getByRole("button", { name: `${BY_PLAYER.team} · ${AMBIGUOUS.player} played here`, exact: true });
      await expect(cubs).toHaveAttribute("aria-pressed", "true");
      await expect(teamTile.getByRole("button", { name: "Save team", exact: true })).toBeVisible();
      await expect(teamTile.getByRole("button", { name: "No team on this card", exact: true })).toBeVisible();
      await expect(pinkTile(page, "Team")).toHaveCount(1);
      await expect(tidyFooterButton(page, "saveAndNext")).toBeDisabled();
      await expectAccessible(page, { within: walk, label: "Tidy Up walk, a place ruled not a team, the card's no-team chips" });
      // Left for later: Skip writes nothing (not the preselected Cubs either), and the card stays teamless.
      await skipCard(page);
    }
    expect([...seen].sort(), "the walk stopped on exactly the unsettled and the blue cards").toEqual([...STOPS].sort());

    // The end screen counts the one card skipped. Back is the last card shown, Forward the end again.
    await expect(walk.getByText("1 card skipped, not ready to list", { exact: true })).toBeVisible();
    await page.goBack();
    await expect(tidyCardIdentity(page)).toHaveText(lastIdentity);
    await page.goForward();
    await expect(walk.getByText("1 card skipped, not ready to list", { exact: true })).toBeVisible();
    await finishTidyWalk(page);

    // ── 4. Read back: the rows, then each card's drawer ──
    for (const card of CARDS) {
      await expect(editCardButton(page, card.number)).toHaveAccessibleName(`Edit card ${card.number}, ${card.player}`);
    }
    await expect(rowSays(BARE.number, "No Team")).toBeVisible();
    await expect(rowSays(KNOWN.number, SOONERS)).toBeVisible();
    await expect(rowSays(UNKNOWN.number, minted)).toBeVisible();
    await expect(rowSays(PLACE.number, PLACE.team)).toBeVisible();
    await expect(rowSays(BY_PLAYER.number, BY_PLAYER.team)).toBeVisible();
    // New York was left, and the preselected Cubs were never saved: that card alone is badged.
    await expect(needsTeam(AMBIGUOUS.number, AMBIGUOUS.player)).toBeVisible();
    for (const card of [BARE, KNOWN, UNKNOWN, PLACE, MIXED, BY_PLAYER]) await expect(needsTeam(card.number, card.player)).toHaveCount(0);

    const teamsOn: Record<string, string[]> = {
      [KNOWN.number]: [SOONERS],
      [UNKNOWN.number]: [minted],
      [PLACE.number]: [PLACE.team],
      [MIXED.number]: ["Cincinnati Reds", SOONERS],
      [BY_PLAYER.number]: [BY_PLAYER.team],
    };
    for (const card of CARDS) {
      await editCardButton(page, card.number).click();
      const drawer = page.getByRole("dialog", { name: `Card #${card.number}` });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole("textbox", { name: "Card name" })).toHaveValue(card.player);
      await expect(drawer.getByRole("button", { name: "No Team for this card" })).toHaveAttribute(
        "aria-pressed",
        card === BARE ? "true" : "false",
      );
      const teams = teamsOn[card.number] ?? [];
      const chips = drawer.getByRole("button", { name: /^Remove team / });
      await expect(chips).toHaveCount(teams.length);
      for (const team of teams) {
        await expect(drawer.getByRole("button", { name: `Remove team ${team}`, exact: true })).toBeVisible();
      }
      // A Prospect row makes a Prospect Card (the mixed cell too); a place row does not.
      const prospect = card === PLACE || card === AMBIGUOUS || card === BY_PLAYER ? "false" : "true";
      await drawer.getByRole("button", { name: "Show features editor" }).click();
      await expect(drawer.getByRole("button", { name: "Value for Prospect Card" })).toHaveAttribute("aria-pressed", prospect);
      if (card === BARE) await expectAccessible(page, { within: drawer, label: "Card drawer of a Prospect Card" });
      await drawer.getByRole("button", { name: "Done editing card" }).click();
      await expect(drawer).toBeHidden();
    }

    // ── 5. Clean up the cards ──
    for (const card of CARDS) {
      await deleteCardButton(page, card.number).click();
      await confirmDeleteCardButton(page, card.number).click();
      await expect(editCardButton(page, card.number)).toHaveCount(0);
    }
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
  },
);
