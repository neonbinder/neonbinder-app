// Origin: .maestro/flows/set-selector/checklist-title-length-limits-and-fixer.yaml (Maestro suite retired in NEO-341; see git history)
//
// R1: listing length limits. The card drawer refuses a title over 80 and warns
// on a variation over 65; the card then waits in the Tidy Up walk (NEO-645),
// where its "Listing title" tile shows the 80 meter, keeps a regenerated title
// that cannot fit in an editor that refuses it, and trims the variation.
//
// Fixture: a per-worker hand-made set (R7a, `tlf-` in SET-REGISTRY.md) with
// one card. Desktop and mobile: one spec; the only branch is the phone's
// wrapping check (NEO-535), keyed on `isMobile`.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { setBuilderReady, drillToCustom } from "../../support/set-builder";
import { tidyUpName } from "../../support/wizard";
import { expectNoOverCapLook, expectOverCapLook } from "../../support/theme";
import {
  expectCardsLeft,
  finishTidyWalk,
  mustFixLine,
  needsYouPill,
  openTidyWalk,
  saveAndNext,
  tidyFooterButton,
  tidyTile,
  tidyWalk,
} from "../../support/tidy-walk";

test(
  "Listing length limits — an over-long card title is refused, and the Tidy Up walk's Listing title tile meters, regenerates and trims it",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env, isMobile }) => {
    const id = env.ATTEMPT_ID;
    // Short single-token names (R7a, `tlf` in SET-REGISTRY.md): the whole generated title,
    // sport included, fits 80 on every worker (11 runs the longest ATTEMPT_TOKEN), so
    // nothing but the variation below is ever left out. The set is per attempt, so
    // its one card can carry a plain number.
    const num = "101";
    const team = `TLF${env.ATTEMPT_TOKEN}`;
    // `tlfset`, never `tlf` + the token: a set name equal to the team's (TLF + the token,
    // case-folded) is a repeat the generator leaves out of the title.
    const set = `tlfset${env.ATTEMPT_TOKEN}`;
    const edit = page.getByRole("button", { name: new RegExp(`^Edit card ${num}(, .*)?$`) });
    const cardName = page.getByRole("textbox", { name: "Card name" });
    const cardTitle = page.getByRole("textbox", { name: "Card title", exact: true });
    // NEO-645: an over-long variation is BLUE (worth a check), never pink: the row's mark says so.
    const attentionBadge = page.getByRole("img", {
      name: new RegExp(`^Card ${num}(, .*)? is worth a check: (.*; )?variation text is over the 65-character limit(; .*)?$`),
    });
    const drawer = page.getByRole("dialog", { name: /^Card #/ });
    const generated = new RegExp(`^2024 Topps .*#${num} ${team} Baseball$`);
    const variationText = "Gold Refractor Image Variation Wearing Sunglasses Holding Bat In Dugout";

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // A hand-made Base insert under the real Baseball / 2024 / Topps.
    await drillToCustom(page, {
      sport: "Baseball",
      year: "2024",
      manufacturer: "Topps",
      set,
      variantType: "Insert",
      variant: "Base",
    });

    // ── A card with a brand-new team, so the generated title has a team in it ──
    await page.getByRole("button", { name: "Open add card form" }).click();
    await page.getByRole("textbox", { name: "Card number" }).fill(num);
    await cardName.fill(`TitleCap${env.ATTEMPT_TOKEN}`);
    await page.getByRole("button", { name: "Add team" }).click();
    const teamSearch = page.getByRole("textbox", { name: "Search teams" });
    await teamSearch.fill(team);
    await teamSearch.press("Enter");
    const newTeam = page.getByRole("dialog", { name: `New team: ${team}` });
    await expect(newTeam).toBeVisible();
    await expect(newTeam.getByRole("textbox", { name: "New team name" })).toHaveValue(team);
    await expectAccessible(page, { within: newTeam, label: "New team dialog" });
    await newTeam.getByRole("button", { name: `Create team ${team}` }).click();
    await expect(page.getByRole("button", { name: `Remove team ${team}` })).toBeVisible();
    // Focusing another field closes the team search.
    await cardName.click();
    await expect(page.getByRole("textbox", { name: "Search teams" })).toBeHidden();
    await page.getByRole("button", { name: "Submit new card" }).click();

    await edit.click();
    await expect(cardName).toBeVisible();

    // ── An over-long listing title is refused ──
    // NEO-606: the whole box says so, not only the note under it: the field is
    // invalid to a screen reader and wears the error pink, and the note is the
    // same pink. Trimmed to fit, all of it lets go.
    const overTitle = "NEO101PAD-EXTREMELY-LONG-LISTING-TITLE-SUFFIX-THAT-BLOWS-PAST-THE-EIGHTY-CHARACTER-CAP";
    // The length note ("Title is N characters — M over the 80-character limit"),
    // not the refused save's own alert, which keeps the danger ink.
    const overNote = drawer.getByRole("alert").filter({ hasText: /^Title is \d+ characters/ });
    await expect(cardTitle).toBeVisible();
    await cardTitle.fill(overTitle);
    await expect(page.getByText(/over the 80-character limit/)).toBeVisible();
    const shorten = page.getByText(/Shorten it before saving/);
    await expect(shorten).toBeVisible();
    await expect(cardTitle).toHaveAttribute("aria-invalid", "true");
    await expectOverCapLook(cardTitle, overNote);
    await expectAccessible(page, { within: drawer, label: "Card detail drawer, over-long title refused" });
    // Trimmed to 80, it fits: no longer invalid, no pink, no note.
    await cardTitle.fill(overTitle.slice(0, 80));
    await expect(drawer.getByText("80/80", { exact: true })).toBeVisible();
    await expect(cardTitle).not.toHaveAttribute("aria-invalid", "true");
    await expect(overNote).toHaveCount(0);
    await expectNoOverCapLook(cardTitle);
    // Back over the cap, for the refusal below.
    await cardTitle.fill(overTitle);
    await expect(cardTitle).toHaveAttribute("aria-invalid", "true");

    await cardTitle.press("Enter");
    await expect(page.getByText(/Saved Card title/)).toBeHidden();
    await expect(cardName).toBeVisible();
    await expect(cardTitle).toHaveValue(/NEO101PAD/);
    await expect(shorten).toBeVisible();

    // Regenerating asks twice before it replaces typed text, then rebuilds it.
    const regenerate = page.getByRole("button", { name: "Regenerate card title" });
    await regenerate.click();
    await expect(page.getByText(/Regenerate again to replace the title you have typed/)).toBeVisible();
    await regenerate.click();
    await expect(cardTitle).not.toHaveValue(/NEO101PAD/);
    await expect(cardTitle).toHaveValue(generated);
    await expect(shorten).toBeHidden();

    // ── NEO-535: the title is ONE line in a wrapping field ──
    // A line break typed or pasted reads as a space, Enter still saves (it is
    // not a new line here), and the field wraps: on a phone an 80-character
    // title takes two lines or more, so none of it is cut off. (On a desktop
    // drawer 80 characters fit on one line, so its height proves nothing there.)
    const eighty = "Wrap check title ".repeat(5).slice(0, 80);
    expect(eighty).toHaveLength(80);
    await cardTitle.fill(eighty.replace(" Wrap", "\nWrap"));
    await expect(cardTitle).toHaveValue(eighty);
    if (isMobile) {
      const titleBox = await cardTitle.boundingBox();
      const nameBox = await cardName.boundingBox();
      if (!titleBox || !nameBox) throw new Error("the title and the card name fields must be measurable");
      expect(titleBox.height, "the title field wraps: taller than the one-line Card name input").toBeGreaterThan(
        nameBox.height * 1.3,
      );
    }
    await cardTitle.press("Enter");
    await expect(page.getByText(/Saved Card title/)).toBeVisible();
    await expect(cardTitle).toHaveValue(eighty);

    // ── NEO-535: Regenerate rebuilds the Description too, when it reads as the
    // builder's own ──
    // The facts already moved the builder's text along with every edit, so a
    // STALE builder text is made by hand here: the card's own description with
    // one fact line it does not have (a Rookie line). It still reads as the
    // builder's, so Regenerate rebuilds it (and says so); a description an
    // operator wrote in their own words is left alone.
    const description = drawer.getByRole("textbox", { name: "Card description", exact: true });
    const builtDescription = await description.inputValue();
    expect(builtDescription).toContain(`#${num}`);
    await description.fill(`${builtDescription}\nRookie Card (RC).`);
    await cardName.click(); // leaving the field saves it
    await expect(page.getByText(/Saved Card description/)).toBeVisible();
    await regenerate.click();
    await expect(cardTitle).toHaveValue(generated);
    await expect(description).toHaveValue(builtDescription);
    await expect(page.getByText(/Description rebuilt/).first()).toBeVisible();
    await expectAccessible(page, { within: drawer, label: "Card detail drawer, description rebuilt" });

    const handWritten = `Typed by hand for ${id}: not the builder's words.`;
    await description.fill(handWritten);
    await cardName.click();
    await expect(page.getByText(/Saved Card description/)).toBeVisible();
    await regenerate.click();
    // The next write the drawer makes (below) is queued behind Regenerate's
    // own, so once "Saved Variation" shows, a rebuild would have landed.
    const variation = page.getByRole("textbox", { name: "Card variation", exact: true });

    // ── An over-long variation is saved, but flagged ──
    // NEO-606: past 65 the box wears the error pink with its note; it is advice,
    // not a refusal, so the field is never marked invalid.
    const variationNote = drawer.getByText(/a marketplace that caps this field will reject the value/);
    await variation.fill(variationText);
    await expect(variationNote).toBeVisible();
    await expectOverCapLook(variation, variationNote);
    await expect(variation).not.toHaveAttribute("aria-invalid", "true");
    await expectAccessible(page, { within: drawer, label: "Card detail drawer, over-long variation warned" });
    await variation.press("Enter");
    await expect(page.getByText(/Saved Variation/)).toBeVisible();
    await expect(description).toHaveValue(handWritten);
    await expect(page.getByText(/Description rebuilt/)).toHaveCount(0);
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(cardName).toBeHidden();

    // ── NEO-535: a freshly opened card says what its title left out, and what
    // it was built from, with no Regenerate press ──
    await edit.click();
    await expect(cardName).toBeVisible();
    await expect(drawer.getByText(`Left out to fit: ${variationText}`)).toBeVisible();
    const builtFrom = drawer.getByRole("list", { name: "Title built from" });
    await expect(builtFrom.getByRole("listitem").filter({ hasText: `#${num}` })).toBeVisible();
    await expect(builtFrom.getByRole("listitem").filter({ hasText: team })).toBeVisible();
    // A plain card names no autograph, short print or parallel: none of those
    // is a chip (a chip would claim a fact the card does not have).
    await expect(builtFrom.getByRole("listitem").filter({ hasText: /^(Auto|Short print|Parallel)/ })).toHaveCount(0);
    await expectAccessible(page, { within: drawer, label: "Card detail drawer, opened with what the title left out" });
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(cardName).toBeHidden();

    // The row carries the blue mark, and the checklist counts the card.
    await expect(attentionBadge).toBeVisible();
    // The header's pill (NEO-335): singular for one card, and its visible text
    // is its accessible name, so the exact name is the exact count.
    await expect(needsYouPill(page)).toHaveAccessibleName("1 needs you");
    await expectAccessible(page, { label: "Checklist with a worth-a-check mark for an over-long variation" });

    // ── NEO-645: the walk, opened by hand from the pill ──
    // NEO-497: named for the checklist it tidies (year and set; the checklist is
    // the Base row under Insert, and the walk's name drops a trailing "Base").
    // The listing title does not: under an Insert type a row called Base is an
    // ordinary insert (NEO-609), so its name stays in the title like any level's.
    await openTidyWalk(page, { title: tidyUpName({ year: "2024", set }) });
    await expectCardsLeft(page, 1);
    const walk = tidyWalk(page);
    const titleTile = tidyTile(page, "Listing title");
    // Blue (should check), not pink: the stored title fits, only the variation is over.
    await expect(titleTile).toHaveAccessibleDescription("To check");
    // A title that fits is shown as text with its meter, not opened for editing.
    const shownTitle = titleTile.getByText(generated);
    await expect(shownTitle).toBeVisible();
    const stored = (await shownTitle.textContent()) ?? "";
    expect(stored.length, "the stored title fits the 80 cap").toBeLessThanOrEqual(80);
    await expect(titleTile.getByText(`${stored.length}/80`, { exact: true })).toBeVisible();
    const titleBox = titleTile.getByRole("textbox", { name: `Card title for #${num}`, exact: true });
    await expect(titleBox).toHaveCount(0);
    await expect(titleTile.getByRole("button", { name: "Edit card title", exact: true })).toBeVisible();
    // What the stored title left out (NEO-535), read off the tile.
    const leftOut = titleTile.getByText(`Left out to fit: ${variationText}`, { exact: true });
    await expect(leftOut).toBeVisible();
    // The variation over 65 gets its trim editor, pink with its note (advice, never invalid).
    const trim = titleTile.getByRole("textbox", { name: "Trim the variation", exact: true });
    const trimNote = titleTile.getByText(/a marketplace that caps this field will reject the value/);
    await expect(trim).toHaveValue(variationText);
    await expectOverCapLook(trim, trimNote);
    await expect(trim).not.toHaveAttribute("aria-invalid", "true");
    // Blue never holds the card: Save & next is usable and no "to fix" line shows (R2).
    await expect(tidyFooterButton(page, "saveAndNext", { usable: true })).toBeVisible();
    await expect(mustFixLine(page)).toHaveCount(0);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, Listing title tile with an over-long variation" });

    // ── Regenerate: the variation is never cut (NEO-609), so the rebuilt title is
    // over 80. It is kept in an editor that refuses it, pink, with its meter
    // saying how far over; nothing is saved. ──
    const regenerateOnTile = titleTile.getByRole("button", { name: "Regenerate card title", exact: true });
    const regeneratedOver = `2024 Topps ${set} Base ${variationText}`;
    expect(regeneratedOver.length, "the fixture's rebuilt title is over the cap").toBeGreaterThan(80);
    const overLine = titleTile.getByText("Over the limit, so it opens ready to edit.", { exact: true });
    await regenerateOnTile.click();
    await expect(titleBox).toHaveValue(regeneratedOver);
    await expect(titleBox).toHaveAttribute("aria-invalid", "true");
    await expect(overLine).toBeVisible();
    await expect(titleTile.getByText(`${regeneratedOver.length}/80`, { exact: true })).toBeVisible();
    await expect(titleTile.getByText(`${regeneratedOver.length - 80} over`, { exact: true })).toBeVisible();
    await expect(titleTile.getByRole("button", { name: "Save title", exact: true })).toBeDisabled();
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, regenerated title kept over 80 by its variation" });

    // Typed back to the stored title, it fits and says so; the note names what was left out.
    await titleBox.fill(stored);
    await expect(titleBox).not.toHaveAttribute("aria-invalid", "true");
    await expect(titleTile.getByText("Fits now. Enter saves it.", { exact: true })).toBeVisible();
    await expect(overLine).toHaveCount(0);
    await expect(leftOut).toBeVisible();
    // A line break typed or pasted reads as a space (one line, NEO-535), and puts it back over.
    await titleBox.fill(`${stored}\n${variationText}`);
    await expect(titleBox).toHaveValue(`${stored} ${variationText}`);
    await expect(overLine).toBeVisible();
    // Regenerate over typed text asks once more first.
    await regenerateOnTile.click();
    await expect(titleTile.getByText("Regenerate again to replace the title you have typed.", { exact: true })).toBeVisible();
    await expect(titleBox).toHaveValue(`${stored} ${variationText}`);
    await regenerateOnTile.click();
    await expect(titleBox).toHaveValue(regeneratedOver);
    // The stored title back in, Enter saves it and the editor closes.
    await titleBox.fill(stored);
    await titleBox.press("Enter");
    await expect(titleBox).toHaveCount(0);
    await expect(titleTile.getByRole("button", { name: "Edit card title", exact: true })).toBeVisible();
    await expect(shownTitle).toHaveText(stored);

    // ── The variation trimmed to 65: the note and the pink go, and it saves ──
    await trim.fill(variationText.slice(0, 65));
    await expect(trimNote).toHaveCount(0);
    await expect(titleTile.getByText("65/65", { exact: true })).toBeVisible();
    await expectNoOverCapLook(trim);
    await titleTile.getByRole("button", { name: "Save variation", exact: true }).click();
    await expect(trim).toHaveValue(variationText.slice(0, 65));
    // The only card on the checklist: no other card has the same variation to offer the trim to.
    await expect(titleTile.getByRole("button", { name: /^Apply to the .* with the same variation$/ })).toHaveCount(0);

    // ── Save & next: the card's blue is seen and the walk ends ──
    await saveAndNext(page);
    await expect(walk.getByText("All tidy. Nothing on this checklist needs you.", { exact: true })).toBeVisible();
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, all tidy" });
    // The walk's place is in the address: Back steps to the card, Forward to the end again.
    await page.goBack();
    await expect(page).toHaveURL(/[?&]tidy=(?!done)/);
    await expect(titleTile).toBeVisible();
    await expect(walk.getByText("All tidy. Nothing on this checklist needs you.", { exact: true })).toHaveCount(0);
    await page.goForward();
    await expect(walk.getByText("All tidy. Nothing on this checklist needs you.", { exact: true })).toBeVisible();
    await finishTidyWalk(page);

    // The save WROTE: the row's mark and the pill are gone, the card stays.
    await expect(page.getByText(`#${num}`, { exact: true })).toBeVisible();
    await expect(attentionBadge).toHaveCount(0);
    await expect(needsYouPill(page)).toHaveCount(0);
    // Read back from the card, not the tile's draft: the trim was written (Save & next only
    // marks blue seen, so the gone mark alone would not prove it).
    await edit.click();
    // (The save trims: the 65th character is a space.)
    await expect(variation).toHaveValue(variationText.slice(0, 65).trimEnd());
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(cardName).toBeHidden();
  },
);
