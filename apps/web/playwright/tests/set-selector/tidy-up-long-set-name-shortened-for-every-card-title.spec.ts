// R1: a set name too long for any listing title is fixed once, from the Tidy
// Up walk's "Listing title" tile, for every card of the checklist (NEO-645),
// and the walk names the checklist it tidies, an insert by its own name and a
// parallel after its insert (NEO-497).
//
// The set's name is ONE unbroken 100-character token (200 is the set-name
// cap). No generated title can hold it inside eBay's 80, and the set name is
// never cut, so every card's stored title is over the limit: PINK, and the
// Listing title tile opens already in edit mode ("Over the limit, so it opens
// ready to edit.", the box invalid, Save title and Save & next held).
// "Shorten the set name for every card" opens "Set name in titles" inline; the
// title box shows THIS card's title with the new set name as it is typed (it
// moves with each name), and "Save and apply to all 2 cards" saves the name:
// the open card is retitled at once ("Set name saved. The other cards' titles
// are updating.") and the other card on a schedule, so when the walk reaches
// it, its tile is no longer pink and shows the short name without opening for
// editing. NEO-645 (Jason, 2026-11-23): a title that fits only because the set
// name was shortened, with nothing else left out, is no blue "cut short" check:
// the tile stays plain and says "Set name shortened to fit." in a purple note,
// and lists nothing as left out (#901 and #902, still in the walk for their
// pink Team tile). A third card, #904, carries a 70-character team: even on the
// short name the team cannot fit, so its title is still cut, and #904 is BLUE
// ("To check", no purple set-name note, and the team as the one purple pill of
// the "Left out to fit" list, NEO-665; on a phone the 70-character pill wraps
// inside the tile). NEO-645 C7, every walk write
// regenerates the card's title and description, a hand-typed title included. On #901 a title typed in the tile
// is rebuilt by its team answer; typed again (holding every word, so the
// NEO-637 rule outside the walk would keep it), a second "Shorten the set name"
// rebuilds it with the newer name, and #902 is retitled with that one. Each
// card's "No team on this card" is answered, so the pink cards are fixed. Blue
// is read from the live data (NEO-656 J5, B20): Save & next on #904 leaves it
// blue, so the walk ends "1 card still to check" (2 fixed, 0 skipped, 1 still
// to check, never "All tidy"), its review button names what it reviews ("Check
// the card still to check", not "Review the skipped card"), the checklist keeps
// #904's "listing title was cut short" mark and the pill reads "1 needs you".
// The browser's Back/Forward step through the walk's address, and the drawer
// reads the second card's stored title back.
//
// NEO-665, a team is named in a title only by its exact words: the parallel's
// card #903 carries a team whose one word is the parallel's name plus a plural
// "s" (a "Prismatic Red" parallel beside the "Reds"). Its title says the
// parallel's name but has no room for the team, so the walk's Listing title
// tile lists the team as left out. Before NEO-665 a plural "s" was folded, the
// parallel's name "said" the team, and the tile listed nothing.
//
// The walk's name (NEO-497): an insert other than Base reads as its own name;
// a parallel (a sub-variant under an insert) carries its insert's name first,
// because "Gold" alone does not say which insert's Gold. The heading clamps the
// long name visually, so beside the exact full name each walk proves the
// layout on both projects: the heading and the header's progress bar ("Wizard
// progress") are on screen, never overlap, and stay inside the viewport's
// width. NEO-499: at 100 characters the Set Builder's own "Attributes for <set>
// (Set)" heading used to run off a phone's right edge; the drill stops at the
// set once to prove it now wraps inside the viewport, clear of the panel's
// toggle (NEO-496: the set's panel opens by itself, so it reads "Hide
// attributes").
//
// R7/R7a: every write lands in ONE per-attempt hand-made set, `tuplongset...`,
// under `E2E Test Sport <worker>` > 2026 > Topps (drillToCustomSet;
// SET-REGISTRY.md). Hand-made, so no marketplace side is resolvable beneath it
// and every wait is the 7 s budget. Minted names are single tokens from
// env.ATTEMPT_TOKEN: `tuplongset` + `x` padding + the token (set),
// `tuphost<token>` (insert), `tupred<token>` padded with `x` to 36 characters
// (its parallel) and the set's short names `tupa<token>` / `tups<token>` /
// `tupb<token>`; the hand-typed titles carry `tuptyped<token>`; #904's team,
// made in the card form's New team dialog, is `Tuptm<token>` padded with `x` to
// 70 characters (one token, no Location, so it can only go whole); #903's team
// is the parallel's name plus "s" (one token, so the plural rides on a whole
// one-word team, not a nickname: a two-word team would break the single-token
// rule).
//
// Fixture arithmetic (assessListingTitle, ATTEMPT_TOKEN 1 and 12 characters,
// workers 0-11): on the short names #901/#902 read "<short> Tup<n><token>
// #<n> <sport>", 35-58 characters, built from the set-name box with nothing
// left out (the purple case); #904 with its team is 105-128, and without the
// team (the only cut) 35-58 (the blue case). #903 under the parallel reads
// "<short> <parallel> Tup903<token> #903" (the box takes the parallel's name
// after it), 65-77, the sport and the 37-character team cut. Neither parallel name starts with the
// insert's, so the prefix rule is the only thing that can put the insert's name
// in the walk's name. R9: drillToCustom for the set stop, then drillToCustomSet
// to the Insert type; the grouping is the same Group Parallels move the
// sub-variants spec makes.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { addCardViaForm, cardAttentionMark, createTeamInCardForm, editCardButton, escapeRe } from "../../support/cards";
import type { Locator, Page } from "@playwright/test";
import {
  addCustomEntry,
  columnOption,
  columnSelection,
  customSport,
  drillToCustom,
  drillToCustomSet,
  setBuilderReady,
} from "../../support/set-builder";
import {
  answerPinkTeamTiles,
  expectCardsLeft,
  expectTidyEndScreen,
  finishTidyWalk,
  mustFixLine,
  needsYouPill,
  openTidyWalk,
  pinkTile,
  saveAndNext,
  saveForLater,
  TIDY_ALL_CLEAR,
  tidyFooterButton,
  tidyTile,
  tidyUpName,
  tidyWalk,
  tidyWalkProgress,
} from "../../support/tidy-walk";

/**
 * Two controls on screen, clear of each other, and both inside the viewport's
 * width: the layout proof for a long unbroken name on both projects.
 */
async function expectClearAndInside(page: Page, a: Locator, b: Locator, what: string): Promise<void> {
  const boxA = await a.boundingBox();
  const boxB = await b.boundingBox();
  const viewport = page.viewportSize();
  if (!boxA || !boxB || !viewport) throw new Error(`${what}: both boxes and the viewport must be measurable`);
  const clear =
    boxA.x + boxA.width <= boxB.x ||
    boxB.x + boxB.width <= boxA.x ||
    boxA.y + boxA.height <= boxB.y ||
    boxB.y + boxB.height <= boxA.y;
  expect(clear, `${what}: the two overlap`).toBe(true);
  for (const box of [boxA, boxB]) {
    expect(box.x, `${what}: starts left of the viewport`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${what}: runs past the viewport's right edge`).toBeLessThanOrEqual(viewport.width);
  }
}

/** Every one of `items` (a pill) sits inside `container`'s box: wrapped, never running past it. */
async function expectInside(page: Page, items: Locator, container: Locator, what: string): Promise<void> {
  const outer = await container.boundingBox();
  const viewport = page.viewportSize();
  if (!outer || !viewport) throw new Error(`${what}: the container and the viewport must be measurable`);
  const count = await items.count();
  expect(count, `${what}: at least one to measure`).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const box = await items.nth(i).boundingBox();
    if (!box) throw new Error(`${what}: item ${i} must be measurable`);
    expect(box.x, `${what}: starts left of its tile`).toBeGreaterThanOrEqual(outer.x);
    expect(box.x + box.width, `${what}: runs past its tile's right edge`).toBeLessThanOrEqual(outer.x + outer.width);
    expect(box.x + box.width, `${what}: runs past the viewport's right edge`).toBeLessThanOrEqual(viewport.width);
  }
}

/** The open walk's heading and progress bar, by its whole name, laid out clear of each other inside the viewport. */
async function expectWalkNamed(page: Page, name: string): Promise<void> {
  const walk = tidyWalk(page);
  await expect(walk).toHaveAccessibleName(name);
  const heading = walk.getByRole("heading", { name, exact: true });
  await expect(heading).toBeVisible();
  await expect(tidyWalkProgress(page)).toBeVisible();
  await expectClearAndInside(page, heading, tidyWalkProgress(page), "the walk's heading and the Wizard progress bar");
}

test(
  "A set name too long for any listing title is shortened for every card from the Tidy Up walk's Listing title tile, and the walk names the insert and its parallel (NEO-645, NEO-497)",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const SET = `tuplongset${"x".repeat(100 - "tuplongset".length - T.length)}${T}`;
    const HOST = `tuphost${T}`;
    // NEO-665: one token; #903's team is this plus a plural "s".
    const PARALLEL = `tupred${T}`.padEnd(36, "x");
    const RED_TEAM = `${PARALLEL}s`;
    const FIRST_TRY = `tupa${T}`;
    const SHORT = `tups${T}`;
    const SHORT2 = `tupb${T}`;
    const TYPED = `tuptyped${T}`;
    const TEAM = `Tuptm${T}`.padEnd(70, "x");
    expect(TEAM, "#904's team is 70 characters on every runner").toHaveLength(70);
    const year = "2026";
    /** A title naming `name` before card `#n`'s number (the set name leads, the number follows). */
    const titleWith = (name: string, n: string) => new RegExp(`\\b${escapeRe(name)}\\b.*#${n}\\b`);
    const longSet = new RegExp(escapeRe(SET));

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // NEO-499: the set open on its own, its attributes heading wrapped inside the viewport and
    // clear of the panel's toggle.
    await drillToCustom(page, { sport: customSport(env), year, manufacturer: "Topps", set: SET });
    const setHeading = page.getByRole("heading", { name: `Attributes for ${SET} (Set)`, exact: true });
    const attributesToggle = page.getByRole("button", { name: "Hide attributes", exact: true });
    await expect(setHeading).toBeVisible();
    await expect(attributesToggle).toBeVisible();
    await expect(attributesToggle).toHaveAttribute("aria-expanded", "true");
    await expectClearAndInside(page, setHeading, attributesToggle, "the set's Attributes heading and Hide attributes");

    // An insert, and a parallel moved under it with Group Parallels.
    await drillToCustomSet(page, env, { set: SET, variantType: "Insert" });
    await addCustomEntry(page, "Inserts", HOST, { confirm: "required" });
    await addCustomEntry(page, "Inserts", PARALLEL, { confirm: "required" });
    await columnOption(page, "Inserts", HOST).click();
    await expect(columnSelection(page, "Inserts", HOST)).toBeVisible();
    const grouping = page.getByRole("dialog", { name: "Group Parallels" });
    await page.getByRole("button", { name: "Group Parallels" }).click();
    await expect(grouping.getByText(/Drag inserts under a parent/)).toBeVisible();
    await grouping.getByRole("checkbox", { name: `Select ${PARALLEL}` }).click();
    await grouping.getByText(`Parallels of "${HOST}"`).click();
    await expect(grouping.getByText("1 promotion, 0 demotions")).toBeVisible();
    await grouping.getByRole("button", { name: "Save 1 change" }).click();
    await expect(grouping).toBeHidden();
    await expect(columnOption(page, "Parallels", PARALLEL)).toBeVisible();

    // ── The insert's checklist: three cards, each titled over 80 by the set name ──
    await addCardViaForm(page, { cardNumber: "901", playerName: `Tup901${T}` });
    await addCardViaForm(page, { cardNumber: "902", playerName: `Tup902${T}` });
    await addCardViaForm(page, {
      cardNumber: "904",
      playerName: `Tup904${T}`,
      beforeSubmit: () => createTeamInCardForm(page, TEAM),
    });
    await expect(needsYouPill(page)).toHaveAccessibleName("3 need you, 3 to fix");
    // The insert (not Base): its own name, no variant type word.
    await openTidyWalk(page, { title: tidyUpName({ year, set: SET, variant: HOST }) });
    await expectWalkNamed(page, tidyUpName({ year, set: SET, variant: HOST }));
    await expectCardsLeft(page, 3);
    const walk = tidyWalk(page);
    const titleTile = tidyTile(page, "Listing title");
    // The purple note of a title that fits only on the shortened set name, and
    // (NEO-665) the purple pills of what a title left out: a title that fits that
    // way leaves nothing out, so it has no "Left out to fit" list.
    const shortenedNote = titleTile.getByRole("note").filter({ hasText: /^Set name shortened to fit\.$/ });
    const leftOutList = titleTile.getByRole("list", { name: "Left out to fit", exact: true });
    const leftOutPills = leftOutList.getByRole("listitem");
    /** A pill's text is the item, plus the sr-only ", " that follows every pill but the last (kept raw by a regex: "Twins, "). */
    const pill = (item: string) => new RegExp(`^${escapeRe(item)}(,\\s*)?$`);
    /** The open card's title fits on the short name alone: plain tile, the purple note, nothing left out. */
    const expectFitsOnShortName = async () => {
      await expect(shortenedNote).toBeVisible();
      await expect(titleTile).not.toHaveAccessibleDescription(/To (check|fix)/);
      await expect(leftOutList).toHaveCount(0);
    };
    /** A title typed by hand in the open card's tile and saved: it fits and holds every word. */
    const typeOwnTitle = async (n: string, setName: string): Promise<string> => {
      const own = `${setName} Tup${n}${T} #${n} ${TYPED}`;
      await titleTile.getByRole("button", { name: "Edit title", exact: true }).click();
      const box = titleTile.getByRole("textbox", { name: `Card title for #${n}`, exact: true });
      await box.fill(own);
      await titleTile.getByRole("button", { name: "Save title", exact: true }).click();
      await expect(box).toHaveCount(0);
      await expect(titleTile.getByText(own, { exact: true })).toBeVisible();
      return own;
    };

    // ── #901: pink, and opened ready to edit ──
    const box901 = titleTile.getByRole("textbox", { name: "Card title for #901", exact: true });
    const overLine = titleTile.getByText("Over the limit, so it opens ready to edit.", { exact: true });
    await expect(titleTile).toHaveAccessibleDescription("To fix");
    await expect(box901).toBeVisible();
    await expect(box901).toHaveValue(longSet);
    await expect(box901).toHaveAttribute("aria-invalid", "true");
    await expect(overLine).toBeVisible();
    const stored = await box901.inputValue();
    expect(stored.length, "the stored title is over the 80 cap").toBeGreaterThan(80);
    await expect(titleTile.getByText(`${stored.length}/80`, { exact: true })).toBeVisible();
    await expect(titleTile.getByRole("button", { name: "Save title", exact: true })).toBeDisabled();
    // Pink holds the card.
    await expect(tidyFooterButton(page, "saveAndNext")).toBeDisabled();
    await expect(mustFixLine(page)).toBeVisible();
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, an over-80 title opened for editing" });

    // ── "Shorten the set name for every card": the box shows this card's title with each name typed ──
    const shorten = titleTile.getByRole("button", { name: "Shorten the set name for every card", exact: true });
    await shorten.click();
    await expect(shorten).toHaveAttribute("aria-expanded", "true");
    const setNameBox = titleTile.getByRole("textbox", { name: "Set name in titles", exact: true });
    await expect(setNameBox).toBeFocused();
    await expect(titleTile.getByText(`Was “${SET}”`, { exact: true })).toBeVisible();
    await setNameBox.fill(FIRST_TRY);
    await expect(box901).toHaveValue(titleWith(FIRST_TRY, "901"));
    await expect(box901).not.toHaveValue(longSet);
    // A name that fits lets the title fit: the box is no longer invalid and the meter follows it.
    await expect(box901).not.toHaveAttribute("aria-invalid", "true");
    await expect(overLine).toHaveCount(0);
    const firstPreview = await box901.inputValue();
    expect(firstPreview.length, "the preview fits the 80 cap").toBeLessThanOrEqual(80);
    await expect(titleTile.getByText(`${firstPreview.length}/80`, { exact: true })).toBeVisible();
    // ...and moves again with the next name.
    await setNameBox.fill(SHORT);
    await expect(box901).toHaveValue(titleWith(SHORT, "901"));
    await expect(box901).not.toHaveValue(new RegExp(escapeRe(FIRST_TRY)));
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, the set name being shortened" });

    // ── "Save and apply to all 2 cards": this card at once, the other on a schedule ──
    await titleTile.getByRole("button", { name: "Save and apply to all 3 cards", exact: true }).click();
    await expect(
      titleTile.getByRole("status").filter({ hasText: "Set name saved. The other cards' titles are updating." }),
    ).toBeVisible();
    await expect(setNameBox).toHaveCount(0);
    await expect(box901).toHaveCount(0);
    await expect(titleTile.getByText(titleWith(SHORT, "901"))).toBeVisible();
    await expect(titleTile.getByRole("button", { name: "Edit title", exact: true })).toBeVisible();
    await expect(pinkTile(page, "Listing title")).toHaveCount(0);
    // It fits only because the set name was shortened: the purple note, not the blue check.
    await expectFitsOnShortName();
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, a title that fits on the shortened set name" });
    // C7: a title typed by hand, then the card's other pink (no team) answered so
    // Save & next can take it. The answer regenerates the title over the typed
    // one, and it still opens with the short name.
    // A typed title is not the generated one, so the note goes with it.
    await typeOwnTitle("901", SHORT);
    await expect(shortenedNote).toHaveCount(0);
    await answerPinkTeamTiles(page, { noTeam: "noTeamOnCard" });
    await expect(titleTile.getByText(titleWith(SHORT, "901"))).toBeVisible();
    await expect(titleTile.getByText(TYPED)).toHaveCount(0);
    await expect(titleTile.getByText(longSet)).toHaveCount(0);
    await expectFitsOnShortName();
    // C7: typed again, holding every word, then the set name shortened again from
    // the walk: the save rebuilds this card's title, the typed words gone.
    await typeOwnTitle("901", SHORT);
    await shorten.click();
    await expect(setNameBox).toBeFocused();
    await setNameBox.fill(SHORT2);
    await titleTile.getByRole("button", { name: "Save and apply to all 3 cards", exact: true }).click();
    await expect(
      titleTile.getByRole("status").filter({ hasText: "Set name saved. The other cards' titles are updating." }),
    ).toBeVisible();
    await expect(titleTile.getByText(titleWith(SHORT2, "901"))).toBeVisible();
    await expect(titleTile.getByText(TYPED)).toHaveCount(0);
    await expectFitsOnShortName();
    await saveAndNext(page);

    // ── #902, retitled by the schedule: no longer pink, shown with the newer short name, not opened ──
    await expect(titleTile.getByText(titleWith(SHORT2, "902"))).toBeVisible();
    await expect(pinkTile(page, "Listing title")).toHaveCount(0);
    await expect(titleTile.getByRole("textbox", { name: "Card title for #902", exact: true })).toHaveCount(0);
    await expect(titleTile.getByRole("button", { name: "Edit title", exact: true })).toBeVisible();
    await expect(titleTile.getByText(longSet)).toHaveCount(0);
    await expectFitsOnShortName();
    await answerPinkTeamTiles(page, { noTeam: "noTeamOnCard" });
    await saveAndNext(page);

    // ── #904, retitled by the schedule: its team still does not fit, so it stays BLUE ──
    await expect(titleTile.getByText(titleWith(SHORT2, "904"))).toBeVisible();
    await expect(titleTile).toHaveAccessibleDescription("To check");
    // NEO-665: the team is the list's one pill.
    await expect(leftOutPills).toHaveText([pill(TEAM)]);
    // The 70-character pill wraps inside the tile, never past it (a phone is narrower than the
    // one unbroken line it would take).
    await expectInside(page, leftOutPills, titleTile, "#904's team pill");
    await expect(shortenedNote).toHaveCount(0);
    await expect(pinkTile(page, "Listing title")).toHaveCount(0);
    await expect(titleTile.getByText(longSet)).toHaveCount(0);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, a short-name title that still leaves the team out (its pill)" });
    // Blue never holds the card, and Save & next does not clear it (B20): its title is still cut,
    // so the walk ends with #904 "still to check", #901 and #902 fixed, nothing skipped.
    await saveAndNext(page);
    await expectTidyEndScreen(page, { fixed: 2, stillToCheck: 1 });
    await expect(walk.getByText(TIDY_ALL_CLEAR, { exact: true })).toHaveCount(0);
    // The review button names the blue card it goes back to, never a skipped one.
    const checkBlue = walk.getByRole("button", { name: "Check the card still to check", exact: true });
    await expect(checkBlue).toBeVisible();
    await expect(walk.getByRole("button", { name: /^Review the / })).toHaveCount(0);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk end screen with a card still to check" });
    // The walk's place is in the address: Back steps to #904, Forward to the end again.
    await page.goBack();
    await expect(page).toHaveURL(/[?&]tidy=(?!done)/);
    await expect(titleTile.getByText(titleWith(SHORT2, "904"))).toBeVisible();
    await expect(checkBlue).toHaveCount(0);
    await page.goForward();
    await expectTidyEndScreen(page, { fixed: 2, stillToCheck: 1 });
    await finishTidyWalk(page);

    // Only #904 needs anyone now (blue: its team is left out of the title), #901 and #902 carry
    // no mark, and #902's stored title carries the newer short name.
    await expect(editCardButton(page, "902")).toBeVisible();
    await expect(cardAttentionMark(page, "904", "listing title was cut short")).toBeVisible();
    await expect(cardAttentionMark(page, "904")).toHaveAccessibleName(/is worth a check: /);
    await expect(editCardButton(page, "901")).toBeVisible();
    await expect(cardAttentionMark(page, "901")).toHaveCount(0);
    await expect(cardAttentionMark(page, "902")).toHaveCount(0);
    await expect(needsYouPill(page)).toHaveAccessibleName("1 needs you");
    await editCardButton(page, "902").click();
    const drawerTitle = page.getByRole("dialog").getByRole("textbox", { name: "Card title", exact: true });
    await expect(drawerTitle).toHaveValue(titleWith(SHORT2, "902"));
    await expect(drawerTitle).not.toHaveValue(longSet);
    await expect(drawerTitle).not.toHaveValue(new RegExp(escapeRe(TYPED)));
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(drawerTitle).toBeHidden();

    // ── The parallel under the insert: the walk's name puts the insert's name first ──
    await columnOption(page, "Parallels", PARALLEL).click();
    await expect(columnSelection(page, "Parallels", PARALLEL)).toBeVisible();
    await addCardViaForm(page, {
      cardNumber: "903",
      playerName: `Tup903${T}`,
      beforeSubmit: () => createTeamInCardForm(page, RED_TEAM),
    });
    await expect(needsYouPill(page)).toBeVisible();
    await openTidyWalk(page, { title: tidyUpName({ year, set: SET, variant: `${HOST} ${PARALLEL}` }) });
    await expectWalkNamed(page, tidyUpName({ year, set: SET, variant: `${HOST} ${PARALLEL}` }));
    // NEO-665: #903's title says the parallel's name ("...red") but has no room for its team
    // ("...reds"). A team is named only by its exact words, so the team is the tile's one pill.
    // The shown title (the pill reads the team, so the title's own text is matched whole).
    const title903 = new RegExp(`^${escapeRe(SHORT2)} ${escapeRe(PARALLEL)} (?!.*${escapeRe(RED_TEAM)}).*#903\\b`);
    await expect(titleTile.getByText(title903)).toBeVisible();
    await expect(titleTile).toHaveAccessibleDescription("To check");
    await expect(leftOutPills).toHaveText([pill(RED_TEAM)]);
    await expectInside(page, leftOutPills, titleTile, "#903's team pill");
    await saveForLater(page);
  },
);
