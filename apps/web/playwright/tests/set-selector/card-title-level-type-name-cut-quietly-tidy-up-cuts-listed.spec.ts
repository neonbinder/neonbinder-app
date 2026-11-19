// R1 - ONE feature (NEO-609, the listing title names every level from NB's own
// rows): a level says its own name and then its variant type's name in the
// singular ("Proofs" reads "Proof"), the type name is a quiet cut that is never
// reported, and a title that has to give up a whole team, its number or a first
// name (the cuts past the Tidy Up line) sends the card to Tidy Up, where its
// title is the Card titles question. /N and the level's own name are never cut.
//
// The flow, on one hand-made card under a custom "Proofs" variant type:
//   * Born (quick-add, no print run): the stored title gave up the type name,
//     the sport, the team (no Location, so it can only go whole) and the first
//     name, and the number came back bare; the drawer says "Left out to fit:
//     <team>, Bartholomew" (never the type name or the sport), and the "Title
//     built from" chip for the level is labelled "Proof".
//   * The checklist badges the card "auto-generated title was cut short" and
//     the header pill counts it; the walker opens on its "Card titles" step,
//     whose note, read against the card as it is now, also misses the /25
//     saved after the title was built.
//   * With a print run of 25 saved, the walker's Regenerate keeps "/25" and
//     the level's name, gives up the team, the number and the first name, and
//     the note lists all three. Saved, the walker has walked the card, and the
//     drawer holds that title. A generated title still past the Tidy Up line
//     keeps its flag (only a typed title clears it), so the card's badge and
//     the "1 needs you" pill stay. Back undoes the drill's pick of the level.
//
// R2 - every title is a full-string match computed with the generator
// (`assessListingTitle`), so a type name that is not singular, not cut, cut
// before a quieter token or reported left out, a /N that is cut, or a card that
// never reaches Tidy Up each fail. The "Left out to fit" absences of the type
// name and the sport are proved by the exact note text.
//
// Fixture arithmetic - exact on every runner. ATTEMPT_TOKEN is 12 characters at
// most, so the set name, the surname and the team are padded to fixed lengths;
// the custom sport ("E2E Test Sport <w>", 16 or 17 characters) is cut and never
// fits back, so its length never reaches a title:
//   description "2026 Topps <set 15> <LEVEL 31>" = 58, never cut.
//   born        58 + " Proof" 6 + " Bartholomew <surname 14>" 27 + " #PP-LR7" 8
//               + " <team 20>" 21 + " <sport>" 17-18 = 137-138. Cuts: the type
//               name, the sport, the team, the number, the first name: 73. The
//               refill: the first name (85) does not fit, the number with its
//               "#" (81) does not, bare (80) does. 80.
//   print run   the same with " /25" 4: after the cuts 77; neither the first
//               name (89), the number (85 / 84), the team, the sport nor the type
//               name (83) fits back. 77.
//
// Desktop and mobile - the drawer and the walker render the same controls with
// the same names at phone width; nothing branches.
//
// R3 - `card-title-uses-short-name-for-titles` owns the cut order through the
// Insert type's name, the "#" rule and the box; this spec owns a custom type's
// name as the title says it and the Tidy Up line on a hand-made card.
//
// R7a / data isolation - a PER-ATTEMPT hand-made set `prf<token>…` under the
// worker's custom sport › 2026 › Topps (SET-REGISTRY.md, prefix `prf`), its own
// variant type "Proofs" and level, a minted player (no lookup in the custom
// sport) and a minted team with no Location, all made in the UI for this
// attempt. Nothing is deleted: the set is this attempt's alone.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { columnOption, drillToCustomSet, setBuilderReady } from "../../support/set-builder";
import { editCardButton } from "../../support/cards";
import { tidyUpName } from "../../support/wizard";

/** The custom variant type, named in the plural: the title says it in the singular. */
const TYPE = "Proofs";
const TYPE_AS_SAID = "Proof";
/** The level under it: 31 characters, its own name, never cut. */
const LEVEL = "Pre-Production Proofs Lazer Red";
const FIRST = "Bartholomew";
const NUMBER = "PP-LR7";
const PRINT_RUN = 25;

test(
  "Listing titles - a level names its variant type in the singular and that name is cut quietly, while a team, the number and a first name cut to fit send the card to Tidy Up (NEO-609)",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const set = `prf${env.ATTEMPT_TOKEN}`.padEnd(15, "x");
    const surname = `Qz${env.ATTEMPT_TOKEN}`.padEnd(14, "x");
    const player = `${FIRST} ${surname}`;
    const team = `Tm${env.ATTEMPT_TOKEN}`.padEnd(20, "x");
    const description = `2026 Topps ${set} ${LEVEL}`;
    const bornTitle = `${description} ${surname} ${NUMBER}`;
    const listedTitle = `${description} ${surname} /${PRINT_RUN}`;
    expect([set.length, surname.length, team.length], "padded to fixed lengths on every runner").toEqual([15, 14, 20]);
    expect([description.length, bornTitle.length, listedTitle.length]).toEqual([58, 80, 77]);

    const drawer = page.getByRole("dialog", { name: /^Card #/ });
    const cardTitle = drawer.getByRole("textbox", { name: "Card title", exact: true });
    const builtFrom = drawer.getByRole("list", { name: "Title built from" });
    const leftOut = drawer.getByText(/^Left out to fit: /);
    const doneEditing = page.getByRole("button", { name: "Done editing card" });
    const cardName = page.getByRole("textbox", { name: "Card name", exact: true });

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // R9: <custom sport> > 2026 > Topps > prf… > Proofs > LEVEL, checklist open.
    await drillToCustomSet(page, env, { set, variantType: TYPE, variant: LEVEL });

    // ── STEP 1: one card, a minted player and a team with no Location ──
    await page.getByRole("button", { name: "Open add card form" }).click();
    await expect(cardName).toBeVisible();
    await page.getByRole("textbox", { name: "Card number", exact: true }).fill(NUMBER);
    await page.getByRole("button", { name: "Add a player to the new card" }).click();
    const findPlayer = page.getByRole("textbox", { name: "Find a player for the new card" });
    await findPlayer.fill(player);
    await page.getByRole("option", { name: `Create player ${player}`, exact: true }).click();
    await expect(page.getByRole("button", { name: `Remove player ${player}` })).toBeVisible();
    // Close the player popover (it covers Submit) by focusing another field.
    await cardName.click();
    await expect(findPlayer).toBeHidden();
    await page.getByRole("button", { name: "Add team" }).click();
    const teamSearch = page.getByRole("textbox", { name: "Search teams" });
    await teamSearch.fill(team);
    // NEO-331: "No matches." is this query's verdict; Enter is dropped before it.
    await expect(page.getByText("No matches.", { exact: true })).toBeVisible();
    await teamSearch.press("Enter");
    const newTeam = page.getByRole("dialog", { name: `New team: ${team}` });
    await expect(newTeam.getByRole("textbox", { name: "New team name" })).toHaveValue(team);
    // No Location: the team has no city to give up, so it can only go whole.
    await expect(newTeam.getByRole("textbox", { name: "New team location (optional)" })).toHaveValue("");
    await newTeam.getByRole("button", { name: `Create team ${team}` }).click();
    await expect(newTeam).toBeHidden();
    await expect(page.getByRole("button", { name: `Remove team ${team}` })).toBeVisible();
    await cardName.click();
    await expect(teamSearch).toBeHidden();
    await page.getByRole("button", { name: "Submit new card" }).click();
    await expect(cardName).toBeHidden();
    await expect(editCardButton(page, NUMBER)).toBeVisible();

    // ── STEP 2: the title it was born with ──
    // The type name and the sport went quietly; the team and the first name are
    // Tidy Up cuts, and only those two are reported. The number came back bare.
    await editCardButton(page, NUMBER).click();
    await expect(cardTitle).toHaveValue(bornTitle);
    await expect(leftOut).toHaveText(`Left out to fit: ${team}, ${FIRST}`);
    // The level's chip carries its type's name, said in the singular.
    const levelChip = builtFrom.getByRole("listitem").filter({ hasText: LEVEL });
    await expect(levelChip.getByText(TYPE_AS_SAID, { exact: true })).toBeVisible();
    await expectAccessible(page, { within: drawer, label: "Card drawer, a title that left out a team and a first name" });

    // A print run, saved: the stored title stays as it was until it is rebuilt.
    const printRun = drawer.getByRole("spinbutton", { name: "Print run" });
    await printRun.fill(String(PRINT_RUN));
    await printRun.press("Enter");
    await expect(page.getByText(/Saved Print run/).first()).toBeVisible();
    await expect(cardTitle).toHaveValue(bornTitle);
    await doneEditing.click();
    await expect(cardTitle).toBeHidden();

    // ── STEP 3: Tidy Up has it ──
    const badge = page.getByRole("img", {
      name: new RegExp(`^Card ${NUMBER}(, .*)? needs attention: auto-generated title was cut short$`),
    });
    await expect(badge).toBeVisible();
    const pill = page.getByRole("button", { name: "1 needs you", exact: true });
    await expect(pill).toBeVisible();
    await pill.click();
    const walker = page.getByRole("dialog", { name: tidyUpName({ year: "2026", set, variant: LEVEL }), exact: true });
    await expect(walker.getByRole("button", { name: `Skip for now, card ${NUMBER}` })).toBeVisible();
    await expect(walker.getByText("Card titles", { exact: true })).toBeVisible();
    await expect(walker.getByText("auto-generated title was cut short", { exact: true })).toBeVisible();
    const walkerTitle = walker.getByRole("textbox", { name: `Card title for #${NUMBER}` });
    const walkerLeftOut = walker.getByText(/^Left out to fit: /);
    await expect(walkerTitle).toHaveValue(bornTitle);
    // The note reads the field against the card as it is now: the stored title
    // was built before the print run, so "/25" is missing from it too.
    await expect(walkerLeftOut).toHaveText(`Left out to fit: ${team}, ${FIRST}, /${PRINT_RUN}`);
    await expectAccessible(page, { within: walker, label: "Attention walker, Card titles step for a title cut past the Tidy Up line" });

    // Regenerate with the print run in hand: /25 is never cut, so the number
    // goes too, and the note lists the team, the number and the first name.
    await walker.getByRole("button", { name: "Regenerate card title" }).click();
    await expect(walkerTitle).toHaveValue(listedTitle);
    await expect(walkerLeftOut).toHaveText(`Left out to fit: ${team}, #${NUMBER}, ${FIRST}`);
    await expect(walkerTitle).not.toHaveAttribute("aria-invalid", "true");
    const walkerLevelChip = walker.getByRole("list", { name: "Title built from" }).getByRole("listitem").filter({ hasText: LEVEL });
    await expect(walkerLevelChip.getByText(TYPE_AS_SAID, { exact: true })).toBeVisible();
    await expectAccessible(page, { within: walker, label: "Attention walker, a rebuilt title that keeps its print run" });
    await walkerTitle.press("Enter");
    await expect(walker.getByText(/All clear.*nothing on this checklist needs attention/)).toBeVisible();
    await walker.getByRole("button", { name: /Done \(Esc\)/ }).click();
    await expect(walker).toBeHidden();

    // ── STEP 4: the stored title is the one the walker saved ──
    // It is the generator's own title and still leaves out a team, the number
    // and a first name, so the card stays in Tidy Up: only a typed title
    // clears the flag.
    await expect(badge).toBeVisible();
    await expect(pill).toBeVisible();
    await editCardButton(page, NUMBER).click();
    await expect(cardTitle).toHaveValue(listedTitle);
    await expect(leftOut).toHaveText(`Left out to fit: ${team}, #${NUMBER}, ${FIRST}`);
    await doneEditing.click();
    await expect(cardTitle).toBeHidden();

    // The drill lives in the URL: Back undoes the pick of the level, and its
    // column is open again with the row listed.
    await page.goBack();
    await expect(columnOption(page, "Proofs", LEVEL)).toBeVisible();
    await expect(page.getByRole("button", { name: "Open add card form" })).toBeHidden();
  },
);
