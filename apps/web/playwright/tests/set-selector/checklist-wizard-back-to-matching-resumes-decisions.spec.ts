// Origin: .maestro/flows/set-selector/checklist-wizard-back-to-matching-resumes-decisions.yaml (Maestro suite retired in NEO-341; see git history)
import type { Locator } from "@playwright/test";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { CHECKLISTS, checklistFacts, matchCardsDialog, matchedKeptLine, opensMatchCards } from "../../support/published-checklist";
import { setBuilderReady } from "../../support/set-builder";
import {
  answerPlayerAsNew,
  advanceToSave,
  cancelAndDiscard,
  discardResumedReviewBatch,
  fetchChecklistToWizard,
  openDecidedList,
  readBackDecision,
  reviewWizard,
  expectNothingDecided,
  walkToPlayerRow,
} from "../../support/wizard";

test(
  "Entity review — Back to Match Cards opens the Match Cards a fully matched fetch skipped, without discarding, and re-confirming comes back to the same review with the decision still on it",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // NEO-640: the default file is BSC's own answers for the set's 10 cards, so with SportLots
    // paused every card is Matched at 100% and the fetch skips Match Cards: the helper has proved
    // the progress line, the kept line and that no dialog stood (`settleChecklistFetch`). Live,
    // the set's SportLots side is a third source (unmeasured), written to open the dialog.
    const facts = checklistFacts(CHECKLISTS.starsOfMlbNetwork);
    const skipped = !opensMatchCards(facts, env);
    await fetchChecklistToWizard(page, env);
    await discardResumedReviewBatch(page, env);
    const wizard = reviewWizard(page);
    // Nothing decided: a name step is up and there is no "Decided (N)" history (NEO-467).
    await expectNothingDecided(page);

    // NEO-496 (D10, NQ1): the default fetch uploads the publisher's checklist, and BSC plus
    // the checklist are two sources, so a pairing session stands behind the wizard with
    // SportLots paused or live, whether its dialog was shown (live) or skipped (paused, NEO-640).
    // Decide one player, then go back to the pairing step.
    // READY_TO_CREATE: the create below needs a player whose create is not held
    // by a career team the walk skipped.
    await walkToPlayerRow(page, { readyToCreate: true });
    const playerName = ((await wizard.getByRole("heading", { level: 3 }).textContent()) ?? "").trim();
    await answerPlayerAsNew(page);
    // Read the create back off its own row ("Already decided: Added as new"),
    // never off the "Decided (N)" history: with the reference catalogue loaded
    // this create can be the batch's last name, the wizard has then walked on
    // to its next step (the default set's file answers every card "No Team",
    // so it is no longer "Cards with no team"; NEO-489), and the history is not rendered there. The
    // footer Back is "Back to previous decision/step"; the panel's footer
    // still carries "Back to Match Cards", which is pressed next.
    await readBackDecision(page, "Added as new");
    // The history collapses past five decided names, so after the round trip it
    // is opened, then THIS name is found.
    const added = (names: Locator) =>
      names.getByRole("listitem").filter({ hasText: playerName }).filter({ hasText: "Added as new" });
    await expectAccessible(page, { within: wizard, label: "Entity review wizard, player decided" });

    if (skipped) {
      // The line the skip left is still the one in front of the wizard (R2: the skip is this
      // spec's precondition, asserted again here rather than trusted to the helper).
      await expect(matchedKeptLine(page, facts.rows)).toBeVisible();
    }
    await wizard.getByRole("button", { name: "Back to Match Cards" }).click();
    await expect(wizard).toBeHidden();
    const dialog = matchCardsDialog(page);
    await expect(dialog).toBeVisible();
    // Focus goes to the dialog itself, named for what it matches (the Base), NEO-640, not left
    // behind on the wizard that just closed.
    await expect(page.getByRole("dialog", { name: "Match Cards — Base", exact: true })).toBeFocused();
    const confirmMatches = dialog.getByRole("button", { name: "Confirm card matches", disabled: false });
    await expect(confirmMatches).toBeVisible();
    if (skipped) {
      // The skipped dialog holds every card the fetch kept, every one Matched and nothing left
      // over: exactly what the skip committed on the operator's behalf.
      await expect(dialog.getByText(new RegExp(`Matched \\(${facts.rows}\\)`))).toBeVisible();
      await expect(dialog.getByText(new RegExp(`${facts.rows} cards will be saved`))).toBeVisible();
      await expect(dialog.getByRole("heading", { name: /^BSC only \([1-9][0-9]*\)$/ })).toHaveCount(0);
    }
    await expectAccessible(page, {
      within: dialog,
      label: "Match Cards dialog after Back to Match Cards",
    });

    // Re-confirming returns to the same review, the decision still on it.
    await confirmMatches.click();
    await expect(wizard).toBeVisible({ timeout: 60_000 });
    // The resumed review opens on a name step (names still undecided) or, when
    // the create was the last name, past the names. The "Decided (N)" history
    // renders on name steps and on Save, never on the teams / titles steps, so
    // in the second shape walk to Save first on the defaults (nothing is saved:
    // the review is discarded below). A Back that had cancelled the batch would
    // reopen on a name step with nothing decided and fail the history assert.
    const nameStepSkip = wizard.getByRole("button", {
      name: /^Skip .* — (not a person|not a team|this team has no league)$/,
    });
    await expect(
      nameStepSkip
        .or(wizard.getByRole("button", { name: "Next (Enter)", exact: true }))
        .or(wizard.getByRole("button", { name: /Confirm & Save/ }))
        .first(),
    ).toBeVisible();
    if (!(await nameStepSkip.first().isVisible())) await advanceToSave(page);
    await expectAccessible(page, { within: wizard, label: "Entity review wizard, resumed with decision" });
    // Open the decided list: the player added as new is still on it.
    await expect(added(await openDecidedList(page))).toBeVisible();

    await cancelAndDiscard(page);
  },
);
