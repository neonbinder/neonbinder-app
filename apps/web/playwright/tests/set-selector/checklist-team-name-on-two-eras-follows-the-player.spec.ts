// ONE FEATURE (NEO-602): when a card's printed team name fits two eras of a
// club, the card's PLAYER picks the era, not the set's year.
//
// The Rickey Henderson case, minted: `Loc<token> Ath<token>` is the 1968–2024
// row's own name AND an alias of `Ath<token>` (2025–present). A 2025 set's year
// covers only the newer row, so before NEO-602 the card silently became the
// newer team's. The card's player has a stint on the OLDER row (1979–1984), so
// the review links the name to the older row, as a VISIBLE decided row the
// operator can Change ("· <player> played there"), and the commit writes that
// team onto the card.
//
// Fixtures through the UI (GUIDE "Fixtures come from the UI"):
// - its OWN per-attempt sport `aes<token>` (SET-REGISTRY "Custom sets": a row
//   above set level goes under a private ancestor), year 2025, brand Topps and
//   ONE set `aer<token>` with Insert > Base, all hand-made with no marketplace id;
// - the player and both teams in Player Management, in that sport: a minted
//   player in a sport with no `sportConfig.wikidata` makes no lookup, and teams
//   are never looked up on creation. The newer team is created FIRST, with the
//   older team's full name as an alias (no row holds that name yet); the older
//   team is then created under it, which the era-aware reverse check allows
//   (1968–2024 against 2025–) once the dialog's second-era confirmation is
//   answered. The stint is on the older team only, so the players' evidence
//   names one row;
// - the card itself from a pasted publisher's checklist (one row). A hand-made
//   leaf with a checklist in play is fetched with the checklist as its only
//   source (NEO-496 D10): no marketplace is asked and the row's names reach the
//   same review gate a marketplace fetch's do.
// Every name carries the attempt token, so the spec re-runs on the same seed.
//
// Back (house rule): the set builder -> Players is a navigation; Back returns
// to the set builder with the drill and the empty checklist restored.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { editCardButton } from "../../support/cards";
import { usePastedChecklist } from "../../support/published-checklist";
import { addPlayerByHand, expectPlayersLoaded } from "../../support/players";
import { drillToCustom, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import { confirmSaveButton, openDecidedList, reviewWizard } from "../../support/wizard";

test(
  "Entity review — a printed team name that fits two eras is linked to the era the card's player played for, not the one the set's year covers",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const SPORT = `aes${T}`;
    const SET = `aer${T}`;
    const PLAYER = `Rick Ahp${T}`;
    const OLD = `Loc${T} Ath${T}`; // 1968–2024: the name is its own
    const NEW = `Ath${T}`; // 2025–present: the name is its alias

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── PART 1: the hand-made 2025 set, its Base checklist empty ──
    await drillToCustom(page, { sport: SPORT, year: "2025", manufacturer: "Topps", set: SET, variantType: "Insert", variant: "Base" });
    const empty = page.getByText("No cards in this checklist yet.");
    await expect(empty).toBeVisible();

    // ── PART 2: the player, the two eras, and his stint on the older one ──
    await page.getByRole("link", { name: "Players", exact: true }).click();
    await expectPlayersLoaded(page);
    await addPlayerByHand(page, PLAYER, SPORT);
    await expect(page.getByText("No stints recorded yet.")).toBeVisible();

    const addTeam = page.getByRole("button", { name: "Add team" });
    const search = page.getByRole("textbox", { name: "Search teams" });

    // The newer team, wearing the older team's full name as an alias.
    await addTeam.click();
    await search.fill(NEW);
    await expect(page.getByText("No matches.")).toBeVisible();
    await search.press("Enter");
    const newDialog = page.getByRole("dialog", { name: `New team: ${NEW}` });
    await expect(newDialog).toBeVisible();
    await newDialog.getByLabel("New team active from (optional)").fill("2025");
    await newDialog.getByRole("textbox", { name: "New team aliases (optional)" }).fill(OLD);
    await newDialog.getByRole("button", { name: `Create team ${NEW}` }).click();
    const newChip = page.getByRole("button", { name: `Remove team ${NEW}`, exact: true });
    await expect(newChip).toBeVisible();
    // A pick, not a stint: the player must have no stint on the newer team.
    await newChip.click();
    await expect(newChip).toBeHidden();

    // The older team. Its token now finds the newer team, so the search types
    // one nothing answers to and the dialog's Name is set (admin-teams-two-eras).
    await addTeam.click();
    await search.fill(`Zzz${T}`);
    await expect(page.getByText("No matches.")).toBeVisible();
    await search.press("Enter");
    const oldDialog = page.getByRole("dialog", { name: `New team: Zzz${T}` });
    await expect(oldDialog).toBeVisible();
    await oldDialog.getByRole("textbox", { name: "New team name" }).fill(NEW);
    await oldDialog.getByRole("textbox", { name: "New team location (optional)" }).fill(`Loc${T}`);
    await oldDialog.getByLabel("New team active from (optional)").fill("1968");
    await oldDialog.getByLabel("New team active to").fill("2024");
    // The dialog finds the name already answered to (by the newer team's alias)
    // and asks for the same confirmation a second era of one name gets; the
    // second Create makes the team (admin-teams-two-eras proves that step).
    const createOld = oldDialog.getByRole("button", { name: `Create team ${OLD}` });
    await createOld.click();
    await expect(
      oldDialog.getByRole("alert").filter({ hasText: /already exists for 2025–present\. Create again to add this as a second era\./ }),
    ).toBeVisible();
    await createOld.click();
    await expect(page.getByRole("button", { name: `Remove team ${OLD}` })).toBeVisible();

    // His stint on the older team, 1979–1984, saved.
    await page.getByRole("heading", { name: "Career history" }).click(); // closes the typeahead
    await page.getByLabel(/Stint from year/).fill("1979");
    await page.getByLabel(/Stint to year/).fill("1984");
    await page.getByRole("button", { name: "Add stint" }).click();
    const stints = page.getByRole("list", { name: "Career history" }).getByRole("listitem");
    await expect(stints).toHaveCount(1);
    await expect(stints.first()).toContainText(`${OLD} · 1979–1984`);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(new RegExp(`Saved ${PLAYER}`))).toBeVisible();

    // Back: the set builder, on the same empty checklist.
    await page.goBack();
    await expect(setBuilderReady(page)).toBeVisible();
    await expect(empty).toBeVisible();

    // ── PART 3: the card, from a one-row pasted checklist, through the review ──
    const facts = await usePastedChecklist(page, `number,player,team\n1,${PLAYER},${OLD}`, 1);
    expect(facts.rows).toBe(1);
    await syncChecklistButton(page).click();
    const wizard = reviewWizard(page);
    await expect(wizard).toBeVisible();
    // The only name the review holds is the team, and the PLAYER settled it: one
    // decided row, nothing asked, so the wizard stands on Save.
    await expect(page.getByText("1 name was linked for you. Give it a look before this saves.").first()).toBeVisible();
    await expect(wizard.getByText("Ready to save", { exact: true })).toBeVisible();
    const decided = await openDecidedList(page);
    const linked = decided.getByRole("listitem").filter({ hasText: OLD });
    await expect(linked).toContainText(`Linked to ${OLD} · ${PLAYER} played there`);
    // The year's own pick (the newer team) is nowhere in the decision.
    await expect(decided.getByText(`Linked to ${NEW} `)).toHaveCount(0);
    await expect(linked.getByRole("button", { name: `Change decision for ${OLD}` })).toBeVisible();
    await expectAccessible(page, { within: wizard, label: "Entity review wizard, team era linked from the player's stint" });

    await confirmSaveButton(page).click();
    await expect(page.getByText(/Saved 1 card/).first()).toBeVisible();

    // ── PART 4: the commit wrote the older team onto the card ──
    await expect(editCardButton(page, "1")).toBeVisible();
    await editCardButton(page, "1").click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("button", { name: `Remove team ${OLD}`, exact: true })).toBeVisible();
    await expect(drawer.getByRole("button", { name: `Remove team ${NEW}`, exact: true })).toHaveCount(0);
    await expectAccessible(page, { within: drawer, label: "Card drawer, the player's era on the card" });
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(drawer).toBeHidden();
  },
);
