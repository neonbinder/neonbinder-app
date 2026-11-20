// Origin: .maestro/flows/set-selector/checklist-attention-badge-and-filter.yaml (Maestro suite retired in NEO-341; see git history)
// NEO-102 / NEO-335: a stored card with NO team is badged on its row and counted
// by the checklist header's amber "N need you" pill ("1 needs you" for one). The
// pill replaced the filter chip, the "Fix them one at a time" link and Fill
// teams; what the filter proved (WHICH rows are flagged) is now proved by the
// walker the pill opens: it opens on the lowest-numbered flagged card, closing it
// mid-walk leaves that card counted, and skipping that card ends the walk
// (NEO-467: no count to read). Card 3 is born linked to a team AND a player
// (quick-add pickers) and is neither badged nor counted; the player is read back
// from its drawer, the quick-add create path's only E2E proof since NEO-335
// retired set-fill-teams-from-teammate-card.
//
// NEO-343: the checklist search's "attention" keyword lists exactly the cards
// the pill counts, by the same rule, and ANDs with another term. Proved here
// because this is the spec whose data GUARANTEES a flagged card (a hand-added
// card with no team has no automatic team source, so it is flagged at once);
// a marketplace fetch flags a card only if its team string resolves to no NB
// team. The search control itself is checklist-search-narrows-and-clears'.
// Searching is client-side and writes nothing.
//
// Card 3's number is a bare "703" (NEO-609). Its title names its linked player
// and team, and since NEO-609 a title that has to give up a whole team is a
// Tidy Up card ("auto-generated title was cut short"), which the pill counts
// too. With "703-<ATTEMPT_ID>" the number alone ran the title past 80 whenever
// the attempt's random tail was long (a coin toss per run, not a project
// difference), so card 3 joined the count. The set is this attempt's own, so
// the bare number is unique; the title keeps "2024 Topps <set> Base <player>
// #703 <team>" whole for every worker, at most 80 characters (computed with the
// real generator; only the quiet cuts, the sport and the "Insert" type name, go).
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { setBuilderReady, drillToCustom } from "../../support/set-builder";
import { addCardViaForm, editCardButton, escapeRe } from "../../support/cards";
import { recordedNoMatchPlayer } from "../../support/recorded-names";
import type { Page } from "@playwright/test";
import { TIDY_UP_NAME } from "../../support/wizard";

/** Raise a brand-new team through the card form's team picker. */
async function addNewTeam(page: Page, name: string) {
  await page.getByRole("button", { name: "Add team" }).click();
  const search = page.getByRole("textbox", { name: "Search teams" });
  await expect(search).toBeVisible();
  await search.fill(name);
  // The picker is keyboard-first: Enter on a name no team has opens "New team".
  // (Its dropdown can sit below the fold of the card form, so no click here.)
  await expect(page.getByRole("button", { name: `New team ${name}` })).toBeVisible();
  // NEO-331: Enter on the create row is dropped while the rows are HELD from an
  // earlier query; "No matches." is the verdict for THIS query, so wait for it.
  await expect(page.getByText("No matches.")).toBeVisible();
  await search.press("Enter");
  const dialog = page.getByRole("dialog", { name: `New team: ${name}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "New team name" })).toHaveValue(name);
  await expectAccessible(page, { within: dialog, label: `New team dialog for ${name}` });
  await dialog.getByRole("button", { name: `Create team ${name}` }).click();
  await expect(page.getByRole("button", { name: `Remove team ${name}` })).toBeVisible();
}

test(
  "Checklist attention — a card with no team is badged and counted in the header's need-you pill; a card born linked is neither",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const id = env.ATTEMPT_ID;
    const token = env.ATTEMPT_TOKEN;
    const n701 = `701-${id}`;
    const n702 = `702-${id}`;
    const n703 = "703";
    const badge = (number: string) =>
      page.getByRole("img", { name: new RegExp(`^Card ${escapeRe(number)}(, .*)? needs attention: no team on this card yet$`) });
    /** This attempt's three cards, by number. */
    const ours = `(?:${escapeRe(n701)}|${escapeRe(n702)}|${n703})`;
    const teamB = `CNAB${token}`;
    const teamA = `CNAA${token}`;
    // A REAL person whose Baseball lookup the enrichment recording holds as a
    // no-match (support/recorded-names.ts): the quick-add create makes no live
    // Wikidata call. Fresh-only for that reason: re-seed before re-running.
    const player = recordedNoMatchPlayer(env, "checklist-attention-badge-and-filter");
    // The header pill: its visible text is its accessible name, so the exact
    // name IS the exact count.
    const pill = (name: string) => page.getByRole("button", { name, exact: true });

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });
    await drillToCustom(page, {
      sport: "Baseball",
      year: "2024",
      manufacturer: "Topps",
      set: `cna-${env.WORKER_INDEX}-${id}`,
      variantType: "Insert",
      variant: "Base",
    });

    // Two cards with no team, one with a team.
    await addCardViaForm(page, { cardNumber: n701, playerName: `AttnAlpha${token}` });
    await addCardViaForm(page, { cardNumber: n702, playerName: `AttnBravo${token}` });
    await addCardViaForm(page, {
      cardNumber: n703,
      playerName: `AttnCharlie${token}`,
      beforeSubmit: async () => {
        await expectAccessible(page, { label: "Add card form" });
        // The quick-add player picker (NEO-220). Its results popover opens below the
        // field and is fixed to the viewport, so a user lifts the form first (same
        // fold trap as card-player-picker-cross-sport).
        await page.getByRole("heading", { name: "Add Card" }).hover();
        await page.mouse.wheel(0, 250);
        await page.getByRole("button", { name: "Add a player to the new card" }).click();
        await page.getByRole("textbox", { name: "Find a player for the new card" }).fill(player);
        // No player of this name is on file yet, so Create is the answer for it.
        await page.getByRole("option", { name: `Create player ${player}` }).click();
        await expect(page.getByRole("button", { name: `Remove player ${player}` })).toBeVisible();
        // The popover hangs over the Team picker: leave the picker to close it.
        await page.getByRole("textbox", { name: "Card name", exact: true }).click();
        await expect(page.getByRole("textbox", { name: "Find a player for the new card" })).toBeHidden();
        await addNewTeam(page, teamB);
        // Leaving the picker closes its search.
        await page.getByRole("textbox", { name: "Card name", exact: true }).click();
        await expect(page.getByRole("textbox", { name: "Search teams" })).toBeHidden();
      },
    });
    await expect(page.getByText(teamB).first()).toBeVisible();

    // Only the team-less cards are badged, and the header counts them.
    await expect(badge(n701)).toBeVisible();
    await expect(badge(n702)).toBeVisible();
    await expect(pill("2 need you")).toBeVisible();
    // Card 3 carries no mark of any kind: no team question and no title one.
    await expect(page.getByRole("img", { name: new RegExp(`^Card ${n703}(, .*)? needs attention: `) })).toHaveCount(0);
    await expectAccessible(page, { label: "Checklist with attention badges and count" });

    // The player was STORED, read where only the stored row can put it: the row
    // prints no player and an unbadged card says nothing either way, so the
    // drawer's picker chip (off the live query) is the read-back.
    await editCardButton(page, n703).click();
    const born = page.getByRole("dialog", { name: /^Card #/ });
    await expect(born.getByRole("button", { name: `Remove player ${player}` })).toBeVisible();
    await born.getByRole("button", { name: "Done editing card" }).click();
    await expect(born.getByRole("button", { name: `Remove player ${player}` })).toBeHidden();

    // Give card 702 a team through its drawer: its badge goes, the count drops.
    await page.getByRole("button", { name: new RegExp(`^Edit card 702-${id}(, .*)?$`) }).click();
    const cardName = page.getByRole("textbox", { name: "Card name", exact: true });
    await expect(cardName).toBeVisible({ timeout: 15_000 });
    await expectAccessible(page, { within: page.getByRole("dialog", { name: /^Card #/ }), label: "Card detail drawer" });
    await addNewTeam(page, teamA);
    await expect(page.getByText(/Saved Teams/)).toBeVisible();
    await cardName.click();
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(badge(n702)).toBeHidden();
    await expect(badge(n701)).toBeVisible();
    await expect(pill("1 needs you")).toBeVisible();
    await expect(page.getByText(teamA).first()).toBeVisible();

    // NEO-343 — "attention" in the checklist search lists the one flagged card
    // the pill counts, out of the set's three, and every row it lists carries
    // the attention mark. Rows and marks are scoped to this attempt's cards.
    const search = page.getByRole("searchbox", { name: "Search cards" });
    const rows = page.getByRole("button", { name: new RegExp(`^Edit card ${ours}(, .*)?$`) });
    const marks = page.getByRole("img", { name: new RegExp(`^Card ${ours}(, .*)? needs attention: `) });
    await search.fill("attention");
    await expect(page.getByText("1 of 3 cards", { exact: true })).toBeVisible();
    await expect(editCardButton(page, n701)).toBeVisible();
    await expect(rows).toHaveCount(1);
    await expect(badge(n701)).toBeVisible();
    await expect(marks).toHaveCount(1);
    // A keyword ANDs with the other terms: flagged AND #702 is nothing.
    await search.fill(`attention ${n702}`);
    await expect(page.getByText(`No cards match "attention ${n702}".`)).toBeVisible();
    await expect(page.getByText("0 of 3 cards", { exact: true })).toBeVisible();
    await expect(rows).toHaveCount(0);
    // Escape clears it: all three rows are back.
    await search.press("Escape");
    await expect(search).toHaveValue("");
    await expect(rows).toHaveCount(3);

    // WHICH card: the pill opens the walker on the flagged set and only that. It
    // opens on the lowest-numbered flagged card, #701, and skipping it ends the
    // walk at All clear, so a walker that also held #702 (answered) or #703
    // (born linked) would present that card instead (NEO-467: the header has no
    // count to read the queue's length off). The Skip button is the walker's one
    // card-specific handle (the wizard shares its title). Nothing is answered: a
    // skip defers for this sitting and writes nothing.
    await pill("1 needs you").click();
    const walker = page.getByRole("dialog", { name: TIDY_UP_NAME });
    await expect(walker).toBeVisible();
    const skip701 = walker.getByRole("button", { name: `Skip for now, card ${n701}` });
    await expect(skip701).toBeVisible();
    await expectAccessible(page, { within: walker, label: "Attention walker opened from the need-you pill" });
    // Closed MID-WALK, #701 still presented and unanswered: closing defers, so the
    // pill still counts it and its badge stays.
    await walker.getByRole("button", { name: "Close (Esc)" }).click();
    await expect(walker).toBeHidden();
    await expect(pill("1 needs you")).toBeVisible();
    await expect(badge(n701)).toBeVisible();
    // Opened again, the walker presents #701 again; skipping it is the end of the walk.
    await pill("1 needs you").click();
    await expect(walker).toBeVisible();
    await expect(skip701).toBeVisible();
    await skip701.click();
    // "All clear" opens the done line either way (a team lookup still running
    // on another card adds "for now"; it is not a card to walk).
    await expect(walker.getByText(/^All clear/)).toBeVisible();
    await expect(walker.getByRole("button", { name: /^Skip for now, card / })).toHaveCount(0);
    await walker.getByRole("button", { name: "Done (Esc)" }).click();
    await expect(walker).toBeHidden();
    // Skipping and closing deferred: #701 is still the one flagged card.
    await expect(pill("1 needs you")).toBeVisible();
    await expect(badge(n701)).toBeVisible();
  },
);
