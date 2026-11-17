// NEO-535: the shared flow of the two eBay "title over 80 characters" specs, a
// helper beside them (a local one, outside support/: no other spec uses it).
// `runOver80Flow(args, through)` drives the whole fixture and stops where the
// spec's proof ends:
//   through "requeued"  steps 1-4: the card is held back whole with the title's
//                       reason, the title is shortened in the set builder (the
//                       crew's fix, NEO-536: the collector's reason says it's on
//                       us), and Sync status queues the card again with no Sync
//                       pressed.
//                       Needs no publish, so the active spec can go green now.
//   through "listed"    steps 1-6: the second Sync lists it ("1 listed"). Needs
//                       a publish that works (NEO-453: the sandbox refuses every
//                       publish), so its spec is parked.
// The assertions of every step are in the steps themselves; the specs add none.
//
// The flow (NEO-535, R1): an eBay listing whose title is over 80 characters is never
// chopped. NeonBinder holds the card back whole, says why, and lists it on the
// next sync once the title has been shortened in the set builder (an admin's
// fix: the collector is told it's on our end, never sent there). The flow, as
// the user lives it, on eBay's SANDBOX (the deployment's eBay wiring is the
// sandbox's; step 1 refuses to go on if it is not):
//   0. Not wired / paused: a deployment with no eBay wiring FAILS this spec
//      loudly, naming the setup it lacks (never a skip, GUIDE hard rule 1). A
//      deployment with eBay paused takes the paused branch (the connect hop
//      connects nothing; Profile says eBay is on a break). Both branches end in
//      hard asserts (R2).
//   1. The card. In the Set Builder, under a per-attempt hand-made insert whose
//      name never fits (the same 60-character insert `card-title-uses-short-name-
//      for-titles` uses for its card C), they add one card for the catalogue's
//      George Brett with a team of their own, made in the New team dialog to
//      play in Major League Baseball: the card takes its league from its team
//      (NEO-569; a card with a team never reads the set's leagues) and the
//      listing sends League, so the drawer's "Card league" must read it. Every
//      cut the title generator makes still leaves it at 99 characters, so it is
//      stored over 80 and kept whole (the drawer says so): this is the only way
//      a title ever gets past the 80-character write check, which refuses a
//      TYPED one.
//   2. Stock it. A box of their own (every other box set to in-person BEFORE
//      eBay connects, so the connection lists nothing else), eBay connected
//      through the seed hop (eBay's consent screen is a third party's page that
//      no spec can drive) and its setup finished (ships-from, a pick in each of
//      the policy groups), a common price, one copy of the card in the box and
//      a photo on it (eBay listings need one).
//   3. Sync. The checklist's Sync is pressed and Sync status, followed to rest,
//      reads the set "0 listed, 1 skipped" with ONE card held back, and the
//      reason it names is the title's: "Its title is over the 80-character limit
//      for listings, and we won't chop it. Once we shorten it on our end, it
//      goes up on the next sync." That row is the whole of what a
//      collector can see of eBay (the app shows no eBay listing of its own), so
//      "nothing was listed with a chopped title" is read from three things
//      together: the count says 0 listed, the finished run's ledger holds no
//      List the cards / Set prices / Go live step, and the card is held back by
//      name. The axe check runs on this held-back state, light and dark.
//   4. Fix it. Back in the Set Builder they open the card, retype its title at
//      61 characters and save (Enter). The save re-queues the card for eBay by
//      itself, so Sync status lists it under "Queued for the next sync" with no
//      Sync pressed, and the Back button steps back through the views.
//   5. The next sync. They press Sync again: the run walks the card through
//      List the cards / Set prices / Go live (or, when the 15-minute sales poll
//      got there first, which is real product behaviour, the poll listed it and
//      the press reads and sends nothing), and the row reads "1 listed" with no
//      held-back card at all.
//   6. They tidy up (the copy and its photo out through the card drawer's Remove,
//      the common price cleared, the box deleted) and Disconnect eBay, which takes
//      down anything NeonBinder put up on eBay and leaves the account not
//      connected. The afterEach does the same on a failure.
//
// What would turn this red: the drain cutting the title to 80 and listing it
// ("1 listed" at step 3, no held-back card); a hold that names another reason
// (a missing detail, a photo, eBay turning the card down, a card with no league,
// held noLeague, which step 1 rules out at the drawer); a save at step 4 that
// leaves the card out of the queue (the queue never shows it, or the second Sync
// finds nothing to send and "1 listed" never appears); a card that stays held
// after the title fits.
//
// Waits. Every step gets the standard 7 s budget (GUIDE hard rule 3), the eBay
// calls included, exactly as the sibling eBay listing spec does: reading the
// seller's policies, "Set me up", saving a pick or the ships-from address, the
// Sync steps and the disconnect's takedown. The longer waits are the seed hop's
// one full page load (`LAUNCH_GATE`) and the signed-off "Go live" ceiling at its
// call. A step that needs longer is a finding to report, never a number to raise.
//
// KNOWN BLOCKER (NEO-453): eBay's sandbox refuses every publish for any seller
// on our keyset (400 / 25002), which is why the sibling
// `inventory-ebay-sandbox-listing-2024-topps-chrome-future-stars` spec is
// parked in `project-scope.mjs`. Steps 1-4 do not publish and prove the hold and
// the re-queue; step 5 ("1 listed") needs a publish that works. This spec
// asserts the correct end state and goes red there until the sandbox publishes;
// it is not weakened to pass.
//
// Sandbox seller precondition (also in SET-REGISTRY.md, "2024 Topps Chrome ›
// Insert › Future Stars — the marketplace-seller listing fixture"): the sandbox
// seller must already hold the shipping policies "NB Free Shipping" and "NB
// Tracked (USPS Ground Advantage)". NeonBinder makes no shipping policy.
//
// R7/R7a. This spec writes NO real set. Its set is a per-attempt hand-made one
// (`ebt<token>`, padded to a fixed length, prefix proposed for SET-REGISTRY.md)
// under the real Baseball > 2024 > Topps; it carries no marketplace ids. It is
// a sole writer of the eBay sandbox seller account's listings (the registry's
// seller-account row), so it runs only in the seller job, one PR at a time. Its
// NB writes are the signed-in user's own rows: the eBay connection and setup, a
// minted box, one copy with a photo, the common price. It adds a minted team (no
// delete-team affordance exists; the token keeps it unique) that links the
// seed's existing Major League Baseball row and writes nothing to leagues, links
// the catalogue's George Brett, deletes nothing of the catalogue, and leaves the
// per-attempt set and card in place (nothing reads them again).
//
// Fixture arithmetic, exact on every runner: ATTEMPT_TOKEN's length varies with
// the worker and the random tail, so the set name is that token padded to
// SET_LEN characters and every length below is fixed (asserted in the spec). The
// stored title is "2024 Topps <set> <insert> Brett": 11 + 21 + 1 + 60 + 1 +
// 5 = 99, after the generator drops the team, the number, the sport and the
// first name; computed with the real generator, not estimated.
//
// Minted box name and team: single tokens from `env.ATTEMPT_TOKEN`.
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { editCardButton } from "../../support/cards";
import {
  backToBoxes,
  cardsWord,
  checklistTitle,
  clearChecklistCommonPrice,
  confirmRemoved,
  createBox,
  deleteOpenBox,
  drillToCollectorChecklist,
  expectNothingSent,
  followRunToEnd,
  followRunToRest,
  inventoryTabs,
  nameOf,
  putOtherBoxesInPerson,
  quantityField,
  queueSettled,
  syncRun,
  walkForCleanup,
  type CollectorSet,
} from "../../support/collection";
import { expectEbayHookedUp, removeEbayConnection, saveEbayConnection } from "../../support/credentials";
import type { FlowEnv } from "../../support/env";
import { test, expect, expectAccessible, LAUNCH_GATE, type SignIn } from "../../support/fixtures";
import { drillToCustom, escapeRe } from "../../support/set-builder";

const EBAY = "eBay";
const SPORT = "Baseball";
const YEAR = "2024";
const MANUFACTURER = "Topps";
const PLAYER = "George Brett";
/** The catalogue league the minted team plays in, so the card has a league for the listing (NEO-569). */
const MLB = "Major League Baseball";
/** The same 60-character insert `card-title-uses-short-name-for-titles` uses: nothing the generator cuts brings the title under 80. */
const LONG_INSERT = "Commemorative Anniversary Collectors Edition Hologram Series";
/** The card's number, a single token. */
const NUM = "C1";
/** The set's name length on every runner (see the fixture arithmetic above). */
const SET_LEN = 21;

/** The words the screens say (inventory/listing/copy.ts, the eBay Profile page). The spec reads them as a user does; it imports no app copy. */
const SANDBOX_LINE = "Test mode: this NeonBinder talks to eBay's sandbox, so nothing lists for real.";
const PAUSED_LINE = "eBay is on a break. Your changes wait here and go up when it's back.";
const HELD_SENTENCE =
  "Its title is over the 80-character limit for listings, and we won't chop it. Once we shorten it on our end, it goes up on the next sync.";
const NOT_CONNECTED_MISSING_SETUP =
  "eBay did not connect after the seed hop. Either DEV_EBAY_REFRESH_TOKEN (a sandbox seller's refresh token) " +
  "is unset on this deployment, or eBay is paused here (NEONBINDER_PAUSED_PLATFORMS) while this runner's " +
  "PAUSED_PLATFORMS does not name ebay. This spec never skips for missing setup.";

/** The sandbox seller's own shipping policies the spec picks (NeonBinder makes none, NEO-423). */
const TRACKED_POLICY = "NB Tracked (USPS Ground Advantage)";
const FREE_POLICY = "NB Free Shipping";
const mustHoldPolicy = (name: string, slot: string) =>
  `the eBay sandbox seller must already hold the shipping policy "${name}" (offered under ${slot}). ` +
  "NeonBinder no longer makes shipping policies (NEO-423), so add it on the sandbox seller's eBay account by hand " +
  "(see the sibling eBay listing spec's header and SET-REGISTRY.md)";

/** At or above eBay's $0.99 floor and under $20: the flat NB Free Shipping slot the sandbox can publish against (see the sibling spec). */
const COMMON_PRICE = "1.00";
/** A US address, the page's own example ZIP. */
const SHIPS_FROM = { zip: "53703", city: "Madison", state: "WI" };

/** The seed's hand-made front photo, committed for the intake specs (about 1000 px wide; eBay wants at least 500). */
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "intake");
const PHOTO = "03-bowe-front.jpg";

/** What the failing run needs undone, filled as the flow goes. */
const written: { connected?: boolean; disconnected?: boolean; priced?: boolean; target?: CollectorSet; title?: string; setLabel?: string } = {};

/** The key that leaves a quantity field: Tab on a desktop, Enter on a phone. */
const leaveKey = (isMobile: boolean) => (isMobile ? "Enter" : "Tab");

/** The Sync status screen's eBay section and this set's "Last sync by set" row. */
function syncStatus(page: Page, setLabel: string) {
  const platform = page.getByRole("region", { name: EBAY, exact: true });
  const row = platform
    .getByRole("list", { name: "Last sync by set" })
    .getByRole("listitem")
    .filter({ hasText: setLabel });
  return { platform, row };
}

export type Stage = "requeued" | "listed";

interface Args {
  page: Page;
  signIn: SignIn;
  env: FlowEnv;
  isMobile: boolean;
}

// Pass or fail, the account ends with eBay NOT connected. On a failure the
  // common price the run set is cleared first, and the disconnect takes down
  // anything already up on eBay (the same product action the steps end with).
  // Idempotent: it does only what the run got far enough to need.
  export function installOver80Cleanup(): void {
    test.afterEach(async ({ context }, testInfo) => {
    const failed = testInfo.status !== testInfo.expectedStatus;
    const clean = await context.newPage();
    try {
      try {
        if (failed && written.priced && written.target && written.title) {
          await clean.goto("/inventory?tab=checklists");
          await expect(clean.getByRole("heading", { level: 1, name: "Inventory" })).toBeVisible({ timeout: LAUNCH_GATE });
          const checklist = await drillToCollectorChecklist(clean, written.target);
          await clearChecklistCommonPrice(clean, checklist, written.title, COMMON_PRICE);
          written.priced = false;
        }
      } finally {
        if (written.connected && !written.disconnected) {
          // Disconnect waits out a run under way, longer than its button's budget, so
          // the run ends first. A walk that gives up still disconnects: if the run
          // really won't end, Disconnect refuses, and that red is the honest one.
          await clean.goto("/inventory?tab=sync");
          await expect(clean.getByRole("heading", { level: 1, name: "Inventory" })).toBeVisible({ timeout: LAUNCH_GATE });
          if (written.setLabel) {
            const { platform } = syncStatus(clean, written.setLabel);
            await walkForCleanup(() => followRunToEnd(platform, syncRun(platform, written.setLabel as string, EBAY)));
          }
          await removeEbayConnection(clean, { gate: LAUNCH_GATE });
        }
      }
    } finally {
      await clean.close();
    }
  });
}

/** Drives the flow through `through` and tidies up (the copy and its photo, the price, the box, eBay). */
export async function runOver80Flow({ page, signIn, env, isMobile }: Args, through: Stage): Promise<void> {
    // The hook's record of how far this run got starts empty.
    written.connected = false;
    written.disconnected = false;
    written.priced = false;
    written.target = undefined;
    written.title = undefined;
    written.setLabel = undefined;

    const set = `ebt${env.ATTEMPT_TOKEN}`.padEnd(SET_LEN, "x");
    expect(set, "the set name is exactly SET_LEN characters on every runner").toHaveLength(SET_LEN);
    const team = `EBT${env.ATTEMPT_TOKEN}`;
    const boxName = `Ebt${env.ATTEMPT_TOKEN}`;
    const target: CollectorSet = {
      sport: SPORT,
      year: YEAR,
      manufacturer: MANUFACTURER,
      set,
      checklist: { type: "Insert", name: LONG_INSERT },
    };
    const TITLE = checklistTitle(target);
    // An insert reads as part of the set's name on Sync status and in the card drawer.
    const SET_LABEL = TITLE;
    written.target = target;
    written.title = TITLE;
    written.setLabel = SET_LABEL;

    // The stored title (what the generator leaves after every cut) and the one the operator types.
    const longTitle = `${YEAR} ${MANUFACTURER} ${set} ${LONG_INSERT} Brett`;
    const shortTitle = `${YEAR} ${MANUFACTURER} ${set} Hologram Series ${PLAYER}`;
    expect(longTitle, "the stored title is over eBay's 80 on every runner").toHaveLength(99);
    expect(shortTitle, "the retyped title fits eBay's 80 on every runner").toHaveLength(61);

    const said = (text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
    const tabs = inventoryTabs(page);
    const boxes = page.getByRole("list", { name: "Your boxes" });
    const boxSpine = (cards: number) =>
      boxes.getByRole("button", { name: `${boxName}, box, ${cardsWord(cards)} for sale`, exact: true });
    const connectedLine = page.getByText(/^Rockin' on eBay as .+ since .+\.$/);
    const checklistSteps = page.getByRole("status").filter({ hasText: /to go\. Nothing lists on eBay until they're done\.$/ });
    const allSet = page.getByRole("heading", { level: 3, name: "You're all set", exact: true });
    const drawer = page.getByRole("dialog", { name: /^Card #/ });
    const cardTitle = drawer.getByRole("textbox", { name: "Card title", exact: true });
    const overCap = drawer.getByRole("alert").filter({ hasText: /over the 80-character limit/ });
    const doneEditing = page.getByRole("button", { name: "Done editing card" });

    // --- 1a. Profile -> Credentials -> eBay, before anything: wired, sandbox, not connected -----------
    await signIn("/profile/ebay");
    await expect(page.getByRole("heading", { name: "Profile Settings" })).toBeVisible({ timeout: LAUNCH_GATE });
    // Fails loudly, naming the setup, when this deployment has no eBay wiring.
    await expectEbayHookedUp(page);
    await expect(page.getByRole("heading", { level: 2, name: EBAY, exact: true })).toBeVisible();

    if (env.EBAY_PAUSED) {
      // --- Paused: the operator's switch stops all contact with eBay ---------------------------------
      // The seed hop skips a paused platform, so nothing connects and nothing can be held or listed.
      await saveEbayConnection(page, { listing: true, gate: LAUNCH_GATE });
      await expect(page.getByText(PAUSED_LINE, { exact: true })).toBeVisible();
      await expect(connectedLine).toBeHidden();
      await expect(page.getByRole("button", { name: "Connect eBay", exact: true })).toBeHidden();
      await expectAccessible(page, { label: "Profile, eBay on a break" });
      return;
    }

    // The safety assert: this deployment talks to eBay's sandbox, never the real thing.
    await expect(
      page.getByText(SANDBOX_LINE, { exact: true }),
      "the eBay listing spec lists real cards; it runs only on a deployment wired to eBay's SANDBOX (EBAY_ENVIRONMENT=sandbox)",
    ).toBeVisible();
    await expect(connectedLine).toBeHidden();

    // --- 1b. The card: a hand-made insert nobody can fit, one card for George Brett with a team ---------
    // R9: the Set Builder drill helper.
    await drillToCustom(page, { sport: SPORT, year: YEAR, manufacturer: MANUFACTURER, set, variantType: "Insert", variant: LONG_INSERT });
    await page.getByRole("button", { name: "Open add card form" }).click();
    const cardName = page.getByRole("textbox", { name: "Card name", exact: true });
    await expect(cardName).toBeVisible();
    await page.getByRole("textbox", { name: "Card number", exact: true }).fill(NUM);
    // A team of the card's own (the listing asks eBay for it), made through the New team dialog.
    await page.getByRole("button", { name: "Add team" }).click();
    const teamSearch = page.getByRole("textbox", { name: "Search teams" });
    await teamSearch.fill(team);
    await teamSearch.press("Enter");
    const newTeam = page.getByRole("dialog", { name: `New team: ${team}` });
    await expect(newTeam).toBeVisible();
    await expect(newTeam.getByRole("textbox", { name: "New team name" })).toHaveValue(team);
    // The team plays in the catalogue's Major League Baseball (linked, never created): the card takes its
    // league from its team (NEO-569), and a card with no league is held back for that before its title.
    const teamLeague = newTeam.getByRole("combobox", { name: "League" });
    await teamLeague.fill(MLB);
    await newTeam.getByRole("option", { name: new RegExp(`^${MLB}`) }).click();
    await expect(teamLeague).toHaveValue(MLB);
    await newTeam.getByRole("button", { name: `Create team ${team}` }).click();
    await expect(page.getByRole("button", { name: `Remove team ${team}` })).toBeVisible();
    // Focusing another field closes the team search.
    await cardName.click();
    await expect(page.getByRole("textbox", { name: "Search teams" })).toBeHidden();
    // The catalogue's George Brett, picked ("Add <name>", the full match).
    await page.getByRole("button", { name: "Add a player to the new card" }).click();
    const findPlayer = page.getByRole("textbox", { name: "Find a player for the new card" });
    await findPlayer.fill(PLAYER);
    await page.getByRole("option", { name: `Add ${PLAYER}`, exact: true }).click();
    await expect(page.getByRole("button", { name: `Remove player ${PLAYER}` })).toBeVisible();
    // Close the player popover (it covers Submit) by focusing another field.
    await cardName.click();
    await expect(findPlayer).toBeHidden();
    await page.getByRole("button", { name: "Submit new card" }).click();
    await expect(cardName).toBeHidden();
    await expect(editCardButton(page, NUM)).toBeVisible();

    // The fixture is what the feature needs: the stored title is over 80 and the drawer says so.
    await editCardButton(page, NUM).click();
    await expect(cardTitle).toBeVisible();
    await expect(cardTitle).toHaveValue(longTitle);
    await expect(overCap).toBeVisible();
    // The card has a league (its team's), so the listing has one to send and the hold can only be the title's.
    await expect(drawer.getByRole("combobox", { name: "Card league" }), "the card takes Major League Baseball from its team").toHaveValue(MLB);
    await doneEditing.click();
    await expect(cardTitle).toBeHidden();

    // --- 2a. A box to stock, every other box in-person BEFORE connecting ------------------------------
    // A full page load, so the launch gate applies.
    await page.goto("/inventory?tab=boxes");
    await expect(page.getByRole("heading", { level: 1, name: "Inventory" })).toBeVisible({ timeout: LAUNCH_GATE });
    await createBox(page, boxName);
    await backToBoxes(page);
    await expect(boxSpine(0)).toBeVisible();
    await putOtherBoxesInPerson(page, boxName);

    // --- 2b. Connect (the seed hop makes the connection eBay's consent screen would) and finish the setup ---
    // Starts listing as a collector's own Connect does (`listing=on`). Recorded
    // BEFORE the hop: the hop may connect and still fail on the way back.
    written.connected = true;
    await saveEbayConnection(page, { listing: true, gate: LAUNCH_GATE });
    await expect(connectedLine, NOT_CONNECTED_MISSING_SETUP).toBeVisible();
    await expect(page.getByText(SANDBOX_LINE, { exact: true })).toBeVisible();
    await expect(checklistSteps).toHaveText("5 to go. Nothing lists on eBay until they're done.");

    // The seller's policies are read from eBay when the page opens (a live round
    // trip). The read has finished when the first of the seller's own policies for
    // Cards under $20 is on screen; "Set me up" renders in the same paint.
    const underTwenty = page.getByRole("radiogroup", { name: "Cards under $20", exact: true });
    const twentyPlus = page.getByRole("radiogroup", { name: "$20 and up", exact: true });
    const setMeUp = page.getByRole("button", { name: "Set me up", exact: true });
    await expect(underTwenty.getByRole("radio").first(), mustHoldPolicy(FREE_POLICY, "Cards under $20")).toBeVisible();
    const setMeUpOffered = await setMeUp.isVisible();
    // Ships from: Enter in the last field saves, and makes the seller's inventory location on eBay (a live round trip).
    await page.getByRole("textbox", { name: "ZIP code", exact: true }).fill(SHIPS_FROM.zip);
    await page.getByRole("textbox", { name: "City", exact: true }).fill(SHIPS_FROM.city);
    await page.getByRole("textbox", { name: "State", exact: true }).fill(SHIPS_FROM.state);
    await page.keyboard.press("Enter");
    await expect(said("Saved. Your cards ship from here.")).toBeVisible();
    await expect(checklistSteps).toHaveText("4 to go. Nothing lists on eBay until they're done.");
    if (setMeUpOffered) {
      // Offered only where the seller's account has no payment or returns policy: it makes
      // NeonBinder's standard ones (never a shipping policy). The answer is the success line.
      await setMeUp.click();
      await expect(said(/^(Made \d+ on your eBay account|You already had everything)/)).toBeVisible();
    } else {
      await expect(setMeUp).toBeHidden();
    }
    // The seller's own flat NB Free Shipping for the price this spec lists at, NB Tracked for $20 and up.
    const underTwentyFree = underTwenty.getByRole("radio", { name: FREE_POLICY, exact: true });
    await expect(underTwentyFree, mustHoldPolicy(FREE_POLICY, "Cards under $20")).toBeVisible();
    await underTwentyFree.click();
    await expect(underTwentyFree).toBeChecked();
    const tracked = twentyPlus.getByRole("radio", { name: TRACKED_POLICY, exact: true });
    await expect(tracked, mustHoldPolicy(TRACKED_POLICY, "$20 and up")).toBeVisible();
    await tracked.click();
    await expect(tracked).toBeChecked();
    // Payment and Returns: the first of the seller's own policies, where "Set me up" has not already picked one.
    for (const group of ["Payment", "Returns"]) {
      const radios = page.getByRole("radiogroup", { name: group, exact: true }).getByRole("radio");
      await expect(radios.first()).toBeVisible();
      await radios.first().click();
      await expect(page.getByRole("radiogroup", { name: group, exact: true }).getByRole("radio", { checked: true })).toHaveCount(1);
    }
    // The last pick finishes the setup: the checklist folds to "You're all set".
    await expect(allSet).toBeVisible();
    await expect(checklistSteps).toBeHidden();

    // --- 2c. Stock the box: a price, one copy of the card, a photo on it ---------------------------------
    // A full page load, so the launch gate applies.
    await page.goto("/inventory?tab=checklists");
    await expect(page.getByRole("heading", { level: 1, name: "Inventory" })).toBeVisible({ timeout: LAUNCH_GATE });
    const adding = page.getByRole("combobox", { name: "Adding to" });
    await expect(adding).toBeVisible();
    const checklist = await drillToCollectorChecklist(page, target);
    const sync = checklist.getByRole("button", { name: `Sync ${TITLE}`, exact: true });
    await adding.selectOption({ label: boxName });
    await expect(adding.getByRole("option", { selected: true })).toHaveText(boxName);
    const boxList = checklist.getByRole("list", { name: `Quantities in ${boxName}` });
    await expect(boxList.getByRole("textbox").first()).toBeVisible();
    // Connected and set up: Sync is usable.
    await expect(sync).toBeVisible();
    await expect(sync).not.toHaveAttribute("aria-disabled", "true");

    // The card's short name, as the quantity field names it ("Quantity of <card> in <box>").
    const fieldName = await nameOf(boxList.getByRole("textbox").first());
    const named = new RegExp(`^Quantity of (.+) in ${escapeRe(boxName)}$`).exec(fieldName);
    expect(named, `a quantity field named "Quantity of <card> in ${boxName}" (read: ${fieldName})`).not.toBeNull();
    const short = named![1];
    expect(short, "the checklist's one card is the fixture's").toContain(NUM);
    const number = short.split(" ")[0];

    // A common price: a listed box is held until its cards have one.
    await checklist.getByRole("button", { name: `Set a common price for ${TITLE}`, exact: true }).click();
    const priceField = checklist.getByRole("textbox", { name: "Common price", exact: true });
    await expect(priceField).toBeFocused();
    written.priced = true;
    await priceField.fill(COMMON_PRICE);
    await page.keyboard.press("Enter");
    await expect(said(`Common price for ${TITLE} is $${COMMON_PRICE}`)).toBeVisible();

    const field = quantityField(boxList, short, boxName);
    await expect(field).toHaveValue("0");
    await field.fill("1");
    await page.keyboard.press(leaveKey(isMobile));
    await expect(said(new RegExp(`^Boxed 1 more of ${escapeRe(short)}\\.`))).toBeVisible();
    await expect(field).toHaveValue("1");

    // The photo, by hand in the card's drawer: a box row's Details opens the drawer already editing the card's ONE line.
    const cardDrawer = page.getByRole("dialog", { name: new RegExp(`^${escapeRe(SET_LABEL)} ${escapeRe(short)}`) });
    const openCardDrawer = async () => {
      await checklist.getByRole("button", { name: `Details for ${short}`, exact: true }).click();
      const yourCopies = cardDrawer.getByRole("region", { name: `Your copies of ${short}`, exact: true });
      await expect(yourCopies.getByRole("heading", { name: "Your copies (1 line)", exact: true })).toBeVisible();
      const editForm = yourCopies.getByRole("form", { name: /^Edit Raw, / });
      await expect(editForm).toBeVisible();
      return { yourCopies, editForm };
    };
    {
      const { editForm } = await openCardDrawer();
      const panel = editForm.getByRole("region", { name: /^Photos of / });
      await expect(panel.getByText("No front photo yet")).toBeAttached();
      await panel.getByLabel("Front photo file", { exact: true }).setInputFiles(path.join(FIXTURES, PHOTO));
      await expect(panel.getByRole("status")).toHaveText("Front photo saved.");
      await cardDrawer.getByRole("button", { name: "Close card detail" }).click();
      await expect(cardDrawer).toBeHidden();
    }

    // --- 3. Sync: eBay is offered nothing, and the card is held back whole with the title's reason -------
    // Pressed the moment the last write (the photo above) is in, so the 15-minute poll has the narrowest
    // window to hold the box first. The poll holds it the same way; the end state is identical either way.
    await sync.click();
    await expect(said(`Syncing ${TITLE} now. Watch it on Sync status.`)).toBeVisible();
    // After the press, a link to the result sits under Sync. It lands on Sync status, and Back steps to the checklist.
    const seeSyncing = checklist.getByRole("link", { name: "See what's syncing", exact: true });
    await expect(seeSyncing).toBeVisible();
    await seeSyncing.click();
    await expect(page).toHaveURL(/[?&]tab=sync/);
    const { platform, row } = syncStatus(page, SET_LABEL);
    await expect(platform.getByRole("heading", { level: 2, name: EBAY, exact: true })).toBeVisible();
    // Walked one step at a time until the press's queued card is gone and the platform is idle:
    // a press proven to have run (a stale row left by the poll proves nothing).
    const held = syncRun(platform, SET_LABEL, EBAY);
    await followRunToRest(platform, held, queueSettled(platform, SET_LABEL));
    await expect(row.getByText(/^Synced /)).toBeVisible();
    // Nothing is listed; the card is the one skipped, held back, and the reason is the title's.
    await expect(row.getByText(/^0 listed, 1 skipped$/)).toBeVisible();
    await expect(row.getByText("1 held back:", { exact: true })).toBeVisible();
    const heldCard = row.getByRole("listitem").filter({ hasText: HELD_SENTENCE });
    await expect(heldCard).toHaveCount(1);
    await expect(heldCard).toContainText(number);
    // The run gathered its data and sent nothing: no item, offer or publish step was ever taken for the card.
    await expect(held.last).toBeVisible();
    await expect(held.gathered()).toBeVisible();
    await expect(held.last.getByRole("listitem", { name: /^(List the cards|Set prices|Go live)/ })).toHaveCount(0);
    await expectAccessible(page, { label: "Inventory Sync status, eBay card held back for a title over 80 characters" });
    await page.goBack();
    await expect(page).toHaveURL(/[?&]tab=checklists/);
    await expect(checklist.getByRole("heading", { level: 3, name: TITLE })).toBeVisible();

    // --- 4. Fix it in the set builder: the shortened title re-queues the card by itself ------------------
    // R9: the Set Builder drill helper (a full page load, which carries its own gate).
    await drillToCustom(page, { sport: SPORT, year: YEAR, manufacturer: MANUFACTURER, set, variantType: "Insert", variant: LONG_INSERT });
    await editCardButton(page, NUM).click();
    await expect(cardTitle).toBeVisible();
    // Still the stored, over-80 title: nothing changed it behind the operator's back.
    await expect(cardTitle).toHaveValue(longTitle);
    await expect(overCap).toBeVisible();
    await cardTitle.fill(shortTitle);
    await expect(overCap).toBeHidden();
    await cardTitle.press("Enter");
    await expect(page.getByText(/Saved Card title/)).toBeVisible();
    await expect(cardTitle).toHaveValue(shortTitle);
    await doneEditing.click();
    await expect(cardTitle).toBeHidden();

    // Sync status queues the card (the proof the save reaches eBay with no Sync pressed). A full page load.
    await page.goto("/inventory?tab=sync");
    await expect(page.getByRole("heading", { level: 1, name: "Inventory" })).toBeVisible({ timeout: LAUNCH_GATE });
    const queued = platform
      .getByRole("list", { name: /^Queued for the next sync/ })
      .getByRole("listitem")
      .filter({ hasText: new RegExp(`^${escapeRe(number)} .* in ${escapeRe(SET_LABEL)}`) });
    await expect(queued).toHaveCount(1);
    // The held-back line is still the last result until a run takes the card again.
    await expect(row.getByText("1 held back:", { exact: true })).toBeVisible();

    // --- 5. The next sync lists it (the parked proof: it needs a publish that works, NEO-453) -------
    let reopened: Locator | undefined;
    if (through === "requeued") {
      // The queued state is the end of the active proof: a card waiting for the next sync, no Sync pressed.
      await expectAccessible(page, { label: "Inventory Sync status, eBay card queued again after its title was shortened" });
    } else {
      await tabs.getByRole("link", { name: "Checklists", exact: true }).click();
      await expect(page).toHaveURL(/[?&]tab=checklists/);
      // A fresh page load starts at the cascade.
      const relistChecklist = await drillToCollectorChecklist(page, target);
      reopened = relistChecklist;
      const relistSync = relistChecklist.getByRole("button", { name: `Sync ${TITLE}`, exact: true });
      await expect(relistSync).not.toHaveAttribute("aria-disabled", "true");
      await relistSync.click();
      await expect(said(`Syncing ${TITLE} now. Watch it on Sync status.`)).toBeVisible();
      await relistChecklist.getByRole("link", { name: "See what's syncing", exact: true }).click();
      await expect(page).toHaveURL(/[?&]tab=sync/);
      const listing = syncRun(platform, SET_LABEL, EBAY);
      const listedLine = row.getByText(/^1 listed(, 1 updated)?$/);
      // Going live is the one step with a longer budget, a ceiling Jason signed off on
      // 2026-11-03 (GUIDE hard rule 3, the sibling eBay listing spec): one eBay publishOffer
      // call, as long as the slowest call. Measured on the sandbox: 5.1, 9.0, 9.1 and 10.9 s
      // in CI, 6.1 s on dev; our own work in the step is well under a second. Void it if the
      // step gains any work of ours.
      await followRunToRest(platform, listing, queueSettled(platform, SET_LABEL), { "Go live": 15_000 });
      await expect(listedLine).toBeVisible();
      await expect(row.getByText(/^Synced /)).toBeVisible();
      // The card is no longer held back for anything: the row names no held-back card at all.
      await expect(row.getByText(/held back/)).toHaveCount(0);
      await expect(heldCard).toHaveCount(0);
      await expect(queued).toHaveCount(0);
      // Finished, the set's row keeps the run's steps; the data gathering folds to "Gathering data".
      await expect(listing.last).toBeVisible();
      await expect(listing.gathered()).toBeVisible();
      const pressSent = / \d+ updated\b/.test((await listedLine.textContent()) ?? "");
      if (pressSent) {
        // Press first: the press sent the card, so the ledger holds the sending steps, in run order.
        await expect(listing.last.getByRole("listitem")).toContainText([/^List the cards, done$/, /^Set prices, done$/, /^Go live, done$/]);
        await expect(listing.nothingNew()).toHaveCount(0);
      } else {
        // Poll first (the 15-minute poll took the queued card between the save and the press): the
        // line's "1 listed" is the proof it is up; the press read and sent nothing.
        await expectNothingSent(listing);
      }
      await expectAccessible(page, { label: "Inventory Sync status, eBay listed the card once its title was shortened" });
    }

    // --- 6. Tidy up through the product: the copy and its photo, the price, the box, eBay ----------------
    await tabs.getByRole("link", { name: "Checklists", exact: true }).click();
    await expect(page).toHaveURL(/[?&]tab=checklists/);
    // Reopened where it was left after the second Sync; a page loaded fresh for the queue check starts at the cascade.
    const tidyChecklist = reopened ?? (await drillToCollectorChecklist(page, target));
    await expect(tidyChecklist.getByRole("heading", { level: 3, name: TITLE })).toBeVisible();
    {
      // The card's only line goes out through its drawer's Remove, photo and all (so no copy falls into Unsorted).
      await tidyChecklist.getByRole("button", { name: `Details for ${short}`, exact: true }).click();
      const yourCopies = cardDrawer.getByRole("region", { name: `Your copies of ${short}`, exact: true });
      await expect(yourCopies.getByRole("heading", { name: "Your copies (1 line)", exact: true })).toBeVisible();
      const editForm = yourCopies.getByRole("form", { name: /^Edit Raw, / });
      await expect(editForm).toBeVisible();
      await editForm.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(editForm).toBeHidden();
      await yourCopies.getByRole("button", { name: new RegExp(`^Remove ${escapeRe(short)}, Raw, `) }).click();
      await expect(yourCopies.getByText("None yet. Fill in what you know below and add it.")).toBeVisible();
      await confirmRemoved(cardDrawer);
      await cardDrawer.getByRole("button", { name: "Close card detail" }).click();
      await expect(cardDrawer).toBeHidden();
      await expect(quantityField(tidyChecklist.getByRole("list", { name: `Quantities in ${boxName}` }), short, boxName)).toHaveValue("0");
    }
    await clearChecklistCommonPrice(page, tidyChecklist, TITLE, COMMON_PRICE);
    written.priced = false;

    await tabs.getByRole("link", { name: "My Boxes", exact: true }).click();
    await expect(boxSpine(0)).toBeVisible();
    await boxSpine(0).click();
    await expect(page.getByRole("heading", { level: 2, name: boxName, exact: true })).toBeVisible();
    await deleteOpenBox(page, boxName);
    await expect(boxes.getByRole("button", { name: new RegExp(`^${escapeRe(boxName)},`) })).toHaveCount(0);

    // Disconnect: takes down what NeonBinder put up on eBay and leaves the account not connected
    // (a live round trip, the standard budget). A full page load, so the launch gate applies.
    await removeEbayConnection(page, { gate: LAUNCH_GATE });
    written.disconnected = true;
    await expect(page.getByText(/^Rockin' on eBay as /)).toBeHidden();
}
