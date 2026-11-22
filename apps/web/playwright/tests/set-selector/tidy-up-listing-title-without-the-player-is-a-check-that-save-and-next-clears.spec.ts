// R1 - ONE feature (NEO-645, `titleNoPlayer`): a card that names a player but whose stored
// listing title carries none of the player's surname is BLUE, "to check": its row mark says
// "listing title has no player in it", it counts in the "N need you" pill with no ", M to fix"
// suffix, and on the Tidy Up walk its Listing title tile reads "To check" with the tile's note.
// Blue never holds the card: Save & next is usable, and pressing it marks the item seen, so the
// mark and the pill go while the typed title stays as it was.
//
// The fixture, on two hand-added cards linked to the catalogue's George Brett (read only), each
// with its own minted team (so neither has anything pink), and each title TYPED in the drawer:
//   #1 "… Royals icon": no "Brett" anywhere -> the blue item.
//   #2 "… BRETT Royals icon": the surname in capitals -> no item (COUNTER-FIXTURE: the rule reads
//      the surname as a whole word with the case folded, not "typed vs generated").
//
// R2 - the precondition (mark on #1, none on #2 beside its row, the pill's exact text), the walk's
// count and tile description, the usable Save & next with no "to fix" line, and after the press the
// end screen, the mark and pill gone beside the row, and the typed title read back unchanged.
// Back from the end screen lands on #1 again, its tile no longer "To check".
//
// R3 - not here: the cut title (`tidy-up-walk-one-card-at-a-time`), over 80 and the variation trim
// (`checklist-title-length-refused-and-trimmed-on-the-listing-title-tile`).
//
// Desktop and mobile - the walk is full-screen on a phone with the same names; nothing branches.
// axe (light and dark) on the checklist with the blue mark and on the walk's blue tile.
//
// R7a / data isolation - a PER-ATTEMPT hand-made set `tnp<token>` under the REAL Baseball > 2024 >
// Topps, `Insert` > `Base`, no marketplace id beneath it (SET-REGISTRY.md, prefix `tnp`); two cards
// and two minted teams `Tnpa<token>t` / `Tnpb<token>t`, single tokens, all made in the UI. The
// catalogue player is only linked, never written. Nothing is deleted: the set is this attempt's.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { drillToCustom, setBuilderReady } from "../../support/set-builder";
import { addCardViaForm, createTeamInCardForm, editCardButton, escapeRe } from "../../support/cards";
import {
  expectCardsLeft,
  mustFixLine,
  needsYouPill,
  openTidyWalk,
  saveAndNext,
  saveForLater,
  tidyCardHeader,
  tidyFooterButton,
  tidyTile,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";

const PLAYER = "George Brett";

test(
  "Tidy Up Listing title tile — a title with no player in it is a blue check that Save & next marks seen",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const token = env.ATTEMPT_TOKEN;
    const set = `tnp${token}`;
    const drill = {
      sport: "Baseball",
      year: "2024",
      manufacturer: "Topps",
      set,
      variantType: "Insert",
      variant: "Base",
    } as const;
    const missing = { number: "1", team: `Tnpa${token}t`, title: `2024 Topps ${set} #1 Royals icon` };
    const said = { number: "2", team: `Tnpb${token}t`, title: `2024 Topps ${set} #2 BRETT Royals icon` };
    const anyMark = (n: string) =>
      page.getByRole("img", { name: new RegExp(`^Card ${escapeRe(n)}(, [^:]+)? (needs attention|is worth a check): `) });
    // The ONLY reason on the row, and blue: nothing else on the card is worth a check.
    const noPlayerMark = (n: string) =>
      page.getByRole("img", {
        name: new RegExp(`^Card ${escapeRe(n)}(, [^:]+)? is worth a check: listing title has no player in it$`),
      });
    const drawer = page.getByRole("dialog", { name: /^Card #/ });
    const drawerTitle = drawer.getByRole("textbox", { name: "Card title", exact: true });
    const walk = tidyWalk(page);
    const titleTile = tidyTile(page, "Listing title");
    const noPlayerNote = titleTile.getByText("The title has no player. This card names one, so check it.", {
      exact: true,
    });

    /** One card, linked to the catalogue's George Brett in the form's PlayerPicker, with its own minted team. */
    async function addBrettCard(card: { number: string; team: string }): Promise<void> {
      await addCardViaForm(page, {
        cardNumber: card.number,
        playerName: PLAYER,
        beforeSubmit: async () => {
          await page.getByRole("button", { name: "Add a player to the new card" }).click();
          const findPlayer = page.getByRole("textbox", { name: "Find a player for the new card" });
          await findPlayer.fill(PLAYER);
          // Full match, so another player whose name merely contains "Brett" cannot answer.
          await page.getByRole("option", { name: `Add ${PLAYER}`, exact: true }).click();
          await expect(page.getByRole("button", { name: `Remove player ${PLAYER}` })).toBeVisible();
          await page.getByRole("textbox", { name: "Card name", exact: true }).click();
          await expect(findPlayer).toBeHidden();
          await createTeamInCardForm(page, card.team);
        },
      });
      await expect(editCardButton(page, card.number)).toBeVisible();
    }

    /** Type the card's title by hand in the drawer (Enter saves it) and close the drawer. */
    async function typeTitle(card: { number: string; title: string }): Promise<void> {
      await editCardButton(page, card.number).click();
      await expect(drawerTitle).toBeVisible();
      // Generated from the linked player: the title says Brett until it is typed over.
      await expect(drawerTitle).toHaveValue(/\bBrett\b/);
      await drawerTitle.fill(card.title);
      await drawerTitle.press("Enter");
      await expect(drawer.getByText(/Saved Card title/)).toBeVisible();
      await expect(drawerTitle).toHaveValue(card.title);
      await drawer.getByRole("button", { name: "Done editing card" }).click();
      await expect(drawer).toBeHidden();
    }

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });
    await drillToCustom(page, drill);

    await addBrettCard(missing);
    await addBrettCard(said);
    // Generated titles carry the player, so neither card is marked yet (each beside its row).
    await expect(anyMark(missing.number)).toHaveCount(0);
    await expect(anyMark(said.number)).toHaveCount(0);
    await expect(needsYouPill(page)).toHaveCount(0);

    await typeTitle(missing);
    await typeTitle(said);

    // ── The precondition: #1 is blue for the title alone; #2 (BRETT in capitals) is clean ──
    await expect(noPlayerMark(missing.number)).toBeVisible();
    await expect(editCardButton(page, said.number)).toBeVisible();
    await expect(anyMark(said.number)).toHaveCount(0);
    // Blue only: the pill counts the card and says nothing is to fix (its text is its name).
    await expect(needsYouPill(page)).toHaveText("1 needs you");
    await expectAccessible(page, { label: "Checklist with a worth-a-check mark for a title with no player" });

    // ── The walk: one card, its Listing title tile "To check" with the tile's note ──
    await openTidyWalk(page, { title: tidyUpName({ year: "2024", set }) });
    await expect(tidyCardHeader(page, `#${missing.number} · ${PLAYER}`)).toBeVisible();
    await expectCardsLeft(page, 1);
    await expect(titleTile).toHaveAccessibleDescription("To check");
    await expect(noPlayerNote).toBeVisible();
    await expect(titleTile.getByText(missing.title, { exact: true })).toBeVisible();
    // Blue never holds the card: Save & next is usable and no "to fix" line shows.
    await expect(tidyFooterButton(page, "saveAndNext", { usable: true })).toBeVisible();
    await expect(mustFixLine(page)).toHaveCount(0);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, Listing title tile with no player in the title" });

    // ── Save & next marks it seen: the walk ends ──
    await saveAndNext(page);
    await expect(walk.getByText("All tidy. Nothing on this checklist needs you.", { exact: true })).toBeVisible();
    await expectCardsLeft(page, 0);

    // Back steps to the card: seen now, so its tile is no longer "To check" and the note is gone.
    await page.goBack();
    await expect(tidyCardHeader(page, `#${missing.number} · ${PLAYER}`)).toBeVisible();
    await expect(titleTile.getByText(missing.title, { exact: true })).toBeVisible();
    await expect(titleTile).not.toHaveAccessibleDescription("To check");
    await expect(noPlayerNote).toHaveCount(0);
    await saveForLater(page);

    // ── The checklist: the mark and the pill are gone; the typed title was not touched ──
    await expect(editCardButton(page, missing.number)).toBeVisible();
    await expect(anyMark(missing.number)).toHaveCount(0);
    await expect(needsYouPill(page)).toHaveCount(0);
    await editCardButton(page, missing.number).click();
    await expect(drawerTitle).toHaveValue(missing.title);
    await drawer.getByRole("button", { name: "Done editing card" }).click();
    await expect(drawer).toBeHidden();
  },
);
