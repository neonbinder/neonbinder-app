// NEO-528 (R1): a smart binder can take in a player's cameos. An admin lists
// a player P under "Also on this card" on a card he is not the subject of; a
// collector's smart binder whose rule is "Player = P" leaves that card out
// until its "Include cameos" option is on (off by default), then Find cards
// offers it beside P's own card, tagged Cameo, and the binder counts cameos on
// a line of their own.
//
// The fixture is a REAL card (Jason, 2026-11-14): Football > 1984 > Topps >
// Topps > Base, card #355 Fred Dean, with Dan Marino (P) as the cameo. P's own
// card is #123 Dan Marino, in the same checklist.
//
// The flow:
// - The set builder (admin): the checklist is fetched and committed if it is
//   still empty (the publisher's checklist uploaded first; every card pairs at
//   100%, so Match Cards sits out and the cards save first, and the Tidy Up
//   walk that opens is closed with "Save for later", answering nothing), or adopted as it is (a rerun on the same seed). Card #355's
//   drawer gets P under "Also on this card"; its own player stays.
// - The collector marks #123 (P's own) and #355 Have in Main; #355's card
//   detail lists P under "Also on this card" (Back closes the detail).
// - A new smart binder, rule "Player = P, and Set = 1984 Topps" (a line naming
//   a set gives it a checklist the dashboard counts): "Include cameos" is
//   shown and OFF, and Find cards offers P's own card only.
// - Binder settings: the rule is edited to include cameos ("..., cameos
//   included"); Find cards offers both, and only #355 carries the Cameo tag
//   ("P is a cameo on this card"). Both are added. Sorted by checklist with
//   empty slots, the held cameo pocket's name says it is a cameo, P's own
//   pocket does not, and the cover counts cameos apart: "Cameos: 1 have, 0
//   need".
// - Checklists, looking through the binder with "Fits <binder>": the cameo
//   row wears the tag, P's own row does not. The cameo copy is removed: its row
//   stays in the fits list.
// - The dashboard, cameo unfiled: the binder's pocket title reads "Cameos: 0 of
//   1" and its checklist percent counts P's own cards alone (with the cameo in
//   them it would fall).
// - The binder: the cameo's empty slot is named "..., P is a cameo on this
//   card, need. Add it" and the cover reads "Cameos: 0 have, 1 need"; its Add
//   files a copy ("1 have, 0 need"). The dashboard then reads "Cameos: 1 of 1"
//   at the same percent.
// - Binder settings again: with cameos on, Line 1 turned from Player to Set
//   takes the "Include cameos" option away and says so ("Include cameos is off
//   now: ..."); saved without the player line, the rule no longer says
//   "cameos included".
// - Cleanup: the binder is deleted, both copies removed, and P taken off
//   #355's "Also on this card" (its drawer's ×), so the card is as it was.
//
// R7/R7a: SOLE WRITER of Football > 1984 > Topps > Topps > Base
// (SET-REGISTRY.md): the only spec that fetches it, commits it, or writes a
// card of it, and the only one that puts Dan Marino under "Also on this card"
// anywhere (a smart binder's cameo count is catalogue-wide, so the counts
// below are exact only while nothing else does). Not fresh-only: the
// committed checklist stays and a rerun adopts it, and the one card write (P
// on #355) is undone at the end and by the failure hook. The collector writes
// only the signed-in user's own binder and copies.
//
// R3: the set builder drills through `support/set-builder.ts`, the fetch
// through `support/published-checklist.ts`, the walk through `support/tidy-walk.ts`,
// the collector cascade through `support/collection.ts`, and the set builder's
// "Also on this card" names through `support/also-pictured.ts`. The set
// builder's "Player on every card" control is `set-selector/player-on-every-card`.
import type { Locator, Page } from "@playwright/test";
import {
  ALSO_PICTURED,
  addAlsoPictured,
  alsoPicturedGroup,
  cameoLine,
  cardDescription,
  closeCardDrawer,
  openCardDrawer,
} from "../../support/also-pictured";
import { escapeRe } from "../../support/cards";
import { cameoPhrase as cameoWords, deleteBinder, holdInMain, openCollectorChecklist, removeCopy } from "../../support/cameo-binder";
import type { CollectorSet } from "../../support/collection";
import type { FlowEnv } from "../../support/env";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { CHECKLISTS, checklistRows, savedLine, settleChecklistFetch, usePublishersChecklist } from "../../support/published-checklist";
import { drillToBaseVariant, drillToColdManufacturer, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import { saveForLater, settleWalkAfterCommit, tidyUpName, tidyWalk } from "../../support/tidy-walk";

/** The set as the set builder drills it, and as the collector's cascade does. */
const BUILD = { sport: "Football", year: "1984", manufacturer: "Topps", set: "Topps" } as const;
const COLLECTOR: CollectorSet = { ...BUILD };
/** The checklist's name on the collector's screens, and a set's name in a rule ("<season> <set>"). */
const SET_LABEL = `${BUILD.year} ${BUILD.set}`;
/** The cameo's card (Fred Dean) and P's own card. */
const CAMEO_NUMBER = "355";
const OWN_NUMBER = "123";
const P = "Dan Marino";

/**
 * The 1984 team-leader cards: BSC names each by its card ("Colts Team Leaders -
 * Curtis Dickey TL", read as that team), the publisher's checklist by its club
 * ("Baltimore Colts"), so each is a "Checklist says otherwise" card. Read off
 * the file, never typed.
 */
const TEAM_LEADER_NUMBERS = checklistRows(CHECKLISTS.topps1984FootballBase)
  .filter((row) => / Team Leaders /.test(row.player))
  .map((row) => row.number);

/**
 * The set builder's Base of 1984 Topps Football, with its cards: fetched and
 * committed when the checklist is still empty, adopted as it is otherwise.
 * Contract: EXIT the checklist is on screen with cards in it.
 *
 * Its own fetch rather than `fetchChecklistToTidyWalk` (R9 divergence): that
 * helper's result line counts every row the file answers, while here the
 * team-leader cards are disagreements (the saved line's teams count leaves them out).
 */
async function ensureChecklist(page: Page, env: FlowEnv): Promise<void> {
  // No other spec opens Football 1984, so every column may sync itself: the
  // cold drill pays those marketplace waits (R9).
  await drillToColdManufacturer(page, env, BUILD);
  await drillToBaseVariant(page, env, BUILD);
  const empty = page.getByText("No cards in this checklist yet.");
  const cards = page.getByRole("heading", { level: 2, name: /^Cards \([1-9][0-9]*\)$/ });
  await expect(empty.or(cards)).toBeVisible();
  if (await cards.isVisible()) return;

  // Empty: this spec is the set's sole writer, so it fetches and commits it.
  // The publisher's checklist goes first (GUIDE "Checklist first"): every row
  // names its team or says No Team, so BSC is asked for no card one by one.
  const facts = await usePublishersChecklist(page, CHECKLISTS.topps1984FootballBase);
  await syncChecklistButton(page).click();
  // NEO-496 (D10, NQ1): the uploaded checklist is a second source. NEO-640: the file is BSC's own
  // 396 cards, each paired by its number at 100% (a team-leader card's club is a team disagreement,
  // which the walk settles, not Match Cards), so Match Cards is skipped. The helper waits on the
  // fetch (7 s of ours plus BSC's) and proves the saved line with its reason and the teams line.
  await settleChecklistFetch(page, env, {
    facts: { ...facts, matched: facts.matched - TEAM_LEADER_NUMBERS.length },
    what: "the empty checklist's fetch",
  });
  // NEO-645 C5: the cards SAVE first, then the per-card Tidy Up walk opens by itself when a card
  // still needs a person (names the catalogue lacks, the team-leader cards' disagreements). None of
  // that is this spec's claim: "Save for later" closes the walk and writes nothing, as the old
  // wizard's "Skip remaining names" left every name unanswered.
  const saved = savedLine(page, facts.rows);
  if (await settleWalkAfterCommit(page, saved)) {
    await expect(tidyWalk(page)).toHaveAccessibleName(tidyUpName({ year: BUILD.year, set: BUILD.set }));
    await expectAccessible(page, { within: tidyWalk(page), label: "Tidy Up walk after the 1984 Topps Football fetch" });
    await saveForLater(page);
  }
  // A fresh load of the checklist, as a rerun finds it.
  await drillToBaseVariant(page, env, BUILD);
  await expect(cards).toBeVisible();
}

/**
 * #355's description once the card has loaded (it settles before the chips, so
 * it is the signal for whether P is on the card, never the chip row's absence),
 * and P's line in it.
 */
const CARD_LOADED = new RegExp(`Fred Dean, #${CAMEO_NUMBER}\\b`);
const P_LINE = cameoLine(P);

/**
 * Take P off #355's "Also on this card", if he is on it: the drawer's ×, the
 * save's toast, and the description without his line. Contract: ENTRY any
 * page. EXIT P is not on #355, proven by the drawer's description.
 */
async function takeCameoOff(page: Page, env: FlowEnv): Promise<void> {
  await drillToBaseVariant(page, env, BUILD);
  const drawer = await openCardDrawer(page, CAMEO_NUMBER);
  const description = cardDescription(drawer);
  await expect(description).toHaveValue(CARD_LOADED);
  if (P_LINE.test(await description.inputValue())) {
    await alsoPicturedGroup(drawer).getByRole("button", { name: ALSO_PICTURED.remove(P), exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: ALSO_PICTURED.saved })).toBeVisible();
  }
  await expect(description).not.toHaveValue(P_LINE);
  await expect(alsoPicturedGroup(drawer).getByRole("button", { name: ALSO_PICTURED.remove(P), exact: true })).toHaveCount(0);
  await closeCardDrawer(drawer);
}

/** The collector's 1984 Topps Football Base on the Checklists tab, searched for `query` (its region). */
const openChecklist = (page: Page, query: string): Promise<Locator> => openCollectorChecklist(page, COLLECTOR, query);

/**
 * What the body wrote, each set right BEFORE its write, and cleared once the
 * body's own cleanup has undone it.
 */
const written: {
  binder?: string;
  copies?: string[];
  cameo?: boolean;
} = {};

// A failed run must not leave the binder, the copies or P on #355 (which would
// make him a cameo need on the next run, and on every other binder for him).
// Each step runs even when an earlier one fails; the first failure is rethrown
// at the end (R7). A page of its own, so the failure's screenshot and ARIA
// snapshot still show where the body stopped. Brought to the front: left
// behind the test's page, it stalled on the phone project.
test.afterEach(async ({ context, env }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const clean = await context.newPage();
  await clean.bringToFront();
  const failures: unknown[] = [];
  const attempt = async (step: () => Promise<void>) => {
    try {
      await step();
    } catch (error) {
      failures.push(error);
    }
  };
  try {
    const { binder, copies, cameo } = written;
    if (binder) await attempt(() => deleteBinder(clean, binder));
    for (const short of copies ?? []) {
      await attempt(async () => removeCopy(clean, await openChecklist(clean, short.replace(/^#(\S+).*$/, "$1")), short));
    }
    if (cameo) await attempt(() => takeCameoOff(clean, env));
  } finally {
    await clean.close();
    for (const key of Object.keys(written) as Array<keyof typeof written>) delete written[key];
  }
  if (failures.length > 0) throw failures[0];
});

test(
  "Collection: a smart binder for a player takes in his cameos only once Include cameos is on, tags them Cameo and counts them apart",
  { tag: ["@collection"] },
  async ({ page, signIn, env }) => {
    const binder = `Cameos${env.ATTEMPT_TOKEN}`;

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // --- As admin: the real checklist, and P on Fred Dean's card -----------
    await ensureChecklist(page, env);
    const editor = await openCardDrawer(page, CAMEO_NUMBER);
    // The card is Fred Dean's, and P is not on it yet (a red run's hook took
    // him off; R2 precondition, read off the description, which settles with
    // the card).
    await expect(editor.getByRole("button", { name: "Remove player Fred Dean", exact: true })).toBeVisible();
    await expect(cardDescription(editor)).toHaveValue(CARD_LOADED);
    await expect(cardDescription(editor)).not.toHaveValue(P_LINE);
    written.cameo = true;
    await addAlsoPictured(page, editor, P);
    // The chip shows him under "Also on this card", and the card's own player stays.
    await expect(editor.getByLabel(ALSO_PICTURED.chip(P), { exact: true })).toBeVisible();
    await expect(editor.getByRole("button", { name: "Remove player Fred Dean", exact: true })).toBeVisible();
    await expect(editor.getByRole("button", { name: `Remove player ${P}`, exact: true })).toHaveCount(0);
    // The listing description names him as a cameo.
    await expect(cardDescription(editor)).toHaveValue(P_LINE);
    await expectAccessible(page, { within: editor, label: "Card drawer with someone also on the card" });
    await closeCardDrawer(editor);

    const tabs = page.getByRole("navigation", { name: "Collection sections" });
    const toBinders = async () => {
      await tabs.getByRole("link", { name: "My Binders", exact: true }).click();
      await expect(page).toHaveURL(/[?&]tab=binders/);
    };
    const added = (short: string, into = "Main") => page.getByRole("status").filter({ hasText: `Added ${short} to ${into}` });

    // --- The collector holds P's own card and the cameo card ---------------
    const hold = async (number: string): Promise<{ checklist: Locator; short: string }> => {
      const checklist = await openChecklist(page, number);
      const short = await holdInMain(page, checklist, number, (s) => {
        written.copies = [...(written.copies ?? []), s];
      });
      return { checklist, short };
    };
    const own = await hold(OWN_NUMBER);
    expect(own.short, "P's own card").toBe(`#${OWN_NUMBER} ${P}`);
    const cameo = await hold(CAMEO_NUMBER);
    const cameoShort = cameo.short;

    // Its detail says who else is on it.
    await cameo.checklist.getByRole("button", { name: `Details for ${cameoShort}`, exact: true }).click();
    const detail = page.getByRole("dialog", { name: new RegExp(`^${escapeRe(SET_LABEL)}.*#${CAMEO_NUMBER}\\b`) });
    await expect(detail.getByText(ALSO_PICTURED.heading, { exact: true })).toBeVisible();
    await expect(detail.getByRole("definition").filter({ hasText: new RegExp(`^${escapeRe(P)}$`) })).toBeVisible();
    // The detail lives in the address: Back closes it onto the checklist.
    await page.goBack();
    await expect(detail).toBeHidden();
    await expect(cameo.checklist.getByRole("button", { name: `Details for ${cameoShort}`, exact: true })).toBeVisible();

    // --- A smart binder for P: cameos are off by default -------------------
    await toBinders();
    const shelf = page.getByRole("list", { name: "Your binders" });
    await shelf.getByRole("button", { name: "New binder", exact: true }).click();
    const newDialog = page.getByRole("dialog", { name: "New binder", exact: true });
    await newDialog.getByRole("textbox", { name: "Binder name" }).fill(binder);
    await newDialog.getByRole("radio", { name: /^Smart: a rule helps fill it/ }).check();
    await newDialog.getByRole("combobox", { name: "Line 1" }).selectOption({ label: "Player" });
    await newDialog.getByRole("combobox", { name: "Players" }).fill(P);
    await newDialog.getByRole("option", { name: `${P} · Football`, exact: true }).click();
    await expect(newDialog.getByRole("button", { name: `Remove ${P}`, exact: true })).toBeVisible();
    // A line naming the set: the binder's checklist, which the dashboard counts
    // (a rule of players alone has none).
    await newDialog.getByRole("button", { name: "Add a line", exact: true }).click();
    await newDialog.getByRole("combobox", { name: "Line 2" }).selectOption({ label: "Set" });
    await newDialog.getByRole("combobox", { name: "Sets" }).fill(SET_LABEL);
    await newDialog.getByRole("option", { name: SET_LABEL, exact: true }).click();
    await expect(newDialog.getByRole("button", { name: `Remove ${SET_LABEL}`, exact: true })).toBeVisible();
    const includeCameos = newDialog.getByRole("checkbox", { name: "Include cameos", exact: true });
    await expect(includeCameos).toBeVisible();
    await expect(includeCameos).not.toBeChecked();
    await expectAccessible(page, { within: newDialog, label: "New smart binder for a player, Include cameos off" });
    written.binder = binder;
    await newDialog.getByRole("button", { name: "Put it on the shelf" }).click();
    await expect(newDialog).toBeHidden();

    // Find cards opens by itself: P's own card, never the card he is only pictured on.
    const find = page.getByRole("dialog", { name: `Find cards for ${binder}`, exact: true });
    const ownLabel = `${escapeRe(SET_LABEL)} #${OWN_NUMBER} ${escapeRe(P)}`;
    const cameoLabel = `${escapeRe(SET_LABEL)} #${CAMEO_NUMBER}\\b`;
    // Page-rooted, so each also works as a `has` filter inside a row (GUIDE gotcha).
    const addOwnButton = page.getByRole("button", { name: new RegExp(`^Add ${ownLabel}\\b.* from Main$`) });
    const addCameoButton = page.getByRole("button", { name: new RegExp(`^Add ${cameoLabel}.* from Main$`) });
    const addOwn = find.getByRole("button", { name: new RegExp(`^Add ${ownLabel}\\b.* from Main$`) });
    const addCameo = find.getByRole("button", { name: new RegExp(`^Add ${cameoLabel}.* from Main$`) });
    await expect(addOwn).toBeVisible();
    await expect(addCameo).toHaveCount(0);
    await find.getByRole("button", { name: "Done" }).click();
    await expect(find).toBeHidden();
    await expect(page.getByRole("heading", { level: 2, name: binder, exact: true })).toBeVisible();

    // --- Binder settings: include cameos, keep it sorted with empty slots ---
    await page.getByRole("button", { name: "Binder settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: `${binder} settings`, exact: true });
    await settings.getByRole("button", { name: "Edit the rule", exact: true }).click();
    const settingsCameos = settings.getByRole("checkbox", { name: "Include cameos", exact: true });
    await expect(settingsCameos).not.toBeChecked();
    await settingsCameos.check();
    await expect(settingsCameos).toBeChecked();
    await expectAccessible(page, { within: settings, label: "Smart rule editor, Include cameos on" });
    await settings.getByRole("button", { name: "Save the rule", exact: true }).click();
    const ruleSummary = settings.getByText(/^Takes /);
    // Exact: the set reads as the picker names it ("1984 Topps"), never with its brand doubled.
    await expect(ruleSummary).toHaveText(`Takes ${P}, and ${SET_LABEL}, cameos included.`);
    await settings.getByRole("radio", { name: /^Keep sorted by checklist/ }).check();
    await expect(settings.getByRole("radio", { name: /^Keep sorted by checklist/ })).toBeChecked();
    const emptySlots = settings.getByRole("checkbox", { name: /^Include empty slots/ });
    await emptySlots.check();
    await expect(emptySlots).toBeChecked();
    await settings.getByRole("button", { name: "Find cards", exact: true }).click();

    // --- Find cards: both, and only Fred Dean's card is a cameo ------------
    await expect(addOwn).toBeVisible();
    await expect(addCameo).toBeVisible();
    const cameoPhrase = cameoWords(P);
    const cameoRow = find.getByRole("listitem").filter({ has: addCameoButton });
    const ownRow = find.getByRole("listitem").filter({ has: addOwnButton });
    await expect(cameoRow.getByText(cameoPhrase, { exact: true })).toBeVisible();
    await expect(ownRow).toBeVisible();
    await expect(ownRow.getByText(cameoPhrase, { exact: true })).toHaveCount(0);
    await expectAccessible(page, { within: find, label: "Find cards with a cameo" });
    await addOwn.click();
    await expect(addOwn).toHaveCount(0);
    await addCameo.click();
    await expect(addCameo).toHaveCount(0);
    await find.getByRole("button", { name: "Done" }).click();
    await expect(find).toBeHidden();
    // Settings stays open behind Find cards when it opened it; close it if so.
    await expect(settings.or(page.getByRole("heading", { level: 2, name: binder, exact: true }))).toBeVisible();
    if (await settings.isVisible()) {
      await settings.getByRole("button", { name: "Done" }).click();
      await expect(settings).toBeHidden();
    }

    // --- The cover and the pockets ------------------------------------------
    // Two counts: P's own cards, then the cameos on a line of their own (how
    // many own cards P has in the set is the catalogue's, so only the cameo
    // line is exact). On a desktop they sit on the binder's inside cover, on a
    // phone above the page: found on the page, not in the cover.
    const ownCount = page.getByText(/^1 have, \d+ need$/);
    await expect(ownCount).toBeVisible();
    // P's own checklist, for the dashboard's percent below: 1 of (1 + need).
    const ownNeed = Number(/(\d+) need$/.exec((await ownCount.textContent()) ?? "")?.[1]);
    expect(Number.isInteger(ownNeed), "the cover's own count reads 1 have, N need").toBe(true);
    const ownPercent = Math.floor(100 / (1 + ownNeed));
    await expect(page.getByText("Cameos: 1 have, 0 need", { exact: true })).toBeVisible();
    const cover = page.getByRole("region", { name: `${binder}, open`, exact: true });
    // Sorted by checklist: #123 comes before #355, both on the set's first
    // page(s). The held cameo's name says whose cameo it is; P's own pocket's
    // name ends at the card's team, no cameo appended.
    const heldCameo = cover.getByRole("button", { name: new RegExp(`^${cameoLabel}.*, ${escapeRe(cameoPhrase)}$`) });
    await expect(heldCameo).toBeVisible();
    await expect(cover.getByRole("button", { name: new RegExp(`^${ownLabel}(, [^,]+)?$`) })).toBeVisible();
    await expect(cover.getByRole("button", { name: new RegExp(`^${ownLabel}\\b.*cameo`) })).toHaveCount(0);
    await expectAccessible(page, { label: "Smart binder holding a cameo, its cover counting cameos apart" });

    // --- Checklists, looking through the binder: the cameo row wears the tag
    /** Look through the binder, at the cards that fit it. */
    const fitsOnly = async (checklist: Locator) => {
      await checklist.getByRole("combobox", { name: "Binder" }).selectOption({ label: binder });
      const fits = checklist.getByRole("radio", { name: `Fits ${binder}`, exact: true });
      await fits.click();
      await expect(fits).toHaveAttribute("aria-checked", "true");
      return fits;
    };
    const cameoScoped = await openChecklist(page, CAMEO_NUMBER);
    const cameoFits = await fitsOnly(cameoScoped);
    const cameoItem = cameoScoped
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: `Details for ${cameoShort}`, exact: true }) });
    await expect(cameoItem.getByText(cameoPhrase, { exact: true })).toBeVisible();
    await expectAccessible(page, { within: cameoScoped, label: "Checklist through a smart binder, a cameo row tagged" });
    // The cameo copy leaves the collection: the card still fits the rule, so
    // its row stays in the fits list, tagged, now a need.
    await removeCopy(page, cameoScoped, cameoShort);
    written.copies = written.copies?.filter((s) => s !== cameoShort);
    await expect(cameoFits).toHaveAttribute("aria-checked", "true");
    await expect(cameoScoped.getByRole("button", { name: `Have ${cameoShort}`, exact: true, pressed: false })).toBeVisible();
    await expect(cameoItem.getByText(cameoPhrase, { exact: true })).toBeVisible();
    // P's own row fits the same binder and wears no tag.
    const ownScoped = await openChecklist(page, OWN_NUMBER);
    await fitsOnly(ownScoped);
    const ownItem = ownScoped
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: `Details for ${own.short}`, exact: true }) });
    await expect(ownItem).toBeVisible();
    await expect(ownItem.getByText(cameoPhrase, { exact: true })).toHaveCount(0);

    // --- The dashboard, the cameo unfiled -----------------------------------
    // The binder's checklist percent counts P's own cards alone: 1 of
    // (1 + need) as the cover counted them. With the unfiled cameo among them
    // it would fall (1 of 2 + need).
    const openOnDashboard = async () => {
      await page.goto("/dashboard");
      await expect(page.getByRole("heading", { level: 1, name: "Welcome back, slugger." })).toBeVisible();
      const dashSpine = page
        .getByRole("list", { name: "Binders on the shelf" })
        .getByRole("button", { name: new RegExp(`^${escapeRe(binder)}, smart binder, `) });
      await expect(dashSpine).toHaveAccessibleName(new RegExp(`, ${ownPercent}% of the checklist$`));
      await dashSpine.click();
      await expect(dashSpine).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("heading", { level: 3, name: binder, exact: true })).toBeVisible();
      return dashSpine;
    };
    const dashSpine = await openOnDashboard();
    await expect(page.getByText("Cameos: 0 of 1", { exact: true })).toBeVisible();
    await expect(page.getByText(`${ownPercent}% of the checklist.`, { exact: true })).toBeVisible();
    // The open binder lives in the address: Back shuts it.
    await page.goBack();
    await expect(dashSpine).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("heading", { level: 3, name: binder, exact: true })).toHaveCount(0);

    // --- The binder: the cameo's empty slot, and its Add ---------------------
    const openOnShelf = async () => {
      await page.goto("/collection?tab=binders");
      await expect(page.getByRole("heading", { level: 1, name: "Collection" })).toBeVisible();
      await page
        .getByRole("list", { name: "Your binders" })
        .getByRole("button", { name: new RegExp(`^${escapeRe(binder)}, `) })
        .click();
      await expect(page.getByRole("heading", { level: 2, name: binder, exact: true })).toBeVisible();
    };
    await openOnShelf();
    const needCameo = cover.getByRole("button", {
      name: new RegExp(`^${cameoLabel}.*, ${escapeRe(cameoPhrase)}, need\\. Add it$`),
    });
    await expect(needCameo).toBeVisible();
    await expect(page.getByText("Cameos: 0 have, 1 need", { exact: true })).toBeVisible();
    await expectAccessible(page, { label: "Smart binder with a cameo's empty slot" });
    written.copies = [...(written.copies ?? []), cameoShort];
    await needCameo.click();
    // The pocket is optimistic; the notice is the server's answer.
    await expect(added(cameoShort, binder)).toBeVisible();
    await expect(page.getByText("Cameos: 1 have, 0 need", { exact: true })).toBeVisible();
    await expect(heldCameo).toBeVisible();
    await expect(needCameo).toHaveCount(0);

    // --- The dashboard, the cameo filed -------------------------------------
    await openOnDashboard();
    await expect(page.getByText("Cameos: 1 of 1", { exact: true })).toBeVisible();
    await expect(page.getByText(`${ownPercent}% of the checklist.`, { exact: true })).toBeVisible();
    await expectAccessible(page, { label: "Dashboard, a smart binder counting its cameos apart" });

    // --- The rule loses its player line: Include cameos goes, and says so ----
    await openOnShelf();
    await page.getByRole("button", { name: "Binder settings", exact: true }).click();
    await settings.getByRole("button", { name: "Edit the rule", exact: true }).click();
    await expect(settingsCameos).toBeChecked();
    await settings.getByRole("combobox", { name: "Line 1" }).selectOption({ label: "Set" });
    await expect(settingsCameos).toHaveCount(0);
    await expect(
      settings.getByRole("status").filter({ hasText: "Include cameos is off now: no line names a player or Hall of Famers." }),
    ).toBeVisible();
    await expectAccessible(page, { within: settings, label: "Smart rule editor, Include cameos dropped with the player line" });
    // Line 1 is an empty Set line now: take it out, leaving the set's line.
    await settings.getByRole("button", { name: "Remove line 1", exact: true }).click();
    await expect(settings.getByRole("combobox", { name: "Line 2" })).toHaveCount(0);
    await settings.getByRole("button", { name: "Save the rule", exact: true }).click();
    await expect(ruleSummary).toHaveText(`Takes ${SET_LABEL}.`);
    await settings.getByRole("button", { name: "Done" }).click();
    await expect(settings).toBeHidden();

    // --- Cleanup: delete the binder, remove both copies, take P off #355 ----
    await page.getByRole("button", { name: "Back to the shelf" }).click();
    const spine = page.getByRole("list", { name: "Your binders" }).getByRole("button", { name: `${binder}, 2 cards`, exact: true });
    await expect(spine).toBeVisible();
    await deleteBinder(page, binder);
    delete written.binder;
    for (const [number, short] of [
      [CAMEO_NUMBER, cameoShort],
      [OWN_NUMBER, own.short],
    ] as const) {
      await removeCopy(page, await openChecklist(page, number), short);
      written.copies = written.copies?.filter((s) => s !== short);
    }
    await page.goto("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible();
    await takeCameoOff(page, env);
    delete written.cameo;
    // Proven off on a fresh load: the description has lost his line, and the card keeps its own player.
    await page.goto("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible();
    await drillToBaseVariant(page, env, BUILD);
    const after = await openCardDrawer(page, CAMEO_NUMBER);
    await expect(cardDescription(after)).toHaveValue(CARD_LOADED);
    await expect(cardDescription(after)).not.toHaveValue(P_LINE);
    await expect(after.getByRole("button", { name: "Remove player Fred Dean", exact: true })).toBeVisible();
    await closeCardDrawer(after);
  },
);
