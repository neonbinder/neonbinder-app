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
// editing. Each card's "No team on this card" is answered so the walk ends
// "All tidy", the browser's Back/Forward step through the walk's address, and
// the drawer reads the second card's stored title back.
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
// `tuphost<token>` (insert), `tupgold<token>` (its parallel) and the set's short
// names `tupa<token>` / `tups<token>`. Neither parallel name starts with the
// insert's, so the prefix rule is the only thing that can put the insert's name
// in the walk's name. R9: drillToCustom for the set stop, then drillToCustomSet
// to the Insert type; the grouping is the same Group Parallels move the
// sub-variants spec makes.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { addCardViaForm, editCardButton, escapeRe } from "../../support/cards";
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
import { tidyUpName } from "../../support/wizard";
import {
  answerPinkTeamTiles,
  expectCardsLeft,
  finishTidyWalk,
  mustFixLine,
  needsYouPill,
  openTidyWalk,
  pinkTile,
  saveAndNext,
  saveForLater,
  tidyFooterButton,
  tidyTile,
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
    const PARALLEL = `tupgold${T}`;
    const FIRST_TRY = `tupa${T}`;
    const SHORT = `tups${T}`;
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

    // ── The insert's checklist: two cards, each titled over 80 by the set name ──
    await addCardViaForm(page, { cardNumber: "901", playerName: `Tup901${T}` });
    await addCardViaForm(page, { cardNumber: "902", playerName: `Tup902${T}` });
    await expect(needsYouPill(page)).toHaveAccessibleName("2 need you");
    // The insert (not Base): its own name, no variant type word.
    await openTidyWalk(page, { title: tidyUpName({ year, set: SET, variant: HOST }) });
    await expectWalkNamed(page, tidyUpName({ year, set: SET, variant: HOST }));
    await expectCardsLeft(page, 2);
    const walk = tidyWalk(page);
    const titleTile = tidyTile(page, "Listing title");

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
    await titleTile.getByRole("button", { name: "Save and apply to all 2 cards", exact: true }).click();
    await expect(
      titleTile.getByRole("status").filter({ hasText: "Set name saved. The other cards' titles are updating." }),
    ).toBeVisible();
    await expect(setNameBox).toHaveCount(0);
    await expect(box901).toHaveCount(0);
    await expect(titleTile.getByText(titleWith(SHORT, "901"))).toBeVisible();
    await expect(titleTile.getByRole("button", { name: "Edit title", exact: true })).toBeVisible();
    await expect(pinkTile(page, "Listing title")).toHaveCount(0);
    // The card's other pink (no team) is answered, so Save & next can take it.
    await answerPinkTeamTiles(page, { noTeam: "noTeamOnCard" });
    await saveAndNext(page);

    // ── #902, retitled by the schedule: no longer pink, shown with the short name, not opened ──
    await expect(titleTile.getByText(titleWith(SHORT, "902"))).toBeVisible();
    await expect(pinkTile(page, "Listing title")).toHaveCount(0);
    await expect(titleTile.getByRole("textbox", { name: "Card title for #902", exact: true })).toHaveCount(0);
    await expect(titleTile.getByRole("button", { name: "Edit title", exact: true })).toBeVisible();
    await expect(titleTile.getByText(longSet)).toHaveCount(0);
    await answerPinkTeamTiles(page, { noTeam: "noTeamOnCard" });
    await saveAndNext(page);
    const allTidy = walk.getByText("All tidy. Nothing on this checklist needs you.", { exact: true });
    await expect(allTidy).toBeVisible();
    // The walk's place is in the address: Back steps to #902, Forward to the end again.
    await page.goBack();
    await expect(page).toHaveURL(/[?&]tidy=(?!done)/);
    await expect(titleTile.getByText(titleWith(SHORT, "902"))).toBeVisible();
    await expect(allTidy).toHaveCount(0);
    await page.goForward();
    await expect(allTidy).toBeVisible();
    await finishTidyWalk(page);

    // Nothing on the checklist needs anyone now, and #902's stored title carries the short name.
    await expect(editCardButton(page, "902")).toBeVisible();
    await expect(needsYouPill(page)).toHaveCount(0);
    await editCardButton(page, "902").click();
    const cardTitle = page.getByRole("dialog").getByRole("textbox", { name: "Card title", exact: true });
    await expect(cardTitle).toHaveValue(titleWith(SHORT, "902"));
    await expect(cardTitle).not.toHaveValue(longSet);
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(cardTitle).toBeHidden();

    // ── The parallel under the insert: the walk's name puts the insert's name first ──
    await columnOption(page, "Parallels", PARALLEL).click();
    await expect(columnSelection(page, "Parallels", PARALLEL)).toBeVisible();
    await addCardViaForm(page, { cardNumber: "903", playerName: `Tup903${T}` });
    await expect(needsYouPill(page)).toBeVisible();
    await openTidyWalk(page, { title: tidyUpName({ year, set: SET, variant: `${HOST} ${PARALLEL}` }) });
    await expectWalkNamed(page, tidyUpName({ year, set: SET, variant: `${HOST} ${PARALLEL}` }));
    await saveForLater(page);
  },
);
