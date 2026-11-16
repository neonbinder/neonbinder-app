// NEO-556: "No Team" on a REAL unlicensed set. 2026 Leaf Vivid, Proof, "Animated Autographs
// Pre-Production Proofs Lazer Red" (44 BuySportsCards cards, none of which the marketplace gives a
// team) is fetched twice: once with no answer on the set, once after the SET answers No Team.
//
// R1: the ONE feature is that a set's No Team reaches the cards a fetch commits beneath it, and
// stops where a card already has a claim:
//   - with no answer on the set, the tidy-up wizard's teams step hints at one ("Pick a set
//     team, or No Team, under Edit attributes"); with No Team on the set the hint is gone;
//   - the cards commit No Team (their rows read "No Team", nothing needs the operator), and the
//     one card the publisher's checklist gives a team keeps it, never the set's No Team (rule 8:
//     a claim in the data holds the guess back);
//   - the same answer reaches a PARALLEL built from the set's Base: its copies of two teamless
//     Base cards (made before the set answered, so they carry no stamp) read No Team, and BSC's
//     per-card "no team" answer is what settles them (the lookup holds the stamp back until it
//     answers, rule 8), never a team.
//
// SOLE WRITER (R7a, SET-REGISTRY.md "Leaf Vivid"): this spec alone writes Leaf Vivid. It commits
// the Proof checklist, so it is FRESH-ONLY (GUIDE "Fresh-only specs"): a second run on the same
// seed finds the cards already there and the first fetch's hint step gone. Re-seed to re-run.
// The checklist is a one-row paste (no capture file exists for this set), so BSC is asked about
// the other cards per card, recorded for the fake (the recorder's list, never a spec change).
// SportLots: the set is BSC-only paused or live (nothing is asked of it for a Proof row).
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import {
  columnHeading,
  columnOption,
  columnSelection,
  drillToBaseVariant,
  drillToSet,
  pick,
  setBuilderReady,
  syncChecklistButton,
} from "../../support/set-builder";
import { usePastedChecklist, expectTeamsFromChecklist } from "../../support/published-checklist";
import {
  advanceToSave,
  cancelUndecided,
  confirmSaveButton,
  reviewWizard,
  tidyUpName,
} from "../../support/wizard";
import { expectAfterMarketplace } from "../../support/marketplace-wait";

const PROOF = "Animated Autographs Pre-Production Proofs Lazer Red";
const TARGET = { sport: "Baseball", year: "2026", manufacturer: "Leaf", set: "Leaf Vivid" } as const;
// The publisher's own claim: one card names a team. Pete Incaviglia is a card of the Proof set and
// Texas Rangers an NB team; every other card of the set gets no answer from BSC.
const CLAIMED = { player: "Pete Incaviglia", team: "Texas Rangers" };
const CHECKLIST = `number,player,team\nNNO,${CLAIMED.player},${CLAIMED.team}`;
// Two Base cards made by hand: unnumbered like every card of the Proof family, each a player on the
// first parallel the build reaches (Clear Green, alphabetically), so that parallel pairs both.
const BASE_CARDS = ["Derek Curiel", "Kenedy Corona"];
const FIRST_PARALLEL = "Animated Autographs Pre-Production Proofs Clear Green";

test(
  "Set-level No Team on a real Leaf set — the wizard's set-team hint goes, fetched cards commit No Team, and a card the checklist gives a team keeps it (NEO-556)",
  { tag: ["@smoke", "@set-selector"] },
  async ({ page, signIn, env }) => {
    const panel = page.getByRole("region", { name: "Set attributes panel" });
    const edit = panel.getByRole("button", { name: "Edit attributes" });
    const hide = panel.getByRole("button", { name: "Hide attributes" });
    const toggle = (pressed: boolean) => panel.getByRole("button", { name: "No Team for new cards here", pressed });
    const hint = reviewWizard(page).getByText(/Pick a set team, or No Team, under Edit attributes/);
    const teamsStep = reviewWizard(page).getByText("Cards with no team", { exact: true });
    const search = page.getByRole("searchbox", { name: "Search cards" });
    // A checklist row is one run of text; the match stops at the next row's "#".
    const rowSays = (name: string, text: string) => page.getByText(new RegExp(`#NNO[^#]*${name}[^#]*${text}`));

    async function openProof() {
      await drillToSet(page, env, TARGET);
      await pick(page, "Variant Types", "Proof", { search: false });
      await columnOption(page, "Proofs", PROOF).click();
      await expect(syncChecklistButton(page)).toBeVisible();
    }
    async function fetchToWizard(): Promise<{ facts: Awaited<ReturnType<typeof usePastedChecklist>>; cards: number }> {
      const facts = await usePastedChecklist(page, CHECKLIST, 1);
      await syncChecklistButton(page).click();
      // One live BSC round trip: 7 s of our own time plus the seconds the screen says it waits on BSC.
      const kept = page.getByText(/Kept all [0-9]+ cards? from BSC/);
      await expectAfterMarketplace(page, kept, { platform: "BuySportsCards", what: "the Proof fetch's kept-cards line" });
      const cards = Number(/Kept all ([0-9]+)/.exec((await kept.first().textContent()) ?? "")?.[1]);
      expect(cards).toBeGreaterThan(8);
      await expect(reviewWizard(page)).toBeVisible();
      await expect(reviewWizard(page)).toHaveAccessibleName(
        tidyUpName({ year: TARGET.year, set: TARGET.set, variant: PROOF }),
      );
      await expectTeamsFromChecklist(page, facts);
      return { facts, cards };
    }

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── STEP 0: two cards in the set's Base, made while the set has no answer, so they are
    // teamless and carry no stamp. (Opening Base cancels its mapping picker: a one-marketplace set.)
    await drillToBaseVariant(page, env, TARGET);
    for (const player of BASE_CARDS) {
      await page.getByRole("button", { name: "Open add card form" }).click();
      const number = page.getByRole("textbox", { name: "Card number", exact: true });
      await number.fill("NNO");
      await page.getByRole("textbox", { name: "Card name", exact: true }).fill(player);
      await page.getByRole("button", { name: "Submit new card" }).click();
      await expect(number).toBeHidden();
      await expect(page.getByText(player, { exact: true })).toBeVisible();
    }
    await expect(page.getByText("Cards (2)")).toBeVisible();

    // ── STEP 1: no answer on the set. The wizard's teams step lists every card the checklist
    // does not answer and, being long, points at the set-level shortcut.
    await openProof();
    const first = await fetchToWizard();
    await expect(teamsStep).toBeVisible();
    await expect(hint).toBeVisible();
    await expectAccessible(page, { within: reviewWizard(page), label: "Tidy-up teams step with the set-team hint" });
    await cancelUndecided(page);

    // ── STEP 2: the SET answers No Team. Rows beneath it (Base, the Proof row opened above) follow.
    // The two Base cards already there stay as they are: the panel only OFFERS to mark them.
    await drillToSet(page, env, TARGET);
    await expect(panel.getByRole("heading", { name: `Attributes for ${TARGET.set} (Set)` })).toBeVisible();
    await expect(edit.or(hide)).toBeVisible();
    if (await edit.isVisible()) await edit.click();
    await expect(toggle(false)).toBeVisible();
    await toggle(false).click();
    const confirm = page.getByRole("dialog", { name: "Set this set to No Team?" });
    await expect(confirm).toBeVisible();
    await expectAccessible(page, { within: confirm, label: "Set No Team on a real set, checklists beneath it" });
    await confirm.getByRole("button", { name: "Yes, set No Team" }).click();
    await expect(toggle(true)).toBeVisible();
    await expect(panel.getByRole("button", { name: "Mark 2 teamless cards No Team" })).toBeVisible();

    // ── STEP 3: the same fetch again. The Proof row copied the answer, the wizard still lists the
    // cards (each may be answered one by one) but no longer hints at a set team.
    await pick(page, "Variant Types", "Proof", { search: false });
    await columnOption(page, "Proofs", PROOF).click();
    await expect(panel.getByText("No Team", { exact: true })).toBeVisible();
    const second = await fetchToWizard();
    expect(second.cards).toBe(first.cards);
    await expect(teamsStep).toBeVisible();
    await expect(hint).toBeHidden();
    await expectAccessible(page, { within: reviewWizard(page), label: "Tidy-up teams step under a No Team set" });

    // ── STEP 4: save. Every card is born under the set's answer except the one that has a claim.
    await advanceToSave(page);
    await expect(reviewWizard(page).getByText(`Save ${second.cards} cards?`)).toBeVisible();
    await confirmSaveButton(page).click();
    await expect(reviewWizard(page)).toBeHidden();
    await expect(page.getByText(`Cards (${second.cards})`)).toBeVisible();

    // The claimed card keeps the checklist's team; a card with nothing naming a team is No Team.
    await expect(search).toBeVisible();
    await search.fill("Incaviglia");
    await expect(rowSays("Pete Incaviglia", CLAIMED.team)).toBeVisible();
    await expect(rowSays("Pete Incaviglia", "No Team")).toBeHidden();
    await search.fill("Martinez");
    await expect(rowSays("Edgar Martinez", "No Team")).toBeVisible();
    await search.fill("");
    // Nothing needs the operator: no card is flagged "no team on this card yet".
    await expect(page.getByRole("button", { name: /needs you$/ })).toHaveCount(0);
    await expectAccessible(page, { label: "Leaf Vivid Proof checklist, cards born No Team" });

    // Back steps through the drill in the URL: the pick of the Proof row is undone, its column is open.
    await page.goBack();
    await expect(columnHeading(page, "Proofs")).toBeVisible();
    await expect(columnSelection(page, "Variant Types", "Proof")).toBeVisible();

    // ── STEP 5: the set's parallels, built from Base (stopped after the first). A copy of a Base
    // card the set's answer never touched is born under the parallel's own No Team once BSC's
    // per-card lookup, which holds the stamp back, answers that it names no team.
    await drillToSet(page, env, TARGET);
    await pick(page, "Variant Types", "Parallel", { search: false });
    await page.getByRole("button", { name: /^Build [0-9]+ parallels from Base$/ }).click();
    const replace = page.getByRole("button", { name: "Replace and build" });
    await expect(replace.or(page.getByRole("button", { name: "Stop after this one" })).first()).toBeVisible();
    if (await replace.isVisible()) await replace.click();
    await page.getByRole("button", { name: "Stop after this one" }).click();
    // GUIDE R5 exception as base-parallels-build-from-section: the build fetches each parallel's
    // checklist from BSC before writing it.
    await expect(page.getByRole("heading", { name: /^Base parallels — stopped after [1-9][0-9]* of [0-9]+/ })).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      page.getByText(new RegExp(`^${FIRST_PARALLEL} — Built ${BASE_CARDS.length} cards?`)),
    ).toBeVisible();
    await expectAccessible(page, { label: "Base parallels build stopped, set under No Team" });

    await columnOption(page, "Parallels", FIRST_PARALLEL).click();
    for (const player of BASE_CARDS) {
      await expect(rowSays(player, "No Team")).toBeVisible();
    }
    await expect(page.getByRole("button", { name: /needs you$/ })).toHaveCount(0);
    await expectAccessible(page, { label: "Built parallel, copies No Team" });
  },
);
