// Origin: .maestro/flows/set-selector/checklist-title-length-limits-and-fixer.yaml (Maestro suite retired in NEO-341; see git history)
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { setBuilderReady, drillToCustom } from "../../support/set-builder";
import { tidyUpName } from "../../support/wizard";
import { expectNoOverCapLook, expectOverCapLook } from "../../support/theme";

test(
  "Listing length limits — an over-long card title is refused, and an over-long variation is walked to a fix",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env, isMobile }) => {
    const id = env.ATTEMPT_ID;
    const num = `101-${id}`;
    const team = `TLF${env.ATTEMPT_TOKEN}`;
    const set = `tlf-${env.WORKER_INDEX}-${id}`;
    const edit = page.getByRole("button", { name: new RegExp(`^Edit card ${num}(, .*)?$`) });
    const cardName = page.getByRole("textbox", { name: "Card name" });
    const cardTitle = page.getByRole("textbox", { name: "Card title", exact: true });
    const attentionBadge = page.getByRole("img", {
      name: new RegExp(`^Card ${num}(, .*)? needs attention: variation text is over the 65-character limit$`),
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

    // The row carries an attention badge, and the checklist counts it.
    await expect(attentionBadge).toBeVisible();
    // The header's amber pill (NEO-335): singular for one card, and its visible
    // text is its accessible name, so the exact name is the exact count.
    const pill = page.getByRole("button", { name: "1 needs you", exact: true });
    await expect(pill).toBeVisible();
    await expectAccessible(page, { label: "Checklist with an attention badge for an over-long variation" });

    // ── Walk it to a fix: opened by hand from the pill (the walker never opens itself) ──
    await pill.click();
    // NEO-497: named for the checklist it tidies (year and set; the checklist is
    // the Base row under Insert, and the walker's name drops a trailing "Base").
    // The listing title does not: under an Insert type a row called Base is an
    // ordinary insert (NEO-609), so its name stays in the title like any level's.
    const fixer = page.getByRole("dialog", { name: tidyUpName({ year: "2024", set }), exact: true });
    await expect(fixer).toBeVisible();
    // The walker and the wizard share title and header; its own Skip control
    // says which this is, and the subtitle names the question (also the
    // progress bar's value text since NEO-467). That this card is the sitting's
    // only one is proved by Save going straight to All clear below.
    await expect(fixer.getByRole("button", { name: `Skip for now, card ${num}` })).toBeVisible();
    await expect(fixer.getByRole("progressbar", { name: "Wizard progress" })).toHaveAttribute(
      "aria-valuetext",
      "Card titles",
    );
    await expect(fixer.getByText("Card titles", { exact: true })).toBeVisible();
    await expect(fixer.getByText("variation text is over the 65-character limit")).toBeVisible();
    await expect(fixer.getByRole("textbox", { name: `Card title for #${num}` })).toHaveValue(generated);
    // NEO-606: the walker's variation box is pink while it is past 65 (advice,
    // never invalid), and lets go the moment it is trimmed to 65 (below).
    const fixerVariation = fixer.getByRole("textbox", { name: `Card variation for #${num}` });
    const fixerVariationNote = fixer.getByText(/a marketplace that caps this field will reject the value/);
    await expect(fixerVariation).toHaveValue(variationText);
    await expectOverCapLook(fixerVariation, fixerVariationNote);
    await expect(fixerVariation).not.toHaveAttribute("aria-invalid", "true");
    await expectAccessible(page, { within: fixer, label: "Attention walker, over-long variation" });

    // NEO-609: the variation is never cut, nor is the row's own name "Base" (an
    // ordinary insert's name here). Regenerate builds the title with the saved
    // variation in hand and makes every other cut (the type name, the team, the
    // number, the sport), and with the 71-character variation it is still over
    // 80 (about 100 characters, by the set name's length), so it is
    // kept over the cap and says so. The "Left out to fit" note is read from
    // the field's text and waits until the text fits: typed back to the stored
    // title (which lacks the variation), the note names the variation, and the
    // variation typed back in takes it off again. Regenerate asks twice over
    // typed text.
    const fixerTitle = fixer.getByRole("textbox", { name: `Card title for #${num}` });
    const fixerRegenerate = fixer.getByRole("button", { name: "Regenerate card title" });
    const fixerLeftOut = fixer.getByText(/^Left out to fit: /);
    const fixerTooLong = fixer.getByText(
      "Too long to list as-is. Trim it here, or shorten the set name for the whole row.",
      { exact: true },
    );
    const regeneratedOver = `2024 Topps ${set} Base ${variationText}`;
    const stored = await fixerTitle.inputValue();
    await fixerRegenerate.click();
    await expect(fixerTitle).toHaveValue(regeneratedOver);
    // What the rebuilt title was built from stays on show beside it.
    await expect(fixer.getByRole("list", { name: "Title built from" })).toBeVisible();
    await expect(fixerTitle).toHaveAttribute("aria-invalid", "true");
    await expect(fixerTooLong).toBeVisible();
    await expect(fixerLeftOut).toHaveCount(0);
    await expectAccessible(page, { within: fixer, label: "Attention walker, regenerated title kept over 80 by its variation" });
    await fixerTitle.fill(stored);
    await expect(fixerTitle).not.toHaveAttribute("aria-invalid", "true");
    await expect(fixerLeftOut).toHaveText(`Left out to fit: ${variationText}`);
    // A line break typed or pasted reads as a space (one line, NEO-535).
    await fixerTitle.fill(`${stored}\n${variationText}`);
    await expect(fixerTitle).toHaveValue(`${stored} ${variationText}`);
    await expect(fixerLeftOut).toHaveCount(0);
    await fixerRegenerate.click();
    await expect(fixer.getByText("Regenerate again to replace the title you have typed.")).toBeVisible();
    await fixerRegenerate.click();
    await expect(fixerTitle).toHaveValue(regeneratedOver);
    // Over the cap, the walker will not save: the stored title goes back in.
    await fixerTitle.fill(stored);
    await expect(fixerLeftOut).toHaveText(`Left out to fit: ${variationText}`);

    await expect(fixer.getByRole("button", { name: /Save \(Enter\)/ })).toBeVisible();
    // Trimmed to 65, the variation fits: the note and the pink go.
    await fixerVariation.fill(variationText.slice(0, 65));
    await expect(fixerVariationNote).toBeHidden();
    await expect(fixer.getByRole("button", { name: /Save \(Enter\)/ })).toBeVisible();
    await expectNoOverCapLook(fixerVariation);
    await fixerVariation.clear();
    await expect(fixerVariationNote).toBeHidden();
    await fixer.getByRole("button", { name: /Save \(Enter\)/ }).click();

    await expect(fixer.getByText(/All clear.*nothing on this checklist needs attention/)).toBeVisible();
    // No "fixed" count any more (NEO-335 Phase 2): the walker has left the card,
    // and that the save WROTE is proved on the grid below, where the badge is gone.
    await expect(fixer.getByRole("button", { name: `Skip for now, card ${num}` })).toBeHidden();
    await expectAccessible(page, { within: fixer, label: "Attention walker, all clear" });
    await fixer.getByRole("button", { name: /Done \(Esc\)/ }).click();
    await expect(fixer).toBeHidden();

    await expect(attentionBadge).toBeHidden();
    await expect(page.getByRole("button", { name: /^[0-9]+ needs? you$/ })).toBeHidden();
    await expect(page.getByText(`#${num}`, { exact: true })).toBeVisible();
  },
);
