// ONE FEATURE (NEO-424 rule F, as NEO-602 leaves it): a printed team name that
// no catalogue row settles for the set's year links to the team a COMMITTED
// card of the same set already carries, and the wizard shows that link in its
// Decided list ("· already on another card in this set") with a Change.
//
// NEO-602 (Jason, 2026-11-19) narrowed where set history may answer for a team:
// a name several eras answer to is the players' stints' to settle, or the
// operator's, never set history's (checklist-wizard-set-history-links-across-variants
// now proves that on the Browns). Set history still answers the two shapes no
// other rule settles, and this spec proves both in one fetch:
//   (a) a lone row whose era starts AFTER the set's year: `Fut<token>`, active
//       from 2026, printed on a 2025 card. A card never shows a team's future,
//       so the year refuses it (lib/teams/team-era.ts `pickTeamForYear`), and the
//       set's own committed card is what links it;
//   (b) a name no row holds as its full name or alias, but a committed card's
//       team answers to as its NICKNAME: `Lcn<token> Nic<token>`, printed as
//       `Nic<token>` (the hobby's "Orioles" for "Baltimore Orioles"). The
//       catalogue lookup reads full names and aliases only; set history also
//       keys every team on the set's cards by its nickname (`historyTeamsByIds`).
// The checklist's player has no stints at all, so nothing but the set's history
// can answer either name.
//
// Fixtures through the UI (GUIDE "Fixtures come from the UI"), all in this
// attempt's private sport `aeh<token>` (SET-REGISTRY "Custom sets"), year 2025,
// brand Topps, ONE set `aeg<token>` with two Insert-type variants, all hand-made
// with no marketplace id:
// - the player `Sol Ahs<token>` in Player Management (a minted player in a sport
//   with no `sportConfig.wikidata` makes no lookup);
// - variant A, `Base`: card `1`, added by hand, carrying BOTH teams, each born
//   in the card drawer's New Team dialog (teams are never looked up on creation);
// - variant B, `aei<token>`: two cards from a pasted publisher's checklist,
//   fetched with the checklist as its only source (NEO-496 D10), `1` printing
//   `Fut<token>` and `2` printing `Nic<token>`, both naming the player.
// Every name carries the attempt token, so the spec re-runs on the same seed.
//
// Back (house rule): the set builder -> Players is a navigation; Back returns
// to the set builder with the drill and the empty Base checklist restored.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { addCardViaForm, editCardButton } from "../../support/cards";
import { usePastedChecklist } from "../../support/published-checklist";
import { addPlayerByHand, expectPlayersLoaded } from "../../support/players";
import { drillToCustom, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import { advanceToSave, confirmSaveButton, openDecidedList, reviewWizard, tidyUpName } from "../../support/wizard";
import type { Page } from "@playwright/test";

/** In the open card drawer: create `search` as a new team through the New Team dialog and put it on the card. */
async function createTeamOnCard(
  page: Page,
  search: string,
  fields: { location?: string; from?: string },
  fullName: string,
): Promise<void> {
  await page.getByRole("button", { name: "Add team" }).click();
  await page.getByRole("textbox", { name: "Search teams" }).fill(search);
  await page.getByRole("button", { name: `New team ${search}` }).click();
  const dialog = page.getByRole("dialog", { name: `New team: ${search}` });
  await expect(dialog).toBeVisible();
  if (fields.location) await dialog.getByRole("textbox", { name: "New team location (optional)" }).fill(fields.location);
  if (fields.from) await dialog.getByLabel("New team active from (optional)").fill(fields.from);
  await dialog.getByRole("button", { name: `Create team ${fullName}` }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: `Remove team ${fullName}`, exact: true })).toBeVisible();
}

test(
  "Entity review — a printed team name no catalogue row settles for the set's year (a team from a later year, or a bare nickname) links to the team a committed card of the set carries, and says so",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const SPORT = `aeh${T}`;
    const SET = `aeg${T}`;
    const INSERT = `aei${T}`;
    const PLAYER = `Sol Ahs${T}`;
    const FUTURE = `Fut${T}`; // active from 2026; the set is 2025
    const NICK = `Nic${T}`; // printed bare
    const NICK_FULL = `Lcn${T} ${NICK}`; // the team's full name

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── PART 1: the hand-made 2025 set, its Base checklist empty ──
    const target = (variant: string) => ({ sport: SPORT, year: "2025", manufacturer: "Topps", set: SET, variantType: "Insert", variant });
    await drillToCustom(page, target("Base"));
    const empty = page.getByText("No cards in this checklist yet.");
    await expect(empty).toBeVisible();

    // ── PART 2: the checklist's player, with no stints ──
    await page.getByRole("link", { name: "Players", exact: true }).click();
    await expectPlayersLoaded(page);
    await addPlayerByHand(page, PLAYER, SPORT);
    await expect(page.getByText("No stints recorded yet.")).toBeVisible();
    // Back: the set builder, on the same empty Base checklist.
    await page.goBack();
    await expect(setBuilderReady(page)).toBeVisible();
    await expect(empty).toBeVisible();

    // ── PART 3: variant A's committed card carries both teams ──
    await addCardViaForm(page, { cardNumber: "1", playerName: PLAYER });
    await editCardButton(page, "1").click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByLabel("Team picker")).toBeVisible();
    await createTeamOnCard(page, FUTURE, { from: "2026" }, FUTURE);
    await createTeamOnCard(page, NICK, { location: `Lcn${T}` }, NICK_FULL);
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(drawer).toBeHidden();

    // ── PART 4: variant B's checklist prints both names; set history links them ──
    await drillToCustom(page, target(INSERT));
    await expect(empty).toBeVisible();
    const facts = await usePastedChecklist(page, `number,player,team\n1,${PLAYER},${FUTURE}\n2,${PLAYER},${NICK}`, 2);
    expect(facts.rows).toBe(2);
    await syncChecklistButton(page).click();
    const wizard = reviewWizard(page);
    await expect(wizard).toBeVisible();
    await expect(wizard).toHaveAccessibleName(tidyUpName({ year: "2025", set: SET, variant: INSERT }));
    // Positive: both names were linked for the operator.
    await expect(page.getByText("2 names were linked for you. Give them a look before this saves.").first()).toBeVisible();
    // Negative, read against that: neither name is asked as a team step.
    await expect(wizard.getByRole("heading", { level: 3, name: /^(Which team|New Team): / })).toHaveCount(0);
    await expectAccessible(page, { within: wizard, label: "Entity review wizard, team names linked from the set's history" });

    // The Save step's Decided list says why each was linked, with a Change.
    await advanceToSave(page);
    await expect(wizard.getByText("Save 2 cards?", { exact: true })).toBeVisible();
    const decided = await openDecidedList(page);
    for (const [printed, linkedTo] of [
      [FUTURE, FUTURE],
      [NICK, NICK_FULL],
    ] as const) {
      const row = decided.getByRole("listitem").filter({ has: page.getByText(printed, { exact: true }) });
      await expect(row.getByText(`Linked to ${linkedTo} · already on another card in this set`, { exact: true })).toBeVisible();
      await expect(row.getByRole("button", { name: `Change decision for ${printed}` })).toBeVisible();
    }
    await expectAccessible(page, { within: wizard, label: "Entity review wizard, Save step with set-history team links" });
    await confirmSaveButton(page).click();
    await expect(page.getByText(/^Saved 2 cards\./).first()).toBeVisible();

    // ── PART 5: the commit put each linked team on its card ──
    for (const [number, team, other] of [
      ["1", FUTURE, NICK_FULL],
      ["2", NICK_FULL, FUTURE],
    ] as const) {
      await expect(editCardButton(page, number)).toBeVisible();
      await editCardButton(page, number).click();
      await expect(drawer.getByRole("button", { name: `Remove team ${team}`, exact: true })).toBeVisible();
      await expect(drawer.getByRole("button", { name: `Remove team ${other}`, exact: true })).toHaveCount(0);
      if (number === "2") await expectAccessible(page, { within: drawer, label: "Card drawer, a nickname linked from the set's history" });
      await page.getByRole("button", { name: "Done editing card" }).click();
      await expect(drawer).toBeHidden();
    }
  },
);
