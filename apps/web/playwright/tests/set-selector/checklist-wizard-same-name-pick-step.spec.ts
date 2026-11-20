// Origin: .maestro/flows/set-selector/checklist-wizard-same-name-pick-step.yaml (Maestro suite retired in NEO-341; see git history)
// NEO-332: when two players on file share a checklist name, the entity-review
// wizard opens on a PICK step ("Which <name> is this?") instead of offering
// "Add as New Player". "Create new" opens the New Player step, "Back to the
// list" returns with nothing decided, and taking a candidate records a link to
// THAT player.
//
// The ambiguity is made through the product. The NEO-330 reference catalogue (a
// prod snapshot) already holds a "Shuya Yamada" (Hanshin Tigers from 2026, no
// birth year); the spec adds a second Baseball "Shuya Yamada" born 1851 (the
// form's floor is 1850). Two on file, so the name is ambiguous. ONE row of our
// own, not two: on a catalogue preview the server refuses a second fork
// (`adoptOrForkOnCreate` forks past ONE undated rival but not past several;
// CI run 38197074499). The b. 1851 row has no stint, so card-year narrowing
// never filters him out; the catalogue row survives the +-2-year tolerance and
// his stint starts after 2024, so the card's team cannot pick him outright. If
// a catalogue refresh moves that stint or drops the row, STEP 1 fails by name
// (no pick step): re-measure, do not hedge.
//
// The name is a REAL two-token checklist name, not a minted one (the exception
// to single-token names; SET-REGISTRY.md "BBM Rookie Edition Premium"). Sole
// owner of that set; READ-ONLY on it: the spec leaves through Cancel and Discard.
// NEO-475: the fixture moved from 2024 Topps Chrome NPB (216 cards) to 2024 BBM
// Rookie Edition Premium (36 cards, RP01-RP36), where Shuya Yamada is RP03
// (Hanshin). The drill is BBM's own brand row: a known brand (convex/
// knownBrands.ts), minted under 2024 by the seed's year-wide Sets sync, which
// files this set under it by name. Chosen by a read-only probe with SportLots
// PAUSED (BSC only, 2026-11-09): the live branches (BBM in SportLots' 2024 brand list,
// the Base picker's first SportLots candidate, the Match Cards pairing) are
// UNMEASURED until SportLots returns, and the first live run must check them. Re-runs are
// idempotent (an existing b. 1851 row is adopted). The decided count is read
// relative to K, the walk's skips, off the names' "Decided (N)" history: since
// NEO-467 the header carries a progress bar ("Wizard progress"), not a step
// count, so "this row is still undecided" is also read off the row's own
// controls and "this row was decided" off its skip going away.
// NEO-490: STEP 6-8 add the career-team rule (6b), with NEO-574's year rule on it: a stint
// counts for the card's club only if it is undated or starts in or before the card's year. The
// catalogue's Shuya Yamada played for the club the card names (RP03 says "Hanshin Tigers"), but
// from 2026, after this 2024 set, so his stint does not count. Once the b. 1851 row has a Hanshin
// Tigers stint of 2021-2022 he is the ONLY one of the two the card's club settles, so the fetch
// links him and shows it as a decided row: no pick step. Without the year rule both would count
// and the exactly-one guard would bring the pick step back, so STEP 7 fails by name if the rule
// goes. 2021-2022, not 2024: a stint that COVERS the card's year is rule 4 (convex/players.ts),
// which resolves the name before review (no row, no Decided line; measured NEO-574), and one that
// ends before 2022 drops him from the year narrowing's +-2 survivors, leaving the catalogue's man
// alone. 2021-2022 survives rule 4 and the narrowing and reaches 6b. The
// stint is removed again at the end, and a stray one a red attempt left is removed at the start,
// because the pick step above needs a rival with NO career on file.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { expectPlayersLoaded, emptyListAndPickSport, PLAYERS_MATCHES, playersCounter } from "../../support/players";
import { CHECKLISTS } from "../../support/published-checklist";
import {
  cancelAndDiscard,
  decidedSummary,
  expectDecidedCount,
  expectNameStepLeft,
  expectNothingDecided,
  expectWizardStep,
  fetchChecklistToWizard,
  openDecidedList,
  readDecidedCount,
  reviewWizard,
  STEP_SUBTITLE,
  walkToPlayerRow,
  wizardProgress,
} from "../../support/wizard";
import type { Page } from "@playwright/test";

const SET = "BBM Rookie Edition Premium";
const TARGET = { manufacturer: "BBM", set: SET };
const NAME = "Shuya Yamada";
/** The club the card prints (RP03): the rival's career, once he has one, in the card's year. */
const CARD_CLUB = "Hanshin Tigers";
/** The rival's stint there: starts before the card's 2024, ends before it (see the header). */
const RIVAL_FROM = "2021";
const RIVAL_TO = "2022";

/**
 * Add the b. 1851 Baseball Shuya Yamada, or open the row a previous run left (the add form adopts
 * him: "already exists"). Contract: ENTRY /admin/players is loaded. EXIT his detail is open and
 * the list is on Baseball.
 */
async function addOrOpenRival(page: Page): Promise<void> {
  await emptyListAndPickSport(page, "Baseball");
  const newName = page.getByRole("textbox", { name: "New player name" });
  const birthYear = page.getByRole("spinbutton", { name: /^Birth year \(optional\)/ });
  // With the catalogue's row on file creation is the demoted "anyway" control;
  // without it (no catalogue) the plain one. A re-run adopts the b. 1851 row
  // ("already exists"). A REFUSAL renders neither result line, so this fails by
  // name if the server will not file him.
  const create = page.getByRole("button", { name: new RegExp(`^Create player ${NAME}( anyway)?$`) });
  const result = page.getByText(new RegExp(`(Added ${NAME}\\.|That player already exists — opened it\\.)`));
  await page.getByRole("button", { name: "Add player" }).click();
  await expect(page.getByRole("heading", { name: "Add a player" })).toBeVisible();
  await newName.fill(NAME);
  await birthYear.fill("1851");
  await create.click();
  await expect(result).toBeVisible();
}

test(
  "Entity review — a checklist name two players on file share asks which one it is, and Create new is a step you can back out of",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    await signIn("/admin/players");
    // The list counter, not the heading: the heading paints before the list query answers.
    await expectPlayersLoaded(page, LAUNCH_GATE);

    // ── FIXTURE: a second Baseball Shuya Yamada, b. 1851, beside the catalogue's ──
    await addOrOpenRival(page);

    // A stint a red attempt of STEP 6 left on him would turn the pick step below into a link: take
    // it off first, so the claim of the pick step (a rival with NO career on file) holds.
    // R2: the guard has two states and each ends in a hard assert.
    //   (a) CLEAN, the expected one: the page says "No stints recorded yet." and nothing runs.
    //   (b) STRAY: a "Remove <club> <n> stint" control is showing (a red earlier run left it): it is
    //       removed and saved, and "Saved <name>" must appear.
    // The first assert below requires one of the two to be on screen, and the last requires (a) in
    // both cases, so the spec cannot go on with a career on file.
    // Any club: before NEO-574 the stint was at another club.
    const strayStint = page.getByRole("button", { name: /^Remove .+ [0-9]+ stint$/ });
    await expect(strayStint.or(page.getByText("No stints recorded yet.")).first()).toBeVisible();
    if (await strayStint.isVisible()) {
      await strayStint.click();
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByText(`Saved ${NAME}`)).toBeVisible();
    }
    await expect(page.getByText("No stints recorded yet.")).toBeVisible();

    // The b. 1851 row is on file (a server search, so read back from the
    // database). No count is asserted: the search matches ANY token, so other
    // Baseball "Yamada"s may fill the page ("10+ matches"); rows matching both
    // tokens rank first. That the name is AMBIGUOUS is proved by the wizard's own
    // intro in STEP 1.
    await page.getByRole("textbox", { name: "Filter players" }).fill(NAME);
    await expect(playersCounter(page, PLAYERS_MATCHES)).toBeVisible();
    await expect(page.getByText(/b\. 1851/).first()).toBeVisible();

    // ── SETUP: this set's live fetch, the wizard open with nothing decided ──
    await fetchChecklistToWizard(page, env, TARGET, { checklist: CHECKLISTS.bbmRookieEditionPremium });
    const wizard = reviewWizard(page);
    // Settled into one state (the header is up), then branch on it: a resumed
    // batch shows its "Decided (k)" history from the first decision on.
    await expect(wizardProgress(page)).toBeVisible();
    if (await decidedSummary(page).isVisible()) {
      // A red attempt left its review batch on this set and the fetch resumed
      // it: throw it away and fetch again so this run starts clean.
      await page.getByRole("button", { name: "Cancel (Esc)" }).click();
      await expect(page.getByText(/Discard [0-9]+ decisions?/)).toBeVisible();
      await page.getByRole("button", { name: "Discard", exact: true }).click();
      await expect(page.getByText("Fetch cancelled — no cards saved.")).toBeVisible({ timeout: 30_000 });
      await fetchChecklistToWizard(page, env, TARGET, { checklist: CHECKLISTS.bbmRookieEditionPremium });
    }
    await expectNothingDecided(page);

    // ── STEP 1: the pick step. The same-name row arrives READY (no lookup of its
    // own), so the wizard never offers "Add as New Player" for it. Every other
    // unknown name on this set is in the enrichment recording (NEO-394), so
    // their lookups settle at once and any career teams they stage come first:
    // the walk SKIPS every team/league step and stops on the first player row,
    // this pick step. Rows are inserted in card order and he is RP03; RP01
    // (Kaito Shimomura) and RP02 (Tsuyoshi Shiiba) each resolve to one catalogue
    // player and are linked at the fetch, so his is the batch's first row (the
    // other unknowns, RP13 Kota Nishidate, RP18 Gouki Oda, RP20 Kosuke Kawachi,
    // RP27 Ryotaro Sawayanagi and RP33 Koichi Okumura, come after him). The
    // walk's skips are K decisions, so every count below is read against K. A
    // staged career team can open the batch (it did on the old NPB fixture),
    // which is why there is no "opens on the pick step" check.
    const question = wizard.getByText(`Which ${NAME} is this?`);
    const link1851 = wizard.getByRole("button", { name: `Link to ${NAME}, born 1851` });
    // The catalogue's man: his label carries what is on file about him but no
    // birth year, so "any Shuya Yamada link that is not a dated one" cannot be
    // the b. 1851 row and pins no catalogue data this spec does not own.
    const linkCatalogue = wizard.getByRole("button", { name: new RegExp(`^Link to ${NAME}, (?!born ).+`) });
    await walkToPlayerRow(page);
    await expect(question).toBeVisible();
    // K: the walk's skips. This row's own skip is up exactly while it is undecided.
    const decidedK = await readDecidedCount(page);
    const rowSkip = wizard.getByRole("button", { name: `Skip ${NAME} — not a person`, exact: true });
    // NEO-335: the pick step is its own screen type in the header (NEO-467: also
    // the progress bar's value text).
    await expect(wizard.getByText("Which player is this?", { exact: true })).toBeVisible();
    await expectWizardStep(page, STEP_SUBTITLE.pick);
    await expect(wizard.getByText("We've got 2 on file under that name. Pick the one on this card.")).toBeVisible();
    await expect(link1851).toBeVisible();
    await expect(linkCatalogue).toBeVisible();
    // NEO-462: his row carries what is on file about him (no birth year, one open
    // stint) as a written line and, in the accessible name, the same facts spoken
    // after the roster note: "2026–present" reads "2026 to present". The catalogue
    // names the club "Tigers"; a refresh that moves his stint fails here by name.
    await expect(linkCatalogue.getByText("Tigers 2026–present", { exact: true })).toBeVisible();
    await expect(linkCatalogue).toHaveAccessibleName(`Link to ${NAME}, On a roster that year, Tigers 2026 to present`);
    // NEO-602: the step shows the card the name came off, so the operator can choose by
    // it: the card's number and the team printed on it (RP03 says "Hanshin Tigers"), and
    // under them each candidate with the stints on file. The cards are read from the cards the
    // fetch observed, so a refresh cannot move them. Both lists are named by their visible
    // lead-in ("Printed on N cards", "Teams we know for each player").
    const printedCards = wizard.getByRole("list", { name: /^Printed on [0-9]+ cards?$/ });
    await expect(printedCards).toContainText("#RP03");
    await expect(printedCards).toContainText("Hanshin Tigers");
    const known = wizard.getByRole("list", { name: "Teams we know for each player" });
    await expect(known).toContainText(`${NAME}, b. 1851`);
    // The catalogue's man has no birth year, so the list tells him from his namesake by his place
    // in the pick step's order, the wording the Link buttons use when a row has nothing else. The
    // order is the server's (`sameNamePlayers`: the name index, ties by creation), and the catalogue's
    // row is imported with the seed before this spec adds or adopts its namesake, so he is option 1.
    await expect(known).toContainText(`${NAME}, option 1 of 2`);
    // The rival has no career on file (the fixture's claim); the catalogue's man has one stint,
    // on the club the card prints, and it is marked as that, as a qualifier after the team.
    await expect(known).toContainText("Nothing on file yet");
    await expect(known).toContainText(/Hanshin Tigers \(printed team\)/);
    // The status line says what that settles: exactly one of the two has a stint with the
    // printed team, so it names him by his place in the list. The wizard's other live regions
    // are filtered out by the sentence.
    await expect(
      wizard
        .getByRole("status")
        .filter({
          hasText: new RegExp(`^Only ${NAME} \\(option 1 of 2\\) has a stint on file with the printed team\\.$`),
        }),
    ).toBeVisible();
    await expect(wizard.getByRole("button", { name: "Create new" })).toBeVisible();
    await expect(rowSkip).toBeVisible();
    await expectAccessible(page, { within: wizard, label: "Entity review wizard, same-name pick step" });

    // ── STEP 2: Create new opens the New Player step, without the list ──
    await wizard.getByRole("button", { name: "Create new" }).click();
    await expect(wizard.getByRole("button", { name: "Add as New Player" })).toBeVisible();
    await expect(wizard.getByRole("button", { name: "Back to the list" })).toBeVisible();
    await expect(wizard.getByRole("heading", { name: `New Player: ${NAME}` })).toBeVisible();
    // ...and the header says which screen type this is now: a New Player step.
    await expect(wizard.getByText("New player", { exact: true })).toBeVisible();
    await expect(question).toBeHidden();
    await expect(wizard.getByRole("button", { name: new RegExp(`^Link to ${NAME}, `) })).toBeHidden();
    await expectAccessible(page, { within: wizard, label: "Entity review wizard, New Player step opened from the pick step" });

    // ── STEP 3: Back to the list decides nothing ──
    await wizard.getByRole("button", { name: "Back to the list" }).click();
    await expect(question).toBeVisible();
    await expect(link1851).toBeVisible();
    await expect(linkCatalogue).toBeVisible();
    await expect(wizard.getByText("Back at the list. 2 on file.")).toBeVisible();
    // Nothing was recorded (Create new started this row's own lookup; it decided
    // nothing): the wizard is still on THIS row's pick step, and the decided
    // count is still K.
    await expect(rowSkip).toBeVisible();
    await expectWizardStep(page, STEP_SUBTITLE.pick);
    await expectDecidedCount(page, decidedK);

    // ── STEP 4: take one, and the read-back says which ──
    await link1851.click();
    // Exactly one decision, on this row: the wizard has left it, and the
    // decided count is K + 1.
    await expectNameStepLeft(page, `Skip ${NAME} — not a person`);
    await expectDecidedCount(page, decidedK + 1);
    await expect(question).toBeHidden();
    // The read-back names WHICH man. Not the Decided list (it folds past five and
    // the walk's skips usually put it there): the link moved the walk on, and the
    // footer's "Back to previous decision" reopens this row read-only, in a panel
    // named for the row. Neither a create, a skip nor a link to the catalogue's
    // undated Shuya Yamada can produce this text.
    await wizard.getByRole("button", { name: "Back to previous decision" }).click();
    await expect(
      wizard.getByRole("group", { name: `Decision for ${NAME}` }).getByText(`Linked to ${NAME}, b. 1851`),
    ).toBeVisible();
    await expectAccessible(page, { within: wizard, label: "Entity review wizard, pick recorded" });

    // ── STEP 5: leave without writing anything ──
    await wizard.getByRole("button", { name: "Cancel (Esc)" }).click();
    await expect(page.getByText(/Discard [0-9]+ decisions?/)).toBeVisible();
    await page.getByRole("button", { name: "Discard", exact: true }).click();
    await expect(page.getByText("Fetch cancelled — no cards saved.")).toBeVisible();

    // ── STEP 6 (NEO-490, NEO-574): the rival gets a career at the card's club, 2021-2022 ──
    // Through Player Management's career editor, as an operator would record it, on the club's row
    // already on file (an "Add <club> ..." option, never "New team"). Both Yamadas now have a career
    // on file at the club the card names; only the rival's stint starts by the card's year.
    await page.goto("/admin/players");
    await expectPlayersLoaded(page, 30_000);
    await addOrOpenRival(page);
    await expect(page.getByText("No stints recorded yet.")).toBeVisible();
    await page.getByRole("button", { name: "Add team" }).click();
    await page.getByRole("textbox", { name: "Search teams" }).fill(CARD_CLUB);
    await page.getByRole("option", { name: new RegExp(`^Add ${CARD_CLUB}`) }).click();
    await page.getByRole("heading", { name: "Career history" }).click(); // closes the typeahead
    await page.getByLabel(/Stint from year/).fill(RIVAL_FROM);
    await page.getByLabel(/Stint to year/).fill(RIVAL_TO);
    await page.getByRole("button", { name: "Add stint" }).click();
    await expect(page.getByRole("link", { name: new RegExp(`${CARD_CLUB} · ${RIVAL_FROM}.${RIVAL_TO}`) })).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(`Saved ${NAME}`)).toBeVisible();

    // ── STEP 7: fetch again: no pick step, the b. 1851 Shuya Yamada is linked as a decided row ──
    await fetchChecklistToWizard(page, env, TARGET, { checklist: CHECKLISTS.bbmRookieEditionPremium });
    // The link is a decided row the operator can Change, and it says what settled it: the club on
    // the card ("Hanshin Tigers", RP03), from 2021, by 2024. The line names no birth year (an automatic link
    // reads the same for either man), but only one man can be linked this way: the exactly-one
    // guard sends two covering stints back to the pick step, and the catalogue's starts in 2026.
    const decided = await openDecidedList(page);
    await expect(decided.getByRole("listitem").filter({ hasText: NAME })).toContainText(
      `Linked to ${NAME} · played for the Hanshin Tigers`,
    );
    // And the pick step never comes: the walk reaches a player row with the question nowhere.
    await walkToPlayerRow(page);
    await expect(wizard.getByText(`Which ${NAME} is this?`)).toBeHidden();
    await expectAccessible(page, { within: wizard, label: "Entity review wizard, career-team link decided" });
    await cancelAndDiscard(page);

    // ── STEP 8: take the stint off again, so the pick step above is true on the next run ──
    await page.goto("/admin/players");
    await expectPlayersLoaded(page, 30_000);
    await addOrOpenRival(page);
    await page.getByRole("button", { name: `Remove ${CARD_CLUB} ${RIVAL_FROM} stint`, exact: true }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(`Saved ${NAME}`)).toBeVisible();
    await expect(page.getByText("No stints recorded yet.")).toBeVisible();
  },
);
