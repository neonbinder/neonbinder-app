// ONE FEATURE (R1, NEO-345 on the NEO-645 Tidy Up walk): an AU card's autograph format is the
// operator's answer, never a marketplace's. The walk's Autograph tile asks it, "Apply to all"
// carries it to the part's AU cards, and it stays changeable (on the tile for one card, in Set
// details for the part, and from the checklist header's prompt).
//   (a) ASKED: the fetch saves the five AU cards, and the walk opens on a card whose Autograph
//       tile is pink ("To fix"): the required radiogroup "Autograph format" with neither radio
//       checked, Save & next held. Arrows choose without moving on; Enter answers and hands focus
//       on (Save & next, or the first control still pink);
//   (b) APPLIED TO ALL: "Apply to all 5 autographed cards" reads "Applied.", and another card's
//       drawer reads autographed ON CARD (Signed By = the card's player, print run 99 from BSC's
//       SN99); Set details' "Autograph format" row holds the answer;
//   (c) CHANGEABLE: "Sticker auto" on the tile changes that one card (its drawer reads sticker,
//       the other card stays on card); Set details' row changed to Sticker carries the part's
//       cards; a stored part with no format and an AU card reading "None" asks again from the
//       checklist header, and that answer formats the card.
// One spec because it is one fresh-only fixture: a second spec would be a second writer of the
// same five cards (R7a).
//
// Replaces `checklist-autograph-format-asked-applied-and-changeable` (the old wizard's required
// "Autographed cards" step, retired by NEO-645); (b)'s drawer and Set details and (c)'s header
// prompt are carried over unchanged.
//
// FIXTURE (SET-REGISTRY.md -> "Baseball -> 2025 -- the NEO-345 autograph fixture"; approved by
// Jason 2026-10-14): Baseball -> 2025 -> Bowman > Bowman Draft > Insert > Bowman Draft Nights
// Autographs, five cards, every one tagged AU + SN99 in BSC's attribute field. SOLE WRITER of
// those five cards. It shares the YEAR and the Insert column's reconcile with the dual-team spec
// (a different insert, different rows), so the reconcile is reached through
// `openInsertsReconcile`. FRESH-ONLY: a re-run finds the checklist committed and fails at "No
// cards in this checklist yet.", by name. It answers no name on the walk (Player, Team: not this
// spec's), so it mints no player, team or league.
//
// NOT PROVED HERE (unit/component tests are the proof): the tile's radio keyboard in full (Home,
// End, wrap) and the per-card write: components/SetSelector/tidy/tiles/AutographTile.test.tsx;
// the cascade's skips (an operator's own value left alone): convex/autographFormat.test.ts;
// BSC attribute tokens: convex/adapters/buysportscards.test.ts.
import type { Locator } from "@playwright/test";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { editCardButton } from "../../support/cards";
import { expectStepWithSportLots } from "../../support/marketplace-wait";
import { CHECKLISTS, confirmChecklistMatchCards, matchCardsDialog, usePublishersChecklist } from "../../support/published-checklist";
import {
  COLD_SYNC,
  columnHeading,
  columnOption,
  columnSearch,
  drillToColdManufacturer,
  drillToSet,
  expectAfterBscSync,
  openInsertsReconcile,
  pick,
  setBuilderReady,
  syncChecklistButton,
  VARIANT_TYPES_SYNC,
} from "../../support/set-builder";
import {
  mustFixLine,
  pinkTile,
  saveForLater,
  settleWalkAfterCommit,
  tidyCardIdentity,
  tidyFooterButton,
  tidyTile,
  tidyWalk,
} from "../../support/tidy-walk";

const INSERT = "Bowman Draft Nights Autographs";
/** The five cards and their players (the uploaded checklist, `CHECKLISTS.bowmanDraftNightsAutographs2025`). */
const PLAYERS: Readonly<Record<string, string>> = {
  "BDNA-EW": "Eli Willits",
  "BDNA-GF": "Gavin Fien",
  "BDNA-KA": "Kade Anderson",
  "BDNA-SH": "Seth Hernandez",
  "BDNA-XN": "Xavier Neyens",
};
const BOWMAN_DRAFT = { sport: "Baseball", year: "2025", manufacturer: "Bowman", set: "Bowman Draft" };
/** A live BSC (+ SportLots) checklist round trip: the ceiling kept while SportLots is live (`expectStepWithSportLots`). */
const CHECKLIST_FETCH = 120_000;

const PILL = {
  onCard: /Value for Autographed: Auto \(On Card\)/,
  sticker: /Value for Autographed: Auto \(Sticker\)/,
};

test(
  "Tidy Up — an AU card's autograph format is asked on the walk's Autograph tile, applied to all the part's AU cards, and changeable per card, in Set details and from the header (NEO-345)",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const reconcile = page.getByRole("dialog", { name: "Reconcile Inserts" });

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── STEP 1: drill to Baseball / 2025 / Bowman, pick `Bowman Draft`, open Insert ──
    // The year may be cold (this spec ran first) or already synced by the dual-team spec; the
    // helper's waits are ceilings, not sleeps.
    await drillToColdManufacturer(page, env, { sport: "Baseball", year: "2025", manufacturer: "Bowman" });
    await expectStepWithSportLots(page, page.getByRole("listbox", { name: "Sets" }), env, {
      liveMs: COLD_SYNC,
      what: "the Sets list",
    });
    await pick(page, "Sets", "Bowman Draft");
    await expect(columnHeading(page, "Variant Types")).toBeVisible();
    const insertType = columnOption(page, "Variant Types", "Insert");
    await expectStepWithSportLots(page, insertType, env, { liveMs: VARIANT_TYPES_SYNC, what: "Variant Types row Insert" });
    await insertType.click();

    // ── STEP 2: make the insert an NB set: the Inserts reconcile ──
    if (!env.SL_PAUSED) {
      await openInsertsReconcile(page, env);
      // Narrow both lists to the insert. Its refractor siblings share the words, so the set is
      // made by its own exact button, never "Keep all" (that would make every sibling a set too).
      await reconcile.getByRole("textbox", { name: "Filter NeonBinder sets" }).fill(INSERT);
      await reconcile.getByRole("textbox", { name: "Filter BSC items" }).fill(INSERT);
      const insertSet = reconcile.getByRole("textbox", { name: `NeonBinder set name for ${INSERT}`, exact: true });
      const makeOwn = reconcile.getByRole("button", { name: `Make its own set: ${INSERT}`, exact: true });
      await expect(insertSet.or(makeOwn)).toBeVisible();
      if (await makeOwn.isVisible()) await makeOwn.click();
      await expect(insertSet).toBeVisible();
      await expectAccessible(page, { within: reconcile, label: "Reconcile Inserts dialog (Bowman Draft Nights Autographs)" });
      await reconcile.getByRole("button", { name: /^Save [0-9]+ sets/ }).click();
      await expect(reconcile).toBeHidden();

      // Saving leaves the columns at the offset the dialog opened from: re-drill (every level is
      // warm now) and reopen the Insert column.
      await drillToSet(page, env, BOWMAN_DRAFT);
      await columnOption(page, "Variant Types", "Insert").click();
    } else {
      // Paused: one marketplace, nothing to reconcile; the column fills straight from BSC.
      // BSC alone: 7 s plus the seconds the column's wait line is up (measured 0.8 s on the #487 merge-group run (GUIDE)).
      await expectAfterBscSync(page, columnHeading(page, "Inserts"), "the Inserts column opening");
      await expect(reconcile).toBeHidden();
    }

    // ── STEP 3: select the insert and fetch its checklist ──
    await columnSearch(page, "Inserts").fill(INSERT);
    await columnOption(page, "Inserts", INSERT).click();
    // The empty-checklist assert makes the saved cards below THIS fetch's.
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
    // The publisher's checklist (NEO-478): the fetch asks BSC for the checklist and for no card.
    // The autograph format comes from BSC's checklist (the AU + SN99 tags), not from the file.
    const facts = await usePublishersChecklist(page, CHECKLISTS.bowmanDraftNightsAutographs2025);
    await syncChecklistButton(page).click();

    // NEO-496: BSC plus the uploaded checklist are two sources, so Match Cards opens with
    // SportLots paused or live. Live SportLots keeps the old ceiling; paused, BSC alone under the
    // fetch's wait line (`expectStepWithSportLots`).
    const matchCards = matchCardsDialog(page);
    await expectStepWithSportLots(page, matchCards.getByRole("button", { name: "Confirm card matches", disabled: false }), env, {
      liveMs: CHECKLIST_FETCH,
      what: "the insert checklist fetch",
    });
    await expectAccessible(page, { within: matchCards, label: "Match Cards dialog (Bowman Draft Nights Autographs)" });
    // Confirm SAVES the cards (NEO-645: commit first, walk second); our own write, the 7 s bar.
    await confirmChecklistMatchCards(page, { facts, what: "the Bowman Draft Nights Autographs fetch" });

    // ── STEP 4: (a) the walk opens, and its Autograph tile asks ──
    // REQUIRED (R2): every card is tagged AU and the part has no format, so every card is pink
    // and the walk always opens. A commit that did not see AU leaves nothing pink: fails here.
    const opened = await settleWalkAfterCommit(page, page.getByText(/Saved 5 cards\./).first());
    expect(opened, "five AU cards with no autograph format open the walk").toBe(true);
    const walk = tidyWalk(page);

    const tile = tidyTile(page, "Autograph");
    const formats = tile.getByRole("radiogroup", { name: "Autograph format", exact: true });
    const onCard = formats.getByRole("radio", { name: "On-card auto", exact: true });
    const sticker = formats.getByRole("radio", { name: "Sticker auto", exact: true });
    const applyAll = tile.getByRole("button", { name: "Apply to all 5 autographed cards", exact: true });
    const saveNext = tidyFooterButton(page, "saveAndNext");

    await expect(pinkTile(page, "Autograph"), "the open card's Autograph tile is pink").toHaveCount(1);
    await expect(tile).toHaveAccessibleDescription(/To fix/);
    await expect(tile.getByText("How is this card signed? It can't be listed until you know.", { exact: true })).toBeVisible();
    // A required choice of two, neither pre-picked (no marketplace says which), the way on held.
    await expect(formats).toHaveAttribute("aria-required", "true");
    await expect(onCard).not.toBeChecked();
    await expect(sticker).not.toBeChecked();
    await expect(saveNext).toBeDisabled();
    await expect(mustFixLine(page)).toBeVisible();
    // Nothing to apply until this card has an answer.
    await expect(tile.getByRole("button", { name: /^Apply to all/ })).toHaveCount(0);
    // Reachable on a phone too: each radio and the way on can be brought into view.
    for (const control of [onCard, sticker, saveNext]) {
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeInViewport();
    }
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, Autograph tile asking" });

    // The card the tile is answered on; (b) reads ANOTHER card's drawer, (c) reads this one's.
    const header = (await tidyCardIdentity(page).allTextContents()).join(" ");
    const answeredOn = /#(BDNA-[A-Z]+)/.exec(header)?.[1] ?? "";
    expect(Object.keys(PLAYERS), `the open card is one of the five (header "${header}")`).toContain(answeredOn);
    const other = answeredOn === "BDNA-KA" ? "BDNA-EW" : "BDNA-KA";

    // By keyboard: the group is one Tab stop (the first radio). An arrow CHOOSES (and saves) but
    // keeps focus in the group, so the operator can arrow back; Enter is the answer. The radios
    // are aria-disabled while a choice saves, so each next key waits for the saved, usable radio.
    const settled = (name: "On-card auto" | "Sticker auto") =>
      formats.getByRole("radio", { name, exact: true, checked: true, disabled: false });
    await onCard.focus();
    await page.keyboard.press("ArrowRight");
    await expect(settled("Sticker auto"), "the arrow chose and saved Sticker auto").toBeVisible();
    await expect(onCard).not.toBeChecked();
    await expect(sticker).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(settled("On-card auto"), "the arrow chose and saved On-card auto").toBeVisible();
    await expect(sticker).not.toBeChecked();
    await expect(onCard).toBeFocused();
    await expect(pinkTile(page, "Autograph"), "an arrow's choice is saved: the tile is no longer pink").toHaveCount(0);
    await expect(tile.getByText("Answered", { exact: true })).toBeVisible();
    await page.keyboard.press("Enter");
    // Enter on a radio is the radio's (never Save & next as well): the walk stays on this card,
    // and focus moves on: to Save & next when nothing else is pink, else to the first control
    // still pink (a Player or Team name this spec leaves alone).
    await expect(onCard).toBeChecked();
    const saveUsable = tidyFooterButton(page, "saveAndNext", { usable: true });
    await expect(saveUsable.or(mustFixLine(page)).first()).toBeVisible();
    if (await saveUsable.isVisible()) {
      await expect(saveUsable, "the answer hands focus to Save & next").toBeFocused();
    } else {
      await expect(mustFixLine(page), "something other than the autograph is still pink").toBeVisible();
      await expect(onCard, "the answer handed focus on, out of the radio group").not.toBeFocused();
      await expect(sticker).not.toBeFocused();
    }
    await expect(tidyCardIdentity(page).first(), "Enter on a radio did not move the walk").toContainText(`#${answeredOn}`);

    // ── STEP 5: (b) Apply to all ──
    await expect(applyAll).toBeVisible();
    await applyAll.click();
    await expect(tile.getByRole("status").filter({ hasText: /^Applied\.$/ })).toBeVisible();
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, Autograph applied to all" });

    // ── STEP 6: (c) changeable on the tile: this card only ──
    await sticker.click();
    await expect(sticker).toBeChecked();
    await expect(onCard).not.toBeChecked();
    await expect(pinkTile(page, "Autograph")).toHaveCount(0);
    // The tile saved as it was answered: Save for later writes nothing more.
    await saveForLater(page);

    // ── STEP 7: the drawers read the stored rows (getCardChecklist), not the tile ──
    const openCard = async (card: string) => {
      await editCardButton(page, card).click();
      const drawer = page.getByRole("dialog");
      await expect(drawer.getByRole("textbox", { name: "Card name" })).toBeVisible();
      await expect(drawer.getByText(new RegExp(`Card #${card}`))).toBeVisible();
      return drawer;
    };
    const closeDrawer = async (drawer: Locator) => {
      await drawer.getByRole("button", { name: "Done editing card" }).click();
      await expect(drawer.getByRole("textbox", { name: "Card name" })).toBeHidden();
      await expect(syncChecklistButton(page)).toBeVisible();
    };
    const expectSignedBy = async (drawer: Locator, card: string) => {
      const showFeatures = drawer.getByRole("button", { name: "Show features editor" });
      const hideFeatures = drawer.getByRole("button", { name: "Hide features editor" });
      // The editor remembers whether it was left open, so open it only if needed.
      await expect(showFeatures.or(hideFeatures)).toBeVisible();
      if (await showFeatures.isVisible()) await showFeatures.click();
      await expect(drawer.getByRole("textbox", { name: "Value for Signed By" })).toHaveValue(PLAYERS[card]);
    };
    const expectFormat = async (drawer: Locator, format: "onCard" | "sticker") => {
      const [on, off] = format === "onCard" ? [PILL.onCard, PILL.sticker] : [PILL.sticker, PILL.onCard];
      await expect(drawer.getByRole("button", { name: on })).toHaveAttribute("aria-pressed", "true");
      await expect(drawer.getByRole("button", { name: off })).toHaveAttribute("aria-pressed", "false");
    };

    // (b) Apply to all reached a card the tile never showed: autographed ON CARD. The cascade is
    // our own scheduled write behind the press: the 7 s bar.
    let drawer = await openCard(other);
    await expectFormat(drawer, "onCard");
    await expect(drawer.getByRole("spinbutton", { name: "Print run" })).toHaveValue("99");
    await expectSignedBy(drawer, other);
    await expectAccessible(page, { within: drawer, label: "Card drawer, autographed on card, Signed By seeded, print run 99" });
    await closeDrawer(drawer);
    // (c) The tile's change reached its own card only.
    drawer = await openCard(answeredOn);
    await expectFormat(drawer, "sticker");
    await closeDrawer(drawer);

    // ── STEP 8: Set details' "Autograph format" row ──
    // The row holds the Apply's answer (a stored value, read back), and changing it carries the
    // part's AU cards: the other card now reads sticker.
    const editAttributes = page.getByRole("button", { name: "Edit attributes" });
    const hideAttributes = page.getByRole("button", { name: "Hide attributes" });
    // The panel remembers whether it was left open, so open it only if needed.
    await expect(editAttributes.or(hideAttributes)).toBeVisible();
    if (await editAttributes.isVisible()) await editAttributes.click();
    await expect(hideAttributes).toBeVisible();
    const format = page.getByRole("combobox", { name: "Value for Autograph format" });
    const formatShown = format.getByRole("option", { selected: true });
    await expect(format).toBeVisible();
    await expect(formatShown).toHaveText("On card");
    await expectAccessible(page, { label: "Set details open on the insert, Autograph format row" });

    await format.selectOption({ label: "Sticker" });
    await expect(page.getByText(/Saved Autograph format/)).toBeVisible();
    await expect(formatShown).toHaveText("Sticker");
    drawer = await openCard(other);
    await expectFormat(drawer, "sticker");
    await expectSignedBy(drawer, other);
    await closeDrawer(drawer);

    // ── STEP 9: a stored part with an unformatted AU card prompts from the header ──
    // The part is put in the state a stored, never-answered part is in by the operator's own
    // controls: clear the format ("No value" touches no card), then take one card's autograph
    // off by hand. Exactly one AU card reads "None" on a part with no format, so the header asks,
    // for that one card.
    await format.selectOption({ label: "No value" });
    await expect(page.getByText(/Cleared Autograph format/)).toBeVisible();
    await expect(formatShown).toHaveText("No value");
    drawer = await openCard(other);
    await drawer.getByRole("button", { name: PILL.sticker }).click();
    await expect(drawer.getByRole("button", { name: PILL.sticker })).toHaveAttribute("aria-pressed", "false");
    await expect(drawer.getByRole("button", { name: PILL.onCard })).toHaveAttribute("aria-pressed", "false");
    await closeDrawer(drawer);

    const prompt = page.getByRole("group", { name: "1 autographed card — on card or sticker?", exact: true });
    await expect(prompt).toBeVisible();
    // Reachable on a phone too: both answers can be brought into view.
    for (const answer of ["On card", "Sticker"]) {
      const button = prompt.getByRole("button", { name: answer, exact: true });
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeInViewport();
    }
    await expectAccessible(page, { within: prompt, label: "Checklist header, autograph format prompt" });
    await prompt.getByRole("button", { name: "On card", exact: true }).click();
    // The answer is saved in place: the prompt says so and the part's row holds it.
    await expect(page.getByRole("status").filter({ hasText: "Autographs saved as on card." }).first()).toBeVisible();
    await expect(prompt).toBeHidden();
    await expect(formatShown).toHaveText("On card");
    drawer = await openCard(other);
    await expectFormat(drawer, "onCard");
    await expectSignedBy(drawer, other);
    await closeDrawer(drawer);
  },
);
