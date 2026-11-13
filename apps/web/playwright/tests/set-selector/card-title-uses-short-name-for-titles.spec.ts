// Origin: .maestro/flows/set-selector/card-title-uses-short-name-for-titles.yaml (Maestro suite retired in NEO-341; see git history)
//
// R1 - ONE feature (NEO-535, the listing-title cut order): a card's title is
// built to fit eBay's 80 characters by cutting in a fixed order, never a word
// of the set's description, and what it had to leave out is said under the
// field, read from the text the field holds now. A title that cannot fit
// after every cut takes the set's "Set name in titles" verbatim, and the
// collector's card search reads the description, which keeps everything.
//   * Card A's full title is EXACTLY 81 characters: only the "#" of its card
//     number goes (the 81 rule), nothing is reported left out.
//   * Card B's longer number cannot come back even bare: the number goes, the
//     player's full name stays, and the drawer says "Left out to fit: #<num>".
//     Typing the number back into the field takes the note away at once (the
//     note is read from the field's text, not from the generated assessment:
//     the NEO-535 stale-note fix), and Regenerate brings both back.
//   * Card C sits under an insert whose name never fits: its stored title is
//     over 80 after every cut. The Attributes panel's "Set name in titles" on
//     that insert row (placeholder: the builder's own description) is then
//     used VERBATIM by Regenerate, with nothing prepended.
//   * /collection's "Find a card" finds card B by its number, a word only its
//     DESCRIPTION holds now that the title dropped it.
//
// R2 - what makes it fail if the feature breaks:
//   * Every title is a full-string match computed from the cut rules (below),
//     so a different cut order, a lost "#" rule, a cut description word or a
//     prepended year/maker each fail on the value.
//   * The "Left out to fit" absences are paired with the "Title built from"
//     chips, which render only once Regenerate's preview has answered, so a
//     note that never loaded cannot pass for "nothing left out".
//   * The search asserts the one hit by its accessible name, which ends in the
//     card's number: a title-only search finds nothing for that word.
//
// R3 - `checklist-title-length-limits-and-fixer` owns the 80-character refusal
// of a TYPED title and the variation cap; `inserts-1996-score-one-nb-set-two-
// bsc-sources` drives the wizard's "Set name in titles" box on a real fetch.
// This spec owns the cut order through Regenerate, the drawer's note, the
// panel row and the description search.
//
// R7a / data isolation - a PER-ATTEMPT hand-made set `ttl<token>…` under the
// REAL Baseball / 2024 / Topps (SET-REGISTRY.md, prefix `ttl`): the quick-add
// PlayerPicker searches the set's sport, where the reference catalogue's
// Baseball rows live. `Insert` > `Base` (cards A, B) and `Insert` > the long
// insert (card C) beneath it, all hand-made, so no marketplace call fires.
// The player is the catalogue's George Brett (one Baseball row, read only; the
// same row `checklist-missing-team-fixer-hand-added-card` reads). Nothing is
// deleted: the set is this attempt's alone, and its cards carry no team.
//
// Fixture arithmetic - exact on every runner. ATTEMPT_TOKEN's length varies
// with the worker and the random tail, so the set name is that token padded to
// SET_LEN characters, and every length below is fixed:
//   description  "2024 Topps <set> Base" = 11 + 21 + 5 = 37; the hand-made
//                insert row "Base" sits under an Insert type, so it is an
//                insert by role and earns the "Insert" label (cut row 4).
//   card A       37 + " Insert" 7 + " George Brett" 13 + " #<A>" 15 +
//                " Baseball" 9 = 81  ->  the "#" alone goes: 80.
//   card B       the same with a 31-character number: 99. Cuts: the label
//                (92), the sport (83), the number (50); the refill tries the
//                number first, but even bare it makes 82, so it stays out
//                and the sport and the label come back: 66, full name.
//   card C       "2024 Topps <set> <60-character insert> Brett" is 99 after
//                every cut (the description, the surname): STOP, kept over
//                the cap. With the box (48 characters) it is 74.
// Card B's number leads with `NB<token>`, a single token (GUIDE, minted names)
// the search index splits off at the hyphen; no other card holds it.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { drillToCustom, escapeRe, setBuilderReady } from "../../support/set-builder";
import { editCardButton } from "../../support/cards";
import { goViaShell } from "../../support/collection";
import type { Page } from "@playwright/test";

const SET_LEN = 21;
const PLAYER = "George Brett";
const LONG_INSERT = "Commemorative Anniversary Collectors Edition Hologram Series";
const NUM_A = "91A-AA1234567"; // 13 characters
const NUM_C = "C1";

/** Quick-add one card under the open checklist, linked to the catalogue's George Brett. */
async function addBrettCard(page: Page, number: string): Promise<void> {
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
  await page.getByRole("button", { name: "Submit new card" }).click();
  await expect(cardName).toBeHidden();
  await expect(editCardButton(page, number)).toBeVisible();
}

test(
  "Listing titles - the cut order drops the # at 81, then the number before a first name, says what it left out, and an over-cap card takes Set name in titles verbatim",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env, isMobile }) => {
    const set = `ttl${env.ATTEMPT_TOKEN}`.padEnd(SET_LEN, "x");
    expect(set, "the set name is exactly SET_LEN characters on every runner").toHaveLength(SET_LEN);
    const searchToken = `NB${env.ATTEMPT_TOKEN}`;
    const numB = `${searchToken}-`.padEnd(31, "0");
    expect(numB, "card B's number is 31 characters on every runner").toHaveLength(31);
    const box = `2024 Topps ${set} Hologram Series`;

    const head = `2024 Topps ${set} Base Insert ${PLAYER}`;
    const titleA = `${head} ${NUM_A} Baseball`;
    const titleB = `${head} Baseball`;
    const titleCOver = `2024 Topps ${set} ${LONG_INSERT} Brett`;
    const titleCBox = `${box} ${PLAYER} #${NUM_C} Baseball`;
    expect([titleA.length, titleB.length, titleCOver.length, titleCBox.length]).toEqual([80, 66, 99, 74]);

    const drawer = page.getByRole("dialog", { name: /^Card #/ });
    const cardTitle = drawer.getByRole("textbox", { name: "Card title", exact: true });
    const regenerate = drawer.getByRole("button", { name: "Regenerate card title" });
    const builtFrom = drawer.getByRole("list", { name: "Title built from" });
    const leftOut = drawer.getByText(/^Left out to fit: /);
    const overCap = drawer.getByRole("alert").filter({ hasText: /over the 80-character limit/ });
    const doneEditing = page.getByRole("button", { name: "Done editing card" });

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // R9: Baseball > 2024 > Topps > ttl… > Insert > Base, checklist open.
    await drillToCustom(page, {
      sport: "Baseball",
      year: "2024",
      manufacturer: "Topps",
      set,
      variantType: "Insert",
      variant: "Base",
    });

    // ── STEP 1: cards A and B, the same player under the same description ──
    await addBrettCard(page, NUM_A);
    await addBrettCard(page, numB);

    // ── STEP 2: card A, exactly 81, loses only its "#" ──
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

    // ── STEP 5: "Set name in titles" on the long insert's row ──
    await expect(page.getByRole("heading", { name: `Attributes for ${LONG_INSERT}` })).toBeVisible();
    const editAttributes = page.getByRole("button", { name: "Edit attributes" });
    const hideAttributes = page.getByRole("button", { name: "Hide attributes" });
    // The panel remembers whether it was left open, so open it only if needed.
    await expect(editAttributes.or(hideAttributes)).toBeVisible();
    if (await editAttributes.isVisible()) await editAttributes.click();
    await expect(hideAttributes).toBeVisible();
    const setNameInTitles = page.getByRole("textbox", { name: "Value for Set name in titles" });
    // Nothing stored: the placeholder is the description this row's cards get.
    await expect(setNameInTitles).toHaveValue("");
    await expect(setNameInTitles).toHaveAttribute("placeholder", `2024 Topps ${set} ${LONG_INSERT}`);
    await expectAccessible(page, { label: "Set attributes panel, Set name in titles row" });
    await setNameInTitles.fill(box);
    // Enter commits a single-line feature field in place (NEO-216); "Saved"
    // waits for the write (NEO-412), so Regenerate below reads the new value.
    await setNameInTitles.press("Enter");
    await expect(page.getByText(/Saved Set name in titles/)).toBeVisible();
    await expect(setNameInTitles).toHaveValue(box);

    // ── STEP 6: Regenerate uses it verbatim ──
    await editCardButton(page, NUM_C).click();
    await expect(cardTitle).toBeVisible();
    await regenerate.click();
    // THE FEATURE: the box text opens the title as typed (a prepended year or
    // maker would read "2024 Topps 2024 Topps …"), and the card's own tokens
    // follow in full.
    await expect(cardTitle).toHaveValue(titleCBox);
    await expect(page.getByText(/Saved Card title/)).toBeVisible();
    await expect(builtFrom.getByRole("listitem").filter({ hasText: box })).toBeVisible();
    await expect(overCap).toHaveCount(0);
    await expect(leftOut).toHaveCount(0);
    await expectAccessible(page, { within: drawer, label: "Card drawer, title from Set name in titles" });
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
    await expect(page.getByRole("region", { name: `2024 ${set} Base` })).toBeVisible();
    await expect(find).toBeHidden();
    await page.goBack();
    await expect(page).not.toHaveURL(/[?&]tab=checklists/);
    await expect(find).toBeVisible();
  },
);
