// NEO-464 — the signed-in dashboard draws the collector's own shelf, and only
// the sections the collector's data fills. Replaces view-collection.spec.ts,
// which proved the "COMING SOON" page this replaced.
//
// R1: the shelf stands, and a section with nothing behind it stays away: no
// run to finish in the Hopper while nothing is in intake (only the stat of
// runs sorted, NEO-539), and no Out the Door: the worker's
// account has a saved marketplace sign-in (the bootstrap's) but no order (the
// spec clears any test order other specs left), and
// only a stored order puts the sales section up (Jason, 2026-11-10). New on
// NeonBinder, the catalog's news, shows for everyone, and its tiles open real
// checklists. It lists only the six newest uploads (`NEW_SETS_SHOWN`), so the spec
// makes its own: a hand-made set with a Base and one card, uploaded a few seconds
// before the dashboard is read, is always on the list. (The seed's 2024 Topps Chrome
// is not: every other spec's hand-made set is newer than the seed's load.)
//
// NEO-532: the list walks the newest cards and a set must not drop out of it because
// another set's cards landed between its own. The spec builds two sets and interleaves
// the writes: A gets card 1, B gets card 1, then A gets card 2 (A's late card lands
// AFTER B's upload began). The old walk jumped past A's whole upload window at B's
// card and hid whichever set it passed over; both sets must be tiles, A counting
// both of its cards and B its one.
//
// R7: the hopper's state is this account's own and other specs leave scans in
// it (real-hopper-run-link seeds one), so this spec asks for the state it needs:
// it seeds a run with one open scan (`hopperScan`), then the seed hop's
// `clearHopper` sets the account's open scans aside. Every scan of that run is
// out of intake, so it counts as SORTED today: the hopper shows its stat line
// and no run to finish. (Setting scans aside leaves the run's last activity
// alone, so the seeded run, made just now, is "this week" whatever else the
// account holds.) The seeded batch still reads "running" and holds a cap slot, so
// `afterEach` discards it through /print/placeholders.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { addCardViaForm } from "../../support/cards";
import { customSport, drillToCustom, escapeRe, selectOrCreate, setBuilderReady } from "../../support/set-builder";
import { discardIfStillOpen } from "../../support/placeholder-intake";

test.afterEach(async ({ page }, testInfo) => {
  await discardIfStillOpen(page, testInfo, { all: true });
});

test("Dashboard shows the collector's own binder shelf", { tag: ["@smoke", "@dashboard"] }, async ({ page, signIn, env }) => {
  // R7: two hand-made sets of this worker's own, in its own sport, per attempt (SET-REGISTRY
  // `shelf-`, `shelfb-`). Nothing is deleted. Neither name is a prefix of the other.
  const setA = `shelf-${env.WORKER_KEY}-${env.ATTEMPT_ID}`;
  const setB = `shelfb-${env.WORKER_KEY}-${env.ATTEMPT_ID}`;
  const titleA = `2026 Topps ${setA}`;
  const titleB = `2026 Topps ${setB}`;
  const sport = customSport(env);

  // R7: no stored order, asked for, not assumed: other specs on this worker leave
  // test orders behind (inventory-pick-list ships its orders and leaves them to the
  // bootstrap's reset). The clear removes only the caller's marked test orders and
  // forwards to the dashboard. The clears and the hopper seed come BEFORE the sets are
  // built, so the last write before the dashboard is read is a card, not a hop.
  await signIn("/testing/seed-dashboard?clear=1");
  await expect(page.getByRole("heading", { level: 1, name: "Welcome back, slugger." })).toBeVisible({ timeout: LAUNCH_GATE });
  // The hopper seed (one run with one open scan) and its clear are the same kind of hop, from
  // the signed-in page; the clear lands on the set builder.
  await page.goto("/testing/seed-placeholder-run?hopperScan=1");
  await expect(page).toHaveURL(/\/collection\?tab=add&run=\w+/, { timeout: LAUNCH_GATE });
  await page.goto("/testing/seed-placeholder-run?clearHopper=1&redirect=%2Fset-selector");
  await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

  // One set's Base with one more card: drill to it (making each hand-made row the first time,
  // opening it the next), open Base, add the card.
  async function addBaseCard(setName: string, cardNumber: string, playerName: string): Promise<void> {
    await drillToCustom(page, { sport, year: "2026", manufacturer: "Topps", set: setName });
    await selectOrCreate(page, "Variant Types", "Base", { via: "list" });
    await expect(page.getByRole("button", { name: "Open add card form" })).toBeVisible();
    await addCardViaForm(page, { cardNumber, playerName });
  }

  // The interleave: A's first card, then B's, then A's second AFTER B's. Each is the newest
  // card in the catalog at the moment it lands.
  await addBaseCard(setA, "1", `Shelf${env.ATTEMPT_TOKEN}`);
  await addBaseCard(setB, "1", `ShelfB${env.ATTEMPT_TOKEN}`);
  await addBaseCard(setA, "2", `ShelfLate${env.ATTEMPT_TOKEN}`);

  await page.goto("/dashboard");

  // Gate on the dashboard's own greeting (its one h1), not the shared header.
  await expect(page.getByRole("heading", { level: 1, name: "Welcome back, slugger." })).toBeVisible({ timeout: LAUNCH_GATE });
  await expect(page.getByRole("heading", { name: "Your binders" })).toBeVisible();

  // Main is every collector's binder, so it always stands on the shelf. Its
  // spine is named for it: "Main, <n> cards, nothing new".
  const shelf = page.getByRole("list", { name: "Binders on the shelf" });
  const main = shelf.getByRole("button", { name: /^Main, \d+ cards?, / });
  await expect(main).toBeVisible();

  // Sections only when there is data. Out the Door shows only for an account
  // with an order stored; this one has none, whatever logins it saved, so there is
  // no Pick List link either. Nothing is in intake, so the hopper holds no run to
  // finish: just the stat of the run sorted this week (the seeded one), no lead
  // line of scans waiting and no "Finish this run" link.
  await expect(page.getByRole("heading", { level: 2, name: "Out the Door", exact: true })).toHaveCount(0);
  await expect(page.getByText("All shipped. Nice.")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Pull them on the Pick List", exact: true })).toHaveCount(0);
  const hopper = page.getByRole("region", { name: "In the Hopper" });
  await expect(hopper.getByRole("heading", { level: 2, name: "In the Hopper", exact: true })).toBeVisible();
  await expect(hopper.getByText(/^\d+ runs? sorted this week$/)).toBeVisible();
  await expect(hopper.getByText(/all-time/)).toHaveCount(0);
  await expect(hopper.getByRole("list", { name: "Runs to finish", exact: true })).toHaveCount(0);
  await expect(hopper.getByRole("link", { name: /^Finish this run/ })).toHaveCount(0);
  await expect(hopper.getByText(/ to identify| needs? your yes/)).toHaveCount(0);

  // With no binder open, the first one on the shelf stands shut beside it, one button to open it.
  await expect(page.getByRole("button", { name: /^Crack open / })).toBeVisible();

  // New on NeonBinder shows every collector the latest checklist uploads, grouped by set; the
  // two sets this spec just filled are the newest. Each tile opens a checklist a collector can read: the
  // set's Base for a whole set, else the variant itself (Jason, round 2).
  const news = page.getByRole("region", { name: "New on NeonBinder" });
  await expect(news).toBeVisible();
  // The whole-set tile reads "<set> <sport>, <n> cards" with no variant in its name (a lone
  // variant's tile would read "<set> <variant> <sport>, ..."), so it is the tile that must open
  // the set's Base. NEO-532: A reads BOTH its cards although B's card landed between them, and
  // B is listed beside it with its one.
  const tile = news.getByRole("link", { name: new RegExp(`^${escapeRe(titleA)} ${escapeRe(sport)}, 2 cards$`) });
  await expect(tile).toBeVisible();
  await expect(tile).toHaveAttribute("href", /^\/collection\?tab=checklists&set=[^&]+&type=[^&]+$/);
  await expect(news.getByRole("link", { name: new RegExp(`^${escapeRe(titleB)} ${escapeRe(sport)}, 1 card$`) })).toBeVisible();

  await expectAccessible(page, { label: "Dashboard" });

  // A real move: the set's Base checklist opens (the Variant Types step reads Base, and the
  // checklist is "2026 <set> Base", not an insert or parallel), and Back returns to the dashboard.
  await tile.click();
  await expect(page).toHaveURL(/\/collection\?tab=checklists&set=[^&]+&type=[^&]+$/);
  const base = page.getByRole("region", { name: `2026 ${setA} Base`, exact: true });
  await expect(base.getByRole("heading", { level: 3, name: `2026 ${setA} Base`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Variant Types: Base, change", exact: true })).toBeVisible();
  await expect(base.getByRole("button", { name: /^Details for #/ }).first()).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Welcome back, slugger." })).toBeVisible();
});
