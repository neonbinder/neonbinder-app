// Origin: .maestro/flows/set-selector/checklist-pairing-dialog-cancel.yaml (Maestro suite retired in NEO-341; see git history)
// NEO-137/189/220: syncing the real 2024 Topps Chrome Insert > Future Stars
// checklist with its publisher's file, FS-20's row left out (NEO-640: a card
// with no row needs the operator), opens the Match Cards dialog instead of
// committing, with focus on the dialog itself; Cancel asks to discard and
// writes nothing. Both branches run that much: with SportLots paused (NEO-287)
// BSC and the file are the two sources; live, SportLots is a third.
// LIVE ONLY (a disagreement needs two marketplaces on one row): a manual
// cross-link whose two sides name the card differently raises a name-conflict
// choice (BSC's value preselected, SportLots' on request, or a typed third
// name); NEO-344: every choice is the bare value, never which marketplace
// said it, and the warning reads "Potential names/players for this card"; a
// conflict does not block Confirm.
// NEO-640, last: a second Sync with BSC's catalogue read held (the fake, this
// worker's own account) stands on the progress line, and its "Cancel card
// fetch" ends the run there: the line goes, no dialog opens, nothing is saved,
// Sync is usable again (paused only: live, SportLots' streamed rows would open
// the dialog while BSC's read is held, so there is no line to cancel; unmeasured).
// READ-ONLY on the shared set: the flow only ever cancels ("The one sanctioned
// read-only visitor", SET-REGISTRY.md; this is still its only fetcher).
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { BSC_PATH, bscFault } from "../../support/bscFake";
import { escapeRe } from "../../support/cards";
import { expectAfterMarketplace } from "../../support/marketplace-wait";
import {
  CHECKLISTS,
  cancelCardFetchButton,
  checklistFetchProgress,
  matchCardsDialog,
  opensMatchCards,
  publishersChecklistChip,
  usePublishersChecklist,
} from "../../support/published-checklist";
import {
  columnHeading,
  columnOption,
  columnSearch,
  drillToSet,
  pick,
  setBuilderReady,
  syncChecklistButton,
} from "../../support/set-builder";
import { reviewWizard } from "../../support/wizard";

/**
 * How long the fake holds the second fetch's catalogue read (`search/bulk-upload/results`): the
 * progress line must still be up when Cancel is pressed. A fault hold under the read's own 30 s
 * timeout (an answer, never a failure to the call gate), not a spec budget: nothing waits it out.
 */
const HOLD_MS = 15_000;

test(
  "Checklist — the card-pairing dialog opens instead of committing, flags a marketplace name disagreement on a manual link, cancelling writes nothing, and a held fetch is cancelled from its progress line",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env, bscFake }) => {
    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── Drill to the pre-synced 2024 Topps Chrome > Insert > Future Stars.
    await drillToSet(page, env);
    await pick(page, "Variant Types", "Insert", { search: false });
    await expect(columnHeading(page, "Inserts")).toBeVisible({ timeout: 20_000 });
    // The inserts are already reconciled, so the search box is the expected state.
    await expect(columnSearch(page, "Inserts")).toBeVisible({ timeout: 60_000 });
    await columnSearch(page, "Inserts").fill("Future Stars");
    const futureStars = columnOption(page, "Inserts", "Future Stars");
    await expect(futureStars).toBeVisible({ timeout: 15_000 });
    await futureStars.click();
    const cancelled = page.getByText("Sync cancelled — no cards saved.");

    if (env.SL_PAUSED) {
      // Before any sync: the rows are BSC-only cards with no SportLots ref, and the operator is
      // told why.
      await expect(page.getByText(/#FS-[0-9]/).first()).toBeVisible();
      await expect(page.getByText("BSC", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("BSC only", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("SL", { exact: true })).toBeHidden();
      await expect(page.getByText("SportLots is on pause.")).toBeVisible();
      await expect(
        page.getByText(
          "Syncs roll on with BuySportsCards only. Your SportLots links stay put — nothing gets unlinked.",
        ),
      ).toBeVisible();
      await expectAccessible(page, { label: "Future Stars checklist, SportLots on pause" });
    }

    // ── STEP 1: sync must NOT commit; it opens the pairing dialog.
    // NEO-489: the seed's own publisher's checklist first (BSC's answers for the 20 cards), so the
    // fetch asks BSC for no card one by one but FS-20. NEO-640: the whole file pairs every card at
    // 100%, which would let the run skip Match Cards, so FS-20's row is LEFT OUT: that card has no
    // row, so the dialog opens (`opensMatchCards`, asserted, both branches).
    const facts = await usePublishersChecklist(page, CHECKLISTS.futureStars2024, { drop: ["FS-20"] });
    expect(opensMatchCards(facts, env), "Future Stars without FS-20's row opens Match Cards").toBe(true);
    // Read off the file (support/published-checklist.ts, the product's own matcher): each of the
    // file's rows pairs its BSC card, and FS-20's card is the one no row pairs.
    const bscOnly = facts.cards - facts.paired;
    expect(bscOnly, "FS-20's card is the one the file leaves out").toBe(1);
    await syncChecklistButton(page).click();
    const dialog = matchCardsDialog(page);
    // One live BSC round trip (FS-20's lookup): 7 s of ours plus the seconds BSC is waited on.
    await expectAfterMarketplace(page, dialog, { platform: "BuySportsCards", what: "Match Cards on the Future Stars fetch" });
    // NEO-640: focus lands on the dialog itself, named for the set, not on a control inside it.
    await expect(page.getByRole("dialog", { name: /^Match Cards — Future Stars/ })).toBeFocused();

    // ── STEP 2: it names the set and states what it will save.
    await expect(dialog.getByRole("heading", { name: /Match Cards — Future Stars/ })).toBeVisible();
    await expect(dialog.getByText(/[0-9]+ cards? will be saved/)).toBeVisible();

    // ── STEP 3: wait for the stream to finish (Confirm replaces "Loading…"): the same live round trip.
    const confirm = dialog.getByRole("button", { name: "Confirm card matches" });
    await expectAfterMarketplace(page, dialog.getByRole("button", { name: "Confirm card matches", disabled: false }), {
      platform: "BuySportsCards",
      what: "Confirm unlocked on the Future Stars fetch",
    });
    await expect(confirm).toHaveText("Confirm");
    const matched = (n: number) => dialog.getByText(new RegExp(`Matched \\(${n}\\)`));

    if (env.SL_PAUSED) {
      // BSC and the file: every row's card is Matched, FS-20's waits in "BSC only (1)", and only the
      // matched cards would be saved (a BSC-only card is dropped at Confirm unless kept).
      await expect(matched(facts.paired)).toBeVisible();
      await expect(dialog.getByRole("heading", { name: `BSC only (${bscOnly})`, exact: true })).toBeVisible();
      await expect(dialog.getByText(new RegExp(`^${facts.paired} cards will be saved`))).toBeVisible();
      await expectAccessible(page, { within: dialog, label: "Match Cards dialog, one card left out by the file" });
      // Something for Cancel to throw away (NEO-220: a clean session closes without asking): the
      // operator keeps FS-20's card, so every card would be saved.
      await dialog.getByRole("button", { name: "Keep all BSC-only cards" }).click();
      await expect(dialog.getByRole("heading", { name: "BSC only (0)", exact: true })).toBeVisible();
      await expect(dialog.getByText(new RegExp(`^${facts.cards} cards will be saved`))).toBeVisible();
    } else {
      // UNMEASURED live (SportLots paused since 2026-10-20): BSC and SportLots pair FS-20 between
      // them, so every card is Matched; re-read these counts on the first live run.
      const all = facts.cards;
      await expect(matched(all)).toBeVisible();
      await expect(dialog.getByRole("button", { name: /^Unlink / }).first()).toBeVisible();
      await expectAccessible(page, { within: dialog, label: "Match Cards dialog, all cards matched" });
      // Unlink two pairs so there is something to mis-pair.
      await dialog.getByRole("button", { name: /^Unlink #FS-1 / }).click();
      await expect(matched(all - 1)).toBeVisible();
      await dialog.getByRole("button", { name: /^Unlink #FS-2 / }).click();
      await expect(matched(all - 2)).toBeVisible();

      // Collapse Matched so the columns are on screen, and so the auto-expand on
      // a new disagreement has something to prove.
      await dialog.getByRole("button", { name: /^Collapse matched cards/ }).click();
      await expect(dialog.getByRole("button", { name: /^Expand matched cards/ })).toBeVisible();
      await expect(dialog.getByText(/BSC only \(2\)/)).toBeVisible();

      // NEO-344: the pills no longer say which marketplace a value came from,
      // so both names are read where the screen still says which side a card is
      // on: the two unmatched columns. A row's name is `<verb> #<number> <name>`
      // (plus ` · <variation>` on a variation), so stripping the verb and the
      // number leaves the value its pill will show. Read BEFORE the BSC row is
      // selected: selecting renames it to `#FS-1 …, selected. Press to deselect.`.
      // No live value is hardcoded.
      const bscRow = dialog.getByRole("radio", { name: /^Select BSC card #FS-1 / });
      const slRow = dialog.getByRole("button", { name: /^Link selected BSC card to #FS-2 / });
      const nameOf = async (row: typeof bscRow, prefix: string) =>
        ((await row.getAttribute("aria-label")) ?? "").replace(prefix, "").replace(/ · .*$/, "").trim();
      await expect(bscRow).toBeVisible();
      await expect(slRow).toBeVisible();
      const bscName = await nameOf(bscRow, "Select BSC card #FS-1 ");
      const slName = await nameOf(slRow, "Link selected BSC card to #FS-2 ");
      // The data precondition, stated (R2): #FS-1 and #FS-2 must be different
      // players for there to be a disagreement at all.
      expect(bscName, "#FS-1's BSC name").not.toBe("");
      expect(slName, "#FS-1 and #FS-2 must name different players").not.toBe(bscName);

      // Cross-link BSC's #FS-1 to SportLots' #FS-2.
      await bscRow.click();
      await expect(dialog.getByRole("radio", { name: /^#FS-1 .*, selected\. Press to deselect\.$/ })).toBeVisible();
      await slRow.click();

      // The warning is surfaced AND the section opened itself to show it.
      await expect(dialog.getByRole("button", { name: /^Collapse matched cards, .* with a name conflict$/ })).toBeVisible();
      await expect(dialog.getByText(/name conflict/).first()).toBeVisible();

      // The row: the warning group (exact, or #FS-10 … #FS-19 would answer),
      // its sentence, and the names as a single-select group. NEO-344: the
      // sentence names no marketplace.
      const nameGroup = dialog.getByRole("group", { name: "Name conflict on #FS-1", exact: true });
      await expect(nameGroup).toBeVisible();
      await expect(
        nameGroup.getByText("Potential names for this card — pick the right one before it is listed."),
      ).toBeVisible();
      await expect(dialog.getByRole("radiogroup", { name: "Name for #FS-1", exact: true })).toBeVisible();
      // Each pill is the BARE value, announced and shown: its accessible name is
      // `<value> — use this name for #FS-1` and its text the value (the checked
      // pill's `✓ ` is a separate aria-hidden span).
      const pill = (value: string) =>
        dialog.getByRole("radio", { name: `${value} — use this name for #FS-1`, exact: true });
      const bscPill = pill(bscName);
      const slPill = pill(slName);
      await expect(bscPill).toBeVisible();
      await expect(bscPill).toHaveText(new RegExp(`^(✓ )?${escapeRe(bscName)}$`));
      await expect(slPill).toBeVisible();
      await expect(slPill).toHaveText(new RegExp(`^(✓ )?${escapeRe(slName)}$`));

      // The cross-link puts two different players' rosters on one row, so the
      // players decision is raised too, worded the same way.
      const playersGroup = dialog.getByRole("group", { name: "Players conflict on #FS-1", exact: true });
      await expect(playersGroup).toBeVisible();
      await expect(
        playersGroup.getByText("Potential players for this card — pick the right ones before it is listed."),
      ).toBeVisible();
      await expect(
        dialog.getByRole("radio", { name: /— use these players for #FS-1$/ }).first(),
      ).toBeVisible();

      // NEO-606: a roster name past 120 characters is refused in place. The typed roster stays,
      // the field is invalid, and the refusal is an alert on its own field well (the error pink
      // misses 4.5:1 on the row's tile); axe reads it in both modes while it shows. Escape drops
      // the draft, and the roster field shows the card's players again.
      // LIVE BRANCH ONLY: a roster disagreement needs BSC and SportLots on one row, so this has
      // not run while SportLots is paused (written against CardPairingModal's names).
      const roster = dialog.getByRole("textbox", { name: "Players for #FS-1 (separate names with |)", exact: true });
      const rosterBefore = await roster.inputValue();
      const overLongPlayer = `Paul ${"Skenes".repeat(20)}x`.slice(0, 121);
      expect(overLongPlayer).toHaveLength(121);
      await roster.fill(overLongPlayer);
      await roster.press("Enter");
      const rosterRefusal = dialog.getByRole("alert").filter({ hasText: "Player names are limited to" });
      await expect(rosterRefusal).toHaveText("Player names are limited to 120 characters — shorten it to save.");
      await expect(roster).toHaveValue(overLongPlayer);
      await expect(roster).toHaveAttribute("aria-invalid", "true");
      await expectAccessible(page, { within: dialog, label: "Match Cards dialog, a roster name over 120 refused" });
      await roster.press("Escape");
      await expect(rosterRefusal).toHaveCount(0);
      await expect(roster).toHaveValue(rosterBefore);
      await expect(dialog).toBeVisible();

      // …and no marketplace is named anywhere in the conflict UI: not the old
      // sentence, not a prefixed choice name or text, title or roster. These
      // negatives ride on the positives just above (R2).
      const sourcePrefix = /^(BSC|SportLots|Custom): /;
      await expect(dialog.getByText(/These marketplaces/)).toHaveCount(0);
      await expect(dialog.getByRole("radio", { name: sourcePrefix })).toHaveCount(0);
      await expect(dialog.getByRole("radio").filter({ hasText: /^(✓ )?(BSC|SportLots|Custom): / })).toHaveCount(0);
      await expectAccessible(page, { within: dialog, label: "Match Cards dialog, name conflict on a manual link" });

      // BSC stays preselected (Jason, 2026-10-13: only its label goes): read on
      // the name the merged row will be saved with, which its Unlink carries.
      await expect(bscPill).toBeChecked();
      await expect(dialog.getByRole("button", { name: `Unlink #FS-1 ${bscName}`, exact: true })).toBeVisible();

      // Choosing the other value, by the value it shows, changes the name the
      // card would be saved with.
      await slPill.click();
      await expect(dialog.getByRole("button", { name: `Unlink #FS-1 ${slName}`, exact: true })).toBeVisible();
      await expect(dialog.getByRole("button", { name: `Unlink #FS-1 ${bscName}`, exact: true })).toBeHidden();

      // Neither value is right: the operator types the name, which joins the
      // same group as a third checked option, bare like the others.
      await dialog.getByRole("button", { name: /^Edit name for #FS-1 / }).click();
      const nameField = dialog.getByRole("textbox", { name: "Edit name for #FS-1", exact: true });
      await expect(nameField).toBeVisible();
      await expectAccessible(page, { within: dialog, label: "Match Cards dialog, editing the card name" });
      await nameField.fill("NB Operator Name");
      await nameField.press("Enter");
      const typedPill = pill("NB Operator Name");
      await expect(typedPill).toBeVisible();
      await expect(typedPill).toBeChecked();
      await expect(dialog.getByRole("radio", { name: sourcePrefix })).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: "Unlink #FS-1 NB Operator Name", exact: true })).toBeVisible();
      await expect(dialog.getByRole("button", { name: `Unlink #FS-1 ${slName}`, exact: true })).toBeHidden();
      // Both fetched values stay on offer.
      await expect(bscPill).toBeVisible();
      await expect(slPill).toBeVisible();

      // A conflict does not block Confirm: every card, less 2 unlinked, plus 1 re-linked.
      await expect(dialog.getByText(new RegExp(`^${all - 1} cards will be saved`))).toBeVisible();
      await expect(confirm).toHaveText("Confirm");
      await expect(confirm).toBeEnabled();
      await expectAccessible(page, { within: dialog, label: "Match Cards dialog, custom name chosen" });
    }

    // ── STEP 4: Cancel asks to discard the operator's work (NEO-220) and writes nothing.
    await dialog.getByRole("button", { name: "Cancel card matching" }).click();
    const discard = page.getByRole("button", { name: /^Discard / });
    await expect(discard).toBeVisible();
    await expectAccessible(page, { label: "Match Cards dialog, discard confirm" });
    await discard.click();
    // By role, never by text: the page's own lines may name Match Cards.
    await expect(cancelled).toBeVisible();
    await expect(matchCardsDialog(page)).toHaveCount(0);

    // The set is untouched: Sync is available for a retry, no entity-review wizard opened and no
    // save landed (paired with the cancelled line above, R2).
    await expect(reviewWizard(page)).toBeHidden();
    await expect(page.getByText(/^Saved [0-9]+ cards?\./)).toHaveCount(0);
    await expect(syncChecklistButton(page)).toBeEnabled();
    await expectAccessible(page, { label: "Future Stars checklist after the sync was cancelled" });
    if (!env.SL_PAUSED) return;

    // ── STEP 5 (NEO-640): a fetch cancelled from its progress line. The file is still in play (its
    // chip), and the fake holds BSC's catalogue read, so the run stands on the line with no row to
    // open the dialog on.
    await expect(publishersChecklistChip(page, facts.rows)).toBeVisible();
    await bscFake.setFaults([bscFault.slow(BSC_PATH.results, HOLD_MS, { times: 1, ttlS: 600 })]);
    await syncChecklistButton(page).click();
    const progress = checklistFetchProgress(page);
    await expect(progress).toBeVisible();
    // A new run clears the last one's line (paired with the progress line just above, R2), so the
    // cancelled line after the click below is this run's own.
    await expect(cancelled).toHaveCount(0);
    await expect(matchCardsDialog(page)).toHaveCount(0);
    await cancelCardFetchButton(page).click();
    await expect(cancelled).toBeVisible();
    await expect(progress).toHaveCount(0);
    // Nothing came of the run: no dialog, no wizard, no save, and Sync is usable again (R2: each rides
    // on the cancelled line).
    await expect(matchCardsDialog(page)).toHaveCount(0);
    await expect(reviewWizard(page)).toBeHidden();
    await expect(page.getByText(/^Saved [0-9]+ cards?\./)).toHaveCount(0);
    await expect(syncChecklistButton(page)).toBeEnabled();
    await expectAccessible(page, { label: "Future Stars checklist after a fetch was cancelled from its progress line" });
  },
);
