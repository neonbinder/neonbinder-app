// Origin: .maestro/flows/set-selector/card-title-uses-short-name-for-titles.yaml (Maestro suite retired in NEO-341; see git history)
//
// R1 - ONE feature (NEO-535, NEO-609, the listing-title cut order): a card's
// title is built to fit eBay's 80 characters by cutting in a fixed order,
// never a word of the set's description, and what it had to leave out is said
// under the field, read from the text the field holds now. A title that cannot
// fit after every cut takes the set's "Set name in titles" verbatim, and so does
// one that says it left something out (NEO-637); a title that left nothing out
// keeps the builder's own description. The collector's card search reads the
// description, which keeps everything.
//   * NEO-609: each level names itself and then its variant type's name, in the
//     singular ("<row> Insert"); the type name is a quiet cut (row 5) and goes
//     before the "#" rule is ever tried (the rule starts at the Tidy Up line).
//   * Card Q's full title is EXACTLY 81 characters: the "Insert" type name goes
//     (quiet), and its "#" stays.
//   * Card A is 81 once every quiet cut is made (the type name, the sport):
//     only the "#" of its card number goes then (the 81 rule), nothing is
//     reported left out.
//   * Card B's longer number cannot come back even bare: the number goes, the
//     player's full name stays, and the drawer says "Left out to fit: #<num>".
//     Typing the number back into the field takes the note away at once (the
//     note is read from the field's text, not from the generated assessment:
//     the NEO-535 stale-note fix), and Regenerate brings both back.
//   * Card C sits under an insert whose name never fits: its stored title is
//     over 80 after every cut, so the Tidy Up walk (NEO-645) shows its
//     "Listing title" tile PINK and open for editing. The tile's "Shorten the
//     set name for every card" writes the insert row's "Set name in titles"
//     (the same value the Attributes panel shows, placeholder the builder's own
//     description), and card C's title then opens with it VERBATIM, nothing
//     prepended.
//   * /collection's "Find a card" finds card B by its number, a word only its
//     DESCRIPTION holds now that the title dropped it.
//   * NEO-606, teams (cut row 9): card D's team has a Location and a Name, and
//     dropping the location is the cut that makes the title fit, so its STORED
//     title (written at creation, no Regenerate) names the team by its
//     nickname and nothing is reported left out. Card E's team has the same
//     length and no location: it can only go whole, and the note names it in
//     full.
//   * NEO-637: once the row holds a "Set name in titles", a card added under it
//     takes the box only when its own title would show the yellow line. Card F
//     (card Q's shape) leaves nothing out and is stored with the builder's
//     description; card G (card B's shape) would leave its number out, so it is
//     stored from the box, the number back and no line.
//
// R2 - what makes it fail if the feature breaks:
//   * Every title is a full-string match computed from the cut rules (below),
//     so a different cut order, a lost "#" rule, a cut description word or a
//     prepended year/maker each fail on the value.
//   * The "Left out to fit" absences are paired with the "Title built from"
//     chips, which render only once Regenerate's preview has answered, so a
//     note that never loaded cannot pass for "nothing left out".
//   * Card C's stored title, read back in the drawer after the walk, is the
//     full-string box title: a set name the tile kept to itself, or one the
//     server prefixed with the year and maker, fails there; the panel's value
//     fails if the tile wrote anywhere but the row's "Set name in titles".
//   * The search asserts the one hit by its accessible name, which ends in the
//     card's number: a title-only search finds nothing for that word.
//   * Card D's title holds the nickname and not the location, and card E's
//     holds no team at all: a team dropped whole where its location would do
//     (or a location dropped where the team has none) fails on the value.
//   * Card F's value opens with the description, not the box (a box applied to a
//     title that left nothing out fails there), and card G's opens with the box
//     and holds the number (a box held back from a title with the line fails).
//
// Desktop and mobile - CardDetailPanel and the Attributes panel render the
// same controls with the same names at phone width; only widths change (the
// drawer is 95vw on a phone and a 45rem side panel on a desktop, the panel's
// grid one column instead of two). STEP 3 asserts that one difference with
// `isMobile`; nothing else branches.
//
// R3 - `checklist-title-length-refused-and-trimmed-on-the-listing-title-tile`
// owns the 80-character refusal of a TYPED title (the over-cap editor's lines,
// Regenerate in the tile) and the variation cap;
// `tidy-up-long-set-name-shortened-for-every-card-title` owns the tile's live
// set-name preview and the retitle of the OTHER cards. This spec owns the cut
// order through Regenerate, the drawer's note, the tile's set name landing on
// the row's "Set name in titles" (panel and stored title), and the
// description search.
//
// R7a / data isolation - a PER-ATTEMPT hand-made set `ttl<token>…` under the
// REAL Baseball / 2024 / Topps (SET-REGISTRY.md, prefix `ttl`): the quick-add
// PlayerPicker searches the set's sport, where the reference catalogue's
// Baseball rows live. `Insert` > `Rw<token>…` (cards Q, A, B, D, E) and
// `Insert` > the long insert (card C) beneath it, all hand-made, so no
// marketplace call fires. The row is a minted token, not the reserved-looking
// "Base" the spec used before NEO-609: a single-token row keeps the level's
// own name and its "Insert" type name apart in every assertion (R7a).
// The player is the catalogue's George Brett (one Baseball row, read only; the
// same row `tidy-up-team-tile-offers-the-whole-career-unpicked-when-no-stint-covers-the-year`
// reads). Nothing is deleted: the set is this attempt's alone. Cards Q, A, B
// and C carry no team (the walk records card C as "No team on this card", its own card only);
// D and E carry one each, made in the New team dialog for this attempt
// (minted single tokens, GUIDE "Minted names"; a team is never looked up).
//
// Fixture arithmetic - exact on every runner (computed with the generator,
// `assessListingTitle`). ATTEMPT_TOKEN is 12 characters at most and varies with
// the worker and the random tail, so the set name and the row are that token
// padded to SET_LEN / ROW_LEN characters, and every length below is fixed:
//   description  "2024 Topps <set> <row>" = 11 + 15 + 1 + 14 = 41; the row
//                sits under the "Insert" type, so the title says "<row>
//                Insert" (the type name, cut row 5).
//   card Q       41 + " Insert" 7 + " George Brett" 13 + " #<Q>" 11 +
//                " Baseball" 9 = 81. The type name goes (74) and it fits; the
//                "#" rule is never reached. The refill cannot put it back (81).
//   card A       the same with a 25-character number: 97. The type name (90)
//                and the sport (81) go, then at exactly 81 the "#" alone: 80.
//   card B       the same with a 31-character number: 103. The type name
//                (96), the sport (87), the number (54); the refill tries the
//                number first, but even bare it makes 86, so it stays out
//                and the sport and the type name come back: 70, full name.
//   card C       "2024 Topps <set> <60-character insert> Brett" is 93 after
//                every cut (the description, the surname): STOP, kept over
//                the cap. With the box (42 characters) it is 68.
//   card D       41 + " Insert" 7 + 13 + " #D1" 4 + " <15-character location>
//                <15-character nickname>" 32 + " Baseball" 9 = 106. Cuts: the
//                type name (99), the sport (90), the team's location (74): it
//                fits. Neither the sport (83) nor the type name (81) fits back.
//   card E       the same, with ONE 31-character team name and no location:
//                the type name, the sport, then the team whole (58); the
//                refill puts the sport and the type name back: 74.
//   card F       card Q's shape (a 9-character number), added once the row's
//                box is "2024 Topps <set>" (26): 74 with nothing left out, so
//                the box is not used.
//   card G       card B's shape (a 31-character number): without the box 70
//                with the number left out; with it 26 + 13 + 33 = 72, the
//                sport (81) the one quiet cut, nothing left out.
// Card B's number leads with `NB<token>`, a single token (GUIDE, minted names)
// the search index splits off at the hyphen; no other card holds it.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { drillToCustom, escapeRe, openAttributesPanel, setBuilderReady } from "../../support/set-builder";
import { editCardButton } from "../../support/cards";
import { goViaShell } from "../../support/collection";
import { expectOverCapLook } from "../../support/theme";
import {
  answerPinkTeamTiles,
  expectTidyWalkOpen,
  finishTidyWalk,
  mustFixLine,
  pinkTile,
  saveAndNext,
  tidyFooterButton,
  tidyTile,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";
import type { Page } from "@playwright/test";

const SET_LEN = 15;
const ROW_LEN = 14;
const PLAYER = "George Brett";
const LONG_INSERT = "Commemorative Anniversary Collectors Edition Hologram Series";
const NUM_Q = "Q9-123456"; // 9 characters
const NUM_A = "91A-AA1234567890123456789"; // 25 characters
const NUM_C = "C1";
const NUM_D = "D1";
const NUM_E = "E1";
const NUM_F = "F9-123456"; // card Q's shape, 9 characters

/** A team made in the New team dialog: `location` set only when the team has one. */
type NewTeam = { name: string; location?: string };

/**
 * Quick-add one card under the open checklist, linked to the catalogue's
 * George Brett and, when `team` is given, to a team made for it in the New
 * team dialog.
 */
async function addBrettCard(page: Page, number: string, team?: NewTeam): Promise<void> {
  await page.getByRole("button", { name: "Open add card form" }).click();
  const cardName = page.getByRole("textbox", { name: "Card name", exact: true });
  await expect(cardName).toBeVisible();
  await page.getByRole("textbox", { name: "Card number", exact: true }).fill(number);
  await page.getByRole("button", { name: "Add a player to the new card" }).click();
  const findPlayer = page.getByRole("textbox", { name: "Find a player for the new card" });
  await findPlayer.fill(PLAYER);
  // The catalogue row, picked ("Add <name>", full match).
  await page.getByRole("option", { name: `Add ${PLAYER}`, exact: true }).click();
  await expect(page.getByRole("button", { name: `Remove player ${PLAYER}` })).toBeVisible();
  // Close the player popover (it covers Submit) by focusing another field.
  await cardName.click();
  await expect(findPlayer).toBeHidden();
  if (team) {
    const fullName = team.location ? `${team.location} ${team.name}` : team.name;
    await page.getByRole("button", { name: "Add team" }).click();
    const teamSearch = page.getByRole("textbox", { name: "Search teams" });
    await teamSearch.fill(team.name);
    // NEO-331: the create row shows while the rows of an earlier query are still
    // held, and Enter is dropped then; "No matches." is this query's verdict.
    await expect(page.getByText("No matches.", { exact: true })).toBeVisible();
    await teamSearch.press("Enter");
    const newTeam = page.getByRole("dialog", { name: `New team: ${team.name}` });
    await expect(newTeam).toBeVisible();
    await expect(newTeam.getByRole("textbox", { name: "New team name" })).toHaveValue(team.name);
    if (team.location) {
      await newTeam.getByRole("textbox", { name: "New team location (optional)" }).fill(team.location);
    }
    await newTeam.getByRole("button", { name: `Create team ${fullName}` }).click();
    await expect(newTeam).toBeHidden();
    await expect(page.getByRole("button", { name: `Remove team ${fullName}` })).toBeVisible();
    // Focusing another field closes the team search.
    await cardName.click();
    await expect(teamSearch).toBeHidden();
  }
  await page.getByRole("button", { name: "Submit new card" }).click();
  await expect(cardName).toBeHidden();
  await expect(editCardButton(page, number)).toBeVisible();
}

test(
  "Listing titles - the cut order drops the # at 81, then the number before a first name, says what it left out, and an over-cap card's Listing title tile sets the row's Set name in titles, used verbatim",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env, isMobile }) => {
    const set = `ttl${env.ATTEMPT_TOKEN}`.padEnd(SET_LEN, "x");
    expect(set, "the set name is exactly SET_LEN characters on every runner").toHaveLength(SET_LEN);
    const row = `Rw${env.ATTEMPT_TOKEN}`.padEnd(ROW_LEN, "x");
    expect(row, "the row is exactly ROW_LEN characters on every runner").toHaveLength(ROW_LEN);
    expect([NUM_Q.length, NUM_A.length]).toEqual([9, 25]);
    const searchToken = `NB${env.ATTEMPT_TOKEN}`;
    const numB = `${searchToken}-`.padEnd(31, "0");
    expect(numB, "card B's number is 31 characters on every runner").toHaveLength(31);
    const box = `2024 Topps ${set} Hologram Series`;

    const description = `2024 Topps ${set} ${row}`;
    const head = `${description} Insert ${PLAYER}`;
    const titleQ = `${description} ${PLAYER} #${NUM_Q} Baseball`;
    const titleA = `${description} ${PLAYER} ${NUM_A}`;
    const titleB = `${head} Baseball`;
    const titleCOver = `2024 Topps ${set} ${LONG_INSERT} Brett`;
    const titleCBox = `${box} ${PLAYER} #${NUM_C} Baseball`;
    expect(description, "the description is 41 characters").toHaveLength(41);
    expect([titleQ.length, titleA.length, titleB.length, titleCOver.length, titleCBox.length]).toEqual([
      74, 80, 70, 93, 68,
    ]);
    // NEO-606: card D's team has a location to give up, card E's (the same
    // length, one name) has none. Single tokens padded to a fixed length.
    const teamD: NewTeam = {
      location: `Lc${env.ATTEMPT_TOKEN}`.padEnd(15, "x"),
      name: `Nk${env.ATTEMPT_TOKEN}`.padEnd(15, "x"),
    };
    const teamE: NewTeam = { name: `Wh${env.ATTEMPT_TOKEN}`.padEnd(31, "x") };
    const teamDFull = `${teamD.location} ${teamD.name}`;
    expect([teamDFull.length, teamE.name.length], "both teams are 31 characters on every runner").toEqual([31, 31]);
    const titleD = `${description} ${PLAYER} #${NUM_D} ${teamD.name}`;
    const titleE = `${head} #${NUM_E} Baseball`;
    expect([titleD.length, titleE.length]).toEqual([74, 74]);
    // NEO-637: the Rw row's own box, and the two cards added under it.
    const rwBox = `2024 Topps ${set}`;
    const numG = `G${env.ATTEMPT_TOKEN}`.padEnd(31, "0");
    expect(numG, "card G's number is 31 characters on every runner").toHaveLength(31);
    const titleF = `${description} ${PLAYER} #${NUM_F} Baseball`;
    const titleG = `${rwBox} ${PLAYER} #${numG}`;
    expect([rwBox.length, titleF.length, titleG.length]).toEqual([26, 74, 72]);

    const drawer = page.getByRole("dialog", { name: /^Card #/ });
    const cardTitle = drawer.getByRole("textbox", { name: "Card title", exact: true });
    const regenerate = drawer.getByRole("button", { name: "Regenerate card title" });
    const builtFrom = drawer.getByRole("list", { name: "Title built from" });
    const leftOut = drawer.getByText(/^Left out to fit: /);
    const overCap = drawer.getByRole("alert").filter({ hasText: /over the 80-character limit/ });
    const doneEditing = page.getByRole("button", { name: "Done editing card" });

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // R9: Baseball > 2024 > Topps > ttl… > Insert > Rw…, checklist open.
    await drillToCustom(page, {
      sport: "Baseball",
      year: "2024",
      manufacturer: "Topps",
      set,
      variantType: "Insert",
      variant: row,
    });

    // ── STEP 1: cards Q, A and B, the same player under the same description ──
    await addBrettCard(page, NUM_Q);
    await addBrettCard(page, NUM_A);
    await addBrettCard(page, numB);

    // ── STEP 1b (NEO-609): card Q, 81 in full, gives up its type name, not its "#" ──
    // Stored at creation. The type name is a quiet cut, made before the "#"
    // rule is tried, and neither is ever reported left out.
    await editCardButton(page, NUM_Q).click();
    await expect(cardTitle).toBeVisible();
    await expect(cardTitle).toHaveValue(titleQ);
    await expect(builtFrom.getByRole("listitem").filter({ hasText: `#${NUM_Q}` })).toBeVisible();
    // The row's chip is labelled with its type's name in the singular.
    const rowChip = builtFrom.getByRole("listitem").filter({ hasText: row });
    await expect(rowChip.getByText("Insert", { exact: true })).toBeVisible();
    await expect(leftOut).toHaveCount(0);
    await doneEditing.click();
    await expect(cardTitle).toBeHidden();

    // ── STEP 2: card A, 81 after the quiet cuts, loses only its "#" ──
    await editCardButton(page, NUM_A).click();
    await expect(cardTitle).toBeVisible();
    await regenerate.click();
    await expect(cardTitle).toHaveValue(titleA);
    // The preview has answered (its chips are drawn from it), and nothing is
    // reported: the bare number is still the number, and a "#" removed on its
    // own is never listed.
    await expect(builtFrom.getByRole("listitem").filter({ hasText: `#${NUM_A}` })).toBeVisible();
    await expect(leftOut).toHaveCount(0);
    await expectAccessible(page, { within: drawer, label: "Card drawer, title at 81 loses only its #" });
    await doneEditing.click();
    await expect(cardTitle).toBeHidden();

    // ── STEP 3: card B, the number goes and the full name stays ──
    await editCardButton(page, numB).click();
    await expect(cardTitle).toBeVisible();
    await regenerate.click();
    await expect(cardTitle).toHaveValue(titleB);
    await expect(builtFrom.getByRole("listitem").filter({ hasText: `#${numB}` })).toBeVisible();
    // Exactly the number: no first name, no sport, no label is reported.
    await expect(leftOut).toHaveText(`Left out to fit: #${numB}`);
    await expectAccessible(page, { within: drawer, label: "Card drawer, number left out to fit" });
    // Phone vs desktop (the one layout difference in this flow): the drawer is
    // `w-full max-w-[95vw]` below the sm breakpoint and 45rem above it; the
    // Attributes panel only goes from one column to two. Same controls, same
    // names on both, so only the drawer's width is asserted per project, and
    // the note must sit inside the viewport either way.
    const viewport = page.viewportSize();
    const drawerBox = await drawer.boundingBox();
    if (!viewport || !drawerBox) throw new Error("the drawer and the viewport must be measurable");
    if (isMobile) {
      expect(drawerBox.width, "on a phone the drawer takes the width (95vw)").toBeGreaterThan(viewport.width * 0.9);
    } else {
      expect(drawerBox.width, "on a desktop the drawer is a side panel").toBeLessThan(viewport.width * 0.8);
    }
    await leftOut.scrollIntoViewIfNeeded();
    await expect(leftOut).toBeInViewport();

    // The note follows the field: typing the number back takes it off at once
    // (the title is then over the cap, which the drawer says, and is not saved).
    await cardTitle.fill(`${titleB} #${numB}`);
    await expect(overCap).toBeVisible();
    await expect(leftOut).toHaveCount(0);
    await expectAccessible(page, { within: drawer, label: "Card drawer, number typed back, note gone" });
    // Regenerate asks twice over typed text, then puts the generated title and
    // its note back.
    await regenerate.click();
    await expect(drawer.getByText("Regenerate again to replace the title you have typed.")).toBeVisible();
    await regenerate.click();
    await expect(cardTitle).toHaveValue(titleB);
    await expect(leftOut).toHaveText(`Left out to fit: #${numB}`);
    await expect(overCap).toHaveCount(0);
    await doneEditing.click();
    await expect(cardTitle).toBeHidden();

    // ── STEP 3b (NEO-606): a team gives up its location before it goes ──
    // Card D: the location is the cut that makes it fit, so the title it was
    // stored with at creation (no Regenerate here) names the team by its
    // nickname, and nothing is reported left out: a location is not a team,
    // and the type name and the sport are quiet cuts.
    // The chips are drawn from the preview, so they prove the note has loaded.
    await addBrettCard(page, NUM_D, teamD);
    await editCardButton(page, NUM_D).click();
    await expect(cardTitle).toBeVisible();
    await expect(cardTitle).toHaveValue(titleD);
    await expect(builtFrom.getByRole("listitem").filter({ hasText: `#${NUM_D}` })).toBeVisible();
    await expect(leftOut).toHaveCount(0);
    await expectAccessible(page, { within: drawer, label: "Card drawer, a team named by its nickname to fit" });
    await doneEditing.click();
    await expect(cardTitle).toBeHidden();
    // Card E: a team with no location can only be dropped whole (a Tidy Up
    // cut), and the yellow note names it in full.
    await addBrettCard(page, NUM_E, teamE);
    await editCardButton(page, NUM_E).click();
    await expect(cardTitle).toBeVisible();
    await expect(cardTitle).toHaveValue(titleE);
    await expect(leftOut).toHaveText(`Left out to fit: ${teamE.name}`);
    await doneEditing.click();
    await expect(cardTitle).toBeHidden();

    // ── STEP 4: card C, under an insert whose name never fits ──
    await drillToCustom(page, {
      sport: "Baseball",
      year: "2024",
      manufacturer: "Topps",
      set,
      variantType: "Insert",
      variant: LONG_INSERT,
    });
    await addBrettCard(page, NUM_C);
    await editCardButton(page, NUM_C).click();
    await expect(cardTitle).toBeVisible();
    // Stored at creation: every cut made, still over 80, kept as it is (no
    // description word is cut to force a fit), and the drawer says so.
    await expect(cardTitle).toHaveValue(titleCOver);
    await expect(overCap).toBeVisible();
    await expectAccessible(page, { within: drawer, label: "Card drawer, title over 80 after every cut" });
    await doneEditing.click();
    await expect(cardTitle).toBeHidden();

    // ── STEP 4b (NEO-645): the walk's Listing title tile shortens the set name ──
    // Card C is pink (over the cap, and no team), the only card of this
    // checklist the pill counts. Its Listing title tile opens ready to edit.
    const setNameInTitles = page.getByRole("textbox", { name: "Value for Set name in titles" });
    const pill = page.getByRole("button", { name: "1 needs you, 1 to fix", exact: true });
    await expect(pill).toBeVisible();
    await pill.click();
    await expectTidyWalkOpen(page, { title: tidyUpName({ year: "2024", set, variant: LONG_INSERT }) });
    const walk = tidyWalk(page);
    const titleTile = tidyTile(page, "Listing title");
    const walkTitle = titleTile.getByRole("textbox", { name: `Card title for #${NUM_C}`, exact: true });
    const overLine = titleTile.getByText("Over the limit, so it opens ready to edit.", { exact: true });
    await expect(titleTile).toHaveAccessibleDescription(/To fix/);
    await expect(walkTitle).toHaveValue(titleCOver);
    await expect(titleTile.getByText(`${titleCOver.length}/80`, { exact: true })).toBeVisible();
    // NEO-606: the whole box says "too long": invalid to a screen reader, and
    // the error pink on its edge and on the line.
    await expect(walkTitle).toHaveAttribute("aria-invalid", "true");
    await expectOverCapLook(walkTitle, overLine);
    // Pink holds Save & next, and the footer says why.
    await expect(tidyFooterButton(page, "saveAndNext")).toBeDisabled();
    await expect(mustFixLine(page)).toBeVisible();
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, a title over 80 after every cut" });

    // "Shorten the set name for every card": the title box follows the name
    // typed, and the save writes it to this checklist's row.
    await titleTile.getByRole("button", { name: "Shorten the set name for every card", exact: true }).click();
    const setNameBox = titleTile.getByRole("textbox", { name: "Set name in titles", exact: true });
    await expect(setNameBox).toBeFocused();
    await setNameBox.fill(box);
    await expect(walkTitle).toHaveValue(titleCBox);
    await expect(walkTitle).not.toHaveAttribute("aria-invalid", "true");
    await titleTile.getByRole("button", { name: "Save and apply to all 1 card", exact: true }).click();
    await expect(titleTile.getByRole("status").filter({ hasText: /^Set name saved\./ })).toBeVisible();
    // The open card is retitled at once: no longer pink, shown as text, the
    // editor closed.
    await expect(titleTile.getByText(titleCBox, { exact: true })).toBeVisible();
    await expect(pinkTile(page, "Listing title")).toHaveCount(0);
    await expect(walkTitle).toHaveCount(0);
    await expect(titleTile.getByRole("button", { name: "Edit title", exact: true })).toBeVisible();

    // The card has no team: say so, and the card is done. The answer
    // regenerates the title (NEO-645 C7), which keeps the row's new set name.
    await answerPinkTeamTiles(page, { noTeam: "noTeamOnCard" });
    await expect(titleTile.getByText(titleCBox, { exact: true })).toBeVisible();
    await saveAndNext(page);
    await expect(walk.getByText("All tidy. Nothing on this checklist needs you.", { exact: true })).toBeVisible();
    await finishTidyWalk(page);
    await expect(editCardButton(page, NUM_C)).toBeVisible();
    await expect(pill).toHaveCount(0);

    // ── STEP 5: the tile wrote the row's "Set name in titles" ──
    await expect(page.getByRole("heading", { name: `Attributes for ${LONG_INSERT}` })).toBeVisible();
    await openAttributesPanel(page);
    await expect(setNameInTitles).toHaveValue(box);
    // The placeholder is still the description this row's cards get without one.
    await expect(setNameInTitles).toHaveAttribute("placeholder", `2024 Topps ${set} ${LONG_INSERT}`);
    await expectAccessible(page, { label: "Set attributes panel, Set name in titles row" });

    // ── STEP 6: card C's stored title takes it verbatim ──
    // THE FEATURE: the box text opens the title as typed (a prepended year or
    // maker would read "2024 Topps 2024 Topps …"), and the card's own tokens
    // follow in full. The chips are a live read of the card's facts.
    await editCardButton(page, NUM_C).click();
    await expect(cardTitle).toHaveValue(titleCBox);
    await expect(builtFrom.getByRole("listitem").filter({ hasText: box })).toBeVisible();
    await expect(overCap).toHaveCount(0);
    await expect(leftOut).toHaveCount(0);
    await expectAccessible(page, { within: drawer, label: "Card drawer, title from Set name in titles" });
    await doneEditing.click();
    await expect(cardTitle).toBeHidden();

    // ── STEP 6b (NEO-637): the box reaches only a title that left something out ──
    // Back on the Rw row, give it a box of its own, then add two cards under it.
    // The insert reads the box through the same rule as Regenerate and the wizard.
    await drillToCustom(page, {
      sport: "Baseball",
      year: "2024",
      manufacturer: "Topps",
      set,
      variantType: "Insert",
      variant: row,
    });
    await expect(page.getByRole("heading", { name: `Attributes for ${row}` })).toBeVisible();
    await openAttributesPanel(page);
    await expect(setNameInTitles).toHaveValue("");
    await expect(setNameInTitles).toHaveAttribute("placeholder", description);
    await setNameInTitles.fill(rwBox);
    await setNameInTitles.press("Enter");
    await expect(page.getByText(/Saved Set name in titles/)).toBeVisible();
    await expect(setNameInTitles).toHaveValue(rwBox);
    // The save and the card writes below go from this tab in order, so the
    // cards are inserted with the box already stored.
    await addBrettCard(page, NUM_F);
    await addBrettCard(page, numG);
    // Card F leaves nothing out (only the quiet type name goes), so no line and
    // no box: the builder's own description opens it.
    await editCardButton(page, NUM_F).click();
    await expect(cardTitle).toBeVisible();
    await expect(cardTitle).toHaveValue(titleF);
    await expect(builtFrom.getByRole("listitem").filter({ hasText: `#${NUM_F}` })).toBeVisible();
    await expect(leftOut).toHaveCount(0);
    await doneEditing.click();
    await expect(cardTitle).toBeHidden();
    // Card G would leave its number out (the line), so the box opens it and the
    // number is back: nothing is reported left out.
    await editCardButton(page, numG).click();
    await expect(cardTitle).toBeVisible();
    await expect(cardTitle).toHaveValue(titleG);
    await expect(builtFrom.getByRole("listitem").filter({ hasText: rwBox })).toBeVisible();
    await expect(leftOut).toHaveCount(0);
    await expectAccessible(page, { within: drawer, label: "Card drawer, a title that left something out takes the row's box" });
    await doneEditing.click();
    await expect(cardTitle).toBeHidden();

    // ── STEP 7: the collector's search reads the description ──
    // Card B's title dropped its number; its description keeps it.
    await goViaShell(page, isMobile, "Collection");
    await expect(page.getByRole("heading", { level: 1, name: "Collection" })).toBeVisible();
    const find = page.getByRole("search").getByRole("textbox", { name: "Find a card" });
    await find.fill(searchToken);
    const search = page.getByRole("search");
    await expect(search.getByRole("status")).toHaveText("1 card matches. Enter opens them all in Checklists.");
    const hit = search.getByRole("button", {
      name: new RegExp(`^${escapeRe(PLAYER)}, .*, #${escapeRe(numB)}\\. Show it in Checklists$`),
    });
    await expect(hit).toBeVisible();
    await expectAccessible(page, { label: "My Cards, a card found by a word only its description holds" });

    // The hit opens the card in Checklists; Back returns to the search.
    await hit.click();
    await expect(page).toHaveURL(/[?&]tab=checklists/);
    // The card's own checklist, named "<season> <set> <row>".
    await expect(page.getByRole("region", { name: `2024 ${set} ${row}` })).toBeVisible();
    await expect(find).toBeHidden();
    await page.goBack();
    await expect(page).not.toHaveURL(/[?&]tab=checklists/);
    await expect(find).toBeVisible();
  },
);
