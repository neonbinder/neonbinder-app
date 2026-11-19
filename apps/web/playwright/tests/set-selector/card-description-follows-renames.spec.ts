// R1 - ONE feature (NEO-535): a card's Description (the text the collector's
// card search reads, and eBay's item copy) follows a rename of the player, the
// team or the set it names. The builder's own text is rebuilt from the new
// name; a description an operator wrote is left exactly as typed.
//
// R2 - what makes it fail if the feature breaks:
//   * Card A carries the builder's description. After each rename the drawer's
//     Description box holds the FULL expected text with the new name in it (an
//     exact value, so a fan-out that skipped a rename, rebuilt the wrong line
//     or lost a fact fails on the value), and the old name is gone from it.
//   * Card B links the same player and team but its Description was typed by
//     hand, with the old player name and the old set name in it. The fan-out
//     visits it (same links) and must leave it byte-for-byte.
//   * The collector's "Find a card" is the consumer: the new player name finds
//     card A, and the old one finds card B alone (the hand-written text still
//     says it) and never card A.
//   * Each drawer read follows the rename's own "Saved" line, so a read of
//     the old text before the fan-out landed cannot pass for "unchanged".
//
// Desktop and mobile: every control has the same name at phone width; only the
// shell tabs differ, and `goViaShell` is the one helper that knows.
//
// R7a / data isolation - a PER-ATTEMPT hand-made set `drn<token>` under the
// worker's custom sport (SET-REGISTRY.md, prefix `drn`), renamed to
// `drx<token>` in-flow. The player and the team are minted for this attempt in
// that custom sport, which has no Wikidata mapping, so no lookup is made
// (`recordedNoMatchName` is for REAL sports). Nothing is deleted: the set, its
// two cards, the player and the team stand under their new names.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { setBuilderReady, drillToCustom, drillToCustomSet, customSport, escapeRe } from "../../support/set-builder";
import { editCardButton } from "../../support/cards";
import { expectPlayersLoaded, expectTeamsLoaded, teamsCounter } from "../../support/players";
import { goViaShell } from "../../support/collection";
import type { Page } from "@playwright/test";

/** Quick-add one card linked to `player` and `team` (each either new or already made). */
async function addLinkedCard(
  page: Page,
  card: { number: string; player: string; team: string; made: boolean },
): Promise<void> {
  const { number, player, team, made } = card;
  await page.getByRole("button", { name: "Open add card form" }).click();
  const cardName = page.getByRole("textbox", { name: "Card name", exact: true });
  await expect(cardName).toBeVisible();
  await page.getByRole("textbox", { name: "Card number", exact: true }).fill(number);

  await page.getByRole("button", { name: "Add a player to the new card" }).click();
  const findPlayer = page.getByRole("textbox", { name: "Find a player for the new card" });
  await findPlayer.fill(player);
  await page
    .getByRole("option", { name: made ? `Add ${player}` : `Create player ${player}`, exact: true })
    .click();
  await expect(page.getByRole("button", { name: `Remove player ${player}` })).toBeVisible();
  // A pointerdown outside closes the popover (it covers the team row).
  await cardName.click();
  await expect(findPlayer).toBeHidden();

  await page.getByRole("button", { name: "Add team" }).click();
  const teamSearch = page.getByRole("textbox", { name: "Search teams" });
  await teamSearch.fill(team);
  if (made) {
    await page.getByRole("option", { name: new RegExp(`^Add ${escapeRe(team)}( · .*)?$`) }).click();
  } else {
    // Enter opens the New Team dialog only once the search has answered "none".
    await expect(page.getByText("No matches.")).toBeVisible();
    await teamSearch.press("Enter");
    const newTeam = page.getByRole("dialog", { name: `New team: ${team}` });
    await expect(newTeam).toBeVisible();
    await newTeam.getByRole("button", { name: `Create team ${team}` }).click();
  }
  await expect(page.getByRole("button", { name: `Remove team ${team}` })).toBeVisible();
  await cardName.click();
  await expect(page.getByRole("textbox", { name: "Search teams" })).toBeHidden();

  await page.getByRole("button", { name: "Submit new card" }).click();
  await expect(cardName).toBeHidden();
  await expect(editCardButton(page, number)).toBeVisible();
}

test(
  "Card description follows a player, team and set rename, leaves a hand-written one alone, and the collector's search reads the new name",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env, isMobile }) => {
    const token = env.ATTEMPT_TOKEN;
    const sport = customSport(env);
    const set = `drn${token}`;
    const setNew = `drx${token}`;
    const player = `Pold${token}`;
    const playerNew = `Pnew${token}`;
    const team = `Told${token}`;
    const teamNew = `Tnew${token}`;
    const numA = `71-${env.ATTEMPT_ID}`;
    const numB = `72-${env.ATTEMPT_ID}`;
    const handWritten = `Typed by hand: ${player} of ${set}, kept as I wrote it.`;

    // The builder's text for card A (`generateListingDescription`): the set
    // label, the hand-made Base insert (an insert by role), the player and
    // number, the team and the sport.
    const builtBy = (who: string, club: string, setName: string) =>
      [
        `2026 Topps ${setName} Base card of ${who}, #${numA}.`,
        "Insert: Base.",
        `Team: ${club}.`,
        `Sport: ${sport}.`,
      ].join("\n");

    const drawer = page.getByRole("dialog", { name: /^Card #/ });
    const description = drawer.getByRole("textbox", { name: "Card description", exact: true });
    const cardNameField = drawer.getByRole("textbox", { name: "Card name", exact: true });
    const doneEditing = page.getByRole("button", { name: "Done editing card" });
    /** Open card `num`'s drawer with its Description box on screen (the caller reads it, then closes). */
    const readDescription = async (num: string) => {
      await editCardButton(page, num).click();
      await expect(description).toBeVisible();
    };

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── Fixture: two cards on one player and one team ──
    await drillToCustomSet(page, env, { set, variantType: "Insert", variant: "Base" });
    await addLinkedCard(page, { number: numA, player, team, made: false });
    await addLinkedCard(page, { number: numB, player, team, made: true });

    // Card B's Description is typed by hand, old names and all.
    await readDescription(numB);
    await description.fill(handWritten);
    await cardNameField.click(); // leaving the field saves it
    await expect(page.getByText(/Saved Card description/)).toBeVisible();
    await doneEditing.click();
    await expect(description).toBeHidden();

    // Card A starts with the builder's text, old names in it.
    await readDescription(numA);
    await expect(description).toHaveValue(builtBy(player, team, set));
    await expectAccessible(page, { within: drawer, label: "Card drawer, builder-written description" });
    await doneEditing.click();
    await expect(description).toBeHidden();

    // ── 1. The player is renamed (Players, then Back to the set builder) ──
    await page.goto("/admin/players");
    await expectPlayersLoaded(page);
    await page.getByRole("textbox", { name: "Filter players" }).fill(player);
    await page.getByRole("button", { name: new RegExp(`^${escapeRe(player)}\\b`) }).click();
    await page.getByRole("textbox", { name: "Player name", exact: true }).fill(playerNew);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(new RegExp(`Saved ${escapeRe(playerNew)}`)).first()).toBeVisible();
    await page.goBack();
    await expect(setBuilderReady(page)).toBeVisible();

    await readDescription(numA);
    await expect(description).toHaveValue(builtBy(playerNew, team, set));
    await doneEditing.click();
    await expect(description).toBeHidden();

    // ── 2. The team is renamed (Team Management, then Back) ──
    await page.goto("/admin/teams");
    await expectTeamsLoaded(page);
    await page.getByRole("textbox", { name: "Filter teams" }).fill(team);
    await expect(teamsCounter(page, "1 match")).toBeVisible();
    await page.getByRole("button", { name: team, exact: true }).click();
    await page.getByRole("textbox", { name: "Name", exact: true }).fill(teamNew);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(new RegExp(`Saved ${escapeRe(teamNew)}`))).toBeVisible();
    await page.goBack();
    await expect(setBuilderReady(page)).toBeVisible();

    await readDescription(numA);
    await expect(description).toHaveValue(builtBy(playerNew, teamNew, set));
    await doneEditing.click();
    await expect(description).toBeHidden();

    // ── 3. The set is renamed from the Attributes panel ──
    // The panel names the row picked last, so stop the drill at the set.
    await drillToCustom(page, {
      sport: sport,
      year: "2026",
      manufacturer: "Topps",
      set,
    });
    await expect(page.getByRole("heading", { name: `Attributes for ${set}` })).toBeVisible();
    await page.getByRole("button", { name: `Rename ${set}` }).click();
    const rename = page.getByRole("textbox", { name: `Edit name for ${set}` });
    await expect(rename).toBeVisible();
    await rename.fill(setNew);
    await rename.press("Enter");
    await expect(page.getByRole("heading", { name: `Attributes for ${setNew}` })).toBeVisible();

    await drillToCustomSet(page, env, { set: setNew, variantType: "Insert", variant: "Base" });
    await readDescription(numA);
    await expect(description).toHaveValue(builtBy(playerNew, teamNew, setNew));
    await doneEditing.click();
    await expect(description).toBeHidden();

    // Card B, the hand-written one, is exactly as typed through all three.
    await readDescription(numB);
    await expect(description).toHaveValue(handWritten);
    await doneEditing.click();
    await expect(description).toBeHidden();

    // ── The collector's search reads the NEW names ──
    await goViaShell(page, isMobile, "Collection");
    await expect(page.getByRole("heading", { level: 1, name: "Collection" })).toBeVisible();
    const search = page.getByRole("search");
    const find = search.getByRole("textbox", { name: "Find a card" });
    const hitFor = (who: string, num: string) =>
      search.getByRole("button", {
        name: new RegExp(`^${escapeRe(who)} .*, #${escapeRe(num)}\\. Show it in Checklists$`),
      });
    // Both cards link the renamed player, so both show his NEW name as the hit.
    // The new name is in card A's rebuilt text and is not in card B's typed one.
    await find.fill(playerNew);
    await expect(find).toHaveValue(playerNew);
    await expect(hitFor(playerNew, numA)).toBeVisible();
    await expect(hitFor(playerNew, numB)).toHaveCount(0);
    await expectAccessible(page, { label: "Collection search, a renamed player found" });
    // The old name is still in card B's typed text and nowhere in card A's.
    await find.fill(player);
    await expect(hitFor(playerNew, numB)).toBeVisible();
    await expect(hitFor(playerNew, numA)).toHaveCount(0);
  },
);
