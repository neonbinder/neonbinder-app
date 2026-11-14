// NEO-556: "No Team" is a third answer to a set's Team, beside a team and nothing.
// R1: the ONE feature is that answer carrying down: saved on a set it reaches the
// cards born beneath it, the cards already there come along only when the operator
// says so (a run that leaves a card with a team alone), and the same answer is
// one press in a card's drawer.
//
// Per-worker, per-attempt hand-made set under E2E Test Sport <worker> > 2026 >
// Topps (R7a; the prefix is in SET-REGISTRY.md). The set carries no marketplace
// id, so nothing is fetched and no card is looked up (a card with a BSC lookup
// outstanding is held back from No Team; none exists here). Every minted name is
// a single token. "The set's Base" is the Insert > Base row, as in
// set-team-carries-down-to-cards.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { setBuilderReady, drillToCustom, selectOrCreate } from "../../support/set-builder";
import { addCardViaForm, deleteCardButton, confirmDeleteCardButton } from "../../support/cards";
import type { Page } from "@playwright/test";

test(
  "Set-level No Team carries down to cards — new cards are born No Team, the mark-existing run stamps teamless cards and leaves a teamed one, and a card's drawer toggles it (NEO-556)",
  { tag: ["@smoke", "@set-selector"] },
  async ({ page, signIn, env }) => {
    const A = env.ATTEMPT_ID;
    const T = env.ATTEMPT_TOKEN;
    const SET = `snt-${env.WORKER_INDEX}-${A}`;
    const TEAM = `SNA${T}`;
    const target = {
      sport: `E2E Test Sport ${env.WORKER_INDEX}`,
      year: "2026",
      manufacturer: "Topps",
      set: SET,
    };
    const NUMBERS = { bare: `781-${A}`, teamed: `782-${A}`, born: `783-${A}` };

    const panel = page.getByRole("region", { name: "Set attributes panel" });
    const edit = panel.getByRole("button", { name: "Edit attributes" });
    const hide = panel.getByRole("button", { name: "Hide attributes" });
    const cardName = page.getByRole("textbox", { name: "Card name" });
    const removeChip = page.getByRole("button", { name: `Remove team ${TEAM}` });
    // A checklist row is one run of text: "#<number> <name> <team or No Team> ...".
    const rowSays = (n: string, text: string | RegExp) =>
      page.getByText(new RegExp(`#${n}.*${typeof text === "string" ? text : text.source}`));
    const badge = (n: string) =>
      page.getByRole("img", { name: new RegExp(`^Card ${n}(, .*)? needs attention: no team on this card yet$`) });

    async function openPanel() {
      await expect(edit.or(hide)).toBeVisible();
      if (await edit.isVisible()) await edit.click();
      await expect(hide).toBeVisible();
    }

    async function openInsertBase() {
      await selectOrCreate(page, "Variant Types", "Insert", { via: "list" });
      await expect(page.getByRole("heading", { name: "Inserts", exact: true })).toBeVisible();
      await selectOrCreate(page, "Inserts", "Base", { via: "list" });
      await expect(page.getByRole("button", { name: "Open add card form" })).toBeVisible();
    }

    async function deleteCard(p: Page, number: string, nameText: string) {
      await deleteCardButton(p, number).click();
      await expect(p.getByText("Confirm?")).toBeVisible();
      await confirmDeleteCardButton(p, number).click();
      await expect(p.getByText(nameText)).toBeHidden();
    }

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── STEP 1: two cards in the set's Insert > Base, BEFORE the set has an
    // answer. #781 has no team (badged); #782 is born with its own team.
    await drillToCustom(page, { ...target, variantType: "Insert", variant: "Base" });
    await addCardViaForm(page, { cardNumber: NUMBERS.bare, playerName: `NoTeamAlpha${T}` });
    await addCardViaForm(page, {
      cardNumber: NUMBERS.teamed,
      playerName: `NoTeamBravo${T}`,
      beforeSubmit: async () => {
        await page.getByRole("button", { name: "Add team" }).click();
        const search = page.getByRole("textbox", { name: "Search teams" });
        await search.fill(TEAM);
        await expect(page.getByRole("button", { name: `New team ${TEAM}` })).toBeVisible();
        // NEO-331: Enter on the create row is dropped while rows are HELD from an earlier
        // query; "No matches." is the verdict for THIS query.
        await expect(page.getByText("No matches.")).toBeVisible();
        await search.press("Enter");
        const dialog = page.getByRole("dialog", { name: `New team: ${TEAM}` });
        await expect(dialog).toBeVisible();
        await dialog.getByRole("button", { name: `Create team ${TEAM}` }).click();
        await expect(page.getByRole("button", { name: `Remove team ${TEAM}` })).toBeVisible();
        await page.getByRole("textbox", { name: "Card name", exact: true }).click();
        await expect(search).toBeHidden();
      },
    });
    await expect(rowSays("782", TEAM)).toBeVisible();
    await expect(badge(NUMBERS.bare)).toBeVisible();
    await expect(badge(NUMBERS.teamed)).toBeHidden();

    // ── STEP 2: the SET answers No Team. The answer reaches past the row (the
    // Insert and Base rows beneath follow it), so a confirm states that and that
    // cards already here stay as they are.
    await drillToCustom(page, target);
    await expect(panel.getByRole("heading", { name: `Attributes for ${SET} (Set)` })).toBeVisible();
    await openPanel();
    // A toggle's state is its role's "pressed", which a screen reader announces.
    const setToggle = (pressed: boolean) =>
      panel.getByRole("button", { name: "No Team for every card here", pressed });
    await expect(setToggle(false)).toBeVisible();
    await setToggle(false).click();
    const confirm = page.getByRole("dialog", { name: "Set this set to No Team?" });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByText("Every new card here gets No Team.")).toBeVisible();
    await expectAccessible(page, { within: confirm, label: "Set this set to No Team confirm" });
    await confirm.getByRole("button", { name: "Yes, set No Team" }).click();
    // The save's own toast ("Saved No Team · new cards here get No Team") is replaced within
    // a frame or two by the cascade's finish line, as the team path's is (set-team-carries-down),
    // so the finish line is what a user is left to read.
    await expect(page.getByText("Team applied to cards")).toBeVisible();
    await expect(setToggle(true)).toBeVisible();
    await expectAccessible(page, { label: "Set attributes panel with the set at No Team" });

    // ── STEP 3: the follow-up offer counts ONE teamless card (the teamed one is
    // not offered) and a confirm lists what is left alone.
    const offer = page.getByRole("button", { name: "Mark 1 teamless card No Team" });
    await expect(offer).toBeVisible();
    await offer.click();
    const mark = page.getByRole("dialog", { name: "Mark 1 card No Team?" });
    await expect(mark).toBeVisible();
    await expect(mark.getByRole("group", { name: "Cards left as they are" })).toBeVisible();
    await expect(mark.getByText("1 card has a team, and keeps it.")).toBeVisible();
    await expectAccessible(page, { within: mark, label: "Mark teamless cards No Team confirm" });
    await mark.getByRole("button", { name: "Yes, mark them No Team" }).click();

    // ── STEP 4: the run's ledger ends on what it did, per checklist.
    const ledger = page.getByRole("region", { name: "Marked 1 card No Team" });
    await expect(ledger).toBeVisible();
    await expect(ledger.getByText("Base — marked 1 card No Team, left 1 as it is", { exact: true })).toBeVisible();
    await expectAccessible(page, { within: ledger, label: "No Team run ledger, finished" });
    await ledger.getByRole("button", { name: "Dismiss the No Team run" }).click();
    await expect(ledger).toBeHidden();
    // Collapsed, the Team bar still says it.
    await hide.click();
    await expect(edit).toBeVisible();
    await expect(panel.getByText("No Team", { exact: true })).toBeVisible();

    // ── STEP 5: the run moved only the teamless card; a card added now is born No Team.
    await openInsertBase();
    await expect(rowSays("781", "No Team")).toBeVisible();
    await expect(badge(NUMBERS.bare)).toBeHidden();
    await expect(rowSays("782", TEAM)).toBeVisible();
    await expect(rowSays("782", "No Team")).toBeHidden();

    await addCardViaForm(page, { cardNumber: NUMBERS.born, playerName: `NoTeamCharlie${T}` });
    await expect(rowSays("783", "No Team")).toBeVisible();
    await expect(badge(NUMBERS.born)).toBeHidden();

    // ── STEP 6: the drawer. The teamed card takes No Team in one press (its team
    // chip goes), then a team back.
    await page.getByRole("button", { name: new RegExp(`^Edit card ${NUMBERS.teamed}`) }).click();
    await expect(cardName).toBeVisible();
    await expect(removeChip).toBeVisible();
    const cardToggle = (pressed: boolean) =>
      page.getByRole("button", { name: "No Team for this card", pressed });
    await expect(cardToggle(false)).toBeVisible();
    await cardToggle(false).click();
    await expect(page.getByText("Saved No Team", { exact: true })).toBeVisible();
    await expect(cardToggle(true)).toBeVisible();
    await expect(removeChip).toBeHidden();
    await expectAccessible(page, { label: "Card drawer with No Team on the card" });

    await page.getByRole("button", { name: "Add team" }).click();
    const searchTeams = page.getByRole("textbox", { name: "Search teams" });
    await searchTeams.fill(TEAM);
    await expect(page.getByRole("option", { name: new RegExp(`^Add ${TEAM}( · .*)?$`) })).toBeVisible();
    await searchTeams.press("Enter");
    await expect(page.getByText(/Saved Teams/)).toBeVisible();
    await cardName.click();
    await expect(removeChip).toBeVisible();
    await expect(cardToggle(false)).toBeVisible();
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(cardName).toBeHidden();
    await expect(rowSays("782", TEAM)).toBeVisible();

    // Cleanup: all three cards go, leaving the checklist empty.
    await deleteCard(page, NUMBERS.bare, `NoTeamAlpha${T}`);
    await deleteCard(page, NUMBERS.teamed, `NoTeamBravo${T}`);
    await deleteCard(page, NUMBERS.born, `NoTeamCharlie${T}`);
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
  },
);
