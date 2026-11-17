// NEO-556: the OFF direction of a "No Team" answer, and its reach into rows made after it.
// R1: the ONE feature is that No Team on a Team row can be turned back off, and that the
// answer in force when a card or a checklist row is made is the answer it is made with.
//   - a checklist row created under a No Team set copies it down (its own Team row reads
//     No Team), so a card added there is born No Team;
//   - turning it off on the set bar un-says it ("Cleared No Team");
//   - on that checklist row: off -> a card added now is teamless and badged; a real team
//     -> a card added now is born with it; No Team again (it replaces the team) -> a card
//     added now is born No Team.
// Cards already made keep what they have (the toast says so): the spec asserts that too.
//
// Hand-made per-attempt set under E2E Test Sport <worker> > 2026 > Topps (R7a; prefix in
// SET-REGISTRY.md). The set carries no marketplace id, so nothing is fetched and no card
// is looked up. Every minted name is a single token. The mark-existing run, the drawer
// and the quick-add toggle are proved in set-no-team-carries-down-to-cards.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { setBuilderReady, drillToCustom, selectOrCreate } from "../../support/set-builder";
import { addCardViaForm, deleteCardButton, confirmDeleteCardButton } from "../../support/cards";
import type { Locator, Page } from "@playwright/test";

test(
  "No Team turns off again — on the set bar and on a checklist row, and a card made after each flip is born with the answer then in force (NEO-556)",
  { tag: ["@smoke", "@set-selector"] },
  async ({ page, signIn, env }) => {
    const A = env.ATTEMPT_ID;
    const T = env.ATTEMPT_TOKEN;
    const SET = `snf-${env.WORKER_INDEX}-${A}`;
    const TEAM = `SNB${T}`;
    const target = {
      sport: `E2E Test Sport ${env.WORKER_INDEX}`,
      year: "2026",
      manufacturer: "Topps",
      set: SET,
    };
    const N = { first: `791-${A}`, off: `792-${A}`, team: `793-${A}`, again: `794-${A}` };
    const NAME = (who: string) => `NoTeam${who}${T}`;

    const panel = page.getByRole("region", { name: "Set attributes panel" });
    const edit = panel.getByRole("button", { name: "Edit attributes" });
    const hide = panel.getByRole("button", { name: "Hide attributes" });
    const toggle = (pressed: boolean) =>
      panel.getByRole("button", { name: "No Team for new cards here", pressed });
    // A checklist row is one run of text: "#<number> <name> <team or No Team> ...". The match
    // stops at the next row's "#" (the list's own text joins every row).
    const rowSays = (n: string, text: string) => page.getByText(new RegExp(`#${n}[^#]*${text}`));
    const badge = (n: string) =>
      page.getByRole("img", { name: new RegExp(`^Card ${n}(, .*)? needs attention: no team on this card yet$`) });
    const teamChip = panel.getByRole("button", { name: `Remove team ${TEAM}` });

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

    // ── STEP 1: the SET answers No Team while it has nothing beneath it (no row follows,
    // no card is touched, so nothing is asked).
    await drillToCustom(page, target);
    await expect(panel.getByRole("heading", { name: `Attributes for ${SET} (Set)` })).toBeVisible();
    await openPanel();
    await expect(toggle(false)).toBeVisible();
    await toggle(false).click();
    await expect(toggle(true)).toBeVisible();
    await expect(
      panel.getByText("No Team: new cards with nothing naming a team get it. Pick a team to replace it."),
    ).toBeVisible();

    // ── STEP 2: a checklist row made NOW copies the answer down, and a card added to it is
    // born No Team.
    await openInsertBase();
    await openPanel();
    await expect(toggle(true)).toBeVisible();
    await expectAccessible(page, { label: "Checklist row's Attributes panel, No Team copied down from the set" });
    await addCardViaForm(page, { cardNumber: N.first, playerName: NAME("Foxtrot") });
    await expect(rowSays("791", "No Team")).toBeVisible();
    await expect(badge(N.first)).toBeHidden();

    // ── STEP 3: off, on the checklist row. It saves straight away; the card already there
    // keeps its answer; a card added now is teamless and badged, not No Team.
    await toggle(true).click();
    await expect(toggle(false)).toBeVisible();
    await expect(page.getByText("Cleared No Team · cards unchanged")).toBeVisible();
    await expect(rowSays("791", "No Team")).toBeVisible();
    await addCardViaForm(page, { cardNumber: N.off, playerName: NAME("Golf") });
    await expect(badge(N.off)).toBeVisible();
    await expect(rowSays("792", "No Team")).toBeHidden();

    // ── STEP 4: a real team on the row. The toggle stays off, the chip shows, and a card
    // added now is born with the team (and the teamless card before it follows).
    await panel.getByRole("button", { name: "Add set team" }).click();
    const find = page.getByRole("textbox", { name: "Find a team for the set" });
    await expect(find).toBeVisible();
    await find.fill(TEAM);
    await expect(page.getByRole("button", { name: `New team ${TEAM}` })).toBeVisible();
    // NEO-331: Enter on the create row is dropped while rows are HELD from an earlier query;
    // "No matches." is the verdict for THIS query.
    await expect(page.getByText("No matches.")).toBeVisible();
    await find.press("Enter");
    const newTeam = page.getByRole("dialog", { name: `New team: ${TEAM}` });
    await expect(newTeam).toBeVisible();
    const league: Locator = newTeam.getByRole("combobox", { name: "League" });
    await league.fill("No lea");
    await newTeam.getByRole("option", { name: "No league" }).click();
    await newTeam.getByRole("button", { name: `Create team ${TEAM}` }).click();
    const apply = page.getByRole("dialog", { name: new RegExp(`^Apply ${TEAM} to this `) });
    await expect(apply).toBeVisible();
    await expectAccessible(page, { within: apply, label: "Apply a team over a checklist row that was No Team" });
    await apply.getByRole("button", { name: "Yes, apply" }).click();
    await expect(teamChip).toBeVisible();
    await expect(toggle(false)).toBeVisible();
    await addCardViaForm(page, { cardNumber: N.team, playerName: NAME("Hotel") });
    await expect(rowSays("793", TEAM)).toBeVisible();
    await expect(badge(N.team)).toBeHidden();
    await expect(rowSays("792", TEAM)).toBeVisible();
    // The card that was stamped No Team keeps it: a team on the row does not take it back.
    await expect(rowSays("791", "No Team")).toBeVisible();

    // ── STEP 5: No Team again replaces the team (the chip goes). It reaches past the row
    // (cards carry the team), so it asks; a card added after is born No Team.
    await toggle(false).click();
    const again = page.getByRole("dialog", { name: /^Set this .+ to No Team\?$/ });
    await expect(again).toBeVisible();
    await expectAccessible(page, { within: again, label: "Set this row to No Team over a team confirm" });
    await again.getByRole("button", { name: "Yes, set No Team" }).click();
    await expect(toggle(true)).toBeVisible();
    await expect(teamChip).toBeHidden();
    await addCardViaForm(page, { cardNumber: N.again, playerName: NAME("India") });
    await expect(rowSays("794", "No Team")).toBeVisible();
    await expect(badge(N.again)).toBeHidden();
    // The cards that carried the team keep it (No Team never moves an existing card).
    await expect(rowSays("793", TEAM)).toBeVisible();

    // ── STEP 6: back on the SET bar: it is still No Team (the checklist row's changes never
    // touched it); off, and the collapsed bar stops saying it.
    await drillToCustom(page, target);
    await expect(panel.getByRole("heading", { name: `Attributes for ${SET} (Set)` })).toBeVisible();
    await openPanel();
    await hide.click();
    await expect(edit).toBeVisible();
    await expect(panel.getByText("No Team", { exact: true })).toBeVisible();
    await edit.click();
    await expect(toggle(true)).toBeVisible();
    await toggle(true).click();
    await expect(toggle(false)).toBeVisible();
    await expect(page.getByText("Cleared No Team · cards unchanged")).toBeVisible();
    await hide.click();
    await expect(edit).toBeVisible();
    await expect(panel.getByText("No Team", { exact: true })).toBeHidden();
    await expectAccessible(page, { label: "Set attributes panel collapsed after No Team was turned off" });

    // Cleanup: every card goes, leaving the checklist empty.
    await openInsertBase();
    await deleteCard(page, N.first, NAME("Foxtrot"));
    await deleteCard(page, N.off, NAME("Golf"));
    await deleteCard(page, N.team, NAME("Hotel"));
    await deleteCard(page, N.again, NAME("India"));
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
  },
);
